/**
 * Local learner: learns how far to trust each kind of check from examples, instead of from
 * hand-tuned rules.
 *
 * Teachers: the user's Right/Wrong clicks, and exact Wikidata facts (when an exact fact settles a
 * claim, the word-matching verdict on that same claim becomes an example). Never its own verdicts.
 *
 * Method: nearest neighbours. Each check is described by a few numbers (which judge decided, what
 * kind of source, whether the claim has a name or a date, whether it's about the chat itself...).
 * A new check is compared with the remembered examples; the ones that look almost the same (cosine
 * similarity >= 0.85) vote, on top of a prior that trusts the checker (0.9). With a handful of
 * examples this only affects checks that really resemble them, unlike a model whose weights would
 * spread the blame for one wrong flag over features every check shares.
 *
 * It can only make the checker more careful: the pipeline hides a verdict or finding whose chance of
 * being right falls below 0.5, a "wrong" counts 3x a "right", and nothing is ever turned into
 * "supported". Only numbers are stored, never text. Plain JS, nothing leaves the browser.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const VERSION = 1;
  const HEADS = ["supported", "contradicted", "consistency"];
  const PRIOR = 0.9; // trust the checker until taught otherwise
  const PRIOR_WEIGHT = 2; // ...as if it had been right twice
  const SIMILAR = 0.85; // cosine similarity for "looks almost the same"
  const CAUTION = 3; // a "wrong" counts this many times a "right"
  const AUTO_WEIGHT = 0.3; // exact facts teach more gently than the user does
  const MAX_EXAMPLES = 300; // per head; the oldest are forgotten first
  const THRESHOLD = 0.5;

  // The numbers that describe a check. Order matters for storage; add new ones at the end.
  const FEATURES = [
    // which judge decided
    "judge_heuristic", "judge_ai", "judge_memory",
    // what kind of source it was checked against
    "src_wikipedia", "src_wikidata", "src_link", "src_web", "src_page", "src_conversation", "src_exact",
    // the claim
    "has_name", "has_number", "has_year", "details", "weight", "long", "pronoun_led",
    "first_person", "second_person", "hedged", "negated",
    // claim vs evidence
    "overlap", "confidence",
    // conversation findings
    "f_changed_unknown", "f_changed_fixed", "f_changed_wrong", "f_held", "f_misquote", "after_pushback",
    "v_date", "v_time", "v_money", "v_count", "v_measure", "v_year", "v_name", "v_statement", "by_ai", "frame",
  ];
  const INDEX = new Map(FEATURES.map((name, i) => [name, i]));

  const FIRST_PERSON = /\b(?:I|I'm|I've|I'll|I'd|me|my|we|we're|we'll|let me|let's)\b/;
  const SECOND_PERSON = /\b(?:you|your|you're|you've|you'll|you'd)\b/i;
  const HEDGES = /\b(?:may|might|could|perhaps|possibly|probably|likely|generally|usually|often|typically|about|around|roughly|approximately|some|is thought|is believed|is considered)\b/i;
  const NEGATION = /\b(?:not|no|never|none|without)\b|n['’]t\b/i;
  const LEADING_PRONOUN = /^\s*(?:it|its|this|that|these|those|they|their|he|his|she|her)\b/i;
  const STOP = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "with", "by", "from", "of", "and", "or", "is", "was", "are", "were", "be", "been", "it", "its", "this", "that"]);

  const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

  function words(text) {
    return new Set((String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !STOP.has(w)));
  }

  /** Share of the claim's words that the evidence also has. */
  function overlap(claimText, evidenceText) {
    const claim = words(claimText);
    if (!claim.size) return 0;
    const evidence = words(evidenceText);
    let shared = 0;
    for (const w of claim) if (evidence.has(w)) shared++;
    return shared / claim.size;
  }

  function claimFeatures(claim) {
    const text = String((claim && (claim.sentence || claim.text)) || "");
    const entities = (claim && claim.entities) || [];
    const hasYear = /\b(?:1\d{3}|20\d{2})\b/.test(text);
    const hasNumber = /\d/.test(text.replace(/\b(?:1\d{3}|20\d{2})\b/g, ""));
    return {
      has_name: entities.length ? 1 : 0,
      has_number: hasNumber ? 1 : 0,
      has_year: hasYear ? 1 : 0,
      details: clamp01((entities.length + (hasNumber ? 1 : 0) + (hasYear ? 1 : 0)) / 3),
      weight: clamp01(((claim && claim.weight) || 0) / 2),
      long: clamp01(text.split(/\s+/).length / 30),
      pronoun_led: LEADING_PRONOUN.test(text) ? 1 : 0,
      first_person: FIRST_PERSON.test(text) ? 1 : 0,
      second_person: SECOND_PERSON.test(text) ? 1 : 0,
      hedged: HEDGES.test(text) ? 1 : 0,
      negated: NEGATION.test(text) ? 1 : 0,
    };
  }

  /** What describes a supported or contradicted verdict. evidence: the Evidence item it cites, if known. */
  function featuresForVerdict(verdict, claim, evidence) {
    const judge = (verdict && verdict.judge) || "heuristic";
    const kind = (evidence && evidence.kind) || "";
    const evidenceText = (verdict && verdict.evidenceText) || (evidence && evidence.text) || "";
    return {
      judge_heuristic: judge === "heuristic" ? 1 : 0,
      judge_ai: judge === "on-device-ai" ? 1 : 0,
      judge_memory: judge === "memory" ? 1 : 0,
      src_wikipedia: kind === "wikipedia" ? 1 : 0,
      src_wikidata: kind === "wikidata" ? 1 : 0,
      src_link: kind === "link" ? 1 : 0,
      src_web: kind === "web" ? 1 : 0,
      src_page: kind === "page" ? 1 : 0,
      src_conversation: kind === "conversation" ? 1 : 0,
      src_exact: evidence && evidence.exact ? 1 : 0,
      ...claimFeatures(claim),
      overlap: clamp01(overlap(claim && claim.text, evidenceText)),
      confidence: clamp01(verdict && verdict.confidence),
    };
  }

  /**
   * What describes a conversation finding. basis: { valueType, shared, byAI } from engine/conversation.js
   * (the kind of value that differed, how many words around it matched, and whether the AI decided).
   */
  function featuresForItem(item, claim, basis) {
    const type = (item && item.type) || "";
    const valueType = String((basis && basis.valueType) || "statement");
    return {
      f_changed_unknown: type === "changed_unknown" ? 1 : 0,
      f_changed_fixed: type === "changed_fixed" ? 1 : 0,
      f_changed_wrong: type === "changed_wrong" ? 1 : 0,
      f_held: type.startsWith("held_") ? 1 : 0,
      f_misquote: type === "misquote" ? 1 : 0,
      after_pushback: item && item.afterPushback ? 1 : 0,
      v_date: valueType === "date" || valueType === "weekday" || valueType === "month" ? 1 : 0,
      v_time: valueType === "time" ? 1 : 0,
      v_money: valueType === "money" || valueType === "percent" ? 1 : 0,
      v_count: valueType.startsWith("after:") || (valueType.startsWith("qty:") && !(basis && basis.measure)) ? 1 : 0,
      v_measure: valueType.startsWith("qty:") && basis && basis.measure ? 1 : 0,
      v_year: valueType === "year" ? 1 : 0,
      v_name: valueType === "name" ? 1 : 0,
      v_statement: valueType === "statement" ? 1 : 0,
      by_ai: basis && basis.byAI ? 1 : 0,
      frame: clamp01(((basis && basis.shared) || 0) / 3),
      ...claimFeatures(claim),
    };
  }

  function toVector(features) {
    const vector = new Array(FEATURES.length).fill(0);
    for (const [name, value] of Object.entries(features || {})) {
      const i = INDEX.get(name);
      if (i !== undefined) vector[i] = Math.round(clamp01(Number(value)) * 100) / 100;
    }
    return vector;
  }

  function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }

  function emptyState() {
    const heads = {};
    for (const head of HEADS) heads[head] = { examples: [] };
    return { version: VERSION, heads, counts: { right: 0, wrong: 0, auto: 0 } };
  }

  /** A learner from saved state (or empty). State: { version, heads: { [head]: { examples: [[vector, label, weight]] } }, counts }. */
  function createLearner(saved) {
    const state = emptyState();
    if (saved && saved.version === VERSION && saved.heads) {
      for (const head of HEADS) {
        const examples = saved.heads[head] && saved.heads[head].examples;
        if (Array.isArray(examples)) state.heads[head].examples = examples.filter((e) => Array.isArray(e) && Array.isArray(e[0])).slice(-MAX_EXAMPLES);
      }
      for (const key of ["right", "wrong", "auto"]) state.counts[key] = Math.max(0, Number(saved.counts && saved.counts[key]) || 0);
    }

    /** The chance this check is right, from the prior and the examples that look almost the same. */
    function predict(head, features) {
      const examples = state.heads[head] ? state.heads[head].examples : [];
      if (!examples.length) return PRIOR;
      const x = toVector(features);
      let votes = PRIOR * PRIOR_WEIGHT;
      let total = PRIOR_WEIGHT;
      for (const [vector, label, weight] of examples) {
        const similarity = cosine(x, vector);
        if (similarity < SIMILAR) continue;
        const w = similarity * weight * (label === 0 ? CAUTION : 1);
        votes += w * label;
        total += w;
      }
      return votes / total;
    }

    function shows(head, features) {
      return predict(head, features) >= THRESHOLD;
    }

    /** Remembers one example. label 1 = the check was right, 0 = wrong. { auto: true } for exact facts. */
    function update(head, features, label, options) {
      if (!state.heads[head] || (label !== 0 && label !== 1)) return false;
      const auto = Boolean(options && options.auto);
      const examples = state.heads[head].examples;
      examples.push([toVector(features), label, auto ? AUTO_WEIGHT : 1]);
      if (examples.length > MAX_EXAMPLES) examples.splice(0, examples.length - MAX_EXAMPLES);
      if (auto) state.counts.auto++;
      else state.counts[label === 1 ? "right" : "wrong"]++;
      return true;
    }

    function stats() {
      return { ...state.counts };
    }

    function toJSON() {
      return JSON.parse(JSON.stringify(state));
    }

    return { predict, shows, update, stats, toJSON };
  }

  AH.learner = {
    createLearner,
    featuresForVerdict,
    featuresForItem,
    FEATURES,
    HEADS,
    THRESHOLD,
    STORAGE_KEY: "learner",
  };

  if (typeof module !== "undefined") {
    module.exports = AH.learner;
  }
})(globalThis);
