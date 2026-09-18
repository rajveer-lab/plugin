"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const aiJudge = require("../engine/ai-judge.js");

const CLAIM = { id: "c1", text: "The Eiffel Tower was completed in 1889", weight: 1.4 };
const EVIDENCE = [
  { id: "p1", text: "Berlin is the capital of Germany.", url: "https://en.wikipedia.org/wiki/Berlin" },
  { id: "p2", text: "The main structural work of the tower was completed at the end of March 1889.", url: "https://en.wikipedia.org/wiki/Eiffel_Tower" },
  { id: "p3", text: "The Eiffel Tower is in Paris.", url: "https://en.wikipedia.org/wiki/Eiffel_Tower" },
  { id: "p4", text: "Bananas are yellow." },
];

function fakeModel({ availability = "available", reply, onCreate } = {}) {
  const log = { created: 0, cloned: 0, destroyed: 0, prompts: [] };
  const makeSession = () => ({
    clone: async () => {
      log.cloned++;
      return makeSession();
    },
    prompt: async (text, options) => {
      log.prompts.push({ text, options });
      return typeof reply === "function" ? reply(text, options) : reply;
    },
    destroy: () => {
      log.destroyed++;
    },
  });
  return {
    log,
    LanguageModel: {
      availability: async () => availability,
      create: async (options) => {
        log.created++;
        if (onCreate) onCreate(options);
        return makeSession();
      },
    },
  };
}

test("selectEvidence keeps the most relevant passages", () => {
  assert.deepEqual(aiJudge.selectEvidence(CLAIM, EVIDENCE).map((p) => p.id), ["p2", "p3"]);
  assert.deepEqual(aiJudge.selectEvidence(CLAIM, EVIDENCE, 1).map((p) => p.id), ["p2"]);
  assert.deepEqual(aiJudge.selectEvidence(CLAIM, []), []);
});

test("judge asks the model with a JSON schema and returns a cited verdict", async () => {
  const { LanguageModel, log } = fakeModel({ reply: JSON.stringify({ verdict: "supported", source: 1, reason: "Passage 1 says so." }) });
  const judge = aiJudge.createJudge({ LanguageModel });
  const verdict = await judge.judge(CLAIM, EVIDENCE);

  assert.equal(verdict.status, "supported");
  assert.equal(verdict.evidenceId, "p2");
  assert.equal(verdict.evidenceUrl, "https://en.wikipedia.org/wiki/Eiffel_Tower");
  assert.equal(verdict.judge, "on-device-ai");
  assert.equal(verdict.weight, 1.4);
  assert.equal(verdict.reasoning, "On-device AI: Passage 1 says so.");

  const { text, options } = log.prompts[0];
  assert.match(text, /^CLAIM: The Eiffel Tower was completed in 1889\n\nSOURCES:\n\[1\] The main structural work/);
  assert.deepEqual(options.responseConstraint.properties.verdict.enum, ["supported", "contradicted", "unsupported"]);
  assert.equal(options.responseConstraint.properties.source.maximum, 2);
  assert.ok(options.signal);
});

test("one base session with the system prompt, a fresh clone per claim", async () => {
  let systemPrompt;
  const { LanguageModel, log } = fakeModel({
    reply: '{"verdict":"unsupported","source":0,"reason":"Not stated."}',
    onCreate: (options) => {
      systemPrompt = options.initialPrompts && options.initialPrompts[0].content;
    },
  });
  const judge = aiJudge.createJudge({ LanguageModel });
  await judge.judge(CLAIM, EVIDENCE);
  await judge.judge({ ...CLAIM, id: "c2" }, EVIDENCE);
  assert.equal(log.created, 1);
  assert.equal(log.cloned, 2);
  assert.equal(log.destroyed, 2);
  assert.equal(systemPrompt, aiJudge.SYSTEM_PROMPT);
});

test("guards: uncited or number-mismatched 'supported' becomes unsupported", () => {
  const passages = aiJudge.selectEvidence(CLAIM, EVIDENCE);
  const uncited = aiJudge.parseResponse({ verdict: "supported", source: 0, reason: "Yes" }, CLAIM, passages);
  assert.equal(uncited.status, "unsupported");
  assert.equal(uncited.evidenceId, null);

  const wrongYear = aiJudge.parseResponse({ verdict: "supported", source: 1, reason: "Yes" }, { ...CLAIM, text: "The Eiffel Tower was completed in 1887" }, passages);
  assert.equal(wrongYear.status, "unsupported");
  assert.match(wrongYear.reasoning, /1887 doesn't appear in the source/);

  const outOfRange = aiJudge.parseResponse({ verdict: "contradicted", source: 9, reason: "No" }, CLAIM, passages);
  assert.equal(outOfRange.status, "unsupported");

  const numbers = aiJudge.parseResponse({ verdict: "supported", source: 1, reason: "ok" }, { id: "n", text: "Everest is 8,849 metres tall" }, [{ id: "e", text: "Mount Everest is 8849 metres tall." }]);
  assert.equal(numbers.status, "supported", "commas in numbers don't matter");
});

test("contradicted keeps its cited passage; unreadable replies return null", () => {
  const passages = aiJudge.selectEvidence(CLAIM, EVIDENCE);
  const contradicted = aiJudge.parseResponse('Sure! {"verdict":"contradicted","source":2,"reason":"Different place."}', CLAIM, passages);
  assert.equal(contradicted.status, "contradicted");
  assert.equal(contradicted.evidenceId, "p3");
  assert.equal(aiJudge.parseResponse("not json", CLAIM, passages), null);
  assert.equal(aiJudge.parseResponse({ verdict: "maybe", source: 1 }, CLAIM, passages), null);
});

test("returns null without the Prompt API, without a ready model, or without relevant passages", async () => {
  assert.equal(await aiJudge.createJudge({ LanguageModel: null }).status(), "unsupported");
  const downloadable = fakeModel({ availability: "downloadable", reply: "{}" });
  const judge = aiJudge.createJudge({ LanguageModel: downloadable.LanguageModel });
  assert.equal(await judge.available(), false);
  assert.equal(await judge.judge(CLAIM, EVIDENCE), null);
  assert.equal(downloadable.log.created, 0, "never starts a download on its own");

  const ready = fakeModel({ reply: "{}" });
  assert.equal(await aiJudge.createJudge({ LanguageModel: ready.LanguageModel }).judge(CLAIM, [{ id: "x", text: "Bananas are yellow." }]), null);
});

test("prepare downloads the model and reports progress", async () => {
  const progress = [];
  const LanguageModel = {
    availability: async () => "available",
    create: async (options) => {
      const listeners = {};
      options.monitor({ addEventListener: (name, fn) => (listeners[name] = fn) });
      listeners.downloadprogress({ loaded: 0.5 });
      listeners.downloadprogress({ loaded: 1 });
      return { destroy() {} };
    },
  };
  assert.equal(await aiJudge.createJudge({ LanguageModel }).prepare((p) => progress.push(p)), "available");
  assert.deepEqual(progress, [0.5, 1]);
});
