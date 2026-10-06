/**
 * Developer preview only: fake extension APIs so the real popup, checker and options pages render
 * in a normal browser tab (tools/ui-preview/index.html). Never loaded by the extension.
 * window.__previewState picks the scenario before this script runs.
 */
"use strict";

(function () {
  const state = window.__previewState || "";

  const RESULT = {
    report: {
      riskLevel: "HIGH",
      grounded: false,
      counts: { supported: 3, contradicted: 1, unsupported: 2 },
      breakdown: { confirmed: 54, hallucinated: 21, unverified: 25 },
      verdicts: [],
    },
    annotations: [
      { sentenceIndex: 0, sentence: "The Eiffel Tower was completed in 1889 for the World's Fair.", status: "supported", note: "Wikipedia says it was completed in 1889.", evidenceIds: ["w1"] },
      { sentenceIndex: 1, sentence: "It is located in Lyon, on the banks of the Rhône.", status: "contradicted", note: "Wikidata: The Eiffel Tower is in Paris, France, not in Lyon.", evidenceIds: ["d1"] },
      { sentenceIndex: 2, sentence: "Gustave Eiffel's company designed and built it.", status: "supported", note: "Wikipedia: named after the engineer Gustave Eiffel, whose company designed and built the tower.", evidenceIds: ["w2"] },
      { sentenceIndex: 3, sentence: "About 7 million people visit it every year.", status: "unsupported", note: "No source mentions this.", evidenceIds: [] },
    ],
    linkChecks: [{ url: "https://made-up.example/eiffel-history", status: "not_found" }],
    evidence: [
      { id: "w1", source: "Wikipedia: Eiffel Tower", url: "https://en.wikipedia.org/wiki/Eiffel_Tower", text: "…completed in 1889…" },
      { id: "w2", source: "Wikipedia: Eiffel Tower", url: "https://en.wikipedia.org/wiki/Eiffel_Tower", text: "…Gustave Eiffel…" },
      { id: "d1", source: "Wikidata: Eiffel Tower", url: "https://www.wikidata.org/", text: "The Eiffel Tower is in Paris, France, not in Lyon." },
    ],
    errors: state.includes("errors") ? { webSearch: "Brave Search rejected the API key (HTTP 401)." } : {},
  };

  const local = {
    settings: { enabled: !state.includes("paused"), strictness: "strict", sources: { links: true, wikipedia: true, webSearch: false, pages: true }, braveApiKey: "", onDeviceAI: true },
    factMemory: [
      { key: "eiffel tower located lyon", claimText: "The Eiffel Tower is located in Lyon", status: "contradicted", evidenceText: "The Eiffel Tower is in Paris, France, not in Lyon.", evidenceUrl: "https://www.wikidata.org/", judge: "heuristic", checkedAt: "2026-10-06T10:12:00Z" },
      { key: "python first released 1991", claimText: "Python was first released in 1991", status: "supported", evidenceText: "Python 0.9.0 was released in February 1991.", evidenceUrl: "https://en.wikipedia.org/wiki/Python_(programming_language)", judge: "heuristic", checkedAt: "2026-10-06T09:40:00Z" },
      { key: "einstein born ulm", claimText: "Albert Einstein was born in Ulm", status: "supported", evidenceText: "Albert Einstein was born in Ulm.", evidenceUrl: "https://www.wikidata.org/wiki/Q937", judge: "heuristic", checkedAt: "2026-10-05T18:02:00Z" },
    ],
  };
  const session = {
    pageSources: state.includes("pages") ? [{ title: "Eiffel Tower – official site", url: "https://www.toureiffel.paris/en", chars: 18234 }] : [],
    checkerInput: state.includes("checker-from-page")
      ? { text: RESULT.annotations.map((a) => a.sentence).join(" ") + " Source: https://made-up.example/eiffel-history", pageTitle: "Travel blog: 10 facts about Paris", pageUrl: "https://blog.example/paris-facts", at: Date.now() }
      : undefined,
  };

  const area = (data) => ({
    get: async (keys) => {
      if (!keys) return { ...data };
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const key of list) {
        if (data[key] !== undefined) out[key] = data[key];
        else if (keys && typeof keys === "object" && !Array.isArray(keys)) out[key] = keys[key];
      }
      return out;
    },
    set: async (values) => Object.assign(data, values),
    remove: async (key) => [].concat(key).forEach((k) => delete data[k]),
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener() {} } },
    runtime: {
      sendMessage: async (message) => {
        if (message && message.type === "CHECK_ANSWER") {
          await delay(state.includes("slow") ? 60000 : 350);
          if (state.includes("fail")) return { error: "Wikipedia is rate-limiting requests right now (HTTP 429). Try again in a minute." };
          if (state.includes("empty")) return { ...RESULT, report: { ...RESULT.report, counts: { supported: 0, contradicted: 0, unsupported: 0 }, breakdown: { confirmed: 0, hallucinated: 0, unverified: 0 } }, annotations: [], linkChecks: [] };
          return RESULT;
        }
        if (message && message.type === "ADD_PAGE_SOURCE") return { source: { title: "Eiffel Tower – Wikipedia", url: "https://en.wikipedia.org/wiki/Eiffel_Tower", chars: 81209 } };
        return {};
      },
      getURL: (path) => `/extension/${path}`,
      getManifest: () => ({ version: "0.2.0" }),
      openOptionsPage: () => {},
    },
    tabs: { query: async () => [{ id: 1, url: state.includes("other-site") ? "https://news.example/article" : "https://chatgpt.com/c/preview", title: "ChatGPT" }] },
    permissions: { contains: async () => state.includes("granted"), request: async () => true, remove: async () => true },
    windows: { create: async () => ({}) },
  };

  // Scenario: a check already run in the popup's paste box
  if (state.includes("popup-result")) {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        const box = document.getElementById("pasteText");
        if (!box) return;
        box.value = RESULT.annotations.map((a) => a.sentence).join(" ");
        document.getElementById("pasteCheck").click();
      }, 50);
    });
  }
})();
