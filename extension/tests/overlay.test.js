"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const overlay = require("../content/overlay.js");

const report = (supported, contradicted, unsupported) => ({ counts: { supported, contradicted, unsupported } });

test("summary says what happened in plain words", () => {
  assert.equal(overlay.summarize(report(3, 0, 0), []).text, "All 3 statements backed by sources");
  assert.equal(overlay.summarize(report(1, 0, 0), []).text, "All 1 statement backed by sources");
  assert.equal(overlay.summarize(report(4, 0, 5), []).text, "4 of 9 statements backed by sources");
  assert.equal(overlay.summarize(report(0, 0, 6), []).text, "None of the 6 statements could be checked");
  assert.equal(overlay.summarize(report(0, 0, 0), []).text, "Nothing to check in this answer");
});

test("conflicts win over everything else", () => {
  assert.deepEqual(
    { ...overlay.summarize(report(5, 1, 2), []) },
    { mark: "✕", tone: "ah-tone-bad", text: "1 statement conflicts with sources" },
  );
  assert.equal(overlay.summarize(report(0, 3, 0), []).text, "3 statements conflict with sources");
});

test("fake links are added to the summary", () => {
  const checks = [{ status: "not_found" }, { status: "ok" }, { status: "not_found" }, { status: "unreachable" }];
  assert.equal(overlay.summarize(report(2, 0, 0), checks).text, "All 2 statements backed by sources · 2 fake links");
  assert.equal(overlay.summarize(report(2, 0, 0), [{ status: "not_found" }]).text, "All 2 statements backed by sources · 1 fake link");
  assert.equal(overlay.summarize(report(2, 0, 0), [{ status: "unreachable" }]).text, "All 2 statements backed by sources");
});

test("tone and symbol never rely on colour alone", () => {
  for (const [r, expected] of [
    [report(2, 0, 0), { mark: "✓", tone: "ah-tone-ok" }],
    [report(0, 1, 0), { mark: "✕", tone: "ah-tone-bad" }],
    [report(0, 0, 2), { mark: "?", tone: "ah-tone-warn" }],
    [report(0, 0, 0), { mark: "·", tone: "ah-tone-mute" }],
  ]) {
    const { mark, tone } = overlay.summarize(r, []);
    assert.deepEqual({ mark, tone }, expected);
  }
});
