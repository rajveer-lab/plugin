/* Anti-Hallucination service worker.
 *
 * Routes messages and runs the CHECK_ANSWER pipeline:
 *   claims -> fact memory -> evidence -> verdicts (heuristic, then on-device AI) -> score -> annotations
 *
 * Modules that don't exist yet are skipped, so the extension still loads while it's being built.
 */
"use strict";

const MODULES = [
  "/engine/grounder.js",
  "/engine/claims.js",
  "/engine/verifier.js",
  "/engine/conversation.js",
  "/engine/learner.js",
  "/engine/scorer.js",
  "/engine/mitigator.js",
  "/engine/fact-memory.js",
  "/engine/ai-judge.js",
  "/evidence/links.js",
  "/evidence/wikipedia.js",
  "/evidence/wikidata.js",
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
    minInformation: 1.0,
  };
  const MAX_AI_JUDGED_CLAIMS = 8;
  const MAX_AI_PASTED_CLAIMS = 6;
  const EVIDENCE_PREVIEW_CHARS = 500;
  const MAX_PASSAGE_CHARS = 600;
  const MAX_PASSAGES_PER_SOURCE = 1000;
  // Text the user pastes or right-clicks into the fact checker (site "checker")
  const CHECKER_SITE = "checker";
  const MAX_CHECKER_CHARS = 20000;
  const CHECKER_MENU_ID = "ah-fact-check-selection";
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

  // A period after these doesn't end a sentence: initials ("J. R. R."), titles, "St.", "c. 1900",
  // and Wikipedia's old-style dates "(4 January 1643 [O.S. 25 December 1642] – …)"
  const ABBREVIATION_END = /(?:^|[\s(\[])(?:\p{Lu}|\p{Lu}\.\p{Lu}|St|Mt|Ft|Mr|Mrs|Ms|Dr|Jr|Sr|Prof|Gen|Col|Lt|Capt|No|vs|etc|c|ca|approx|e\.g|i\.e)\.$/u;

  /** Splits one line into sentences, keeping brackets and abbreviations together. */
  function splitLine(line) {
    const sentences = [];
    let current = "";
    for (const piece of line.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)) {
      current = current ? `${current} ${piece}` : piece;
      const openBrackets = (current.match(/[([]/g) || []).length - (current.match(/[)\]]/g) || []).length;
      if (openBrackets > 0 || ABBREVIATION_END.test(current)) continue;
      sentences.push(current);
      current = "";
    }
    if (current) sentences.push(current);
    return sentences;
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
        for (const sentence of splitLine(line)) {
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
   * deps: { settings, missingModules, parseHtml(html, url), aiAvailable(), aiJudge(claim, evidence), learner }
   */
  async function checkAnswer(request, deps) {
    const settings = deps.settings;
    const fromChecker = request.site === CHECKER_SITE;
    const answerText = String(request.answerText || "").slice(0, fromChecker ? MAX_CHECKER_CHARS : undefined);
    const history = Array.isArray(request.history) ? request.history : [];
    const conversation = AH.conversation || null;
    // The user's actual request: pasted text is checked against, never searched, and "Are you sure?"
    // isn't the topic. In the checker window the question is whatever the user typed in its box.
    const question =
      conversation && !fromChecker ? conversation.questionFor(history, request.question) : String(request.question || "");
    const links = normalizeLinks(request.links);
    const result = {
      report: null,
      annotations: [],
      linkChecks: [],
      evidence: [],
      consistency: [],
      missingModules: [...(deps.missingModules || [])],
      errors: {},
    };

    // The on/off switch pauses automatic checks on chat sites; a check the user asks for still runs
    if ((!settings.enabled && !fromChecker) || !answerText.trim()) return result;
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
      // Wikidata's exact facts ride on the Wikipedia setting (same organization, same privacy terms)
      if (settings.sources.wikipedia && AH.wikidata) {
        tasks.push(["wikidata", AH.wikidata.lookup(pending, { question })]);
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
    // Text the user gave the AI in this chat (pasted documents, what they told it): a source of its own
    const pasted = conversation ? uniqueEvidence(toPassages(conversation.pastedSources(history, { all: fromChecker }))) : [];
    const aiNeeded = (evidence.length && pending.length) || pasted.length || (history.length && !fromChecker);
    const aiReady = Boolean(settings.onDeviceAI && deps.aiJudge && deps.aiAvailable && aiNeeded && (await deps.aiAvailable()));
    const byWeight = (indexes) => indexes.sort((a, b) => (claims[b].weight || 0) - (claims[a].weight || 0));

    if (aiReady && evidence.length && pending.length) {
      // Most informative claims first; the on-device model handles one prompt at a time
      const order = byWeight(claims.map((claim, index) => index).filter((index) => !remembered.has(claims[index].id))).slice(0, MAX_AI_JUDGED_CLAIMS);
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

    // Exact facts teach the learner, with no effort from the user: where one settles a claim, the
    // word-matching verdict on that claim from the other passages is an example of a right or wrong check
    const learner = deps.learner || null;
    const exact = evidence.filter((item) => item.exact);
    if (learner && AH.learner && exact.length) {
      const loose = evidence.filter((item) => !item.exact);
      for (const claim of claims) {
        const settled = AH.verifier.verifyClaim(claim, exact);
        if (settled.status === "unsupported") continue;
        const guess = AH.verifier.verifyClaim(claim, loose);
        if (guess.status === "unsupported") continue;
        const cited = loose.find((item) => item.id === guess.evidenceId);
        learner.update(guess.status, AH.learner.featuresForVerdict(guess, claim, cited), guess.status === settled.status ? 1 : 0, { auto: true });
      }
    }

    // The text the user gave it settles claims the sources above left unverified. It's local and says
    // what the AI was given, not what's true, so it never outranks a source. The on-device AI judges
    // it when available; the rules judge whatever the AI doesn't.
    if (pasted.length) {
      let aiLeft = aiReady ? MAX_AI_PASTED_CLAIMS : 0;
      const order = byWeight(claims.map((claim, index) => index).filter((index) => !remembered.has(claims[index].id) && verdicts[index].status === "unsupported"));
      for (const index of order) {
        let verdict = null;
        let answered = false;
        if (aiLeft > 0) {
          aiLeft--;
          try {
            verdict = await deps.aiJudge(claims[index], pasted);
            answered = Boolean(verdict);
          } catch (error) {
            result.errors.aiJudge = errorText(error);
            aiLeft = 0;
          }
        }
        if (!answered) verdict = conversation.checkPasted(claims[index], pasted, AH.verifier.verifyClaim);
        if (verdict && verdict.status !== "unsupported") verdicts[index] = verdict;
      }
    }
    const allEvidence = [...evidence, ...pasted];
    const evidenceById = new Map(allEvidence.map((item) => [item.id, item]));

    // What it has learned: a check that looks like ones the user marked wrong is shown as unverified.
    // Every shown check carries what the learner needs if the user marks it right or wrong.
    if (AH.learner) {
      verdicts.forEach((verdict, index) => {
        if (verdict.status !== "supported" && verdict.status !== "contradicted") return;
        const learn = { head: verdict.status, features: AH.learner.featuresForVerdict(verdict, claims[index], evidenceById.get(verdict.evidenceId)) };
        verdicts[index] =
          learner && !learner.shows(learn.head, learn.features)
            ? { ...verdict, status: "unsupported", hiddenByLearning: verdict.status, evidenceId: null, evidenceText: null, evidenceUrl: null }
            : { ...verdict, learn };
      });
    }

    result.report = AH.scorer.score(verdicts, { minInformation: settings.minInformation });
    if (AH.mitigator) {
      result.annotations = AH.mitigator.annotate(answerText, result.report, claims, allEvidence, {
        strictness: settings.strictness,
      });
    }
    if (conversation && history.length && !fromChecker) {
      try {
        const items = await conversation.compare({
          claims,
          verdicts,
          history,
          evidence,
          verify: AH.verifier.verifyClaim,
          extract: AH.claims.extract,
          judge: aiReady ? deps.aiJudge : null,
        });
        result.consistency = items
          .map(({ basis, ...item }) => {
            if (!AH.learner) return item;
            const claim = claims.find((entry) => entry.sentenceIndex === item.sentenceIndex);
            const learn = { head: "consistency", features: AH.learner.featuresForItem(item, claim, basis) };
            return learner && !learner.shows(learn.head, learn.features) ? null : { ...item, learn };
          })
          .filter(Boolean);
      } catch (error) {
        result.errors.conversation = errorText(error);
      }
    }
    if (AH.factMemory) {
      try {
        // Facts settled by the user's own text are about this chat, not the world: never remembered
        const storable = verdicts.filter(
          (verdict) => verdict.judge !== "memory" && !(conversation && conversation.isConversationEvidence(verdict.evidenceId)),
        );
        await AH.factMemory.record(storable, claims);
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
    result.evidence = allEvidence.filter((item) => referenced.has(item.id)).map((item) => ({
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

  // What the checker has learned (engine/learner.js), loaded once and saved whenever it learns
  let learnerCache = null;

  async function getLearner() {
    if (!AH.learner) return null;
    if (!learnerCache) {
      const stored = await chrome.storage.local.get(AH.learner.STORAGE_KEY);
      learnerCache = AH.learner.createLearner(stored[AH.learner.STORAGE_KEY]);
    }
    return learnerCache;
  }

  async function saveLearner() {
    if (learnerCache) await chrome.storage.local.set({ [AH.learner.STORAGE_KEY]: learnerCache.toJSON() });
  }

  async function handleFeedback(message) {
    const learner = await getLearner();
    if (!learner) throw new Error("Learning isn't available.");
    const features = message.features && typeof message.features === "object" ? message.features : null;
    if (!features || !learner.update(message.head, features, message.label)) throw new Error("That feedback couldn't be used.");
    await saveLearner();
    return { ok: true, stats: learner.stats() };
  }

  async function handleCheck(message) {
    const { settings } = await chrome.storage.local.get("settings");
    const learner = await getLearner();
    const learnedBefore = learner ? learner.stats().auto : 0;
    const links = normalizeLinks(message.links);
    console.log(`[AH] ${message.site || "unknown site"}: answer of ${String(message.answerText || "").length} chars, ${links.length} link(s)`, {
      question: message.question,
      answerText: message.answerText,
      links,
    });
    const result = await checkAnswer(message, { ...chromeDeps, settings: mergeSettings(settings), missingModules, learner });
    if (result.missingModules.length) console.info("[AH] modules not built yet:", result.missingModules);
    if (learner && learner.stats().auto !== learnedBefore) {
      saveLearner().catch((error) => console.warn("[AH] couldn't save what was learned:", errorText(error)));
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target === "offscreen") return false;

    if (message.type === "CHECK_ANSWER") {
      handleCheck(message).then(sendResponse, (error) => sendResponse({ error: errorText(error) }));
      return true;
    }
    if (message.type === "FEEDBACK") {
      handleFeedback(message).then(sendResponse, (error) => sendResponse({ error: errorText(error) }));
      return true;
    }
    if (message.type === "LEARNER_STATS") {
      getLearner()
        .then((learner) => ({ stats: learner ? learner.stats() : { right: 0, wrong: 0, auto: 0 } }))
        .then(sendResponse, (error) => sendResponse({ error: errorText(error) }));
      return true;
    }
    if (message.type === "LEARNER_RESET") {
      learnerCache = AH.learner ? AH.learner.createLearner() : null;
      chrome.storage.local
        .remove(AH.learner ? AH.learner.STORAGE_KEY : "learner")
        .then(() => sendResponse({ ok: true }), (error) => sendResponse({ error: errorText(error) }));
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

  // ---- right-click "Fact-check with Hallucination Guard" ----

  /** The selected text. getSelection() keeps line breaks; info.selectionText flattens them. */
  async function selectionOf(info, tab) {
    if (tab && tab.id !== undefined && chrome.scripting) {
      try {
        // The menu click grants activeTab for this tab
        const [frame] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [info.frameId || 0] },
          func: () => String(getSelection()),
        });
        if (frame && typeof frame.result === "string" && frame.result.trim()) return frame.result;
      } catch (error) {
        // chrome:// pages, the Web Store, PDFs and cross-origin frames can't be scripted
      }
    }
    return info.selectionText || "";
  }

  /** Hands the selection to the checker page through session storage (never the URL) and opens it. */
  async function openChecker(info, tab) {
    const text = await selectionOf(info, tab);
    if (!text.trim()) return;
    await chrome.storage.session.set({
      checkerInput: { text, pageTitle: (tab && tab.title) || "", pageUrl: info.pageUrl || (tab && tab.url) || "", at: Date.now() },
    });
    await chrome.windows.create({ url: chrome.runtime.getURL("checker/checker.html"), type: "popup", width: 480, height: 680 });
  }

  if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== CHECKER_MENU_ID) return;
      openChecker(info, tab).catch((error) => console.warn("[AH] couldn't open the fact checker:", errorText(error)));
    });
  }

  chrome.runtime.onInstalled.addListener(async (details) => {
    // First install: a welcome page where one click turns on the AI checker (the model download needs a page)
    if (details && details.reason === "install" && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") }).catch((error) => console.warn("[AH] couldn't open the welcome page:", errorText(error)));
    }
    if (chrome.contextMenus) {
      // Menu items survive restarts; recreate them on install/update so the id never clashes
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: CHECKER_MENU_ID, title: "Fact-check with Hallucination Guard", contexts: ["selection"] });
      });
    }
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: mergeSettings(settings) });
  });
})(globalThis);
