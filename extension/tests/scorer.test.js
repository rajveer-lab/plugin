/**
 * Unit Tests for Scorer with Information-Weighting and Grounding.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const scorer = require("../engine/scorer.js");

test("scorer calculates verifiedWeight correctly", () => {
  const verdicts = [
    { claimId: "c1", status: "supported", weight: 0.8, confidence: 0.9 },
    { claimId: "c2", status: "supported", weight: 0.5, confidence: 0.8 },
    { claimId: "c3", status: "unsupported", weight: 1.0, confidence: 0.2 },
  ];

  const report = scorer.score(verdicts, { minInformation: 1.0 });
  assert.strictEqual(report.verifiedWeight, 1.3);
  assert.strictEqual(report.counts.supported, 2);
  assert.strictEqual(report.counts.unsupported, 1);
  assert.strictEqual(report.counts.contradicted, 0);
  assert.strictEqual(report.grounded, true, "Should be grounded since verifiedWeight (1.3) >= minInformation (1.0) and 0 contradictions");
});

test("scorer sets grounded: false when verifiedWeight is below minInformation", () => {
  const verdicts = [
    { claimId: "c1", status: "supported", weight: 0.3, confidence: 0.9 }, // Trivial filler
  ];

  const report = scorer.score(verdicts, { minInformation: 1.0 });
  assert.strictEqual(report.verifiedWeight, 0.3);
  assert.strictEqual(report.grounded, false, "Filler alone cannot ground an answer");
});

test("scorer sets grounded: false and elevates risk on contradiction", () => {
  const verdicts = [
    { claimId: "c1", status: "supported", weight: 2.0, confidence: 0.95 },
    { claimId: "c2", status: "contradicted", weight: 1.0, confidence: 0.9 },
  ];

  const report = scorer.score(verdicts, { minInformation: 1.0 });
  assert.strictEqual(report.grounded, false, "Any contradiction prevents grounded status");
  assert.ok(
    report.riskLevel === "HIGH" || report.riskLevel === "CRITICAL",
    "Contradiction must trigger HIGH or CRITICAL risk"
  );
  assert.ok(report.hallucinationScore > 0.3);
});

test("scorer handles empty verdicts gracefully", () => {
  const report = scorer.score([]);
  assert.strictEqual(report.riskLevel, "LOW");
  assert.strictEqual(report.grounded, false);
  assert.strictEqual(report.verifiedWeight, 0.0);
});

test("C-27: caps CRITICAL risk at HIGH when total weighted claims is less than 3", () => {
  // Single claim with contradiction
  const singleVerdict = [
    { claimId: "c1", status: "contradicted", weight: 1.0, confidence: 0.95 },
  ];
  const report1 = scorer.score(singleVerdict);
  assert.strictEqual(report1.riskLevel, "HIGH", "Single contradiction must be capped at HIGH risk, not CRITICAL");

  // Two claims with contradiction
  const twoVerdicts = [
    { claimId: "c1", status: "supported", weight: 1.0, confidence: 0.9 },
    { claimId: "c2", status: "contradicted", weight: 1.0, confidence: 0.95 },
  ];
  const report2 = scorer.score(twoVerdicts);
  assert.strictEqual(report2.riskLevel, "HIGH", "Two claims with contradiction must be capped at HIGH risk");

  // Three or more claims with 2 contradictions can achieve CRITICAL
  const threeVerdicts = [
    { claimId: "c1", status: "supported", weight: 1.0, confidence: 0.9 },
    { claimId: "c2", status: "contradicted", weight: 1.0, confidence: 0.95 },
    { claimId: "c3", status: "contradicted", weight: 1.0, confidence: 0.95 },
  ];
  const report3 = scorer.score(threeVerdicts);
  assert.strictEqual(report3.riskLevel, "CRITICAL", "Three or more claims with multiple contradictions can reach CRITICAL");
});


test("breakdown splits the answer's information into confirmed / hallucinated / unverified", () => {
  const report = scorer.score([
    { status: "supported", weight: 1.0 },
    { status: "supported", weight: 1.0 },
    { status: "contradicted", weight: 1.0 },
    { status: "unsupported", weight: 1.0 },
  ]);
  assert.deepStrictEqual(report.breakdown, { confirmed: 50, hallucinated: 25, unverified: 25 });
});

test("breakdown always adds up to 100 and weighs claims by information", () => {
  const thirds = scorer.breakdown([
    { status: "supported", weight: 1 },
    { status: "contradicted", weight: 1 },
    { status: "unsupported", weight: 1 },
  ]);
  assert.strictEqual(thirds.confirmed + thirds.hallucinated + thirds.unverified, 100);

  // A specific claim (weight 1.5) outweighs a vague one (0.5)
  assert.deepStrictEqual(scorer.breakdown([
    { status: "supported", weight: 1.5 },
    { status: "unsupported", weight: 0.5 },
  ]), { confirmed: 75, hallucinated: 0, unverified: 25 });
});

test("breakdown ignores filler but never hides a conflict", () => {
  // Weight-0 filler (repeats of the question, trivia) doesn't count either way
  assert.deepStrictEqual(scorer.breakdown([
    { status: "supported", weight: 1 },
    { status: "unsupported", weight: 0 },
  ]), { confirmed: 100, hallucinated: 0, unverified: 0 });
  // A contradicted claim counts even at weight 0, and never rounds down to 0%
  const tiny = scorer.breakdown([
    ...Array.from({ length: 300 }, () => ({ status: "supported", weight: 1 })),
    { status: "contradicted", weight: 0 },
  ]);
  assert.strictEqual(tiny.hallucinated, 1);
  assert.strictEqual(tiny.confirmed + tiny.hallucinated + tiny.unverified, 100);
});

test("breakdown is all zeros when there's nothing specific to check", () => {
  assert.deepStrictEqual(scorer.score([]).breakdown, { confirmed: 0, hallucinated: 0, unverified: 0 });
  assert.deepStrictEqual(scorer.breakdown([{ status: "unsupported", weight: 0 }]), { confirmed: 0, hallucinated: 0, unverified: 0 });
});
