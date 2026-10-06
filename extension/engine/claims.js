/**
 * Atomic Claim Extractor with Information Weighting.
 *
 * Implements FActScore / reverify principles:
 * - Decomposes sentences into atomic propositions.
 * - Filters duplicates and question restatements (weight = 0).
 * - Weights claims by information density (numbers, dates, named entities).
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

  const SENTENCE_STARTERS = new Set([
    "The", "This", "That", "These", "Those", "It", "They", "We", "In", "On",
    "At", "However", "Furthermore", "Additionally", "Moreover", "Therefore",
    "First", "Second", "Finally", "Also", "Although"
  ]);

  const YEAR_REGEX = /\b(?:1[5-9]|20)\d{2}\b/;
  const NUMERIC_REGEX = /\b\d+(?:[\.,]\d+)?%?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b/i;
  const ENTITY_REGEX = /(?<!\p{L})[\p{Lu}][\p{L}]+(?:[\s\-]+(?:of|upon|the|de|van|von|da|la|le)[\s\-]+[\p{Lu}][\p{L}]+|[\s\-]+[\p{Lu}][\p{L}]+)*(?!\p{L})/gu;
  const COMMON_VERBS = /\b(?:is|was|are|were|been|be|has|have|had|do|does|did|built|started|completed|opened|created|developed|designed|financed|constructed|celebrating|involved|won|landed|boils|stands|lives|located|credited|helped|co-developed|refined)\b/i;

  function cleanLeadingBullets(str) {
    return (str || "")
      .replace(/^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE00-\uFE0F\u2022\u2023\u25E6\u2043\u2219\u002D\u2013\u2014*#•]+\s*/u, "")
      .replace(/^\d+[\.\)]\s*/, "")
      .trim();
  }

  function tokenize(text) {
    const words = (text || "").toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    return new Set(words.filter((w) => !STOPWORDS.has(w)));
  }

  function jaccardSimilarity(setA, setB) {
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  // Initials are capital letters ("J. R. R."), so that test is case-sensitive: "10 a.m. The doors..."
  // ends a sentence
  const ABBREV_WORDS = /\b(?:Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|No|vs|etc|e\.g|i\.e|U\.S|c|ca|approx|cf|vol)\.$/i;
  const INITIAL = /\b[A-Z]\.$/;
  const ABBREV_REGEX = { test: (text) => ABBREV_WORDS.test(text) || INITIAL.test(text) };

  function splitSentences(text) {
    if (!text || typeof text !== "string") return [];
    // Split on newlines first (handles Markdown lists, bulleted items, etc.)
    const lines = text.split(/\r?\n+/);
    const result = [];
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      // Split on sentence-ending punctuation followed by whitespace and capital letter/number
      const raw = trimmedLine.split(/(?<=[.!?])\s+(?=[A-Z0-9"'`])/);
      const merged = [];
      for (let i = 0; i < raw.length; i++) {
        const piece = raw[i];
        if (merged.length > 0) {
          const prev = merged[merged.length - 1];
          if (ABBREV_REGEX.test(prev.trim())) {
            merged[merged.length - 1] = prev + " " + piece;
            continue;
          }
        }
        merged.push(piece);
      }
      for (const s of merged) {
        const trimmed = s.trim();
        if (trimmed.length >= 3) {
          result.push(trimmed);
        }
      }
    }
    return result.length > 0 ? result : [text.trim()];
  }

  function extractPropositions(sentence) {
    // Split compound sentences joined by semicolons or connective transitions
    const subClauses = sentence.split(/;\s*|\s+(?:furthermore|additionally|moreover),\s*/i);
    const propositions = [];

    for (const clause of subClauses) {
      // 1. Check for non-restrictive relative clauses with ", which"
      const whichMatch = clause.match(/^(.*?),\s+which\s+(.+)$/i);
      if (whichMatch) {
        const mainPart = whichMatch[1].trim().replace(/[.,;]+$/, "");
        const relPart = whichMatch[2].trim().replace(/[.,;]+$/, "");
        const ents = extractEntities(mainPart);
        let subject = "";
        if (ents.length > 0) {
          subject = ents[ents.length - 1];
        } else {
          const npMatch = mainPart.match(/(?:the|a|an)\s+([A-Za-z0-9\s]+?)(?:\s+(?:in|at|on|by|during|between)\s+[A-Za-z0-9\s,]+)?$/i);
          if (npMatch) {
            subject = npMatch[1].trim();
          }
        }

        if (subject && relPart.length >= 5) {
          if (mainPart.length >= 5) {
            propositions.push(mainPart);
          }
          propositions.push(`${subject} ${relPart}`);
          continue;
        }
      }

      // 2. Split on contrastive conjunctions with substance
      const parts = clause.split(/,\s+(?:but|while|whereas|however)\s+/i);
      if (parts.length > 1) {
        for (const part of parts) {
          const clean = part.trim().replace(/[.,;]+$/, "");
          if (clean.length >= 8 && clean.split(/\s+/).length >= 3) {
            propositions.push(clean);
          }
        }
      } else {
        const clean = clause.trim().replace(/[.,;]+$/, "");
        if (clean.length >= 5) {
          propositions.push(clean);
        }
      }
    }

    return propositions.length > 0 ? propositions : [sentence];
  }

  function classifyType(text) {
    if (YEAR_REGEX.test(text)) return "temporal";
    if (NUMERIC_REGEX.test(text)) return "numeric";
    if (/\b(?:is|was|are|were|located|founded|created|developed|written by)\b/i.test(text)) {
      return "relational";
    }
    return "factual";
  }

  /**
   * Capitalized words used mid-sentence in these texts ("Tell me about Microsoft"). They're names,
   * so the same word opening a sentence ("Microsoft was founded…") is a name too, not just a capital.
   */
  function namesUsedMidSentence(...texts) {
    const names = new Set();
    for (const text of texts) {
      for (const match of String(text || "").matchAll(/(?<=[\p{L}\d,;)][ \t]+)([\p{Lu}][\p{Ll}]+)\b/gu)) {
        if (!NON_ENTITY_WORDS.has(match[1])) names.add(match[1]);
      }
    }
    return names;
  }

  function extractEntities(text, knownNames) {
    const unique = new Set();
    const firstWordMatch = (text || "").trim().match(/^([\p{Lu}][\p{Ll}]+)\b/u);
    const firstWord = firstWordMatch ? firstWordMatch[1] : null;

    // Detect words before a colon (e.g. "Purpose:", "Construction started:")
    const colonPrefixMatches = (text || "").match(/(?<!\p{L})([\p{Lu}][\p{Ll}]+)(?=\s*[:\-])/gu) || [];
    const colonLabels = new Set(colonPrefixMatches);

    for (const match of (text || "").matchAll(ENTITY_REGEX)) {
      const m = match[0];
      const parts = m.split(/\s+/);
      // A short number right after a name belongs to it ("Apollo 11", "Windows 95"); years and
      // decimals don't ("Python 3.11" stays "Python")
      const number = (text.slice(match.index + m.length).match(/^[ \t]+\d{1,3}(?![\d%]|[.,]\d)/) || [""])[0];
      if (number && !NON_ENTITY_WORDS.has(parts[parts.length - 1])) {
        unique.add(m + number);
        continue;
      }
      if (parts.length > 1) {
        const filteredParts = parts.filter((p) => !NON_ENTITY_WORDS.has(p) && !colonLabels.has(p));
        if (filteredParts.length > 0) {
          unique.add(m);
        }
      } else {
        if (NON_ENTITY_WORDS.has(m) || colonLabels.has(m)) continue;
        if (m === firstWord && !(knownNames && knownNames.has(m))) continue;
        if (m.length > 2) {
          unique.add(m);
        }
      }
    }
    return Array.from(unique);
  }

  /**
   * Calculates information weight according to reverify / FActScore:
   * - 0.0 for question restatements or duplicates of earlier claims.
   * - High for numbers, dates, and named entities.
   * - Low for trivial/generic assertions.
   */
  function computeWeight(claimText, tokens, questionTokens, previousClaimsTokens) {
    // 1. Check if restatement of the question
    if (questionTokens && questionTokens.size > 0) {
      const questionOverlap = jaccardSimilarity(tokens, questionTokens);
      if (questionOverlap >= 0.65) {
        return 0.0;
      }
    }

    // 2. Check if duplicate of an earlier claim in this answer
    for (const prevTokens of previousClaimsTokens) {
      const sim = jaccardSimilarity(tokens, prevTokens);
      if (sim >= 0.85) {
        return 0.0;
      }
    }

    // 3. Compute informative weight based on specificity
    let weight = 0.2; // base for trivial statement

    if (YEAR_REGEX.test(claimText)) {
      weight += 0.6;
    }
    if (NUMERIC_REGEX.test(claimText)) {
      weight += 0.5;
    }

    const entities = extractEntities(claimText);
    if (entities.length > 0) {
      weight += Math.min(0.8, entities.length * 0.4);
    }

    return Math.round(weight * 10) / 10;
  }

  // Real answers say "It empties into the Adriatic Sea" rather than repeating the name. A sentence
  // opening with a singular pronoun is checked as being about the answer's subject; the sentence
  // shown to the user is unchanged. "They" is left alone: it often means people, not the subject.
  const LEADING_PRONOUN = /^(It|Its|He|His|She|Her)\b(?!['’])/;
  const GENERIC_HEADS = /\b(?:River|Sea|Ocean|Lake|Mountain|Mount|Tower|Wall|Bridge|Reef|Palace|Museum|University|College|Empire|Republic|Kingdom|War|Prize|Company|City|State|Island|Islands|House|Hall|Theatre|Theater|Centre|Center|Building|Hotel|Stadium|Library|School|Institute|Cathedral|Temple|Church|Park|Square|Monument|Memorial)\b/;
  const strip = (name) => String(name || "").replace(/^(?:the|a|an)\s+/i, "");
  // Two or more capitalized words and no common-noun head ("Ada Lovelace", not "Danube River")
  const looksLikePerson = (name) => /^[\p{Lu}][\p{L}'-]+(?:\s+(?:de|da|van|von|of|la|le)?\s*[\p{Lu}][\p{L}'-]+)+$/u.test(strip(name)) && !GENERIC_HEADS.test(name);

  function resolvePronoun(prop, topic, lastPerson) {
    const match = LEADING_PRONOUN.exec(prop);
    if (!match) return prop;
    const personal = /^(He|His|She|Her)$/.test(match[1]);
    const name = personal ? (looksLikePerson(topic) ? topic : lastPerson) : topic;
    if (!name) return prop;
    const possessive = /^(Its|His|Her)$/.test(match[1]);
    return `${strip(name)}${possessive ? "'s" : ""}${prop.slice(match[1].length)}`;
  }

  function extract(text, options) {
    const question = (options && options.question) || "";
    const questionTokens = tokenize(question);
    const sentences = splitSentences(text);
    const knownNames = namesUsedMidSentence(question, text);
    // What the answer is about: the main name in the question ("Tell me about the Danube River")
    // ("Summarize Ada Lovelace's work": the opening verb is capitalized only because it starts the question)
    const firstWord = (question.trim().match(/^[\p{L}]+/u) || [""])[0];
    const topic = extractEntities(question, knownNames)
      .map((name) => (firstWord && name.startsWith(`${firstWord} `) && !knownNames.has(firstWord) ? name.slice(firstWord.length + 1) : name))
      .sort((a, b) => b.length - a.length)[0] || "";
    let lastPerson = looksLikePerson(topic) ? strip(topic) : "";

    const claims = [];
    const seenClaimTokens = [];
    let claimCount = 1;

    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const sentence = sentences[sIdx];
      const cleanSentence = cleanLeadingBullets(sentence);

      // Skip questions (e.g. "Who created it?")
      if (cleanSentence.endsWith("?")) {
        continue;
      }

      // Skip short heading-like lines without a verb (e.g. "Key facts:", "Overview")
      const words = cleanSentence.split(/\s+/);
      if (!COMMON_VERBS.test(cleanSentence) && (cleanSentence.endsWith(":") || words.length <= 3)) {
        continue;
      }

      const propositions = extractPropositions(cleanSentence);

      for (const prop of propositions) {
        const cleanProp = resolvePronoun(cleanLeadingBullets(prop), topic, lastPerson);
        if (cleanProp.length < 5) continue;

        const tokens = tokenize(cleanProp);
        const type = classifyType(cleanProp);
        const entities = extractEntities(cleanProp, knownNames);
        const weight = computeWeight(cleanProp, tokens, questionTokens, seenClaimTokens);

        seenClaimTokens.push(tokens);
        const person = entities.find(looksLikePerson);
        if (person) lastPerson = strip(person);

        claims.push({
          id: `claim_${String(claimCount).padStart(3, "0")}`,
          text: cleanProp,
          type: type,
          sentence: sentence,
          sentenceIndex: sIdx,
          entities: entities,
          weight: weight,
        });

        claimCount++;
      }
    }

    return claims;
  }

  AH.claims = {
    splitSentences,
    extract,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.claims;
  }
})(globalThis);
