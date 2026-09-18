/**
 * Fact memory (reverify's ledger idea).
 *
 * Remembers claims the checks proved supported or contradicted, with their evidence,
 * so the same claim is answered instantly next time. Unverified claims are never stored.
 *
 * To keep wrong verdicts from sticking, it doesn't store:
 * - claims that start with a pronoun ("It was launched in 2021" depends on context)
 * - zero-weight claims (restatements, duplicates)
 * - supported verdicts below MIN_SUPPORTED_CONFIDENCE, or without any evidence
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const STORAGE_KEY = "factMemory";
  const MAX_FACTS = 500;
  const MIN_SUPPORTED_CONFIDENCE = 0.8;
  const EVIDENCE_CHARS = 300;
  const LEADING_PRONOUN = /^\s*(it|its|this|that|these|those|they|them|their|he|she|his|her|we|you|i)\b/i;

  function normalizeKey(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\[s\d+[^\]]*\]/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function isStorable(verdict, claim) {
    if (!verdict || verdict.judge === "memory") return false;
    if (verdict.status !== "supported" && verdict.status !== "contradicted") return false;
    if (!verdict.evidenceText && !verdict.evidenceUrl) return false;
    if (verdict.status === "supported" && !(verdict.confidence >= MIN_SUPPORTED_CONFIDENCE)) return false;
    const weight = claim && typeof claim.weight === "number" ? claim.weight : verdict.weight;
    if (weight === 0) return false;
    const text = verdict.claimText || (claim && claim.text) || "";
    return normalizeKey(text).length > 0 && !LEADING_PRONOUN.test(text);
  }

  function chromeStorage() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return null;
    return {
      get: async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY],
      set: (value) => chrome.storage.local.set({ [STORAGE_KEY]: value }),
    };
  }

  function memoryStorage() {
    let value;
    return { get: async () => value, set: async (next) => { value = next; } };
  }

  /** storage: { get(): Promise<facts[]>, set(facts[]): Promise } — defaults to chrome.storage.local. */
  function createFactMemory(storage) {
    const store = storage || chromeStorage() || memoryStorage();
    let writing = Promise.resolve();

    async function load() {
      const facts = await store.get();
      return Array.isArray(facts) ? facts : [];
    }

    async function lookup(claims) {
      const facts = await load();
      if (!facts.length) return [];
      const byKey = new Map(facts.map((fact) => [fact.key, fact]));
      const hits = [];
      for (const claim of Array.isArray(claims) ? claims : []) {
        const fact = byKey.get(normalizeKey(claim.text));
        if (!fact) continue;
        hits.push({
          claimId: claim.id,
          claimText: claim.text,
          status: fact.status,
          confidence: fact.confidence,
          weight: typeof claim.weight === "number" ? claim.weight : 1,
          evidenceId: null,
          evidenceText: fact.evidenceText,
          evidenceUrl: fact.evidenceUrl,
          reasoning: `Checked earlier (${fact.checkedAt.slice(0, 10)}): ${fact.status}.`,
          judge: "memory",
          checkedAt: fact.checkedAt,
        });
      }
      return hits;
    }

    function record(verdicts, claims) {
      const claimById = new Map((Array.isArray(claims) ? claims : []).map((claim) => [claim.id, claim]));
      const fresh = (Array.isArray(verdicts) ? verdicts : [])
        .filter((verdict) => isStorable(verdict, claimById.get(verdict.claimId)))
        .map((verdict) => ({
          key: normalizeKey(verdict.claimText),
          claimText: verdict.claimText,
          status: verdict.status,
          confidence: verdict.confidence,
          evidenceText: shorten(verdict.evidenceText || "", verdict.claimText),
          evidenceUrl: verdict.evidenceUrl || null,
          judge: verdict.judge || "heuristic",
          checkedAt: verdict.checkedAt || new Date().toISOString(),
        }));
      if (!fresh.length) return writing;

      // Serialize writes so two checks finishing together don't drop each other's facts
      writing = writing.then(async () => {
        const merged = new Map();
        for (const fact of [...fresh.reverse(), ...(await load())]) {
          if (!merged.has(fact.key)) merged.set(fact.key, fact); // newest wins
        }
        await store.set([...merged.values()].slice(0, MAX_FACTS));
      });
      return writing;
    }

    async function clear() {
      writing = writing.then(() => store.set([]));
      return writing;
    }

    async function list() {
      return load();
    }

    return { lookup, record, clear, list };
  }

  function shorten(text, claimText) {
    if (text.length <= EVIDENCE_CHARS) return text;
    return AH.mitigator && AH.mitigator.snippet ? AH.mitigator.snippet(text, claimText, EVIDENCE_CHARS) : text.slice(0, EVIDENCE_CHARS);
  }

  AH.factMemory = { ...createFactMemory(), createFactMemory, normalizeKey, isStorable, MAX_FACTS };

  if (typeof module !== "undefined") {
    module.exports = AH.factMemory;
  }
})(globalThis);
