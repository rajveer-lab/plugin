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
    const words = (text || "").toLowerCase().match(/\b[a-z']+\b/g) || [];
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

    let bestEvidence = null;
    let bestScore = 0.0;

    for (const ev of evidenceList) {
      const score = computeOverlap(claim.text, ev.text);
      if (score > bestScore) {
        bestScore = score;
        bestEvidence = ev;
      }
    }

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

    // Pre-extract entities to evaluate topic relevance for contradiction checks
    const claimEntities = new Set(claim.entities || []);
    if (!claim.entities || claim.entities.length === 0) {
      const capMatches = claim.text.match(/(?<!\p{L})[\p{Lu}][\p{Ll}]+(?:\s+[\p{Lu}][\p{Ll}]+)*(?!\p{L})/gu) || [];
      const firstWordMatch = claim.text.trim().match(/^([\p{Lu}][\p{Ll}]+)\b/u);
      const firstWord = firstWordMatch ? firstWordMatch[1] : null;
      for (const c of capMatches) {
        if (!NON_ENTITY_WORDS.has(c) && c !== firstWord && c.length > 2) {
          claimEntities.add(c);
        }
      }
    }

    const evidenceTextLower = bestEvidence.text.toLowerCase();
    const claimTextLower = claim.text.toLowerCase();

    // Check if at least one named entity from the claim appears in the evidence
    const hasNamedEntityInEvidence = Array.from(claimEntities).some((ent) => {
      const entWords = ent.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      return entWords.some((w) => {
        const base = stemToken(w);
        return new RegExp(`\\b${base}s?\\b`, "i").test(evidenceTextLower);
      });
    });

    // 1. Check Temporal / Year Contradiction (C-27: require bestScore >= 0.50 OR claim entity in passage)
    const claimYears = extractYears(claim.text);
    const evidenceYears = extractYears(bestEvidence.text);
    if (claimYears.length > 0 && evidenceYears.length > 0) {
      const yearMatches = claimYears.some((y) => evidenceYears.includes(y));
      if (!yearMatches && (bestScore >= 0.50 || (hasNamedEntityInEvidence && bestScore >= 0.25))) {
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
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }
    }

    // 2. Check Numerical Contradiction (C-27: ignore currency/unit mismatches, require >= 0.50 OR entity in passage)
    const claimNums = extractNumbers(claim.text);
    const evidenceNums = extractNumbers(bestEvidence.text);
    if (claimNums.length > 0 && evidenceNums.length > 0) {
      const numMatches = claimNums.some((n) => evidenceNums.includes(n));
      const CURRENCY_REGEX = /[$€£₹¥₽₩]|\b(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CNY|Rs|Rupees)\b/i;
      const claimHasCurrency = CURRENCY_REGEX.test(claim.text);
      const evidenceHasCurrency = CURRENCY_REGEX.test(bestEvidence.text);
      const currencyMismatch = claimHasCurrency && !evidenceHasCurrency;

      if (!numMatches && !currencyMismatch && (bestScore >= 0.50 || (hasNamedEntityInEvidence && bestScore >= 0.35))) {
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
          judge: "heuristic",
          checkedAt: timestamp,
        };
      }
    }

    // 3. Check Polarity / Negation Contradiction
    const claimNeg = hasNegation(claim.text);
    const evidenceNeg = hasNegation(bestEvidence.text);
    if (claimNeg !== evidenceNeg && bestScore >= 0.35) {
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
        judge: "heuristic",
        checkedAt: timestamp,
      };
    }

    // 4. Entity and Specific Term Verification (Zero False Accepts, C-12 & C-15)
    const missingEntities = [];

    for (const ent of claimEntities) {
      const entLower = ent.toLowerCase();
      // Partial name match (e.g., "Eiffel" matches "Gustave Eiffel" or "Eiffel Tower")
      const entWords = entLower.split(/\s+/).filter((w) => w.length > 2);
      const isPresent = entWords.some((w) => {
        const base = stemToken(w);
        return new RegExp(`\\b${base}s?\\b`, "i").test(evidenceTextLower);
      });
      if (!isPresent) {
        missingEntities.push(ent);
      }
    }

    if (missingEntities.length > 0) {
      // Check for slot replacement (e.g. "located in", "prize in", "born in", "capital of", "founded by")
      const slotPhrases = [
        "located in", "situated in", "based in", "born in", "died in",
        "prize in", "award in", "founded by", "invented by", "created by",
        "capital of", "designed by", "written by", "discovered by"
      ];

      let isSlotConflict = false;
      let conflictDetail = "";

      for (const phrase of slotPhrases) {
        if (claimTextLower.includes(phrase) && evidenceTextLower.includes(phrase)) {
          // Both have the slot phrase; check if what follows in claim is missing from evidence
          const claimAfter = claimTextLower.split(phrase)[1] || "";
          const evidenceAfter = evidenceTextLower.split(phrase)[1] || "";
          const claimAfterTokens = claimAfter.match(/\b[a-z0-9]+\b/g) || [];
          const evAfterTokens = evidenceAfter.match(/\b[a-z0-9]+\b/g) || [];

          if (claimAfterTokens.length > 0 && evAfterTokens.length > 0 && claimAfterTokens[0] !== evAfterTokens[0]) {
            isSlotConflict = true;
            conflictDetail = `Slot conflict on '${phrase}': claim specifies '${claimAfterTokens[0]}' while evidence has '${evAfterTokens[0]}'.`;
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

    // 5. Proximity Span Check (C-15: avoid false accepts on scattered words in long sentences)
    const claimTokens = tokenize(claim.text);
    const evWords = evidenceTextLower.match(/\b[a-z0-9]+\b/g) || [];
    const matchedTokenPositions = [];
    evWords.forEach((word, idx) => {
      if (claimTokens.has(word)) {
        matchedTokenPositions.push({ word, idx });
      }
    });

    if (matchedTokenPositions.length >= 2) {
      const distinctMatched = new Set(matchedTokenPositions.map((p) => p.word));
      if (distinctMatched.size >= 3) {
        // Find minimum span containing all distinct matched words
        let minSpan = Infinity;
        const counts = new Map();
        let left = 0;
        let distinct = 0;

        for (let right = 0; right < matchedTokenPositions.length; right++) {
          const w = matchedTokenPositions[right].word;
          counts.set(w, (counts.get(w) || 0) + 1);
          if (counts.get(w) === 1) distinct++;

          while (distinct === distinctMatched.size) {
            const span = matchedTokenPositions[right].idx - matchedTokenPositions[left].idx + 1;
            if (span < minSpan) minSpan = span;
            const lw = matchedTokenPositions[left].word;
            counts.set(lw, counts.get(lw) - 1);
            if (counts.get(lw) === 0) distinct--;
            left++;
          }
        }

        const maxAllowedSpan = Math.max(18, Math.round(distinctMatched.size * 3.5));
        if (minSpan > maxAllowedSpan) {
          return {
            claimId: claim.id,
            claimText: claim.text,
            status: "unsupported",
            confidence: Math.round(bestScore * 100) / 100,
            weight: claimWeight,
            evidenceId: bestEvidence.id,
            evidenceText: bestEvidence.text,
            evidenceUrl: bestEvidence.url,
            reasoning: `Matched words are scattered across a wide span (${minSpan} words > ${maxAllowedSpan} allowed).`,
            judge: "heuristic",
            checkedAt: timestamp,
          };
        }
      }
    }

    // 6. Content Token Coverage Check (C-20 & C-23: short claims need every content word, discourse words ignored)
    const contentTokens = Array.from(claimTokens).filter((t) => !DISCOURSE_WORDS.has(t));
    const n = contentTokens.length;
    let missingContentCount = 0;
    const missingTokens = [];
    const evTokenSet = new Set(evWords.map(stemToken));
    for (const t of contentTokens) {
      if (!evTokenSet.has(t)) {
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
