"use strict";

const test = require("node:test");
const assert = require("node:assert");
const history = require("../content/sites/history.js");

test("history rejects non-arrays and filters invalid roles and empty text", () => {
  assert.deepStrictEqual(history.build(null), []);
  assert.deepStrictEqual(history.build("text"), []);
  assert.deepStrictEqual(history.build([
    { role: "system", text: "hidden" }, { role: "user", text: "  " },
    { role: "assistant", text: " answer " }, { role: "user", text: 4 },
  ]), [{ role: "assistant", text: "answer" }]);
});

test("history keeps the last 20 turns in page order", () => {
  const result = history.build(Array.from({ length: 22 }, (_, i) => ({ role: "user", text: String(i) })));
  assert.equal(result.length, 20);
  assert.equal(result[0].text, "2");
  assert.equal(result[19].text, "21");
});

test("history trims each turn to 20,000 characters", () => {
  const result = history.build([{ role: "user", text: `  ${"x".repeat(20005)}  ` }]);
  assert.equal(result[0].text.length, 20000);
});

test("history drops oldest turns to stay within 60,000 characters", () => {
  const result = history.build(Array.from({ length: 4 }, (_, i) => ({ role: "user", text: `${i}${"x".repeat(19999)}` })));
  assert.equal(result.length, 3);
  assert.equal(result[0].text[0], "1");
  assert.ok(result.reduce((sum, turn) => sum + turn.text.length, 0) <= 60000);
});

test("history retains the newest turn when older turns exceed the total limit", () => {
  const result = history.build(Array.from({ length: 4 }, (_, i) => ({ role: "user", text: `${i}${"x".repeat(19999)}` })));
  assert.equal(result.at(-1).text[0], "3");
  assert.ok(result.reduce((sum, turn) => sum + turn.text.length, 0) <= 60000);
});

test("history drops adjacent turns with the same role and text", () => {
  assert.deepStrictEqual(history.build([
    { role: "user", text: " same " },
    { role: "user", text: "same" },
    { role: "assistant", text: "same" },
    { role: "user", text: "same" },
  ]), [
    { role: "user", text: "same" },
    { role: "assistant", text: "same" },
    { role: "user", text: "same" },
  ]);
});
