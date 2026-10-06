"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const grounder = require("../engine/grounder.js");

test("correctionPrompt quotes each conflicting sentence and its source", () => {
  const one = grounder.correctionPrompt([{ sentence: "Construction started on 26 January 1887.", evidenceText: "Work on the foundations started on 28 January 1887.", source: "Wikipedia: Eiffel Tower", url: "https://en.wikipedia.org/wiki/Eiffel_Tower" }]);
  assert.ok(one.startsWith("Please double-check part of your last answer. This statement conflicts with a source:\n\n1. You wrote: \"Construction started on 26 January 1887.\"\n   Wikipedia: Eiffel Tower (https://en.wikipedia.org/wiki/Eiffel_Tower) says: \"Work on the foundations started on 28 January 1887.\""));
  assert.match(one, /Correct anything that's wrong and show the corrected sentence\./);

  const two = grounder.correctionPrompt([
    { sentence: "A.", evidenceText: "Not A." },
    { sentence: "B.", evidenceText: "x".repeat(900), source: "Page" },
  ]);
  assert.match(two, /These statements conflict with sources:/);
  assert.match(two, /\n\n2\. You wrote: "B\."\n   Page says: "x+ …"/);
  assert.match(two, /1\. You wrote: "A\."\n   A source says: "Not A\."/);
  assert.equal(grounder.correctionPrompt([]), "");
  assert.equal(grounder.correctionPrompt([{ sentence: "  " }]), "");
});
