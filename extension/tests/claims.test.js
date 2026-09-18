/**
 * Unit Tests for Claim Extractor and Information Weighting.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const claims = require("../engine/claims.js");

test("splitSentences separates multiple sentences", () => {
  const text = "First sentence. Second sentence! Third sentence?";
  const s = claims.splitSentences(text);
  assert.strictEqual(s.length, 3);
  assert.strictEqual(s[0], "First sentence.");
  assert.strictEqual(s[1], "Second sentence!");
});

test("extract identifies numbers and temporal types", () => {
  const text = "The spacecraft landed in 1969 with 3 astronauts on board.";
  const extracted = claims.extract(text);
  assert.ok(extracted.length >= 1);
  const temporal = extracted.find((c) => c.type === "temporal");
  assert.ok(temporal, "Should find temporal claim with 1969");
  assert.ok(temporal.weight > 0.5, "Temporal claim with year and numbers should have high weight");
});

test("extract assigns weight 0 to restatements of user question", () => {
  const question = "When did Apollo 11 launch?";
  const answer = "When did Apollo 11 launch? It launched on July 16, 1969.";
  const extracted = claims.extract(answer, { question });

  const questionEcho = extracted.find((c) => c.text.includes("Apollo 11 launch?"));
  if (questionEcho) {
    assert.strictEqual(questionEcho.weight, 0.0, "Restatement of question must have weight 0");
  }

  const answerClaim = extracted.find((c) => c.text.includes("1969"));
  assert.ok(answerClaim, "Should extract the informative claim");
  assert.ok(answerClaim.weight > 0.5, "Informative claim must have positive weight");
});

test("extract assigns weight 0 to duplicate claims", () => {
  const text = "Water boils at 100 degrees Celsius. Water boils at 100 degrees Celsius.";
  const extracted = claims.extract(text);
  assert.strictEqual(extracted.length, 2);
  assert.ok(extracted[0].weight > 0, "First instance has positive weight");
  assert.strictEqual(extracted[1].weight, 0.0, "Duplicate instance must have weight 0");
});

test("C-21: list formatting, questions skipped, no month/label entities", () => {
  const text = `The Eiffel Tower was built in Paris, France, between 1887 and 1889.
🏗️ Construction started: 26 January 1887
🏁 Construction completed: 31 March 1889
🎉 Opened to the public: 15 May 1889
🌍 Purpose: Built as the centerpiece of the 1889 Exposition Universelle (World's Fair), celebrating the 100th anniversary of the French Revolution.
Who created it?
It's commonly credited to Gustave Eiffel, whose company built the tower. However, the actual design involved several people:
Maurice Koechlin — engineer who helped develop the original structural concept
Émile Nouguier — engineer who co-developed the concept
Stephen Sauvestre — architect who refined the architectural appearance, including the distinctive arches
Gustave Eiffel — engineer, entrepreneur, and head of the company that developed, financed, and constructed the project.`;

  const sentences = claims.splitSentences(text);
  assert.strictEqual(sentences.length, 12, "Should split list lines into distinct sentences");

  const extracted = claims.extract(text);
  assert.ok(extracted.length >= 10 && extracted.length <= 12, `Extracted count was ${extracted.length}`);
  const questionClaim = extracted.find((c) => c.text.includes("Who created it"));
  assert.strictEqual(questionClaim, undefined, "Questions like 'Who created it?' must not be extracted as claims");

  // Verify no month/label entities
  const allEntities = extracted.flatMap((c) => c.entities);
  const forbidden = ["Construction", "January", "March", "Opened", "Purpose", "Built", "Who", "May"];
  for (const f of forbidden) {
    assert.ok(!allEntities.includes(f), `Entity list should not contain generic word/month/label '${f}'`);
  }

  // Proper names should be recognized
  assert.ok(allEntities.includes("Paris") || allEntities.includes("France"));
  assert.ok(allEntities.includes("Gustave Eiffel"));
  assert.ok(allEntities.includes("Maurice Koechlin"));
});

test("C-23: splitSentences does not break on abbreviations or initials", () => {
  const text = "If you mean Dr. G. Viswanathan, the founder of VIT. He was born in 1938.";
  const s = claims.splitSentences(text);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0], "If you mean Dr. G. Viswanathan, the founder of VIT.");
  assert.strictEqual(s[1], "He was born in 1938.");
});

test("C-30: extractPropositions propagates antecedent subject to relative clause", () => {
  const text = "Interestingly, he later founded Vellore Engineering College in 1984, which eventually became VIT.";
  const c = claims.extract(text);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].text, "Interestingly, he later founded Vellore Engineering College in 1984");
  assert.strictEqual(c[1].text, "Vellore Engineering College eventually became VIT");
});


