"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const claimsModule = require("../engine/claims.js");
const verifier = require("../engine/verifier.js");
const scorer = require("../engine/scorer.js");
const mitigator = require("../engine/mitigator.js");

const EVIDENCE = [
  { id: "wiki:1", kind: "wikipedia", source: "Wikipedia: James Webb Space Telescope", text: "The James Webb Space Telescope was launched on December 25, 2021." },
  { id: "wiki:2", kind: "wikipedia", source: "Wikipedia: JWST orbit", text: "JWST operates in the infrared spectrum at the Sun-Earth L2 Lagrange point." },
];

function claim(id, sentenceIndex, sentence, weight = 1) {
  return { id, text: sentence.replace(/\.$/, ""), sentence, sentenceIndex, weight, entities: [] };
}

function verdict(claimId, status, extra = {}) {
  return { claimId, status, confidence: 0.8, judge: "heuristic", ...extra };
}

test("end to end with the real engine: each status gets a note", () => {
  const answer = "The James Webb Space Telescope was launched in 1995. JWST operates in the infrared spectrum at the Sun-Earth L2 Lagrange point. It was designed by volunteer astronomers in Iceland.";
  const claims = claimsModule.extract(answer);
  const report = scorer.score(verifier.verifyAll(claims, EVIDENCE));
  const annotations = mitigator.annotate(answer, report, claims, EVIDENCE, { strictness: "strict" });

  assert.deepEqual(annotations.map((a) => a.status), ["contradicted", "supported", "unsupported"]);
  assert.match(annotations[0].note, /^Contradicted by Wikipedia: James Webb Space Telescope, which says: "The James Webb Space Telescope was launched on December 25, 2021\."/);
  assert.deepEqual(annotations[0].evidenceIds, ["wiki:1"]);
  assert.match(annotations[1].note, /^Supported by Wikipedia: JWST orbit/);
  assert.equal(annotations[2].note, "No source found that confirms this.");
  annotations.forEach((a) => assert.ok(answer.includes(a.sentence)));
});

test("a sentence takes its worst verdict", () => {
  const sentence = "Paris is in France, and it has 90 million people.";
  const claims = [claim("a", 0, sentence), claim("b", 0, sentence)];
  const report = { verdicts: [verdict("a", "supported", { confidence: 0.9 }), verdict("b", "contradicted", { confidence: 0.7, evidenceId: "e1" })] };
  const [annotation] = mitigator.annotate(sentence, report, claims, [{ id: "e1", source: "Census", text: "Paris has 2.1 million people." }]);
  assert.equal(annotation.status, "contradicted");
  assert.equal(annotation.confidence, 0.7);
  assert.deepEqual(annotation.evidenceIds, ["e1"]);
});

test("supported confidence is the weakest supporting claim", () => {
  const sentence = "A is B, and C is D.";
  const claims = [claim("a", 0, sentence), claim("b", 0, sentence)];
  const report = { verdicts: [verdict("a", "supported", { confidence: 0.9 }), verdict("b", "supported", { confidence: 0.6 })] };
  assert.equal(mitigator.annotate(sentence, report, claims, [])[0].confidence, 0.6);
});

test("zero-weight sentences and moderate unsupported sentences are skipped", () => {
  const text = "You asked about towers. Towers are tall.";
  const claims = [claim("a", 0, "You asked about towers.", 0), claim("b", 1, "Towers are tall.")];
  const report = { verdicts: [verdict("a", "unsupported"), verdict("b", "unsupported")] };
  assert.deepEqual(mitigator.annotate(text, report, claims, []).map((a) => a.sentenceIndex), [1]);
  assert.deepEqual(mitigator.annotate(text, report, claims, [], { strictness: "moderate" }), []);
  assert.match(mitigator.annotate(text, report, claims, [], { strictness: "zero_tolerance" })[0].note, /Treat it as unreliable/);
});

test("memory and on-device AI verdicts say how they were checked", () => {
  const text = "The tower opened in 1889.";
  const claims = [claim("a", 0, text)];
  const memory = mitigator.annotate(text, { verdicts: [verdict("a", "supported", { judge: "memory", evidenceUrl: "https://en.wikipedia.org/wiki/Eiffel_Tower", evidenceText: "Opened in 1889." })] }, claims, []);
  assert.equal(memory[0].note, 'Supported by https://en.wikipedia.org/wiki/Eiffel_Tower (checked earlier): "Opened in 1889."');
  assert.equal(memory[0].judge, "memory");
  const ai = mitigator.annotate(text, { verdicts: [verdict("a", "contradicted", { judge: "on-device-ai" })] }, claims, []);
  assert.equal(ai[0].note, "Contradicted by a source (checked by on-device AI).");
});

test("sentences no longer in the answer are dropped", () => {
  const claims = [claim("a", 0, "Old sentence.")];
  assert.deepEqual(mitigator.annotate("A different answer.", { verdicts: [verdict("a", "supported")] }, claims, []), []);
});

test("empty inputs don't throw", () => {
  assert.deepEqual(mitigator.annotate("", null, null, null), []);
  assert.deepEqual(mitigator.annotate("Text.", { verdicts: [] }, [], []), []);
});

test("snippet picks the most relevant part of a long page", () => {
  const page = "Welcome to our site. ".repeat(40) + "The Eiffel Tower was completed in 1889 for the World's Fair. " + "Cookie policy and more. ".repeat(40);
  assert.equal(mitigator.snippet(page, "The Eiffel Tower was completed in 1889"), "The Eiffel Tower was completed in 1889 for the World's Fair.");
  assert.ok(mitigator.snippet("x".repeat(1000), "claim", 50).length <= 50);
  assert.equal(mitigator.snippet("Short text.", "claim"), "Short text.");
});
