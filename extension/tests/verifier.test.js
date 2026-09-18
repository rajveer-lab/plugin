/**
 * Unit Tests for Fact Verifier with Zero False Accepts (reverify standard).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const verifier = require("../engine/verifier.js");

const KNOWN_TRUE_FIXTURES = [
  {
    claim: { id: "t1", text: "Water boils at 100 degrees Celsius.", weight: 0.8 },
    evidence: [{ id: "ev1", text: "Pure water boils at 100 degrees Celsius under standard atmospheric conditions.", url: "https://example.com/water" }],
    expectedStatus: "supported",
  },
  {
    claim: { id: "t2", text: "Alexander Fleming discovered penicillin in 1928.", weight: 1.2 },
    evidence: [{ id: "ev2", text: "Scottish bacteriologist Alexander Fleming discovered penicillin in 1928.", url: "https://example.com/penicillin" }],
    expectedStatus: "supported",
  },
  {
    claim: { id: "t3", text: "Paris is the capital of France.", weight: 0.7 },
    evidence: [{ id: "ev3", text: "Paris is the capital and most populous city of France.", url: "https://example.com/paris" }],
    expectedStatus: "supported",
  },
  {
    claim: { id: "t4", text: "Marie Curie won the Nobel Prize in Chemistry.", weight: 1.2 },
    evidence: [{ id: "ev4", text: "Marie Curie won the Nobel Prize in Physics in 1903 and in Chemistry in 1911.", url: "https://example.com/curie" }],
    expectedStatus: "supported",
  },
];

const KNOWN_FALSE_FIXTURES = [
  {
    name: "Entity substitution (Berlin vs Paris)",
    claim: { id: "f_ent1", text: "The Eiffel Tower is located in Berlin.", weight: 1.0 },
    evidence: [{ id: "ev_ent1", text: "The Eiffel Tower is located in Paris, France.", url: "https://example.com/eiffel-paris" }],
  },
  {
    name: "Entity/field substitution (Chemistry vs Physics)",
    claim: { id: "f_ent2", text: "Albert Einstein won the Nobel Prize in Chemistry.", weight: 1.2 },
    evidence: [{ id: "ev_ent2", text: "Albert Einstein won the Nobel Prize in Physics in 1921.", url: "https://example.com/einstein" }],
  },
  {
    name: "Year conflict / temporal contradiction",
    claim: { id: "f1", text: "Apollo 11 landed on the moon in 1999.", weight: 1.0 },
    evidence: [{ id: "ev1", text: "Apollo 11 was the American spaceflight that landed the first humans on the Moon in 1969.", url: "https://example.com/apollo" }],
  },
  {
    name: "Numerical conflict / metric mismatch",
    claim: { id: "f2", text: "The Eiffel Tower stands 1200 meters high.", weight: 1.0 },
    evidence: [{ id: "ev2", text: "The Eiffel Tower in Paris stands 330 meters tall.", url: "https://example.com/eiffel" }],
  },
  {
    name: "Polarity negation conflict",
    claim: { id: "f3", text: "The FDA did not approve the COVID-19 vaccine in 2021.", weight: 0.9 },
    evidence: [{ id: "ev3", text: "The FDA approved the COVID-19 vaccine in 2021 after rigorous clinical trials.", url: "https://example.com/fda" }],
  },
  {
    name: "Completely fabricated claim with unrelated evidence",
    claim: { id: "f4", text: "Humans established permanent colonies on Mars in 1980.", weight: 1.2 },
    evidence: [{ id: "ev4", text: "Mars is the fourth planet from the Sun, with an atmosphere composed mainly of carbon dioxide.", url: "https://example.com/mars" }],
  },
  {
    name: "False claim with empty evidence",
    claim: { id: "f5", text: "Unicorns were documented in ancient Roman legions.", weight: 0.8 },
    evidence: [],
  },
  {
    name: "Swapped lowercase noun (cheese vs rock - C-20)",
    claim: { id: "f_noun1", text: "The Moon is made of cheese.", weight: 1.0 },
    evidence: [{ id: "ev_noun1", text: "The Moon is made of rock.", url: "https://example.com/moon" }],
  },
];

test("Known-true claims are correctly verified as supported", () => {
  for (const item of KNOWN_TRUE_FIXTURES) {
    const verdict = verifier.verifyClaim(item.claim, item.evidence);
    assert.strictEqual(
      verdict.status,
      "supported",
      `Known true claim '${item.claim.text}' must be supported`
    );
    assert.ok(verdict.confidence >= 0.5, "Confidence should be at least 0.5");
    assert.strictEqual(verdict.evidenceId, item.evidence[0].id);
    assert.strictEqual(verdict.evidenceUrl, item.evidence[0].url);
  }
});

test("Zero False Accepts: Known-false claims must NEVER be verified as supported", () => {
  for (const item of KNOWN_FALSE_FIXTURES) {
    const verdict = verifier.verifyClaim(item.claim, item.evidence);
    assert.notStrictEqual(
      verdict.status,
      "supported",
      `CRITICAL VIOLATION (${item.name}): Known false claim '${item.claim.text}' was falsely accepted as supported!`
    );
    assert.ok(
      verdict.status === "contradicted" || verdict.status === "unsupported",
      `Status must be contradicted or unsupported, got: ${verdict.status}`
    );
  }
});

test("C-12: Missing entity in source must NOT be marked contradicted", () => {
  const cases = [
    {
      claim: "The Eiffel Tower was designed by Gustave Eiffel.",
      evidence: "The Eiffel Tower was completed in 1889.",
    },
    {
      claim: "Marie Curie was born in Warsaw.",
      evidence: "Marie Curie won the Nobel Prize in Physics in 1903.",
    },
    {
      claim: "Python was created by Guido van Rossum in the Netherlands.",
      evidence: "Python was created by Guido van Rossum.",
    },
    {
      claim: "The Louvre in Paris houses the Mona Lisa.",
      evidence: "The Louvre is the most visited museum in Paris.",
    },
    {
      claim: "Tesla was founded by Martin Eberhard and Marc Tarpenning.",
      evidence: "Tesla was founded in 2003 in San Carlos, California.",
    },
  ];

  for (const c of cases) {
    const verdict = verifier.verifyClaim({ id: "t", text: c.claim, weight: 1.0 }, [{ id: "e", text: c.evidence }]);
    assert.notStrictEqual(
      verdict.status,
      "contradicted",
      `Claim '${c.claim}' was falsely marked contradicted against evidence '${c.evidence}'`
    );
  }
});

test("C-15: Proximity span check and partial name match", () => {
  // Proximity check: scattered words across long sentence must NOT be supported
  const scattered = verifier.verifyClaim(
    { id: "scattered", text: "The Eiffel Tower is located in Berlin.", weight: 1.0 },
    [{
      id: "ev",
      text: "During World War I, the Eiffel Tower's wireless station played a crucial role in intercepting enemy radio communications, including messages sent from transmitters located in Berlin.",
    }]
  );
  assert.notStrictEqual(
    scattered.status,
    "supported",
    "Scattered words across long sentence must not be marked supported"
  );

  // Partial name match: 'Eiffel' for 'Eiffel Tower' must NOT be contradicted
  const partial = verifier.verifyClaim(
    { id: "partial", text: "The Eiffel Tower was completed in 1889.", weight: 1.0 },
    [{
      id: "ev",
      text: "The main structural work was completed at the end of March 1889 and, on 31 March, Eiffel celebrated by leading a group of government officials to the top of the tower.",
    }]
  );
  assert.notStrictEqual(
    partial.status,
    "contradicted",
    "Partial name match must not trigger contradiction"
  );
});

test("C-23: token normalization (possessives, & to and, trailing s) and discourse words", () => {
  // 1. Possessives, &, and trailing s normalization
  const v1 = verifier.verifyClaim(
    { id: "deg1", text: "Bachelor's & Master's in Economics: Loyola College, Chennai", weight: 1.0 },
    [{ id: "ev1", text: "he moved on to obtain his Bachelors and Masters Degrees in Economics from Loyola College, Chennai" }]
  );
  assert.strictEqual(v1.status, "supported", "Should support degree names despite possessives, ampersand, and trailing s");

  // 2. Discourse words in true sentences
  const v2 = verifier.verifyClaim(
    { id: "vit1", text: "Interestingly, he later founded Vellore Engineering College in 1984.", weight: 1.0 },
    [{ id: "ev2", text: "Viswanathan founded Vellore Engineering College in 1984 at Vellore." }]
  );
  assert.strictEqual(v2.status, "supported", "Should support true assertion despite discourse filler words like 'Interestingly', 'later'");
});

test("C-27: numbers with currency mismatch or unrelated context must not be marked contradicted", () => {
  // 1. Currency mismatch (₹ vs no currency or unrelated year)
  const v1 = verifier.verifyClaim(
    { id: "p1", text: "The estimated price for iPhone Duo is ₹2,99,900.", weight: 1.0 },
    [{ id: "ev1", text: "Apple introduced the original Macintosh computer in 1984." }]
  );
  assert.notStrictEqual(v1.status, "contradicted", "Price in currency vs unrelated context must not be contradicted");

  // 2. Loose semantic match without named entity presence
  const v2 = verifier.verifyClaim(
    { id: "p2", text: "The new model will feature 16 gigabytes of unified memory.", entities: ["iPhone Duo"], weight: 1.0 },
    [{ id: "ev2", text: "Some other hardware devices feature 8 gigabytes of storage." }]
  );
  assert.notStrictEqual(v2.status, "contradicted", "Loose numerical difference without claim entity must not be contradicted");
});


