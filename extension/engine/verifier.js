/**
 * Fact Verifier Engine (Heuristic Judge).
 *
 * Checks claims against Evidence objects { id, text, source, url, kind }.
 * Implements strict zero-false-accept rules:
 * - Detects numerical and temporal conflicts.
 * - Detects polarity and negation contradictions.
 * - Returns structured Verdict with evidenceId, evidenceUrl, judge, and ISO timestamp.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const STOPWORDS = new Set([
    "a", "an", "the", "in", "on", "at", "to", "for", "with", "by", "from",
    "is", "was", "are", "were", "been", "be", "it", "this", "that", "these",
    "those", "they", "we", "i", "you", "he", "she", "and", "or", "but",
    "of", "as", "if", "so", "then", "there", "what", "which", "who", "whom"
  ]);

  const NEGATION_WORDS = new Set([
    "not", "never", "no", "neither", "nor", "none", "cannot", "n't", "refused", "failed", "denied"
  ]);

  const AUXILIARY_VERBS = new Set(["is", "was", "are", "were", "be", "been", "did", "does", "do", "has", "have", "had", "can", "could", "will", "would", "should", "may", "might"]);

  const NON_ENTITY_WORDS = new Set([
    "The", "This", "That", "These", "Those", "It", "Its", "They", "Them", "We", "You", "He", "She",
    "In", "On", "At", "However", "Furthermore", "Additionally", "Moreover", "Therefore",
    "First", "Second", "Finally", "Also", "Although", "Overview", "Summary", "Result", "Source",
    "Note", "Started", "Completed", "Finished", "Created", "Designed", "Developed", "Financed",
    "Constructed", "Founded", "Written", "Born", "Died", "Located", "Situated", "Based",
    "According", "Following", "Between", "During", "After", "Before", "Since", "Until",
    "About", "From", "Into", "With", "Without", "Under", "Over", "Total", "General",
    "Major", "Key", "Main", "Important", "Actually", "Commonly", "Several", "People",
    "Project", "Concept", "Appearance", "Construction", "Opened", "Purpose", "Built",
    "Who", "What", "Where", "When", "Why", "How", "Which", "Whose", "Whom",
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
  ]);

  const DISCOURSE_WORDS = new Set([
    "interestingly", "eventually", "specifically", "commonly", "actually",
    "basically", "essentially", "later", "however", "additionally",
    "therefore", "generally", "arguably", "notably", "so", "then",
    "furthermore", "moreover", "indeed", "certainly", "primarily", "mostly"
  ]);

  // A relation word in the claim is satisfied by any word of its group in the passage.
  // "born in London" must not pass on "living in London", so relations are never simply optional.
  // Groups are deliberately narrow: founding a company, inventing something and writing a book are
  // different facts ("co-authored ... 1995" must not confirm "founded in 1995").
  const RELATION_GROUPS = [
    ["born", "birth", "birthplace", "native"],
    ["died", "death", "die", "buried"],
    ["founded", "founder", "founding", "cofounded", "cofounder", "established", "incorporated", "formed"],
    ["created", "creator", "designed", "designer", "developed", "developer", "invented", "inventor", "conceived"],
    ["wrote", "written", "writer", "author", "authored", "penned", "novel"],
    ["painted", "painting", "painter"],
    ["won", "received", "awarded", "award", "winner", "recipient", "laureate"],
    ["released", "release", "launched", "introduced", "debuted"],
    ["published", "publication", "publisher"],
    ["completed", "built", "constructed", "finished", "opened", "construction", "completion", "erected"],
    ["sank", "sunk", "sinking", "sink"],
    ["landed", "landing", "land"],
    ["dedicated", "dedication", "unveiled"],
  ];
  const RELATION_GROUP_OF = new Map();
  RELATION_GROUPS.forEach((group, i) => group.forEach((word) => RELATION_GROUP_OF.set(word, i)));
  // Location verbs are rarely repeated ("a tower ... in Paris"); the subject-before-detail rule covers them
  const LOCATION_WORDS = new Set(["located", "situated", "based", "lies", "sits", "headquartered"]);

  const YEAR_REGEX = /\b(?:1[5-9]|20)\d{2}\b/g;
  const NUMERIC_REGEX = /\b\d+(?:\.\d+)?\b/g;

  function stemToken(word) {
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
      return word.slice(0, -1);
    }
    return word;
  }

  function tokenize(text) {
    const cleaned = (text || "")
      .replace(/&/g, " and ")
      .replace(/'s\b/gi, "s")
      .replace(/\((?:see|per|source|ref)[^)]*\)/gi, " ")
      .replace(/,\s*(?:per|according to)\s+[^,.]*/gi, " ")
      .replace(/\[[^\]]*\](?:\([^)]*\))?/g, " ")
      .replace(/\[\d+\]/g, " ");
    const words = cleaned.toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    return new Set(words.filter((w) => !STOPWORDS.has(w)).map(stemToken));
  }

  function hasNegation(text) {
    // "No. Canberra is the capital" answers a question; the "No" doesn't negate the statement after it
    const statement = String(text || "").replace(/^\s*(?:no|nope)\s*[.,!;:—–-]+\s*/i, "");
    const words = statement.toLowerCase().match(/\b[a-z']+\b/g) || [];
    return words.some((w) => NEGATION_WORDS.has(w) || w.endsWith("n't"));
  }

  function extractYears(text) {
    return (text || "").match(YEAR_REGEX) || [];
  }

  function extractNumbers(text) {
    return (text || "").match(NUMERIC_REGEX) || [];
  }

  function computeOverlap(claimText, evidenceText) {
    const tokensA = tokenize(claimText);
    const tokensB = tokenize(evidenceText);
    if (!tokensA.size || !tokensB.size) return 0.0;

    let matchCount = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        matchCount++;
      }
    }
    return matchCount / tokensA.size;
  }

  // Common nouns inside names. "North Sea" and "Black Sea" share "Sea", and "Mount Kenya" isn't
  // Kilimanjaro: when a name contains one of these, its other words have to be present too.
  const GENERIC_NAME_WORDS = new Set([
    "sea", "ocean", "river", "lake", "bay", "gulf", "strait", "channel", "canal", "island", "islands",
    "peninsula", "cape", "coast", "desert", "valley", "mount", "mountain", "mountains", "range", "falls",
    "forest", "park", "tower", "bridge", "wall", "gate", "palace", "castle", "cathedral", "church", "temple",
    "museum", "university", "college", "station", "airport", "square", "street", "city", "county", "state",
    "province", "region", "district", "kingdom", "empire", "republic", "war", "battle", "treaty", "prize",
    "award", "company", "party", "house", "hall", "centre", "center", "theatre", "theater", "building",
    "hotel", "stadium", "arena", "library", "school", "institute", "hospital", "garden", "gardens",
    "monument", "memorial", "cathedral", "basilica", "square", "dam", "canyon", "cave", "falls",
  ]);

  // Countries, their nations and states, continents and large regions. "Born in Scotland" can't
  // conflict with "born in Lochfield" (a farm in Scotland): when either side of a place slot is a
  // region, word matching can't tell, so it leaves the call to Wikidata's place check.
  const REGION_NAMES = new Set([
    "afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia", "australia", "austria",
    "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belgium", "belize", "benin",
    "bhutan", "bolivia", "bosnia", "botswana", "brazil", "brunei", "bulgaria", "burkina faso", "burundi",
    "cambodia", "cameroon", "canada", "chad", "chile", "china", "colombia", "congo", "costa rica", "croatia",
    "cuba", "cyprus", "czech republic", "czechia", "denmark", "djibouti", "dominica", "dominican republic",
    "ecuador", "egypt", "el salvador", "eritrea", "estonia", "eswatini", "ethiopia", "fiji", "finland",
    "france", "gabon", "gambia", "georgia", "germany", "ghana", "greece", "grenada", "guatemala", "guinea",
    "guyana", "haiti", "honduras", "hungary", "iceland", "india", "indonesia", "iran", "iraq", "ireland",
    "israel", "italy", "ivory coast", "jamaica", "japan", "jordan", "kazakhstan", "kenya", "kiribati",
    "korea", "north korea", "south korea", "kosovo", "kuwait", "kyrgyzstan", "laos", "latvia", "lebanon",
    "lesotho", "liberia", "libya", "liechtenstein", "lithuania", "luxembourg", "madagascar", "malawi",
    "malaysia", "maldives", "mali", "malta", "mauritania", "mauritius", "mexico", "micronesia", "moldova",
    "monaco", "mongolia", "montenegro", "morocco", "mozambique", "myanmar", "burma", "namibia", "nauru",
    "nepal", "netherlands", "holland", "new zealand", "nicaragua", "niger", "nigeria", "norway", "oman",
    "pakistan", "palau", "palestine", "panama", "papua new guinea", "paraguay", "peru", "philippines",
    "poland", "portugal", "qatar", "romania", "russia", "rwanda", "samoa", "san marino", "saudi arabia",
    "senegal", "serbia", "seychelles", "sierra leone", "singapore", "slovakia", "slovenia", "somalia",
    "south africa", "south sudan", "spain", "sri lanka", "sudan", "suriname", "sweden", "switzerland",
    "syria", "taiwan", "tajikistan", "tanzania", "thailand", "togo", "tonga", "trinidad", "tunisia",
    "turkey", "turkmenistan", "tuvalu", "uganda", "ukraine", "united arab emirates", "uae",
    "united kingdom", "uk", "britain", "great britain", "united states", "usa", "us", "america",
    "uruguay", "uzbekistan", "vanuatu", "vatican", "venezuela", "vietnam", "yemen", "zambia", "zimbabwe",
    "england", "scotland", "wales", "northern ireland", "prussia", "bavaria", "saxony", "catalonia",
    "tibet", "kashmir", "siberia", "scandinavia", "lapland", "patagonia", "anatolia", "sicily", "sardinia",
    "corsica", "crete", "tasmania", "hawaii", "alaska", "texas", "california", "florida", "new york",
    "ohio", "virginia", "pennsylvania", "illinois", "michigan", "massachusetts", "washington", "arizona",
    "colorado", "nevada", "oregon", "utah", "kentucky", "tennessee", "louisiana", "alabama", "missouri",
    "minnesota", "wisconsin", "iowa", "kansas", "nebraska", "oklahoma", "arkansas", "mississippi",
    "indiana", "maryland", "delaware", "new jersey", "connecticut", "vermont", "maine", "montana", "idaho",
    "wyoming", "carolina", "north carolina", "south carolina", "dakota", "north dakota", "south dakota",
    "new hampshire", "rhode island", "new mexico", "west virginia", "ontario", "quebec", "british columbia",
    "alberta", "manitoba", "saskatchewan", "nova scotia", "queensland", "victoria", "new south wales",
    "maharashtra", "gujarat", "punjab", "bengal", "west bengal", "kerala", "tamil nadu", "karnataka",
    "rajasthan", "bihar", "uttar pradesh", "andhra pradesh", "telangana", "assam", "odisha", "goa",
    "europe", "asia", "africa", "antarctica", "oceania", "north america", "south america", "latin america",
    "middle east", "east asia", "southeast asia", "central asia", "eastern europe", "western europe",
    "the himalayas", "himalayas", "andes", "alps", "sahara", "amazon", "balkans", "caribbean", "arctic",
  ]);
  const GEO_SLOTS = new Set(["located in", "situated in", "based in", "born in", "died in"]);

  /** Does this place text start with a country or region name ("Scotland", "the United States")? */
  function startsWithRegion(text) {
    const words = String(text || "").toLowerCase().replace(/^\s*the\s+/, "").match(/[a-z]+/g) || [];
    for (let n = Math.min(4, words.length); n >= 1; n--) {
      if (REGION_NAMES.has(words.slice(0, n).join(" "))) return true;
    }
    return false;
  }
  const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Is every mention of this word the start of a longer name? "New York" in "The New York Times" or
   * "Eiffel" in "Eiffel Tower" names something else.
   */
  function onlyInLongerNames(word, passageOriginal) {
    let mentioned = false;
    for (const match of String(passageOriginal || "").matchAll(new RegExp(`\\b${escapeRegex(word)}s?\\b`, "gi"))) {
      mentioned = true;
      const next = passageOriginal.slice(match.index + match[0].length).match(/^ +([A-Z][a-z]+)/);
      if (!next || NON_ENTITY_WORDS.has(next[1])) return false;
    }
    return mentioned;
  }

  /** Does this passage (or its page's topic) mention the name? */
  function entityInPassage(ent, passageLower, topic, passageOriginal) {
    const entLower = String(ent || "").toLowerCase();
    const topicLower = String(topic || "").toLowerCase();
    if (topicLower && (topicLower.includes(entLower) || entLower.includes(topicLower))) return true;
    const words = entLower.split(/[\s\-]+/).filter((w) => w.length > 2);
    if (!words.length) return false;
    // People are often named by surname alone ("Einstein"), so the last word is enough...
    const last = stemToken(words[words.length - 1]);
    if (!new RegExp(`\\b${escapeRegex(last)}s?\\b`, "i").test(passageLower)) return false;
    // Only for multi-word names: a lone title-cased word is often just a common noun ("Masters Degrees")
    if (words.length > 1 && passageOriginal && onlyInLongerNames(last, passageOriginal)) return false;
    // ...unless the name is built on a common noun: then its distinctive words must be there too
    if (words.length > 1 && words.some((w) => GENERIC_NAME_WORDS.has(w))) {
      return words
        .filter((w) => !GENERIC_NAME_WORDS.has(w))
        .every((w) => new RegExp(`\\b${escapeRegex(stemToken(w))}`, "i").test(passageLower));
    }
    return true;
  }

  const MAX_ATTACH_GAP = 10; // words between the subject and a detail
  const MAX_CANDIDATES = 5; // passages each claim is judged against
  const SUBJECT_PRONOUNS = new Set(["it", "its", "he", "his", "she", "her", "they", "their", "the"]);

  function wordsOf(text) {
    return (String(text || "").toLowerCase().match(/\b[a-z0-9]+\b/g) || []).filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(stemToken);
  }

  // Brackets holding only dates and numbers, like life dates in "Isaac Newton (25 December 1642 –
  // 20 March 1726/27) was an English mathematician". They don't move the words after them away
  // from the subject; their own words sit where the bracket opens.
  const DATE_ASIDE = /\((?:[^()a-z]|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|born|died|b|d|c|ca|circa|bc|ad|bce|ce|o|n|s)\b)*\)/g;

  // Any other bracket (pronunciations, native names, "lit." translations) takes no distance either,
  // but what's inside it is never attached: a name in a bracket is a side remark
  const BRACKET = /\((?:[^()]|\([^()]*\))*\)|\[[^\]]*\]/g;
  const DETACHED = 1e9;

  /**
   * The passage's meaningful words, each with its distance coordinate for the attachment check.
   * `sentenceStart` marks a word that opens a sentence ("It is the highest mountain in Japan").
   */
  function attachmentWords(passageLower) {
    const words = [];
    let coord = 0;
    let atStart = true;
    const push = (segment, mode) => {
      for (const match of segment.matchAll(/[a-z0-9]+|[.!?](?=\s|$)/g)) {
        const w = match[0];
        if (/^[.!?]$/.test(w)) {
          atStart = true;
          continue;
        }
        // Distance counts meaningful words only, so "in the ... and in" filler doesn't push details apart
        if (!(/^\d+$/.test(w) || (SUBJECT_PRONOUNS.has(w) && w !== "the") || (w.length > 2 && !STOPWORDS.has(w)))) {
          if (mode === "text") atStart = false;
          continue;
        }
        words.push({ w, coord: mode === "bracket" ? DETACHED : coord, sentenceStart: mode === "text" && atStart });
        if (mode === "text") {
          coord++;
          atStart = false;
        }
      }
    };
    // Date-only brackets keep their numbers next to the subject ("Isaac Newton (25 December 1642 – …)")
    let last = 0;
    for (const bracket of passageLower.matchAll(BRACKET)) {
      push(passageLower.slice(last, bracket.index), "text");
      DATE_ASIDE.lastIndex = 0;
      push(bracket[0], new RegExp(`^${DATE_ASIDE.source}$`).test(bracket[0]) ? "date" : "bracket");
      last = bracket.index + bracket[0].length;
    }
    push(passageLower.slice(last), "text");
    return words;
  }

  function findDetachedDetail(claimText, claimEntities, claimNums, passageLower, topic) {
    const text = String(claimText || "");
    const tokens = attachmentWords(passageLower);
    const evWords = tokens.map((token) => token.w);
    const ordered = [...claimEntities].filter((e) => text.includes(e)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
    if (!ordered.length) return null;

    // Anchor on the subject's distinctive words: "Mount" in "Mount Kenya" isn't Mount Kilimanjaro
    const allSubjectWords = wordsOf(ordered[0]);
    const distinctiveWords = allSubjectWords.filter((w) => !GENERIC_NAME_WORDS.has(w));
    const subjectWords = new Set(distinctiveWords.length ? distinctiveWords : allSubjectWords);
    const topicWords = new Set(wordsOf(topic));
    const namedInPassage = evWords.some((w) => subjectWords.has(stemToken(w)));
    const topicIsSubject = [...subjectWords].some((w) => topicWords.has(w));

    const anchors = [];
    evWords.forEach((word, i) => {
      const stem = stemToken(word);
      if (tokens[i].coord === DETACHED) return;
      if (subjectWords.has(stem)) anchors.push(i);
      else if (!namedInPassage && topicIsSubject && (topicWords.has(stem) || (SUBJECT_PRONOUNS.has(word) && word !== "the"))) anchors.push(i);
      // A sentence opening with "It" after one naming the subject is about the subject ("Mount Fuji is
      // ... on Honshu. It is the highest mountain in Japan"). "He/She" only on the subject's own page:
      // after "designed by Gustave Eiffel", "He" is Eiffel, not the tower.
      else if (tokens[i].sentenceStart && (namedInPassage || topicIsSubject) && (word === "it" || word === "its" || (topicIsSubject && ["he", "his", "she", "her"].includes(word)))) anchors.push(i);
    });
    if (!anchors.length) return null; // entity checks above already cover a missing subject

    const details = [];
    for (const entity of ordered.slice(1)) {
      const words = wordsOf(entity).filter((w) => !subjectWords.has(w));
      if (words.length) details.push({ label: entity, token: words[words.length - 1] });
    }
    for (const number of claimNums) details.push({ label: number, token: number, isNumber: true });

    for (const detail of details) {
      const positions = [];
      evWords.forEach((word, i) => {
        if (stemToken(word) === detail.token) positions.push(i);
      });
      if (!positions.length) continue; // absence is handled by the entity and coverage checks
      // Names must come after the subject ("Eiffel Tower ... in Paris"), unless the subject is
      // introduced by "by" ("Hamlet was written by Shakespeare"). Numbers can sit on either side.
      const attached = positions.some((p) =>
        tokens[p].coord !== DETACHED &&
        anchors.some((a) => {
          if (Math.abs(tokens[p].coord - tokens[a].coord) > MAX_ATTACH_GAP) return false;
          if (detail.isNumber || a < p) return true;
          return a > 0 && evWords[a - 1] === "by";
        }),
      );
      if (!attached) return detail.label;
    }
    return null;
  }

  /** Is there a negation word right before one of the claim's own words in the passage? */
  function negatesClaimWords(passage, claimTokens, subjectWords) {
    // Possessives count as the name itself ("China's" is "China"), as in tokenize()
    const original = (String(passage || "").match(/\b[A-Za-z0-9']+\b/g) || []).map((word) => word.replace(/'s$/i, ""));
    const words = original.map((word) => word.toLowerCase());
    for (let i = 0; i < words.length; i++) {
      if (!NEGATION_WORDS.has(words[i]) && !words[i].endsWith("n't")) continue;
      // "Tokyo is the capital of Japan, not of China" denies China, not a claim about Japan:
      // a name the claim doesn't mention right after the "not" means it's about something else
      const otherName = original.slice(i + 1, i + 5).some((word, k) => {
        const stem = stemToken(words[i + 1 + k]);
        return /^[A-Z][a-z]/.test(word) && !NON_ENTITY_WORDS.has(word) && !claimTokens.has(stem) && !subjectWords.has(stem);
      });
      if (otherName) continue;
      // ...and "Toronto is not Canada's capital" denies Toronto, not "Ottawa is the capital of Canada":
      // a name right before "is/was/did… not" is who the denial is about. (In "is in Paris, France,
      // not in Lyon" there's no such verb, so France doesn't own the "not".)
      let k = i - 1;
      while (k >= 0 && AUXILIARY_VERBS.has(words[k])) k--;
      const owner = k >= 0 && k < i - 1 && /^[A-Z][a-z]/.test(original[k]) && !NON_ENTITY_WORDS.has(original[k]) ? stemToken(words[k]) : null;
      if (owner && !claimTokens.has(owner) && !subjectWords.has(owner)) continue;
      for (let j = i + 1; j <= i + 4 && j < words.length; j++) {
        const stem = stemToken(words[j]);
        if (claimTokens.has(stem) && !subjectWords.has(stem)) return true;
      }
    }
    return false;
  }

  function normalizeEvidence(evidenceList) {
    if (!Array.isArray(evidenceList)) return [];
    return evidenceList.map((e, idx) => {
      if (typeof e === "string") {
        return {
          id: `ev_${idx + 1}`,
          text: e,
          source: "provided",
          url: null,
          kind: "page",
        };
      }
      return {
        id: e.id || `ev_${idx + 1}`,
        text: e.text || "",
        source: e.source || "evidence",
        url: e.url || null,
        kind: e.kind || "page",
        topic: e.topic || null,
        exact: Boolean(e.exact),
      };
    });
  }

  function verifyClaim(claim, rawEvidenceList) {
    const evidenceList = normalizeEvidence(rawEvidenceList);
    const timestamp = new Date().toISOString();
    const claimWeight = typeof claim.weight === "number" ? claim.weight : 1.0;

    if (!evidenceList.length) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "unsupported",
        confidence: 0.0,
        weight: claimWeight,
        evidenceId: null,
        evidenceText: null,
        evidenceUrl: null,
        reasoning: "No evidence passages available.",
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    const ranked = [];

    // Pre-extract entities to evaluate topic relevance and passage ranking
    const claimEntities = new Set(claim.entities || []);
    if (!claim.entities || claim.entities.length === 0) {
      const capMatches = claim.text.match(/(?<!\p{L})[\p{Lu}][\p{L}]+(?:[\s\-]+(?:of|upon|the|de|van|von|da|la|le)[\s\-]+[\p{Lu}][\p{L}]+|[\s\-]+[\p{Lu}][\p{L}]+)*(?!\p{L})/gu) || [];
      const firstWordMatch = claim.text.trim().match(/^([\p{Lu}][\p{L}]+)\b/u);
      const firstWord = firstWordMatch ? firstWordMatch[1] : null;
      for (const c of capMatches) {
        if (!NON_ENTITY_WORDS.has(c) && c !== firstWord && c.length > 2) {
          claimEntities.add(c);
        }
      }
    }
    const claimNums = extractNumbers(claim.text);
    const firstEntity = [...claimEntities].sort((a, b) => claim.text.indexOf(a) - claim.text.indexOf(b))[0];
    const subjectKey = firstEntity ? stemToken(firstEntity.toLowerCase().split(/[s-]+/).filter((w) => w.length > 2).pop() || "") : "";
    const claimRelationGroups = [...tokenize(claim.text)].map((t) => RELATION_GROUP_OF.get(t)).filter((g) => g !== undefined);

    for (const ev of evidenceList) {
      const overlapScore = computeOverlap(claim.text, ev.text);
      const evLower = ev.text.toLowerCase();
      let entityMatchCount = 0;
      for (const ent of claimEntities) {
        const entWords = ent.toLowerCase().split(/[\s\-]+/).filter((w) => w.length > 2);
        if (entWords.length === 0) continue;
        if (entityInPassage(ent, evLower, ev.topic, ev.text)) entityMatchCount++;
      }
      
      let numMatchCount = 0;
      const evNums = extractNumbers(ev.text);
      for (const n of claimNums) {
        if (evNums.includes(n)) numMatchCount++;
      }

      const rankingScore = (entityMatchCount * 10) + (numMatchCount * 10) + overlapScore;
      // Subject + same relation ("Gandhi ... born") finds the sentence that can refute a wrong detail,
      // even when passages repeating the wrong detail ("Delhi") outrank it
      const evTokens = tokenize(ev.text);
      const subjectPresent = subjectKey && (evTokens.has(subjectKey) || (ev.topic || "").toLowerCase().includes(subjectKey));
      const relationPresent = claimRelationGroups.some((g) => RELATION_GROUPS[g].some((w) => evTokens.has(stemToken(w))));
      const relationScore = subjectPresent && relationPresent ? 20 + overlapScore : -1;
      ranked.push({ ev, overlapScore, rankingScore, topicScore: (entityMatchCount * 10) + overlapScore, relationScore });
    }
    ranked.sort((a, b) => b.rankingScore - a.rankingScore);

    // Judges the claim against one passage. verifyClaim runs this on the top few passages,
    // since the highest-ranked one is often not the sentence that actually decides the claim.
    const judge = (bestEvidence, bestScore) => {

    if (!bestEvidence || bestScore < 0.25) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "unsupported",
        confidence: Math.round((1.0 - bestScore) * 100) / 100,
        weight: claimWeight,
        evidenceId: null,
        evidenceText: null,
        evidenceUrl: null,
        reasoning: `Insufficient semantic overlap (${bestScore.toFixed(2)}) with available sources.`,
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    const evidenceTextLower = bestEvidence.text.toLowerCase();
    const claimTextLower = claim.text.toLowerCase();

    // Check if at least one named entity from the claim appears in the evidence
    const hasNamedEntityInEvidence = Array.from(claimEntities).some((ent) => {
      const entWords = ent.toLowerCase().split(/[\s\-]+/).filter((w) => w.length > 2);
      if (entWords.length === 0) return false;
      return entityInPassage(ent, evidenceTextLower, bestEvidence.topic, bestEvidence.text);
    });

    // 1. Check Temporal / Year Contradiction (C-27: require bestScore >= 0.50 OR claim entity in passage)
    // A different year only contradicts the claim if the passage is about the same event:
    // "founded in 1995" vs "founded ... 1975" conflicts; vs "released Windows in 1985" doesn't
    const passageTokens = tokenize(bestEvidence.text);
    const claimRelations = [...tokenize(claim.text)].map((t) => RELATION_GROUP_OF.get(t)).filter((g) => g !== undefined);
    const sameRelation = !claimRelations.length || claimRelations.some((g) => RELATION_GROUPS[g].some((w) => passageTokens.has(stemToken(w))));
    const claimYears = extractYears(claim.text);
    const evidenceYears = extractYears(bestEvidence.text);
    if (claimYears.length > 0 && evidenceYears.length > 0) {
      const yearMatches = claimYears.some((y) => evidenceYears.includes(y));
      if (!yearMatches && sameRelation && (bestScore >= 0.50 || (hasNamedEntityInEvidence && bestScore >= 0.25))) {
        return {
          claimId: claim.id,
          claimText: claim.text,
          status: "contradicted",
          confidence: 0.95,
          weight: claimWeight,
          evidenceId: bestEvidence.id,
          evidenceText: bestEvidence.text,
          evidenceUrl: bestEvidence.url,
          reasoning: `Year mismatch: Claim states ${claimYears.join(", ")} but source states ${evidenceYears.join(", ")}.`,
          conflictKind: "year",
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }
    }

    // 2. Check Numerical Contradiction (C-27: ignore currency/unit mismatches, require >= 0.50 OR entity in passage)
    const evidenceNums = extractNumbers(bestEvidence.text);
    if (claimNums.length > 0 && evidenceNums.length > 0) {
      const numMatches = claimNums.some((n) => evidenceNums.includes(n));
      const CURRENCY_REGEX = /[$€£₹¥₽₩]|\b(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CNY|Rs|Rupees)\b/i;
      const claimHasCurrency = CURRENCY_REGEX.test(claim.text);
      const evidenceHasCurrency = CURRENCY_REGEX.test(bestEvidence.text);
      const currencyMismatch = claimHasCurrency && !evidenceHasCurrency;

      if (!numMatches && !currencyMismatch && sameRelation && (bestScore >= 0.50 || (hasNamedEntityInEvidence && bestScore >= 0.35))) {
        return {
          claimId: claim.id,
          claimText: claim.text,
          status: "contradicted",
          confidence: 0.9,
          weight: claimWeight,
          evidenceId: bestEvidence.id,
          evidenceText: bestEvidence.text,
          evidenceUrl: bestEvidence.url,
          reasoning: `Numerical mismatch: Claim numbers [${claimNums.join(", ")}] contradict source [${evidenceNums.join(", ")}].`,
          conflictKind: "number",
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }
    }

    // 3. Check Polarity / Negation Contradiction. A "not" only counts when it sits right before
    // the claim's own words ("is not visible"), not anywhere in a long passage or quote.
    const subjectOfClaim = [...claimEntities].sort((a, b) => claim.text.indexOf(a) - claim.text.indexOf(b))[0];
    const subjectWordSet = new Set(wordsOf(subjectOfClaim || ""));
    const claimNeg = hasNegation(claim.text);
    const evidenceNeg = negatesClaimWords(bestEvidence.text, tokenize(claim.text), subjectWordSet);
    // Like a year or number conflict, a "not" only contradicts a passage about the same subject: one of
    // the claim's names in it, or most of the claim's words ("I can explain the plot" vs a TV recap)
    if (claimNeg !== evidenceNeg && bestScore >= 0.35 && (hasNamedEntityInEvidence || bestScore >= 0.6)) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "contradicted",
        confidence: Math.round(Math.min(1.0, bestScore + 0.2) * 100) / 100,
        weight: claimWeight,
        evidenceId: bestEvidence.id,
        evidenceText: bestEvidence.text,
        evidenceUrl: bestEvidence.url,
        reasoning: "Polarity conflict detected between claim and source.",
        // A structured check's "not" (Wikidata: "Toronto is not Canada's capital") outweighs a loose
        // word match elsewhere ("Its capital is Ottawa ... Toronto"): the claim can't stay supported
        conflictKind: bestEvidence.exact ? "slot-single" : "polarity",
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    // 4. Entity and Specific Term Verification (Zero False Accepts, C-12 & C-15)
    const missingEntities = [];

    for (const ent of claimEntities) {
      const entLower = ent.toLowerCase();
      const entWords = entLower.split(/[\s\-]+/).filter((w) => w.length > 2);
      if (entWords.length === 0) continue;
      
      if (!entityInPassage(ent, evidenceTextLower, bestEvidence.topic, bestEvidence.text)) missingEntities.push(ent);
    }

    if (missingEntities.length > 0) {
      // Check for slot replacement (e.g. "located in", "prize in", "born in", "capital of", "founded by")
      const slotPhrases = [
        "located in", "situated in", "based in", "born in", "died in",
        "prize in", "award in", "founded by", "invented by", "created by",
        "capital of", "designed by", "written by", "discovered by"
      ];

      // Some slots can hold several true answers (two prizes, several founders), so a conflict there
      // only counts when no other passage supports the claim
      const MULTI_VALUED = new Set(["prize in", "award in", "founded by", "invented by", "created by", "designed by", "written by", "discovered by"]);
      let slotPhrase = "";
      let isSlotConflict = false;
      let conflictDetail = "";

      // A different value only conflicts when the passage is about the claim's subject, the names
      // before the slot: "The capital of China is Beijing" says nothing against "Tokyo is the capital
      // of Japan". With no name before it ("It is located in Berlin") the subject is unknown.
      const aboutSubject = (phrase) => {
        const before = claim.text.slice(0, claimTextLower.indexOf(phrase));
        const named = [...claimEntities].filter((ent) => before.includes(ent));
        return !named.length || named.some((ent) => {
          const last = stemToken(ent.toLowerCase().split(/[\s\-]+/).filter((w) => w.length > 2).pop() || "");
          const topicLower = (bestEvidence.topic || "").toLowerCase();
          return (last && new RegExp(`\\b${last}s?\\b`, "i").test(evidenceTextLower)) || (topicLower && topicLower.includes(ent.toLowerCase()));
        });
      };

      for (const phrase of slotPhrases) {
        if (claimTextLower.includes(phrase) && evidenceTextLower.includes(phrase) && aboutSubject(phrase)) {
          // Both have the slot phrase; check if what follows in claim is missing from evidence
          const claimAfter = claimTextLower.split(phrase)[1] || "";
          const claimAfterTokens = claimAfter.match(/\b[a-z0-9]+\b/g) || [];
          // Look at every occurrence: "Prize in Physics (1903) and the Prize in Chemistry" has two.
          // A denied one ("is not the capital of China") states no value.
          const segments = evidenceTextLower.split(phrase);
          // A region on either side of a place slot can't be compared by words (see REGION_NAMES)
          const geo = GEO_SLOTS.has(phrase);
          if (geo && startsWithRegion(claimAfter)) continue;
          const evidenceFirstTokens = segments
            .slice(1)
            .filter((after, k) => !/\b(?:not|never|no)\b(?:\s+\S+){0,2}\s*$|n't\s+(?:\S+\s+){0,2}$/.test(segments[k]))
            .filter((after) => !(geo && startsWithRegion(after)))
            .map((after) => (after.match(/\b[a-z0-9]+\b/g) || [])[0])
            .filter(Boolean);

          if (claimAfterTokens.length > 0 && evidenceFirstTokens.length > 0 && !evidenceFirstTokens.includes(claimAfterTokens[0])) {
            isSlotConflict = true;
            slotPhrase = phrase;
            conflictDetail = `Slot conflict on '${phrase}': claim specifies '${claimAfterTokens[0]}' while evidence has '${evidenceFirstTokens.join("', '")}'.`;
            break;
          }
        }
      }

      if (isSlotConflict) {
        return {
          claimId: claim.id,
          claimText: claim.text,
          status: "contradicted",
          confidence: 0.92,
          weight: claimWeight,
          evidenceId: bestEvidence.id,
          evidenceText: bestEvidence.text,
          evidenceUrl: bestEvidence.url,
          reasoning: conflictDetail,
          conflictKind: MULTI_VALUED.has(slotPhrase) ? "slot-multi" : "slot-single",
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }

      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "unsupported",
        confidence: Math.round(bestScore * 100) / 100,
        weight: claimWeight,
        evidenceId: bestEvidence.id,
        evidenceText: bestEvidence.text,
        evidenceUrl: bestEvidence.url,
        reasoning: `Key entity '${missingEntities.join(", ")}' not confirmed by source passage.`,
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    // 5. Attachment: the claim's details (other names, numbers) must sit next to its subject in
    // the passage. In "...the Eiffel Tower's wireless station ... transmitters located in Berlin",
    // every word is present but "Berlin" belongs to "transmitters", not to the tower.
    const claimTokens = tokenize(claim.text);
    const evWords = evidenceTextLower.match(/\b[a-z0-9]+\b/g) || [];
    const detached = findDetachedDetail(claim.text, claimEntities, claimNums, evidenceTextLower, bestEvidence.topic);
    if (detached) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "unsupported",
        confidence: Math.round(bestScore * 100) / 100,
        weight: claimWeight,
        evidenceId: bestEvidence.id,
        evidenceText: bestEvidence.text,
        evidenceUrl: bestEvidence.url,
        reasoning: `'${detached}' appears in the source, but not next to what the claim is about.`,
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    // 6. Content Token Coverage Check (C-20 & C-23: short claims need every content word, discourse words ignored)
    const nonRequiredTokens = new Set([...DISCOURSE_WORDS, ...LOCATION_WORDS]);
    for (const ent of claimEntities) {
      const entTokens = Array.from(tokenize(ent));
      // Exclude all but the last word (the "surname" or distinctive part), except in names built on a
      // common noun: "North" is what makes "North Sea" a different sea from the Black Sea
      if (entTokens.length > 1 && !entTokens.some((t) => GENERIC_NAME_WORDS.has(t))) {
        for (let i = 0; i < entTokens.length - 1; i++) {
          nonRequiredTokens.add(entTokens[i]);
        }
      }
    }
    
    const contentTokens = Array.from(claimTokens).filter((t) => !nonRequiredTokens.has(t));
    const n = contentTokens.length;
    let missingContentCount = 0;
    const missingTokens = [];
    // Words of the page's topic count as present ("she" on Marie Curie's page); the attachment
    // check above already made sure the details sit next to a stand-in for the subject
    const evTokenSet = new Set([...evWords.map(stemToken), ...tokenize(bestEvidence.topic || "")]);
    const hasRelation = (token) => {
      const group = RELATION_GROUP_OF.get(token);
      return group !== undefined && RELATION_GROUPS[group].some((word) => evTokenSet.has(stemToken(word)));
    };
    for (const t of contentTokens) {
      if (!evTokenSet.has(t) && !hasRelation(t)) {
        missingContentCount++;
        missingTokens.push(t);
      }
    }
    const maxAllowedMissing = Math.floor(n / 8);
    if (missingContentCount > maxAllowedMissing) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "unsupported",
        confidence: Math.round(bestScore * 100) / 100,
        weight: claimWeight,
        evidenceId: bestEvidence.id,
        evidenceText: bestEvidence.text,
        evidenceUrl: bestEvidence.url,
        reasoning: `Missing key content word(s) [${missingTokens.join(", ")}] from evidence passage.`,
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    // 6b. "S is the capital of X" needs the passage to say S is X's capital today. Word overlap alone
    // isn't enough: "Rio de Janeiro ... is the capital ... of the state of Rio de Janeiro ... in Brazil"
    // and "Its capital is Ottawa ... largest cities are Toronto" contain every word of a wrong claim.
    const capitalClaim = /^(.+?)\s+(?:is|are)\s+the\s+capital(?:\s+city)?\s+of\s+(?:the\s+)?([\p{L}'-]+)/iu.exec(claim.text.trim());
    if (capitalClaim) {
      const subjectWord = escapeRegex(stemToken((wordsOf(capitalClaim[1]).pop() || "").toLowerCase()));
      const place = escapeRegex(capitalClaim[2].toLowerCase());
      const placeIsTopic = Boolean(bestEvidence.topic && bestEvidence.topic.toLowerCase().includes(capitalClaim[2].toLowerCase()));
      const ofPlace =
        new RegExp(`\\bcapital\\b(?:\\s+[\\w'-]+){0,5}?\\s+of\\s+(?:the\\s+)?${place}\\b|\\b${place}(?:'s)?\\s+capital\\b`, "i").test(evidenceTextLower) ||
        (placeIsTopic && /\bits\s+capital\b/i.test(evidenceTextLower));
      const isSubject = Boolean(subjectWord) && (
        new RegExp(`\\b${subjectWord}s?\\b[^.;]{0,80}?\\b(?:is|remains|serves as)\\s+(?:the\\s+|its\\s+)?capital\\b`, "i").test(evidenceTextLower) ||
        new RegExp(`\\bcapital(?:\\s+city)?(?:\\s+is|,)\\s+(?:the\\s+city\\s+of\\s+)?${subjectWord}s?\\b`, "i").test(evidenceTextLower));
      const past = /\b(?:former|formerly|previous|once)\s+capital\b|\b(?:was|were|had been|served as|became)\s+(?:the\s+)?capital\b|\bcapital\b[^.]{0,80}\buntil\b/i.test(evidenceTextLower);
      if (!ofPlace || !isSubject || past) {
        return {
          claimId: claim.id,
          claimText: claim.text,
          status: "unsupported",
          confidence: Math.round(bestScore * 100) / 100,
          weight: claimWeight,
          evidenceId: bestEvidence.id,
          evidenceText: bestEvidence.text,
          evidenceUrl: bestEvidence.url,
          reasoning: `The source doesn't say this is ${capitalClaim[2]}'s capital today.`,
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }
    }

    // 6d. "First published in 1831" needs the year that follows "first published" in the source. In
    // "first published anonymously in 1818, and in 1831, a revised edition was published" every
    // word is present, but the 1831 belongs to another edition.
    const firstEvent = /\b(first|originally|initially)\s+(?:[a-z]+\s+)?(published|released|performed|built|opened|founded|launched|broadcast|aired|issued|printed|produced|recorded|shown|exhibited|flown|sold)\b/i.exec(claim.text);
    if (firstEvent && claimYears.length) {
      const words = evidenceTextLower.match(/[a-z]+|\d{3,4}/g) || [];
      const qualifier = firstEvent[1].toLowerCase();
      const relation = firstEvent[2].toLowerCase();
      const statedYears = [];
      words.forEach((word, i) => {
        if (word !== qualifier || !words.slice(i + 1, i + 4).includes(relation)) return;
        const year = words.slice(i + 1, i + 9).find((w) => /^(?:1[5-9]|20)\d{2}$/.test(w));
        if (year) statedYears.push(year);
      });
      if (!statedYears.some((year) => claimYears.includes(year))) {
        const conflict = statedYears.length > 0;
        return {
          claimId: claim.id,
          claimText: claim.text,
          status: conflict ? "contradicted" : "unsupported",
          confidence: conflict ? 0.9 : Math.round(bestScore * 100) / 100,
          weight: claimWeight,
          evidenceId: bestEvidence.id,
          evidenceText: bestEvidence.text,
          evidenceUrl: bestEvidence.url,
          reasoning: conflict
            ? `Year mismatch: the source says it was ${firstEvent[1]} ${relation} in ${statedYears.join(", ")}.`
            : `The source doesn't say when it was ${firstEvent[1]} ${relation}.`,
          ...(conflict ? { conflictKind: "year" } : {}),
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }
    }

    // 6c. "They officially opened it in 1991" names nothing: any passage with "opened" and "1991"
    // would match. Without a name to anchor it, a pronoun-led claim can't be confirmed.
    if (!claimEntities.size && /^(?:it|its|they|their|them|he|his|she|her|this|that|these|those)\b/i.test(claim.text.trim())) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "unsupported",
        confidence: Math.round(bestScore * 100) / 100,
        weight: claimWeight,
        evidenceId: bestEvidence.id,
        evidenceText: bestEvidence.text,
        evidenceUrl: bestEvidence.url,
        reasoning: "This sentence doesn't name what it's about, so it can't be matched to a source safely.",
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    // 7. Verification threshold check (Zero False Accepts requirement)
    if (bestScore >= 0.55) {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "supported",
        confidence: Math.round(Math.min(1.0, bestScore) * 100) / 100,
        weight: claimWeight,
        evidenceId: bestEvidence.id,
        evidenceText: bestEvidence.text,
        evidenceUrl: bestEvidence.url,
        reasoning: `High semantic alignment (${bestScore.toFixed(2)}) with evidence.`,
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    return {
      claimId: claim.id,
      claimText: claim.text,
      status: "unsupported",
      confidence: Math.round(bestScore * 100) / 100,
      weight: claimWeight,
      evidenceId: bestEvidence.id,
      evidenceText: bestEvidence.text,
      evidenceUrl: bestEvidence.url,
      reasoning: `Partial overlap (${bestScore.toFixed(2)}) is below support threshold (0.55).`,
      judge: "heuristic",
      checkedAt: timestamp,
    };
    };

    // Top passages overall, plus the best ones ignoring number matches: otherwise passages that merely
    // repeat the claimed (wrong) year crowd out the sentence with the real one
    const byTopic = [...ranked].sort((a, b) => b.topicScore - a.topicScore).slice(0, 3);
    const byRelation = ranked.filter((r) => r.relationScore > 0).sort((a, b) => b.relationScore - a.relationScore).slice(0, 3);
    const candidates = [...new Set([...ranked.slice(0, MAX_CANDIDATES), ...byTopic, ...byRelation])];
    if (!candidates.length) return judge(null, 0);
    const verdicts = candidates.map((candidate) => judge(candidate.ev, candidate.overlapScore));
    const byConfidence = (a, b) => b.confidence - a.confidence;
    const supported = verdicts.filter((verdict) => verdict.status === "supported").sort(byConfidence);
    const allContradicted = verdicts.filter((verdict) => verdict.status === "contradicted").sort(byConfidence);
    // When a passage directly confirms the claim, only a conflict on a single-answer fact (born in,
    // died in, located in) overrides it. A different year or number may be another event (a 2026
    // renovation, Python 3.0 in 2008), a "not" may be about another mission, and a second prize or
    // founder doesn't refute the first. Those only count when nothing supports the claim.
    const contradicted = supported.length ? allContradicted.filter((verdict) => verdict.conflictKind === "slot-single") : allContradicted;
    const clean = (verdict) => {
      const { conflictKind, ...rest } = verdict;
      return rest;
    };

    if (supported.length && contradicted.length) {
      // Sources disagree: say so rather than pick a side
      return {
        ...clean(contradicted[0]),
        status: "unsupported",
        confidence: 0.3,
        reasoning: `Sources disagree. One supports it (${supported[0].reasoning}); another conflicts (${contradicted[0].reasoning})`,
      };
    }
    if (supported.length) return clean(supported[0]);
    if (contradicted.length) return clean(contradicted[0]);
    return clean(verdicts[0]);
  }

  function verifyAll(claims, evidenceList) {
    if (!Array.isArray(claims)) return [];
    return claims.map((c) => verifyClaim(c, evidenceList));
  }

  AH.verifier = {
    verifyClaim,
    verifyAll,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.verifier;
  }
})(globalThis);
