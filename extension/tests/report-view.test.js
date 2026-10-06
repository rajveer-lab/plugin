"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { headline, findLinks } = require("../ui/report-view.js");

test("headline covers breakdown states", () => {
  assert.deepEqual(headline({ breakdown: { confirmed: 0, hallucinated: 0, unverified: 0 } }), { mark: "·", tone: "mute", text: "Nothing specific to check" });
  assert.deepEqual(headline({ breakdown: { confirmed: 40, hallucinated: 25, unverified: 35 } }), { mark: "✕", tone: "bad", text: "25% hallucinated" });
  assert.deepEqual(headline({ breakdown: { confirmed: 50, hallucinated: 0, unverified: 50 } }), { mark: "✓", tone: "ok", text: "0% hallucinated" });
  assert.deepEqual(headline({ breakdown: { confirmed: 20, hallucinated: 0, unverified: 80 } }), { mark: "?", tone: "warn", text: "0% hallucinated" });
  assert.deepEqual(headline({}), { mark: "·", tone: "mute", text: "Nothing specific to check" });
});

test("findLinks trims punctuation and de-duplicates", () => {
  assert.equal(findLinks("See https://example.com/a., and https://example.com/a.").length, 1);
  assert.equal(findLinks("See https://example.com/a.,")[0], "https://example.com/a");
  assert.equal(findLinks("https://en.wikipedia.org/wiki/Python_(programming_language)")[0], "https://en.wikipedia.org/wiki/Python_(programming_language)");
  assert.equal(findLinks("(see https://example.com/a)")[0], "https://example.com/a");
});

test("findLinks returns at most ten http(s) URLs", () => {
  const text = Array.from({ length: 12 }, (_, i) => `https://site${i}.example/x`).join(" ") + " javascript:alert(1) ftp://bad.example";
  const links = findLinks(text);
  assert.equal(links.length, 10);
  assert.ok(links.every((url) => /^https?:\/\//.test(url)));
});
