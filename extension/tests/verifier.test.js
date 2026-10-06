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



// Added by Claude while Antigravity was paused (2026-09-21): details must attach to the claim's subject
test("attachment: details must sit next to the claim's subject", () => {
  const claims = require("../engine/claims.js");
  const check = (claimText, passage, topic) => verifier.verifyClaim(claims.extract(claimText)[0], [{ id: "e", text: passage, topic }]).status;

  // Every word is present, but "Berlin" belongs to the transmitters, 15 meaningful words from the tower
  assert.notEqual(
    check("The Eiffel Tower is located in Berlin.", "During World War I, the Eiffel Tower's wireless station played a crucial role in intercepting enemy radio communications, including messages sent from transmitters located in Berlin.", "Eiffel Tower"),
    "supported",
  );
  // Long but tightly attached: filler words ("the", "in", "and") don't count as distance
  assert.equal(check("Marie Curie won the Nobel Prize in Chemistry.", "Marie Curie won the Nobel Prize in Physics in 1903 and in Chemistry in 1911."), "supported");
  // On the subject's own page, a pronoun stands in for the name
  assert.equal(check("Marie Curie won the Nobel Prize in Chemistry in 1911.", "In 1911, she received the Nobel Prize in Chemistry for her discovery of radium.", "Marie Curie"), "supported");
  // ...but not on a page about something else
  assert.notEqual(check("Marie Curie won the Nobel Prize in Chemistry in 1911.", "In 1911, she received the Nobel Prize in Chemistry for her discovery of radium.", "Radium"), "supported");
});

// Real false accepts / false alarms found by tools/accuracy-benchmark.js against live Wikipedia (2026-09-21)
test("benchmark regressions stay fixed", () => {
  const claims = require("../engine/claims.js");
  const check = (claimText, passages) =>
    verifier.verifyClaim(claims.extract(claimText)[0], passages.map((p, i) => (typeof p === "string" ? { id: `e${i}`, text: p } : { id: `e${i}`, ...p })));

  // "born in" is not "living in"
  assert.notEqual(
    check("William Shakespeare was born in London.", [{ text: "William Shakespeare spent a large part of his life living and working in London; his contemporary Ben Jonson was based there.", topic: "London" }]).status,
    "supported",
  );
  // The claim's subject must come before its details: this Lyon tower merely resembles the Eiffel Tower
  assert.notEqual(check("The Eiffel Tower is located in Lyon.", ["The Tour métallique de Fourvière in Lyon resembles the Eiffel Tower."]).status, "supported");
  // A "cannot" in an unrelated quote is not a contradiction
  assert.notEqual(
    check("Isaac Newton was an English mathematician.", [{ text: "Lagrange asserted that Newton was the greatest genius who ever lived, adding that Newton was the most fortunate, for we cannot find more than once a system of the world to establish. The English poet Alexander Pope wrote the famous epitaph.", topic: "Isaac Newton" }]).status,
    "contradicted",
  );
  // "co-authored ... 1995" is not "founded in 1995"; the real founding sentence contradicts it
  const coAuthored = "The Road Ahead, co-authored with Microsoft executive Nathan Myhrvold and journalist Peter Rinearson, was published in November 1995.";
  assert.notEqual(check("Microsoft was founded in 1995.", [coAuthored]).status, "supported");
  assert.equal(check("Microsoft was founded in 1995.", [coAuthored, "Microsoft was founded by Bill Gates and Paul Allen on April 4, 1975."]).status, "contradicted");
  // A different year about a different event doesn't contradict
  assert.notEqual(check("Microsoft was founded in 1975.", ["Microsoft released Windows 1.0 in 1985."]).status, "contradicted");
});

// Wikidata's relation checks (evidence/wikidata.js) state a wrong claim's fact as a sentence like
// these. Each must contradict the false claim it was made for, and must never contradict a true
// claim sitting next to it in the same answer, or support anything false.
test("Wikidata relation sentences contradict only the claim they were written for", () => {
  const claimsModule = require("../engine/claims.js");
  const cases = [
    { ev: ["Toronto is not Canada's capital.", "Canada's capital is Ottawa."], q: "Tell me about Canada.",
      F: ["Toronto is the capital of Canada."], T: ["Ottawa is the capital of Canada.", "Toronto is the largest city in Canada."] },
    { ev: ["Tokyo is not China's capital.", "China's capital is Beijing."], q: "Tell me about Tokyo, Japan and China.",
      F: ["Tokyo is the capital of China."], T: ["Tokyo is the capital of Japan.", "Beijing is the capital of China.", "Tokyo is a large city."] },
    { ev: ["Eiffel Tower is in Paris, France, not in Lyon."], q: "Tell me about the Eiffel Tower.",
      F: ["The Eiffel Tower is located in Lyon.", "The Eiffel Tower is in Lyon."],
      T: ["The Eiffel Tower is located in Paris.", "The Eiffel Tower is located in France.", "The Eiffel Tower is located on the Champ de Mars.", "The Eiffel Tower was completed in 1889."] },
    { ev: ["Mount Everest is in China and Nepal, not in Andes."], q: "Tell me about Mount Everest.",
      F: ["Mount Everest is located in the Andes."], T: ["Mount Everest is located in the Himalayas.", "Mount Everest is located in Nepal."] },
    { ev: ["Amazon River flows through Brazil, Colombia and Peru, not through Egypt."], q: "Tell me about the Amazon River.",
      F: ["The Amazon River flows through Egypt."], T: ["The Amazon River flows through Brazil.", "The Amazon River flows into the Atlantic Ocean."] },
    { ev: ["Nile flows into Mediterranean Sea, not into Pacific Ocean."], q: "Tell me about the Nile.",
      F: ["The Nile flows into the Pacific Ocean."], T: ["The Nile flows into the Mediterranean Sea.", "The Nile flows through Egypt."] },
    { ev: ["Leonardo da Vinci did not paint Starry Night.", "Starry Night was painted by Vincent van Gogh."], q: "Tell me about Leonardo da Vinci.",
      F: ["Leonardo da Vinci painted The Starry Night."], T: ["Leonardo da Vinci painted the Mona Lisa.", "Vincent van Gogh painted The Starry Night.", "Leonardo da Vinci was a painter."] },
  ];
  for (const { ev, q, F, T } of cases) {
    const evidence = ev.map((text, i) => ({ id: `e${i}`, text, source: "Wikidata", kind: "wikidata" }));
    for (const text of F) {
      const verdict = verifier.verifyClaim(claimsModule.extract(text, { question: q })[0], evidence);
      assert.strictEqual(verdict.status, "contradicted", `${text} -> ${verdict.status}: ${verdict.reasoning}`);
    }
    for (const text of T) {
      const verdict = verifier.verifyClaim(claimsModule.extract(text, { question: q })[0], evidence);
      assert.notStrictEqual(verdict.status, "contradicted", `${text} -> contradicted: ${verdict.reasoning}`);
    }
  }
});

test("a denied slot states no value, and a slot conflict needs the claim's subject", () => {
  const claimsModule = require("../engine/claims.js");
  const claim = claimsModule.extract("Tokyo is the capital of Japan.", { question: "Tell me about Tokyo and Japan." })[0];
  assert.notStrictEqual(verifier.verifyClaim(claim, [{ id: "a", text: "Tokyo is not the capital of China." }]).status, "contradicted");
  assert.notStrictEqual(verifier.verifyClaim(claim, [{ id: "b", text: "The capital of China is Beijing." }]).status, "contradicted");
  // A pronoun subject still conflicts: "It" could be the subject of the passage
  const pronoun = claimsModule.extract("It is located in Berlin.", {})[0];
  assert.strictEqual(verifier.verifyClaim(pronoun, [{ id: "c", text: "The Eiffel Tower is located in Paris, France." }]).status, "contradicted");
});

// Real false accepts found by the never-seen benchmark sets (2026-10-06): locked in
test("capital claims need the passage to say it's that place's capital today", () => {
  const claimsModule = require("../engine/claims.js");
  const judge = (text, question, passage, topic) =>
    verifier.verifyClaim(claimsModule.extract(text, { question })[0], [{ id: "p", text: passage, topic }]).status;
  // "capital ... of the state of Rio de Janeiro ... in Brazil" isn't "capital of Brazil"
  assert.notStrictEqual(judge("Rio de Janeiro is the capital of Brazil.", "Tell me about Brazil.",
    "Rio de Janeiro, also known simply as Rio, is the capital and largest city of the state of Rio de Janeiro. It is the second-largest city in Brazil after São Paulo.", "Rio de Janeiro"), "supported");
  // A former capital isn't the capital now
  assert.notStrictEqual(judge("Rio de Janeiro is the capital of Brazil.", "Tell me about Brazil.",
    "Rio de Janeiro served as the capital of republican Brazil until 1960, when the capital was moved to Brasília.", "Rio de Janeiro"), "supported");
  // "Its capital is Ottawa ... Toronto" names another city as the capital
  assert.notStrictEqual(judge("Toronto is the capital of Canada.", "Tell me about Canada.",
    "Its capital is Ottawa and its three largest metropolitan areas are Toronto, Montreal, and Vancouver.", "Canada"), "supported");
  // True capitals are still confirmed
  assert.strictEqual(judge("Ottawa is the capital of Canada.", "Tell me about Canada.",
    "Its capital is Ottawa and its three largest metropolitan areas are Toronto, Montreal, and Vancouver.", "Canada"), "supported");
  assert.strictEqual(judge("Tokyo is the capital of Japan.", "Tell me about Tokyo.",
    "Tokyo, officially the Tokyo Metropolis, is the capital and most populous city of Japan.", "Tokyo"), "supported");
});

test("a name inside a longer name is something else (New York in The New York Times)", () => {
  const claimsModule = require("../engine/claims.js");
  const claim = claimsModule.extract("Harvard University is located in New York.", { question: "Tell me about Harvard University." })[0];
  const verdict = verifier.verifyClaim(claim, [{ id: "p", topic: "Harvard University",
    text: "In a post on Truth Social, Trump accused Harvard of supplying misleading information to The New York Times." }]);
  assert.notStrictEqual(verdict.status, "supported", verdict.reasoning);
});

// Found by the realistic-answer set (HOLDOUT4): answers say "It/She" and mix editions
test("pronoun-led claims are checked as being about the answer's subject, and unresolved ones can't be confirmed", () => {
  const claimsModule = require("../engine/claims.js");
  const [danube] = claimsModule.extract("It empties into the Adriatic Sea.", { question: "Tell me about the Danube River." });
  assert.ok(/^Danube River empties/.test(danube.text), danube.text);
  const [ada] = claimsModule.extract("She published those notes in 1853.", { question: "Summarize Ada Lovelace's work." });
  assert.ok(/^Ada Lovelace published/.test(ada.text), ada.text);
  // "They" often means people, so it's left alone, and a claim that names nothing is never confirmed
  const [wall] = claimsModule.extract("They officially opened it in 1991.", { question: "How did the Berlin Wall come down?" });
  assert.ok(/^They /.test(wall.text));
  const verdict = verifier.verifyClaim(wall, [{ id: "p", text: "The border crossings were officially opened in 1991 after reunification." }]);
  assert.notStrictEqual(verdict.status, "supported", verdict.reasoning);
});

test("a 'first published/released' year must be the year that follows 'first' in the source", () => {
  const claimsModule = require("../engine/claims.js");
  const edition = [{ id: "p", topic: "Frankenstein", text: "The novel was first published anonymously in 1818, and in 1831, a revised edition was published under Mary Shelley's name." }];
  const judge = (text, question, evidence) => verifier.verifyClaim(claimsModule.extract(text, { question })[0], evidence).status;
  assert.strictEqual(judge("It was first published in 1831.", "Give me an overview of Frankenstein.", edition), "contradicted");
  assert.strictEqual(judge("The novel was first published anonymously in 1818.", "Give me an overview of Frankenstein.", edition), "supported");
  const python = [{ id: "q", topic: "Python (programming language)", text: "Python 0.9.0 was first released in 1991. Python 2.0 was released in 2000." }];
  assert.strictEqual(judge("Python was first released in 1991.", "Tell me about Python.", python), "supported");
  assert.strictEqual(judge("Python was first released in 2000.", "Tell me about Python.", python), "contradicted");
});

// Found by the fresh realistic set (HOLDOUT5)
test("a country or region never conflicts with a place that may lie inside it", () => {
  const claimsModule = require("../engine/claims.js");
  const judge = (text, question, passage, topic) =>
    verifier.verifyClaim(claimsModule.extract(text, { question }).pop(), [{ id: "p", text: passage, topic }]).status;
  assert.notStrictEqual(judge("He was born in Scotland.", "What did Alexander Fleming discover?", "Alexander Fleming was born in Lochfield.", "Alexander Fleming"), "contradicted");
  assert.notStrictEqual(judge("Albert Einstein was born in Germany.", "Tell me about Albert Einstein.", "Albert Einstein was born in Ulm, in the Kingdom of Württemberg in the German Empire.", "Albert Einstein"), "contradicted");
  // Two cities still conflict
  assert.strictEqual(judge("Albert Einstein was born in Vienna.", "Tell me about Albert Einstein.", "Albert Einstein was born in Ulm.", "Albert Einstein"), "contradicted");
});

test("a name built on a common noun needs its distinctive words (Sydney Opera House isn't Wright House)", () => {
  const claimsModule = require("../engine/claims.js");
  const claim = claimsModule.extract("It was designed by Frank Lloyd Wright.", { question: "Tell me about the Sydney Opera House." }).pop();
  const verdict = verifier.verifyClaim(claim, [{ id: "p", topic: "Frank Lloyd Wright",
    text: "David Samuel Wright (1895–1997), a building-products representative for whom Wright designed the David & Gladys Wright House, which was rescued from demolition." }]);
  assert.notStrictEqual(verdict.status, "supported", verdict.reasoning);
});

test("a 'not' only contradicts a passage about the same subject", () => {
  const claim = { id: "c1", text: "The notes don't give a launch date.", entities: [], weight: 0.2 };
  const passage = [{ id: "e1", kind: "wikipedia", text: "Giving these away free will give users a date to remember and work like a gateway." }];
  assert.notStrictEqual(verifier.verifyClaim(claim, passage).status, "contradicted");
  const named = { id: "c2", text: "The Eiffel Tower is not in Paris.", entities: ["Eiffel Tower", "Paris"], weight: 1 };
  assert.strictEqual(verifier.verifyClaim(named, [{ id: "e2", kind: "wikipedia", text: "The Eiffel Tower is in Paris, France." }]).status, "contradicted");
});

test("a leading 'No.' answers the question; it doesn't negate the statement", () => {
  const claim = { id: "c1", text: "No. Canberra is the capital of Australia.", entities: ["Canberra", "Australia"], weight: 1 };
  const passage = [{ id: "e1", kind: "wikipedia", text: "Canberra is the capital city of Australia and the largest population centre in the Australian Capital Territory." }];
  assert.notStrictEqual(verifier.verifyClaim(claim, passage).status, "contradicted");
});
