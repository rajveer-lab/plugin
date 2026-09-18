/**
 * Mitigator: turns verdicts into per-sentence annotations for the overlay.
 *
 * A sentence takes the worst verdict among its claims (contradicted > unsupported > supported).
 * Sentences whose claims all carry weight 0 (restatements, duplicates) aren't annotated.
 * With "moderate" strictness, unsupported sentences aren't annotated either.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const SEVERITY = { supported: 0, unsupported: 1, contradicted: 2 };
  const SNIPPET_CHARS = 200;
  const SNIPPET_SCAN_CHARS = 50000;
  const STOPWORDS = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "with", "by", "from", "of", "and", "or", "is", "was", "are", "were", "be", "been", "it", "this", "that"]);

  function tokens(text) {
    return new Set(((text || "").toLowerCase().match(/\b[a-z0-9]+\b/g) || []).filter((w) => !STOPWORDS.has(w)));
  }

  /** The part of a (possibly very long) evidence text that best matches the claim. */
  function snippet(evidenceText, claimText, maxChars) {
    const limit = maxChars || SNIPPET_CHARS;
    const text = String(evidenceText || "").slice(0, SNIPPET_SCAN_CHARS);
    if (text.length <= limit) return text.trim();

    const claimTokens = tokens(claimText);
    let best = "";
    let bestScore = -1;
    for (const piece of text.split(/(?<=[.!?])\s+|\n+/)) {
      let score = 0;
      for (const token of tokens(piece)) if (claimTokens.has(token)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = piece;
      }
    }
    best = best.trim();
    return best.length > limit ? best.slice(0, limit - 1).trimEnd() + "…" : best;
  }

  function sourceName(evidence, verdict) {
    if (evidence) return evidence.source || evidence.url || evidence.kind || "a source";
    if (verdict.evidenceUrl) return verdict.evidenceUrl;
    return "a source";
  }

  function annotate(answerText, report, claims, evidence, options) {
    const strictness = (options && options.strictness) || "strict";
    const verdicts = (report && report.verdicts) || [];
    const claimList = Array.isArray(claims) ? claims : [];
    const claimById = new Map(claimList.map((claim) => [claim.id, claim]));
    const evidenceById = new Map((Array.isArray(evidence) ? evidence : []).map((item) => [item.id, item]));

    const bySentence = new Map();
    verdicts.forEach((verdict, index) => {
      const claim = claimById.get(verdict.claimId) || claimList[index];
      if (!claim || typeof claim.sentenceIndex !== "number") return;
      if (!bySentence.has(claim.sentenceIndex)) bySentence.set(claim.sentenceIndex, []);
      bySentence.get(claim.sentenceIndex).push({ claim, verdict });
    });

    const annotations = [];
    for (const sentenceIndex of [...bySentence.keys()].sort((a, b) => a - b)) {
      const entries = bySentence.get(sentenceIndex);
      if (entries.every(({ claim }) => claim.weight === 0)) continue;

      const worst = entries.reduce((a, b) => (SEVERITY[b.verdict.status] > SEVERITY[a.verdict.status] ? b : a));
      const status = worst.verdict.status in SEVERITY ? worst.verdict.status : "unsupported";
      if (status === "unsupported" && strictness === "moderate") continue;

      const sameStatus = entries.filter(({ verdict }) => verdict.status === status);
      const confidences = sameStatus.map(({ verdict }) => (typeof verdict.confidence === "number" ? verdict.confidence : 0));
      const confidence = status === "supported" ? Math.min(...confidences) : Math.max(...confidences);
      const evidenceIds = [...new Set(sameStatus.map(({ verdict }) => verdict.evidenceId).filter(Boolean))];

      const sentence = worst.claim.sentence || worst.claim.text;
      if (answerText && !String(answerText).includes(sentence)) continue; // answer changed since the check

      annotations.push({
        sentenceIndex,
        sentence,
        status,
        confidence: Math.round(confidence * 100) / 100,
        evidenceIds,
        judge: worst.verdict.judge || "heuristic",
        note: noteFor(status, worst.verdict, evidenceById.get(worst.verdict.evidenceId), strictness),
      });
    }
    return annotations;
  }

  function noteFor(status, verdict, evidence, strictness) {
    const source = sourceName(evidence, verdict);
    const quote = snippet(verdict.evidenceText || (evidence && evidence.text), verdict.claimText);
    const checkedBy = verdict.judge === "memory" ? " (checked earlier)" : verdict.judge === "on-device-ai" ? " (checked by on-device AI)" : "";

    if (status === "supported") {
      return `Supported by ${source}${checkedBy}${quote ? `: "${quote}"` : "."}`;
    }
    if (status === "contradicted") {
      return `Contradicted by ${source}${checkedBy}${quote ? `, which says: "${quote}"` : "."}`;
    }
    return strictness === "zero_tolerance"
      ? "No source confirms this. Treat it as unreliable."
      : "No source found that confirms this.";
  }

  AH.mitigator = { annotate, snippet };

  if (typeof module !== "undefined") {
    module.exports = AH.mitigator;
  }
})(globalThis);
