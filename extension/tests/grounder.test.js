"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const grounder = require("../engine/grounder.js");

const types = (prompt, history) => grounder.assess(prompt, history).flags.map((f) => f.type);

test("clear prompts get no flags", () => {
  assert.deepEqual(types("When was the Eiffel Tower completed?"), []);
  assert.equal(grounder.assess("When was the Eiffel Tower completed?").needsClarification, false);
});

test("short prompts are underspecified", () => {
  assert.deepEqual(types("Explain"), ["underspecified"]);
  assert.equal(grounder.assess("Explain").needsClarification, true);
});

test("references to things outside the chat are flagged unless there is history", () => {
  assert.ok(types("It was founded in which year?").includes("unresolved_reference"));
  assert.ok(types("Tell me more about the above topic").includes("unresolved_reference"));
  assert.ok(types("What is the latest news about it?").includes("unresolved_reference"));
  assert.ok(!types("Is it true that the Eiffel Tower is in Paris?").includes("unresolved_reference"));
  assert.ok(!types("It was founded in which year?", ["Tell me about Apple Inc."]).includes("unresolved_reference"));
});

test("relative time is flagged only without an explicit year", () => {
  assert.ok(types("What is the latest Python version?").includes("relative_time"));
  assert.ok(!types("What was the latest Python version in 2024?").includes("relative_time"));
  assert.equal(grounder.assess("What is the latest Python version?").needsClarification, false);
});

test("boost appends guidelines for each strictness", () => {
  const strict = grounder.boost("Who wrote Hamlet?");
  assert.ok(strict.startsWith("Who wrote Hamlet?\n\n---\nAnswer guidelines:\n- "));
  assert.match(strict, /Don't invent names, numbers, dates, quotes, links or sources/);
  assert.match(grounder.boost("Who wrote Hamlet?", { strictness: "zero_tolerance" }), /reply only: "I don't know\."/);
  assert.ok(grounder.boost("Who wrote Hamlet?", { strictness: "moderate" }).split("\n- ").length === 3);
  assert.equal(grounder.boost("Who wrote Hamlet?", { strictness: "unknown" }), strict);
});

test("boosting twice replaces the guidelines instead of stacking them", () => {
  const once = grounder.boost("Who wrote Hamlet?", { strictness: "moderate" });
  const twice = grounder.boost(once, { strictness: "strict" });
  assert.equal(twice.split("Answer guidelines:").length, 2);
  assert.equal(twice, grounder.boost("Who wrote Hamlet?"));
  assert.equal(grounder.strip(twice), "Who wrote Hamlet?");
});

test("relative-time prompts get today's date", () => {
  const boosted = grounder.boost("What is the latest iPhone?", { today: "2026-09-17" });
  assert.match(boosted, /Today's date is 2026-09-17\./);
  assert.doesNotMatch(grounder.boost("Who wrote Hamlet?", { today: "2026-09-17" }), /Today's date/);
});
