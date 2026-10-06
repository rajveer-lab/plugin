"use strict";

// The real engine (claims, verifier, conversation checks, learner) with fake sources and a fake
// on-device AI, to test how learning and AI judging fit into the CHECK_ANSWER pipeline.
const test = require("node:test");
const assert = require("node:assert/strict");
for (const file of ["claims", "verifier", "conversation", "learner", "scorer", "mitigator"]) require(`../engine/${file}.js`);
const pipeline = require("../background/service-worker.js");

const AH = globalThis.AH;
for (const key of ["factMemory", "links", "webSearch", "pageSources", "wikidata"]) delete AH[key];

let sources = [];
AH.wikipedia = { lookup: async () => sources };

function settings() {
  return pipeline.mergeSettings({ onDeviceAI: true, sources: { links: false, wikipedia: true, webSearch: false, pages: false } });
}

const wiki = (id, text, extra = {}) => ({ id, kind: "wikipedia", source: "Wikipedia: Eiffel Tower", url: "https://en.wikipedia.org/wiki/Eiffel_Tower", text, ...extra });

/** A stand-in for Gemini Nano: contradicts a claim when a passage contains `word`, citing that passage. */
function fakeAI(word, calls = []) {
  return {
    aiAvailable: async () => true,
    aiJudge: async (claim, passages) => {
      calls.push({ claim: claim.text, passages: passages.map((p) => p.text) });
      const index = passages.findIndex((p) => p.text.includes(word));
      if (index < 0) return { claimId: claim.id, claimText: claim.text, status: "unsupported", judge: "on-device-ai", evidenceId: null };
      const cited = passages[index];
      return { claimId: claim.id, claimText: claim.text, status: "contradicted", confidence: 0.85, judge: "on-device-ai", evidenceId: cited.id, evidenceText: cited.text, reasoning: "On-device AI: different" };
    },
  };
}

const run = (request, deps) => pipeline.checkAnswer({ site: "chatgpt", links: [], ...request }, { settings: settings(), ...deps });

test("a check marked wrong is left unverified the next time", async () => {
  sources = [wiki("w1", "The Eiffel Tower was completed in 1889 for the World's Fair.")];
  const learner = AH.learner.createLearner();
  const request = { question: "When was the Eiffel Tower completed?", answerText: "The Eiffel Tower was completed in 1901." };

  const first = await run(request, { learner });
  const flagged = first.annotations.find((a) => a.status === "contradicted");
  assert.ok(flagged, "first time it's flagged");
  assert.equal(flagged.learn.head, "contradicted");
  assert.equal(typeof flagged.learn.features.has_year, "number");

  learner.update(flagged.learn.head, flagged.learn.features, 0);
  const second = await run(request, { learner });
  const now = second.annotations.find((a) => a.sentence === flagged.sentence);
  assert.equal(now.status, "unsupported");
  assert.match(now.note, /marked checks like this one as wrong/);
  assert.equal(second.report.breakdown.hallucinated, 0);
});

test("exact facts teach the learner automatically, both ways", async () => {
  const learner = AH.learner.createLearner();
  sources = [
    wiki("d1", "The Eiffel Tower was completed in 1889.", { kind: "wikidata", exact: true }),
    wiki("w1", "The Eiffel Tower was completed in 1889 for the World's Fair."),
  ];
  await run({ question: "When was the Eiffel Tower completed?", answerText: "The Eiffel Tower was completed in 1889." }, { learner });
  assert.deepEqual(learner.stats(), { right: 0, wrong: 0, auto: 1 });

  // Nothing settles a claim without an exact fact: no example
  sources = [wiki("w1", "The Eiffel Tower was completed in 1889 for the World's Fair.")];
  await run({ question: "When was the Eiffel Tower completed?", answerText: "The Eiffel Tower was completed in 1889." }, { learner });
  assert.equal(learner.stats().auto, 1);
});

test("the on-device AI judges pasted text, and only sees the user's own text for it", async () => {
  sources = [];
  const calls = [];
  const history = [{ role: "user", text: "Please summarize: Mira prefers a window seat on the 9:40 flight to Oslo. She checks one bag." }];
  const result = await run(
    { question: history[0].text, answerText: "Mira wants an aisle seat on the 9:40 flight to Oslo.", history },
    { ...fakeAI("window", calls), learner: AH.learner.createLearner() },
  );
  const annotation = result.annotations[0];
  assert.equal(annotation.status, "contradicted");
  assert.equal(annotation.judge, "on-device-ai");
  assert.match(annotation.note, /Conflicts with the text you gave it/);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((call) => call.passages.every((p) => history[0].text.includes(p))), "only the pasted text was given to the AI");
});

test("without the on-device AI, the rules judge the pasted text", async () => {
  sources = [];
  const history = [{ role: "user", text: "Notes: the launch review is on 14 May in Alder Hall." }];
  const result = await run(
    { question: history[0].text, answerText: "The launch review is on 21 May.", history },
    { aiAvailable: async () => false, aiJudge: async () => assert.fail("not available"), learner: AH.learner.createLearner() },
  );
  assert.equal(result.annotations[0].status, "contradicted");
  assert.equal(result.annotations[0].judge, "heuristic");
});

test("the on-device AI decides conversation findings, and they can be learned away", async () => {
  sources = [];
  const history = [
    { role: "user", text: "Which colour did we pick for the banner?" },
    { role: "assistant", text: "We picked teal for the banner." },
    { role: "user", text: "Great, now write the brief." },
  ];
  const learner = AH.learner.createLearner();
  const request = { question: "Great, now write the brief.", answerText: "The banner will be orange, as agreed.", history };
  const first = await run(request, { ...fakeAI("teal"), learner });
  assert.equal(first.consistency.length, 1);
  const [item] = first.consistency;
  assert.equal(item.type, "changed_unknown");
  assert.equal(item.learn.head, "consistency");
  assert.equal(item.learn.features.by_ai, 1);
  assert.equal(item.basis, undefined, "internal details aren't sent to the page");

  learner.update(item.learn.head, item.learn.features, 0);
  const second = await run(request, { ...fakeAI("teal"), learner });
  assert.deepEqual(second.consistency, []);
});

test("the AI isn't asked more than its limit per answer", async () => {
  sources = [];
  const calls = [];
  const history = [
    { role: "user", text: "Tell me about our trip." },
    { role: "assistant", text: Array.from({ length: 12 }, (_, i) => `Stop ${i + 1} is in Town${i + 1} on day ${i + 1}.`).join(" ") },
    { role: "user", text: "Summarize it again." },
  ];
  const answerText = Array.from({ length: 12 }, (_, i) => `Stop ${i + 1} is in Town${i + 1} on day ${i + 2}.`).join(" ");
  await run({ question: "Summarize it again.", answerText, history }, { ...fakeAI("never-matches", calls), learner: AH.learner.createLearner() });
  assert.ok(calls.length <= 6 + 6, `asked ${calls.length} times`);
});
