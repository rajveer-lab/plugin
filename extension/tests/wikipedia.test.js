"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const wikipedia = require("../evidence/wikipedia.js");

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeWikipedia({ search = {}, extracts = {}, failSearch = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname === "/w/rest.php/v1/search/page") {
      if (failSearch) return json({}, 503);
      const q = parsed.searchParams.get("q");
      return json({ pages: (search[q] || []).map((title) => ({ key: title.replace(/ /g, "_"), title })) });
    }
    const title = parsed.searchParams.get("titles");
    if (!(title in extracts)) return json({ query: { pages: [{ title, missing: true }] } });
    return json({ query: { pages: [{ pageid: 1, title, extract: extracts[title] }] } });
  };
  return { fetchImpl, calls };
}

test("queries use names from the most informative claims", () => {
  const claims = [
    { text: "Water is wet", weight: 0.2, entities: [] },
    { text: "The telephone was invented by Thomas Edison", weight: 0.9, entities: ["Thomas Edison", "Thomas", "Edison"] },
    { text: "You asked about phones", weight: 0, entities: ["Phones"] },
    { text: "The Eiffel Tower opened in 1889", weight: 1.4, entities: ["The Eiffel Tower"] },
  ];
  assert.deepEqual(wikipedia.queriesFor(claims), ["Eiffel Tower", "Thomas Edison", "Water is wet"]);
  assert.deepEqual(wikipedia.queriesFor([], "Who built the Eiffel Tower?"), ["Who built the Eiffel Tower?"]);
  assert.deepEqual(wikipedia.queriesFor([]), []);
});

test("returns article text as evidence, best result per query first", async () => {
  const { fetchImpl, calls } = fakeWikipedia({
    search: {
      "Eiffel Tower": ["Eiffel Tower", "Eiffel Tower replicas and derivatives"],
      "Gustave Eiffel": ["Gustave Eiffel", "Eiffel Tower"],
    },
    extracts: {
      "Eiffel Tower": "The Eiffel Tower is a lattice tower in Paris, France. It was completed in 1889.",
      "Gustave Eiffel": "Gustave Eiffel was a French civil engineer.",
      "Eiffel Tower replicas and derivatives": "Many replicas exist.",
    },
  });
  const evidence = await wikipedia.lookup(
    [{ text: "The Eiffel Tower was designed by Gustave Eiffel", weight: 1, entities: ["The Eiffel Tower", "Gustave Eiffel"] }],
    { fetch: fetchImpl, maxPages: 3 },
  );

  assert.deepEqual(evidence.map((e) => e.id), ["wikipedia:Eiffel_Tower", "wikipedia:Gustave_Eiffel", "wikipedia:Eiffel_Tower_replicas_and_derivatives"]);
  assert.deepEqual(evidence[0], {
    id: "wikipedia:Eiffel_Tower",
    text: "The Eiffel Tower is a lattice tower in Paris, France. It was completed in 1889.",
    source: "Wikipedia: Eiffel Tower",
    url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    kind: "wikipedia",
  });
  assert.ok(calls.every((c) => c.init.credentials === "omit" && c.init.headers["Api-User-Agent"]));
  assert.ok(calls.some((c) => c.url.includes("explaintext=1")));
});

test("missing articles and failed extracts are skipped", async () => {
  const { fetchImpl } = fakeWikipedia({ search: { "Atlantis": ["Atlantis", "Lost city"] }, extracts: { "Lost city": "A lost city is a settlement that fell into decline." } });
  const evidence = await wikipedia.lookup([{ text: "Atlantis sank", weight: 1, entities: ["Atlantis"] }], { fetch: fetchImpl });
  assert.deepEqual(evidence.map((e) => e.source), ["Wikipedia: Lost city"]);
});

test("throws when every search fails, so the pipeline reports it", async () => {
  const { fetchImpl } = fakeWikipedia({ failSearch: true });
  await assert.rejects(wikipedia.lookup([{ text: "Paris is in France", weight: 1, entities: ["Paris", "France"] }], { fetch: fetchImpl }), /HTTP 503/);
});

test("repeat lookups are served from cache and parallel requests are capped", async () => {
  wikipedia.clearCache();
  let inFlight = 0;
  let peak = 0;
  const { fetchImpl, calls } = fakeWikipedia({
    search: { "Alpha One": ["Alpha One"], "Beta Two": ["Beta Two"], "Gamma Three": ["Gamma Three"], "Delta Four": ["Delta Four"] },
    extracts: { "Alpha One": "A.", "Beta Two": "B.", "Gamma Three": "C.", "Delta Four": "D." },
  });
  const slow = async (url, init) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return fetchImpl(url, init);
  };
  const claims = ["Alpha One", "Beta Two", "Gamma Three", "Delta Four"].map((name) => ({ text: name, weight: 1, entities: [name] }));
  const first = await wikipedia.lookup(claims, { fetch: slow });
  const requests = calls.length;
  const second = await wikipedia.lookup(claims, { fetch: slow });
  assert.deepEqual(second, first);
  assert.equal(calls.length, requests, "second lookup made no requests");
  assert.ok(peak <= 3, `peak parallel requests was ${peak}`);
});

test("rate limiting gives a clear error", async () => {
  wikipedia.clearCache();
  const limited = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(wikipedia.lookup([{ text: "Rome", weight: 1, entities: ["Rome"] }], { fetch: limited }), /rate-limiting/);
});

test("other languages use their own Wikipedia", async () => {
  const { fetchImpl, calls } = fakeWikipedia({ search: { "Tour Eiffel": ["Tour Eiffel"] }, extracts: { "Tour Eiffel": "La tour Eiffel est une tour de fer." } });
  const evidence = await wikipedia.lookup([{ text: "La Tour Eiffel", weight: 1, entities: ["Tour Eiffel"] }], { fetch: fetchImpl, lang: "fr" });
  assert.ok(calls.every((c) => c.url.startsWith("https://fr.wikipedia.org/")));
  assert.equal(evidence[0].url, "https://fr.wikipedia.org/wiki/Tour_Eiffel");
});
