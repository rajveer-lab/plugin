"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const wikidata = require("../evidence/wikidata.js");

const item = (id) => ({ mainsnak: { datavalue: { type: "wikibase-entityid", value: { id } } }, rank: "normal" });
const time = (value, precision = 11) => ({ mainsnak: { datavalue: { type: "time", value: { time: value, precision } } }, rank: "normal" });
const withYear = (statement, year) => ({ ...statement, qualifiers: { P585: [{ datavalue: { value: { time: `+${year}-01-01T00:00:00Z`, precision: 9 } } }] } });

// A fake Wikidata in the real response shapes (checked against the live API)
function fakeWikidata() {
  const calls = [];
  const labels = { Q1: "Porbandar", Q2: "New Delhi", Q3: "Bill Gates", Q4: "Paul Allen", Q5: "Nobel Prize in Physics", Q6: "Nobel Prize in Chemistry", Q7: "Old place" };
  const entities = {
    Q1001: {
      labels: { en: { value: "Mahatma Gandhi" } },
      claims: {
        P19: [item("Q1")],
        P569: [time("+1869-10-02T00:00:00Z")],
        P20: [{ ...item("Q7"), rank: "deprecated" }, { ...item("Q2"), rank: "preferred" }],
        P570: [time("+1948-01-30T00:00:00Z")],
      },
    },
    Q2283: { labels: { en: { value: "Microsoft" } }, claims: { P571: [time("+1975-04-04T00:00:00Z")], P112: [item("Q3"), item("Q4")] } },
    Q7186: { labels: { en: { value: "Marie Curie" } }, claims: { P166: [withYear(item("Q5"), 1903), withYear(item("Q6"), 1911)] } },
  };
  const search = { "Mahatma Gandhi": [{ id: "Q9", description: "Wikimedia disambiguation page" }, { id: "Q1001", description: "Indian activist" }], Microsoft: [{ id: "Q2283" }], "Marie Curie": [{ id: "Q7186" }] };

  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const params = new URL(url).searchParams;
    let body;
    if (params.get("action") === "wbsearchentities") body = { search: search[params.get("search")] || [] };
    else {
      const out = {};
      for (const id of params.get("ids").split("|")) {
        if (params.get("props") === "labels") out[id] = { labels: labels[id] ? { en: { value: labels[id] } } : {} };
        else if (entities[id]) out[id] = entities[id];
      }
      body = { entities: out };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

test("facts become plain sentences the verifier can judge", async () => {
  wikidata.clearCache();
  const { fetchImpl, calls } = fakeWikidata();
  const evidence = await wikidata.lookup(
    [
      { text: "Mahatma Gandhi was born in Delhi", entities: ["Mahatma Gandhi"], weight: 1 },
      { text: "Microsoft was founded in 1995", entities: [], weight: 1 },
    ],
    { fetch: fetchImpl },
  );

  assert.deepEqual(evidence.map((e) => e.id), ["wikidata:Q1001", "wikidata:Q2283"]);
  assert.equal(evidence[0].text, [
    "Mahatma Gandhi was born in Porbandar.",
    "Mahatma Gandhi was born on 2 October 1869.",
    "Mahatma Gandhi died in New Delhi.",
    "Mahatma Gandhi died on 30 January 1948.",
  ].join("\n"), "disambiguation pages skipped, preferred statements used, deprecated ignored");
  assert.equal(evidence[1].text, "Microsoft was founded in 1975.\nMicrosoft was founded by Bill Gates and Paul Allen.");
  assert.deepEqual(
    { source: evidence[0].source, url: evidence[0].url, kind: evidence[0].kind, topic: evidence[0].topic },
    { source: "Wikidata: Mahatma Gandhi", url: "https://www.wikidata.org/wiki/Q1001", kind: "wikidata", topic: "Mahatma Gandhi" },
  );
  assert.ok(calls.every((c) => c.init.credentials === "omit" && c.url.startsWith("https://www.wikidata.org/w/api.php?")));
});

test("awards carry their year", async () => {
  wikidata.clearCache();
  const { fetchImpl } = fakeWikidata();
  const [curie] = await wikidata.lookup([{ text: "Marie Curie won a prize", entities: ["Marie Curie"], weight: 1 }], { fetch: fetchImpl });
  assert.equal(curie.text, "Marie Curie received the Nobel Prize in Physics in 1903.\nMarie Curie received the Nobel Prize in Chemistry in 1911.");
});

test("names come from claims, or a capitalized first word", () => {
  assert.deepEqual(
    wikidata.namesFor([
      { text: "It was big", entities: [], weight: 1 },
      { text: "The telephone was invented by Thomas Edison", entities: ["Thomas Edison", "Thomas"], weight: 2 },
      { text: "Microsoft was founded in 1975", entities: [], weight: 1.5 },
      { text: "You asked about Paris", entities: ["Paris"], weight: 0 },
    ]),
    ["Thomas Edison", "Microsoft"],
  );
});

test("dates respect their precision", () => {
  assert.equal(wikidata.formatTime({ time: "+1869-10-02T00:00:00Z", precision: 11 }), "2 October 1869");
  assert.equal(wikidata.formatTime({ time: "+1869-10-00T00:00:00Z", precision: 10 }), "October 1869");
  assert.equal(wikidata.formatTime({ time: "+1869-00-00T00:00:00Z", precision: 9 }), "1869");
  assert.equal(wikidata.formatTime({ time: "-0500-00-00T00:00:00Z", precision: 9 }), null, "BCE dates are skipped");
});

test("with the real verifier: Wikidata catches a wrong birthplace and keeps multiple prizes compatible", () => {
  const claims = require("../engine/claims.js");
  const verifier = require("../engine/verifier.js");
  const check = (claimText, lines, topic) =>
    verifier.verifyClaim(claims.extract(claimText)[0], lines.map((text, i) => ({ id: `w${i}`, text, topic, kind: "wikidata" }))).status;

  const gandhi = ["Mahatma Gandhi was born in Porbandar.", "Mahatma Gandhi was born on 2 October 1869."];
  assert.equal(check("Mahatma Gandhi was born in Delhi.", gandhi, "Mahatma Gandhi"), "contradicted");
  assert.equal(check("Mahatma Gandhi was born in Porbandar.", gandhi, "Mahatma Gandhi"), "supported");
  assert.equal(check("Mahatma Gandhi was born in 1869.", gandhi, "Mahatma Gandhi"), "supported");

  const curie = ["Marie Curie received the Nobel Prize in Physics in 1903.", "Marie Curie received the Nobel Prize in Chemistry in 1911."];
  assert.equal(check("Marie Curie won the Nobel Prize in Chemistry.", curie, "Marie Curie"), "supported", "a second prize isn't a conflict");
  assert.equal(check("Marie Curie won the Nobel Prize in Literature.", curie, "Marie Curie"), "contradicted");
});

test("every search failing is reported; rate limits get a clear error", async () => {
  wikidata.clearCache();
  const limited = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(wikidata.lookup([{ text: "Rome is old", entities: ["Rome"], weight: 1 }], { fetch: limited }), /rate-limiting/);
  assert.deepEqual(await wikidata.lookup([], { fetch: limited }), []);
});

// ---- relation checks ----

const claimsModule = require("../engine/claims.js");
const firstClaim = (text, question) => claimsModule.extract(text, { question })[0];

test("relations are read only from present-tense claims between two names", () => {
  const parse = (text, question) => {
    const relation = wikidata.parseRelation(firstClaim(text, question));
    return relation && [relation.kind, relation.subject, relation.object, relation.verb];
  };
  assert.deepEqual(parse("The Eiffel Tower is located in Lyon.", "Tell me about the Eiffel Tower."), ["location", "Eiffel Tower", "Lyon", null]);
  assert.deepEqual(parse("Tokyo is the capital of China.", "Tell me about Tokyo."), ["capital", "Tokyo", "China", null]);
  assert.deepEqual(parse("The Nile flows into the Pacific Ocean.", "Tell me about the Nile."), ["mouth", "Nile", "Pacific Ocean", null]);
  assert.deepEqual(parse("Leonardo da Vinci painted The Starry Night.", "Tell me about Leonardo da Vinci."), ["creator", "Leonardo da Vinci", "Starry Night", "painted"]);
  assert.deepEqual(parse("The Eiffel Tower is in Paris, France.", "Tell me about the Eiffel Tower."), ["location", "Eiffel Tower", "Paris", null]);
  // The past was sometimes different ("Strasbourg was in Germany"), and "in widespread use" isn't a place
  assert.equal(parse("Strasbourg was located in Germany.", "Tell me about Strasbourg."), null);
  assert.equal(parse("Python is in widespread use.", "Tell me about Python."), null);
});

test("a place conflict needs a different continent, a different country, or a small place far away", () => {
  const place = (extra = {}) => ({ coord: [], area: [], length: [], sovereign: false, ...extra });
  const set = (...ids) => new Map(ids.map((id) => [id, id]));
  const eiffel = place({ coord: ["Point(2.2945 48.8583)"], inside: set("Q90"), country: set("Q142"), continent: set("Q46") });
  const lyon = place({ coord: ["Point(4.835 45.7675)"], area: ["47870000"], country: set("Q142"), continent: set("Q46") });
  const paris = place({ coord: ["Point(2.35 48.86)"], area: ["105400000"], country: set("Q142"), continent: set("Q46") });
  const versailles = place({ coord: ["Point(2.1301 48.8049)"], area: ["26180000"], country: set("Q142"), continent: set("Q46") });
  assert.equal(wikidata.placeConflict("location", eiffel, "Q243", lyon, "Q456"), "distance");
  assert.equal(wikidata.placeConflict("location", eiffel, "Q243", paris, "Q90"), null, "inside its chain");
  assert.equal(wikidata.placeConflict("location", eiffel, "Q243", versailles, "Q621"), null, "13 km away is too close to rule out");

  const everest = place({ coord: ["Point(86.925 27.988)"], country: set("Q148", "Q837"), continent: set("Q48") });
  const andes = place({ coord: ["Point(-66.7 -21.8)"], continent: set("Q18") });
  assert.equal(wikidata.placeConflict("location", everest, "Q513", andes, "Q5456"), "continent");
  const mexico = place({ sovereign: true, coord: ["Point(-102 23)"], continent: set("Q49") });
  const pyramid = place({ coord: ["Point(31.13 29.98)"], country: set("Q79") });
  assert.equal(wikidata.placeConflict("location", pyramid, "Q37200", mexico, "Q96"), "country");

  // Rivers and big areas are never "far from" a small place: the distance rule needs a point-like subject
  const amazon = place({ coord: ["Point(-50 0.7)"], length: ["6400000"], country: set("Q155") });
  assert.equal(wikidata.placeConflict("location", amazon, "Q3783", lyon, "Q456"), null);
});

function fakeRelationWikidata({ search, names, sparql }) {
  return async (url) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    let body;
    if (parsed.hostname === "query.wikidata.org") {
      const values = /VALUES \?e \{([^}]*)\}/.exec(params.get("query"))[1];
      const rows = [];
      for (const id of values.match(/Q\d+/g)) {
        for (const [how, x, label] of sparql[id] || []) {
          rows.push({ e: { value: `http://www.wikidata.org/entity/${id}` }, how: { value: how }, ...(x ? { x: { value: `http://www.wikidata.org/entity/${x}` }, xLabel: { value: label || x } } : {}) });
        }
      }
      body = { results: { bindings: rows } };
    } else if (params.get("action") === "wbsearchentities") {
      body = { search: (search[params.get("search")] || []).map(([id, description]) => ({ id, description })) };
    } else {
      body = { entities: Object.fromEntries(params.get("ids").split("|").map((id) => [id, { labels: { en: { value: names[id] } } }])) };
    }
    return { ok: true, status: 200, json: async () => body };
  };
}

test("a river's real mouth rules out a different sea, even when the name also means a band", async () => {
  wikidata.clearCache();
  const fetchImpl = fakeRelationWikidata({
    search: { Nile: [["Q660835", "American death metal band"], ["Q3392", "major river in northeastern Africa"]], "Pacific Ocean": [["Q98", "ocean between Asia and the Americas"]] },
    names: { Q660835: "Nile", Q3392: "Nile", Q98: "Pacific Ocean" },
    sparql: { Q3392: [["mouth1", "Q4918", "Mediterranean Sea"], ["mouth", "Q4918", "Mediterranean Sea"]] },
  });
  const claims = [firstClaim("The Nile flows into the Pacific Ocean.", "Tell me about the Nile.")];
  const evidence = await wikidata.relationEvidence(claims, { fetch: fetchImpl });
  assert.deepEqual(evidence.map((e) => e.text), ["Nile flows into Mediterranean Sea, not into Pacific Ocean."]);

  // The true mouth gives no sentence: support comes from Wikipedia, never from these checks
  wikidata.clearCache();
  const right = [firstClaim("The Nile flows into the Mediterranean Sea.", "Tell me about the Nile.")];
  const fetchRight = fakeRelationWikidata({
    search: { Nile: [["Q3392", "major river"]], "Mediterranean Sea": [["Q4918", "sea connected to the Atlantic Ocean"]] },
    names: { Q3392: "Nile", Q4918: "Mediterranean Sea" },
    sparql: { Q3392: [["mouth1", "Q4918", "Mediterranean Sea"], ["mouth", "Q4918", "Mediterranean Sea"]] },
  });
  assert.deepEqual(await wikidata.relationEvidence(right, { fetch: fetchRight }), []);
});

test("a capital claim is only contradicted when every place the name can mean has another capital", async () => {
  const claims = [firstClaim("Tokyo is the capital of China.", "Tell me about Tokyo.")];
  const base = {
    search: { Tokyo: [["Q1490", "capital of Japan"]], China: [["Q148", "country in East Asia"], ["Q130693", "ceramic material"]] },
    names: { Q1490: "Tokyo", Q148: "China", Q130693: "china" },
  };
  wikidata.clearCache();
  const wrong = await wikidata.relationEvidence(claims, { fetch: fakeRelationWikidata({ ...base, sparql: { Q148: [["capital", "Q956", "Beijing"]], Q1490: [["capital-of", "Q17", "Japan"]] } }) });
  assert.deepEqual(wrong.map((e) => e.text), ["Tokyo is not China's capital. China's capital is Beijing."]);

  // A former capital isn't the capital now ("Toronto is the capital of Canada" is false today)...
  wikidata.clearCache();
  const former = await wikidata.relationEvidence(claims, { fetch: fakeRelationWikidata({ ...base, sparql: { Q148: [["capital", "Q956", "Beijing"], ["former-capital", "Q1490", "Tokyo"]] } }) });
  assert.deepEqual(former.map((e) => e.text), ["Tokyo is not China's capital. China's capital is Beijing."]);

  // ...but a current one, or the subject being a capital of the place today, is never contradicted
  wikidata.clearCache();
  const current = await wikidata.relationEvidence(claims, { fetch: fakeRelationWikidata({ ...base, sparql: { Q148: [["capital", "Q956", "Beijing"], ["capital", "Q1490", "Tokyo"]] } }) });
  assert.deepEqual(current, []);
  wikidata.clearCache();
  const capitalOf = await wikidata.relationEvidence(claims, { fetch: fakeRelationWikidata({ ...base, sparql: { Q148: [["capital", "Q956", "Beijing"]], Q1490: [["capital-of", "Q148", "China"]] } }) });
  assert.deepEqual(capitalOf, []);
});

test("relation checks stay silent when Wikidata can't be reached", async () => {
  wikidata.clearCache();
  const errors = [];
  const claims = [firstClaim("Tokyo is the capital of China.", "Tell me about Tokyo.")];
  const evidence = await wikidata.relationEvidence(claims, { fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }), onError: (e) => errors.push(e) });
  assert.deepEqual(evidence, []);
  assert.equal(errors.length, 1);
});

test("end to end: a relation sentence catches the false claim and confirms nothing false", async () => {
  const pipeline = require("../background/service-worker.js");
  require("../engine/verifier.js");
  const answer = "Tokyo is the capital of Japan. Tokyo is the capital of China.";
  const claims = claimsModule.extract(answer, { question: "Tell me about Tokyo." });
  wikidata.clearCache();
  const fetchImpl = fakeRelationWikidata({
    search: { Tokyo: [["Q1490", "capital of Japan"]], China: [["Q148", "country in East Asia"]], Japan: [["Q17", "country in East Asia"]] },
    names: { Q1490: "Tokyo", Q148: "People's Republic of China", Q17: "Japan" },
    sparql: { Q148: [["capital", "Q956", "Beijing"]], Q17: [["capital", "Q1490", "Tokyo"]], Q1490: [["capital-of", "Q17", "Japan"]] },
  });
  // Same path as the service worker: evidence is split into sentence passages before judging
  const evidence = pipeline.toPassages(await wikidata.relationEvidence(claims, { fetch: fetchImpl }));
  const [japan, china] = claims.map((claim) => globalThis.AH.verifier.verifyClaim(claim, evidence));
  assert.equal(china.status, "contradicted", china.reasoning);
  assert.notEqual(japan.status, "contradicted", japan.reasoning);
});

test("a place claim is confirmed only when every named place is in the subject's current chain", async () => {
  const sparql = {
    Q9141: [["coord", null], ["inside", "Q42941", "Agra"], ["inside", "Q1498", "Uttar Pradesh"], ["country-now", "Q668", "India"], ["country", "Q668", "India"], ["country", "Q33296", "Mughal Empire"], ["continent", "Q48", "Asia"]],
    Q42941: [["coord", null]], Q668: [["sovereign", null], ["coord", null]], Q33296: [["coord", null]], Q843: [["sovereign", null], ["coord", null]],
  };
  // coord rows need a value; the fake gives them none, so add a WKT point
  for (const rows of Object.values(sparql)) rows.forEach((row) => row[0] === "coord" && (row[1] = undefined));
  const fetchFor = (search, names) => {
    const base = fakeRelationWikidata({ search, names, sparql });
    return async (url) => {
      const response = await base(url);
      if (!url.includes("query.wikidata.org")) return response;
      const body = await response.json();
      for (const row of body.results.bindings) if (row.how.value === "coord") row.v = { value: "Point(78.04 27.17)" };
      return { ok: true, status: 200, json: async () => body };
    };
  };
  const names = { Q9141: "Taj Mahal", Q42941: "Agra", Q668: "India", Q33296: "Mughal Empire", Q843: "Pakistan" };
  const search = { "Taj Mahal": [["Q9141", "mausoleum in Agra"]], Agra: [["Q42941", "city in India"]], India: [["Q668", "country in South Asia"]], "Mughal Empire": [["Q33296", "former empire"]], Pakistan: [["Q843", "country in South Asia"]] };

  wikidata.clearCache();
  const right = await wikidata.relationEvidence([firstClaim("The Taj Mahal is in Agra, India.", "Tell me about the Taj Mahal.")], { fetch: fetchFor(search, names) });
  assert.deepEqual(right.map((e) => e.text), ["Taj Mahal is in Agra, India."]);

  // A historical country isn't where it is now, and a wrong second place spoils the whole claim
  wikidata.clearCache();
  const historical = await wikidata.relationEvidence([firstClaim("The Taj Mahal is located in the Mughal Empire.", "Tell me about the Taj Mahal.")], { fetch: fetchFor(search, names) });
  assert.ok(!historical.some((e) => /is in/.test(e.text) && !/not in/.test(e.text)));
  wikidata.clearCache();
  const wrongCountry = await wikidata.relationEvidence([firstClaim("The Taj Mahal is in Agra, Pakistan.", "Tell me about the Taj Mahal.")], { fetch: fetchFor(search, names) });
  assert.deepEqual(wrongCountry, []);
});
