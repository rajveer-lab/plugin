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

