"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const factMemory = require("../engine/fact-memory.js");

function verdict(claimText, status, extra = {}) {
  return {
    claimId: extra.claimId || "c1",
    claimText,
    status,
    confidence: 0.9,
    weight: 1,
    evidenceText: "The Eiffel Tower was completed in 1889.",
    evidenceUrl: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    judge: "heuristic",
    checkedAt: "2026-09-17T10:00:00.000Z",
    ...extra,
  };
}

test("remembers verified claims and answers from memory", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([verdict("The Eiffel Tower was completed in 1889", "supported"), verdict("The Eiffel Tower is in Berlin", "contradicted", { claimId: "c2" })]);

  const hits = await memory.lookup([
    { id: "x", text: "the Eiffel Tower was completed in 1889.", weight: 0.8 },
    { id: "y", text: "The Eiffel Tower is in Berlin" },
    { id: "z", text: "Something never checked" },
  ]);
  assert.deepEqual(hits.map((h) => [h.claimId, h.status, h.judge]), [["x", "supported", "memory"], ["y", "contradicted", "memory"]]);
  assert.equal(hits[0].weight, 0.8, "weight comes from the current claim");
  assert.equal(hits[0].evidenceUrl, "https://en.wikipedia.org/wiki/Eiffel_Tower");
  assert.match(hits[0].reasoning, /^Checked earlier \(2026-09-17\)/);
});

test("never stores unverified, context-dependent, filler or weak results", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([
    verdict("Unverified claim", "unsupported"),
    verdict("It was launched in 2021", "supported"),
    verdict("They won in 1998", "contradicted"),
    verdict("You asked about towers", "supported", { weight: 0 }),
    verdict("The Louvre is in Paris", "supported", { confidence: 0.6 }),
    verdict("Rome is in Italy", "supported", { evidenceText: "", evidenceUrl: null }),
    verdict("Already from memory", "supported", { judge: "memory" }),
  ]);
  assert.deepEqual(await memory.list(), []);
});

test("low-confidence contradictions are still stored", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([verdict("The Eiffel Tower is in Berlin", "contradicted", { confidence: 0.5 })]);
  assert.equal((await memory.list()).length, 1);
});

test("claim weight passed via claims overrides the verdict", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([verdict("The Eiffel Tower is in Paris", "supported")], [{ id: "c1", weight: 0 }]);
  assert.deepEqual(await memory.list(), []);
});

test("newest verdict wins and size is capped", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([verdict("Pluto is a planet", "supported", { checkedAt: "2005-01-01T00:00:00.000Z" })]);
  await memory.record([verdict("Pluto is a planet", "contradicted", { checkedAt: "2026-01-01T00:00:00.000Z" })]);
  const facts = await memory.list();
  assert.equal(facts.length, 1);
  assert.equal(facts[0].status, "contradicted");

  const many = Array.from({ length: factMemory.MAX_FACTS + 20 }, (_, i) => verdict(`Fact number ${i} is true`, "supported", { claimId: `c${i}` }));
  await memory.record(many);
  const capped = await memory.list();
  assert.equal(capped.length, factMemory.MAX_FACTS);
  assert.equal(capped[0].claimText, `Fact number ${factMemory.MAX_FACTS + 19} is true`, "newest first");
});

test("concurrent records don't lose facts", async () => {
  const memory = factMemory.createFactMemory();
  await Promise.all([
    memory.record([verdict("Alpha is first", "supported")]),
    memory.record([verdict("Beta is second", "supported")]),
  ]);
  assert.equal((await memory.list()).length, 2);
});

test("long evidence is trimmed and clear empties memory", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([verdict("The Eiffel Tower was completed in 1889", "supported", { evidenceText: "x ".repeat(2000) })]);
  assert.ok((await memory.list())[0].evidenceText.length <= 300);
  await memory.clear();
  assert.deepEqual(await memory.lookup([{ id: "c", text: "The Eiffel Tower was completed in 1889" }]), []);
});

test("keys ignore case, punctuation and citation markers", () => {
  assert.equal(factMemory.normalizeKey("The Eiffel Tower, completed in 1889 [S2]."), factMemory.normalizeKey("the eiffel tower completed in 1889"));
});
