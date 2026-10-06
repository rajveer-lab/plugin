"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const overlay = require("../content/overlay.js");

const report = (confirmed, hallucinated, unverified) => ({ breakdown: { confirmed, hallucinated, unverified } });

test("the chip leads with the hallucination percentage, then the other shares", () => {
  assert.equal(overlay.summarize(report(100, 0, 0), []).text, "0% hallucinated · 100% confirmed");
  assert.equal(overlay.summarize(report(50, 25, 25), []).text, "25% hallucinated · 50% confirmed · 25% unverified");
  assert.equal(overlay.summarize(report(0, 0, 100), []).text, "0% hallucinated · 100% unverified");
  assert.equal(overlay.summarize(report(0, 100, 0), []).text, "100% hallucinated");
});

test("nothing specific to check is said plainly, without a percentage", () => {
  assert.equal(overlay.summarize(report(0, 0, 0), []).text, "Nothing specific to check");
  assert.equal(overlay.summarize({ counts: { supported: 0, contradicted: 0, unsupported: 0 } }, []).text, "Nothing specific to check");
});

test("reports without a breakdown fall back to statement counts", () => {
  const old = { counts: { supported: 2, contradicted: 1, unsupported: 1 } };
  assert.equal(overlay.summarize(old, []).text, "25% hallucinated · 50% confirmed · 25% unverified");
});

test("fake links are added to the summary", () => {
  const checks = [{ status: "not_found" }, { status: "ok" }, { status: "not_found" }, { status: "unreachable" }];
  assert.equal(overlay.summarize(report(100, 0, 0), checks).text, "0% hallucinated · 100% confirmed · 2 fake links");
  assert.equal(overlay.summarize(report(100, 0, 0), [{ status: "not_found" }]).text, "0% hallucinated · 100% confirmed · 1 fake link");
  assert.equal(overlay.summarize(report(100, 0, 0), [{ status: "unreachable" }]).text, "0% hallucinated · 100% confirmed");
});

test("tone and symbol never rely on colour alone, and mostly-unverified isn't reassuring", () => {
  for (const [r, expected] of [
    [report(100, 0, 0), { mark: "✓", tone: "ah-tone-ok" }],
    [report(50, 0, 50), { mark: "✓", tone: "ah-tone-ok" }],
    [report(90, 10, 0), { mark: "✕", tone: "ah-tone-bad" }],
    [report(30, 0, 70), { mark: "?", tone: "ah-tone-warn" }],
    [report(0, 0, 0), { mark: "·", tone: "ah-tone-mute" }],
  ]) {
    const { mark, tone } = overlay.summarize(r, []);
    assert.deepEqual({ mark, tone }, expected);
  }
});

test("conversation findings follow the percentages and can only make the tone worse", () => {
  const caved = { type: "changed_wrong", afterPushback: true, tone: "bad" };
  const changed = { type: "changed_unknown", afterPushback: false, tone: "warn" };
  const fixed = { type: "changed_fixed", afterPushback: true, tone: "ok" };

  const bad = overlay.summarize(report(100, 0, 0), [], [caved]);
  assert.equal(bad.text, "0% hallucinated · 100% confirmed · gave in to pushback");
  assert.deepEqual({ mark: bad.mark, tone: bad.tone }, { mark: "✕", tone: "ah-tone-bad" });

  const warn = overlay.summarize(report(100, 0, 0), [], [changed, changed]);
  assert.equal(warn.text, "0% hallucinated · 100% confirmed · contradicts itself");
  assert.deepEqual({ mark: warn.mark, tone: warn.tone }, { mark: "?", tone: "ah-tone-warn" });

  const stillBad = overlay.summarize(report(50, 50, 0), [], [fixed]);
  assert.deepEqual({ mark: stillBad.mark, tone: stillBad.tone }, { mark: "✕", tone: "ah-tone-bad" });
});

test("with nothing else to check, the conversation finding leads the chip", () => {
  const only = overlay.summarize(report(0, 0, 0), [], [{ type: "misquote", tone: "bad" }]);
  assert.equal(only.text, "Misquotes you");
  assert.equal(only.tone, "ah-tone-bad");
  const good = overlay.summarize(report(0, 0, 0), [], [{ type: "held_correct", afterPushback: true, tone: "ok" }]);
  assert.deepEqual({ text: good.text, mark: good.mark }, { text: "Stood by its answer", mark: "✓" });
  assert.equal(overlay.summarize(report(100, 0, 0), [], []).text, "0% hallucinated · 100% confirmed");
});
