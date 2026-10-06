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

test("single facts can be removed without touching the rest", async () => {
  const memory = factMemory.createFactMemory();
  await memory.record([
    verdict("Paris is the capital of France", "supported", { claimId: "a" }),
    verdict("The Eiffel Tower is in Berlin", "contradicted", { claimId: "b" }),
    verdict("Rome is the capital of Italy", "supported", { claimId: "c" }),
  ]);
  const [first] = await memory.list();
  await memory.remove(first.key);
  assert.deepEqual((await memory.list()).map((fact) => fact.claimText).sort(), ["Paris is the capital of France", "The Eiffel Tower is in Berlin"]);

  await memory.remove([factMemory.normalizeKey("Paris is the capital of France"), "no-such-key"]);
  assert.deepEqual((await memory.list()).map((fact) => fact.claimText), ["The Eiffel Tower is in Berlin"]);
  assert.deepEqual(await memory.lookup([{ id: "x", text: "Paris is the capital of France" }]), [], "removed facts are no longer used");
});

test("keys ignore case, punctuation and citation markers", () => {
  assert.equal(factMemory.normalizeKey("The Eiffel Tower, completed in 1889 [S2]."), factMemory.normalizeKey("the eiffel tower completed in 1889"));
});

test("an AI chat page is never a source of remembered facts, and old ones are dropped", async () => {
  const factMemory = require("../engine/fact-memory.js");
  let stored = [
    { key: "bananas grow underground on trees", claimText: "Bananas grow underground on trees", status: "supported", evidenceText: "Sure: Bananas grow underground on trees.", evidenceUrl: "https://chatgpt.com/c/6ac3f842", judge: "heuristic", checkedAt: "2026-10-06T10:00:00Z" },
    { key: "einstein born ulm", claimText: "Einstein was born in Ulm", status: "supported", evidenceText: "Einstein was born in Ulm.", evidenceUrl: "https://www.wikidata.org/wiki/Q937", judge: "heuristic", checkedAt: "2026-10-06T10:00:00Z" },
  ];
  const memory = factMemory.createFactMemory({ get: async () => stored, set: async (value) => { stored = value; } });
  // Old poisoned entry is ignored on lookup and gone from the list
  const hits = await memory.lookup([{ id: "c1", text: "Bananas grow underground on trees", weight: 1 }]);
  assert.equal(hits.length, 0);
  assert.deepEqual((await memory.list()).map((fact) => fact.key), ["einstein born ulm"]);
  // New verdicts backed by an AI chat page are never stored
  await memory.record([{ claimId: "c2", claimText: "The Moon is made of cheese", status: "supported", confidence: 0.95, weight: 1, evidenceText: "The Moon is made of cheese.", evidenceUrl: "https://claude.ai/chat/abc", judge: "heuristic" }],
    [{ id: "c2", text: "The Moon is made of cheese", weight: 1 }]);
  assert.ok(!(await memory.list()).some((fact) => fact.key.includes("cheese")));
});
