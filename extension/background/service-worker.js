/* Anti-Hallucination service worker.
 *
 * Routes messages and runs the CHECK_ANSWER pipeline:
 *   claims -> fact memory -> evidence -> verdicts (heuristic, then on-device AI) -> score -> annotations
 *
 * Modules that don't exist yet are skipped, so the extension still loads while it's being built.
 */
"use strict";

const MODULES = [
  "/engine/claims.js",
  "/engine/verifier.js",
  "/engine/scorer.js",
  "/engine/mitigator.js",
  "/engine/fact-memory.js",
  "/engine/ai-judge.js",
  "/evidence/links.js",
  "/evidence/wikipedia.js",
  "/evidence/web-search.js",
  "/evidence/page-sources.js",
];

const missingModules = [];
if (typeof importScripts === "function") {
  // importScripts only works during the worker's first run, so load everything up front
  for (const path of MODULES) {
    try {
      importScripts(path);
    } catch (error) {
      missingModules.push(path);
    }
  }
}

(function (root) {
  const AH = (root.AH = root.AH || {});

  const DEFAULT_SETTINGS = {
    enabled: true,
    strictness: "strict",
    sources: { links: true, wikipedia: true, webSearch: false, pages: true },
    braveApiKey: "",
    onDeviceAI: true,
    boosterEnabled: true,
    minInformation: 1.0,
  };
  const MAX_AI_JUDGED_CLAIMS = 8;
  const EVIDENCE_PREVIEW_CHARS = 500;
  const MAX_PASSAGE_CHARS = 600;
  const MAX_PASSAGES_PER_SOURCE = 1000;
  const LEADING_PRONOUN = /^(it|its|this|that|these|those|they|their|he|she|his|her)\b/i;

  function mergeSettings(stored) {
    const settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
    settings.sources = { ...DEFAULT_SETTINGS.sources, ...((stored && stored.sources) || {}) };
    return settings;
  }

  /** Accepts URLs or { url, text } objects; keeps unique http(s) links. */
  function normalizeLinks(links) {
    const seen = new Set();
    const result = [];
    for (const link of Array.isArray(links) ? links : []) {
      const url = typeof link === "string" ? link : link && link.url;
      const text = typeof link === "string" ? "" : (link && link.text) || "";
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      result.push({ url, text });
    }
    return result;
  }

  function uniqueEvidence(items) {
    const ids = new Set();
    const texts = new Set();
    const result = [];
    for (const item of items) {
      if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
      const key = item.text.replace(/\s+/g, " ").trim().toLowerCase();
      if (texts.has(key)) continue;
      texts.add(key);
      let id = item.id || `${item.kind || "evidence"}:${result.length + 1}`;
      while (ids.has(id)) id += "'";
      ids.add(id);
      result.push({ ...item, id });
    }
    return result;
  }

  /**
   * Splits evidence into sentence-sized passages before verification.
   * Word overlap against a whole page would "support" almost any claim, since its words
   * appear somewhere on the page. A sentence starting with a pronoun keeps the sentence
   * before it, so "It was completed in 1889." still says what "it" is.
   */
  function toPassages(items) {
    const passages = [];
    for (const item of items) {
      const sentences = [];
      for (const line of String(item.text || "").split(/\n+/)) {
        for (const sentence of line.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)) {
          for (let i = 0; i < sentence.length; i += MAX_PASSAGE_CHARS) sentences.push(sentence.slice(i, i + MAX_PASSAGE_CHARS));
        }
      }
      const clean = sentences.filter(Boolean);
      const texts = clean
        .map((sentence, i) =>
          i > 0 && LEADING_PRONOUN.test(sentence) && clean[i - 1].length + sentence.length < MAX_PASSAGE_CHARS
            ? `${clean[i - 1]} ${sentence}`
            : sentence,
        )
        .slice(0, MAX_PASSAGES_PER_SOURCE);

      if (texts.length <= 1) {
        passages.push(item);
        continue;
      }
      texts.forEach((text, i) => passages.push({ ...item, id: `${item.id}#${i + 1}`, text }));
    }
    return passages;
  }

  /**
   * Runs the full check for one AI answer.
   * deps: { settings, missingModules, parseHtml(html, url), aiAvailable(), aiJudge(claim, evidence) }
   */
  async function checkAnswer(request, deps) {
    const settings = deps.settings;
    const answerText = String(request.answerText || "");
    const question = String(request.question || "");
    const links = normalizeLinks(request.links);
    const result = {
      report: null,
      annotations: [],
      linkChecks: [],
      evidence: [],
      missingModules: [...(deps.missingModules || [])],
      errors: {},
    };

    if (!settings.enabled || !answerText.trim()) return result;
    if (!AH.claims || !AH.verifier || !AH.scorer) return result; // engine not built yet

    const claims = AH.claims.extract(answerText, { question });

    const remembered = new Map();
    if (AH.factMemory) {
      try {
        for (const verdict of await AH.factMemory.lookup(claims)) remembered.set(verdict.claimId, verdict);
      } catch (error) {
        result.errors.factMemory = errorText(error);
      }
    }
    const pending = claims.filter((claim) => !remembered.has(claim.id));

    const tasks = [];
    if (settings.sources.links && links.length && AH.links) {
      tasks.push(["links", AH.links.check(links, { answerText, parseHtml: deps.parseHtml })]);
    }
    if (pending.length) {
      if (settings.sources.wikipedia && AH.wikipedia) {
        tasks.push(["wikipedia", AH.wikipedia.lookup(pending, { question })]);
      }
      if (settings.sources.webSearch && settings.braveApiKey && AH.webSearch) {
        const query = question || pending.map((claim) => claim.text).join(" ");
        tasks.push(["webSearch", AH.webSearch.search(query, { apiKey: settings.braveApiKey, limit: 5 })]);
      }
      if (settings.sources.pages && AH.pageSources) {
        tasks.push(["pages", AH.pageSources.list()]);
      }
    }

    const gathered = [];
    const outcomes = await Promise.allSettled(tasks.map(([, promise]) => promise));
    outcomes.forEach((outcome, i) => {
      const name = tasks[i][0];
      if (outcome.status === "rejected") {
        result.errors[name] = errorText(outcome.reason);
      } else if (name === "links") {
        result.linkChecks = outcome.value.linkChecks || [];
        gathered.push(...(outcome.value.evidence || []));
      } else {
        gathered.push(...(outcome.value || []));
      }
    });
    const evidence = uniqueEvidence(toPassages(uniqueEvidence(gathered)));

    // Verdict order matches claim order
    const verdicts = claims.map((claim) => remembered.get(claim.id) || AH.verifier.verifyClaim(claim, evidence));

    if (settings.onDeviceAI && evidence.length && pending.length && deps.aiJudge && (await deps.aiAvailable())) {
      // Most informative claims first; the on-device model handles one prompt at a time
      const order = claims
        .map((claim, index) => index)
        .filter((index) => !remembered.has(claims[index].id))
        .sort((a, b) => (claims[b].weight || 0) - (claims[a].weight || 0))
        .slice(0, MAX_AI_JUDGED_CLAIMS);
      for (const index of order) {
        try {
          const verdict = await deps.aiJudge(claims[index], evidence);
          if (verdict) verdicts[index] = verdict;
        } catch (error) {
          result.errors.aiJudge = errorText(error);
          break;
        }
      }
    }

    result.report = AH.scorer.score(verdicts, { minInformation: settings.minInformation });
    if (AH.mitigator) {
      result.annotations = AH.mitigator.annotate(answerText, result.report, claims, evidence, {
        strictness: settings.strictness,
      });
    }
    if (AH.factMemory) {
      try {
        await AH.factMemory.record(verdicts.filter((verdict) => verdict.judge !== "memory"), claims);
      } catch (error) {
        result.errors.factMemory = errorText(error);
      }
    }
    // Link evidence can be a whole web page; send back only the relevant part
    result.report = {
      ...result.report,
      verdicts: (result.report.verdicts || []).map((verdict) =>
        verdict.evidenceText && verdict.evidenceText.length > EVIDENCE_PREVIEW_CHARS
          ? { ...verdict, evidenceText: shorten(verdict.evidenceText, verdict.claimText) }
          : verdict,
      ),
    };
    // Only send back evidence the verdicts and annotations point to
    const referenced = new Set(result.report.verdicts.map((verdict) => verdict.evidenceId));
    result.annotations.forEach((annotation) => (annotation.evidenceIds || []).forEach((id) => referenced.add(id)));
    result.evidence = evidence.filter((item) => referenced.has(item.id)).map((item) => ({
      ...item,
      text: item.text.length > EVIDENCE_PREVIEW_CHARS ? item.text.slice(0, EVIDENCE_PREVIEW_CHARS) + "…" : item.text,
    }));
    return result;
  }

  function shorten(text, claimText) {
    return AH.mitigator && AH.mitigator.snippet
      ? AH.mitigator.snippet(text, claimText, EVIDENCE_PREVIEW_CHARS)
      : text.slice(0, EVIDENCE_PREVIEW_CHARS) + "…";
  }

  function errorText(error) {
    return String((error && error.message) || error);
  }

  const pipeline = { checkAnswer, mergeSettings, normalizeLinks, uniqueEvidence, toPassages, DEFAULT_SETTINGS };
  AH.pipeline = pipeline;
  if (typeof module !== "undefined") module.exports = pipeline;

  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.onMessage) return;

  // ---- Chrome wiring ----

  const OFFSCREEN_URL = "background/offscreen.html";
  const AI_AVAILABILITY_TTL_MS = 10 * 60 * 1000;
  let offscreenCreating = null;
  let aiAvailability = { value: false, checkedAt: 0 };

  async function ensureOffscreen() {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return;
    if (!offscreenCreating) {
      offscreenCreating = chrome.offscreen
        .createDocument({
          url: OFFSCREEN_URL,
          reasons: ["DOM_PARSER"],
          justification: "Turn fetched web pages into plain text so AI answers can be checked against them.",
        })
        .catch((error) => {
          if (!/single offscreen/i.test(errorText(error))) throw error;
        })
        .finally(() => {
          offscreenCreating = null;
        });
    }
    await offscreenCreating;
  }

  async function askOffscreen(type, payload) {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({ target: "offscreen", type, ...payload });
    if (response && response.error) throw new Error(response.error);
    return response;
  }

  const chromeDeps = {
    parseHtml: (html, url) => askOffscreen("PARSE_HTML", { html, url }),
    aiAvailable: async () => {
      if (Date.now() - aiAvailability.checkedAt < AI_AVAILABILITY_TTL_MS) return aiAvailability.value;
      let value = false;
      try {
        value = Boolean((await askOffscreen("AI_AVAILABLE", {})).available);
      } catch (error) {
        value = false;
      }
      aiAvailability = { value, checkedAt: Date.now() };
      return value;
    },
    aiJudge: async (claim, evidence) => {
      const passages = AH.aiJudge && AH.aiJudge.selectEvidence ? AH.aiJudge.selectEvidence(claim, evidence) : evidence.slice(0, 3);
      return (await askOffscreen("AI_JUDGE", { claim, evidence: passages })).verdict || null;
    },
  };

  async function handleCheck(message) {
    const { settings } = await chrome.storage.local.get("settings");
    const links = normalizeLinks(message.links);
    console.log(`[AH] ${message.site || "unknown site"}: answer of ${String(message.answerText || "").length} chars, ${links.length} link(s)`, {
      question: message.question,
      answerText: message.answerText,
      links,
    });
    const result = await checkAnswer(message, { ...chromeDeps, settings: mergeSettings(settings), missingModules });
    if (result.missingModules.length) console.info("[AH] modules not built yet:", result.missingModules);
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target === "offscreen") return false;

    if (message.type === "CHECK_ANSWER") {
      handleCheck(message).then(sendResponse, (error) => sendResponse({ error: errorText(error) }));
      return true;
    }
    if (message.type === "ADD_PAGE_SOURCE") {
      if (!AH.pageSources || !AH.pageSources.add) {
        sendResponse({ error: "Page sources aren't available yet." });
        return false;
      }
      AH.pageSources.add(message.tabId).then(sendResponse, (error) => sendResponse({ error: errorText(error) }));
      return true;
    }
    return false;
  });

  chrome.runtime.onInstalled.addListener(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: mergeSettings(settings) });
  });
})(globalThis);
