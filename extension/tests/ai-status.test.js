"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { describe } = require("../ui/ai-status.js");

test("AI status descriptions cover all model states", () => {
  assert.deepEqual(describe("available"), { mark: "✓", tone: "ok", text: "Ready" });
  assert.equal(describe("downloadable").text, "not set up");
  assert.equal(describe("downloading").tone, "warn");
  assert.equal(describe("unavailable").tone, "mute");
  assert.deepEqual(describe("unsupported"), describe("unknown"));
});
