"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const learnerModule = require("../engine/learner.js");

const { createLearner, featuresForVerdict, featuresForItem, THRESHOLD } = learnerModule;

const claim = (text, entities = [], weight = 1) => ({ text, sentence: text, entities, weight });
const wiki = (text) => ({ kind: "wikipedia", text });
const contradicted = (confidence, evidenceText) => ({ judge: "heuristic", status: "contradicted", confidence, evidenceText });

const chatty = featuresForVerdict(contradicted(0.7, "A passage about a TV episode."), claim("I can explain the plot if you'd like.", [], 0.2), wiki("A passage about a TV episode."));
const chattyToo = featuresForVerdict(contradicted(0.75, "An unrelated passage."), claim("I can summarize the main themes if you want.", [], 0.2), wiki("An unrelated passage."));
const real = featuresForVerdict(contradicted(0.9, "The Eiffel Tower is in Paris."), claim("The Eiffel Tower is located in Lyon.", ["Eiffel Tower", "Lyon"]), wiki("The Eiffel Tower is in Paris."));

test("with nothing learned it trusts every check", () => {
  const learner = createLearner();
  for (const head of ["supported", "contradicted", "consistency"]) assert.equal(learner.predict(head, chatty), 0.9);
  assert.equal(learner.shows("contradicted", chatty), true);
});

test("one 'wrong' hides checks that look the same, not different ones", () => {
  const learner = createLearner();
  learner.update("contradicted", chatty, 0);
  assert.ok(learner.predict("contradicted", chatty) < THRESHOLD);
  assert.ok(learner.predict("contradicted", chattyToo) < THRESHOLD, "a similar chatty sentence");
  assert.equal(learner.predict("contradicted", real), 0.9, "a real contradiction is untouched");
  assert.equal(learner.predict("supported", chatty), 0.9, "other heads are untouched");
});

test("caution is learned faster than confidence", () => {
  const learner = createLearner();
  learner.update("contradicted", chatty, 0);
  learner.update("contradicted", chatty, 1);
  assert.ok(learner.predict("contradicted", chatty) < THRESHOLD, "one right doesn't cancel one wrong");
  learner.update("contradicted", chatty, 1);
  learner.update("contradicted", chatty, 1);
  assert.ok(learner.predict("contradicted", chatty) >= THRESHOLD, "three rights do");
});

test("exact facts teach more gently than the user", () => {
  const learner = createLearner();
  learner.update("contradicted", chatty, 0, { auto: true });
  assert.ok(learner.shows("contradicted", chatty), "one automatic example isn't enough to hide a check");
  learner.update("contradicted", chatty, 0, { auto: true });
  assert.ok(!learner.shows("contradicted", chatty));
  assert.deepEqual(learner.stats(), { right: 0, wrong: 0, auto: 2 });
});

test("state survives a save and load, and bad input is ignored", () => {
  const learner = createLearner();
  learner.update("contradicted", chatty, 0);
  assert.equal(learner.update("nonsense", chatty, 0), false);
  assert.equal(learner.update("contradicted", chatty, 2), false);
  const restored = createLearner(JSON.parse(JSON.stringify(learner.toJSON())));
  assert.equal(restored.predict("contradicted", chatty), learner.predict("contradicted", chatty));
  assert.deepEqual(restored.stats(), { right: 0, wrong: 1, auto: 0 });
  assert.equal(createLearner({ version: 99, heads: {} }).predict("contradicted", chatty), 0.9);
  assert.equal(createLearner("garbage").predict("contradicted", chatty), 0.9);
});

test("only numbers are kept, never text", () => {
  const learner = createLearner();
  learner.update("contradicted", chatty, 0);
  const saved = JSON.stringify(learner.toJSON());
  assert.doesNotMatch(saved, /plot|passage|episode/i);
});

test("features describe the check: judge, source, details, chat-talk", () => {
  assert.equal(chatty.first_person, 1);
  assert.equal(chatty.second_person, 1);
  assert.equal(chatty.has_name, 0);
  assert.equal(real.has_name, 1);
  assert.equal(real.src_wikipedia, 1);
  assert.equal(real.judge_heuristic, 1);
  const item = featuresForItem({ type: "changed_wrong", afterPushback: true }, claim("The tower is 300 metres tall."), { valueType: "qty:meter", measure: true, shared: 2, byAI: true });
  assert.equal(item.f_changed_wrong, 1);
  assert.equal(item.after_pushback, 1);
  assert.equal(item.v_measure, 1);
  assert.equal(item.by_ai, 1);
});
