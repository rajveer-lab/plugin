/**
 * Wikidata evidence (free, no API key).
 *
 * Looks up the people, places and organizations a claim names and turns their exact facts
 * into plain sentences ("Mahatma Gandhi was born in Porbandar."), so the verifier judges them
 * with the same rules as Wikipedia prose. Covered: place and date of birth and death,
 * founding year, founders, and awards.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const API = "https://www.wikidata.org/w/api.php";
  const HEADERS = { "Api-User-Agent": "HallucinationGuard/0.1 (Chrome extension; fact checking)" };
  const MAX_NAMES = 3;
  const MAX_AWARDS = 30;
  const TIMEOUT_MS = 8000;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const COMMON_STARTERS = new Set(["The", "This", "That", "These", "Those", "It", "Its", "They", "He", "She", "We", "You", "In", "On", "At", "A", "An"]);

  // Same etiquette as wikipedia.js: cache responses, few requests at a time
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const cache = new Map();
  let active = 0;
  const waiting = [];

  async function withSlot(task) {
    if (active >= 3) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      if (waiting.length) waiting.shift()();
    }
  }

  async function getJson(fetchImpl, params, timeoutMs) {
    const url = `${API}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body;

    const body = await withSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: HEADERS, credentials: "omit", signal: controller.signal });
        if (response.status === 429) throw new Error("Wikidata is rate-limiting requests right now (HTTP 429). Try again in a minute.");
        if (!response.ok) throw new Error(`Wikidata returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    });
    cache.set(url, { at: Date.now(), body });
    return body;
  }

  /** Names to look up: each claim's longest name, or its capitalized first word ("Microsoft was..."). */
  function namesFor(claims) {
    const names = [];
    const add = (name) => {
      const clean = String(name || "").replace(/^(the|a|an)\s+/i, "").trim();
      if (clean.length > 1 && !names.some((n) => n.toLowerCase() === clean.toLowerCase())) names.push(clean);
    };
    const ranked = [...(Array.isArray(claims) ? claims : [])].filter((c) => c.weight !== 0).sort((a, b) => (b.weight || 0) - (a.weight || 0));
    for (const claim of ranked) {
      const entities = [...(claim.entities || [])].sort((a, b) => b.length - a.length);
      if (entities.length) add(entities[0]);
      else {
        const first = String(claim.text || "").match(/^([A-Z][\p{L}'-]+)/u);
        if (first && !COMMON_STARTERS.has(first[1])) add(first[1]);
      }
      if (names.length >= MAX_NAMES) break;
    }
    return names;
  }

  /** Best statements for a property: preferred ones if any, never deprecated ones. */
  function statements(entity, property) {
    const all = ((entity.claims || {})[property] || []).filter((s) => s.rank !== "deprecated" && s.mainsnak && s.mainsnak.datavalue);
    const preferred = all.filter((s) => s.rank === "preferred");
    return preferred.length ? preferred : all;
  }

  /** "+1869-10-02T00:00:00Z" -> "2 October 1869", respecting the stated precision. */
  function formatTime(value) {
    const match = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec((value && value.time) || "");
    if (!match || match[1] === "-") return null;
    const year = String(Number(match[2]));
    const month = Number(match[3]);
    const day = Number(match[4]);
    if (value.precision >= 11 && month && day) return `${day} ${MONTHS[month - 1]} ${year}`;
    if (value.precision === 10 && month) return `${MONTHS[month - 1]} ${year}`;
    return value.precision >= 9 ? year : null;
  }

  function itemId(statement) {
    const value = statement.mainsnak.datavalue.value;
    return value && value.id;
  }

  function qualifierYear(statement, property) {
    const qualifier = ((statement.qualifiers || {})[property] || [])[0];
    const time = qualifier && qualifier.datavalue && formatTime(qualifier.datavalue.value);
    // Years can be short ("AD 80" -> "80"), so take whatever digits end the date
    const year = time && time.match(/\d{1,4}$/);
    return year ? year[0] : null;
  }

  function sentencesFor(label, entity, labels) {
    const name = (id) => labels.get(id);
    const lines = [];
    const first = (property) => statements(entity, property)[0];

    const birthPlace = first("P19");
    if (birthPlace && name(itemId(birthPlace))) lines.push(`${label} was born in ${name(itemId(birthPlace))}.`);
    const birthDate = first("P569");
    if (birthDate && formatTime(birthDate.mainsnak.datavalue.value)) lines.push(`${label} was born on ${formatTime(birthDate.mainsnak.datavalue.value)}.`);

    const deathPlace = first("P20");
    if (deathPlace && name(itemId(deathPlace))) lines.push(`${label} died in ${name(itemId(deathPlace))}.`);
    const deathDate = first("P570");
    if (deathDate && formatTime(deathDate.mainsnak.datavalue.value)) lines.push(`${label} died on ${formatTime(deathDate.mainsnak.datavalue.value)}.`);

    const inception = first("P571");
    const founded = inception && formatTime(inception.mainsnak.datavalue.value);
    const foundedYear = founded && founded.match(/\d{1,4}$/);
    if (foundedYear) lines.push(`${label} was founded in ${foundedYear[0]}.`);

    const founders = statements(entity, "P112").map((s) => name(itemId(s))).filter(Boolean);
    if (founders.length) {
      const list = founders.length > 1 ? `${founders.slice(0, -1).join(", ")} and ${founders[founders.length - 1]}` : founders[0];
      lines.push(`${label} was founded by ${list}.`);
    }

    for (const award of statements(entity, "P166").slice(0, MAX_AWARDS)) {
      const awardName = name(itemId(award));
      if (!awardName) continue;
      const year = qualifierYear(award, "P585");
      lines.push(`${label} received the ${awardName}${year ? ` in ${year}` : ""}.`);
    }
    return lines;
  }

  async function lookupNames(names, options) {
    const settings = { fetch: typeof fetch === "function" ? fetch.bind(root) : null, timeoutMs: TIMEOUT_MS, lang: "en", ...(options || {}) };
    if (!names.length) return [];

    // 1. Find each name's Wikidata item, skipping disambiguation pages
    const searches = await Promise.allSettled(
      names.map((name) =>
        getJson(settings.fetch, { action: "wbsearchentities", search: name, language: settings.lang, uselang: settings.lang, type: "item", limit: "3" }, settings.timeoutMs),
      ),
    );
    if (searches.every((s) => s.status === "rejected")) throw searches[0].reason;
    const ids = [];
    for (const search of searches) {
      if (search.status !== "fulfilled") continue;
      const hit = ((search.value && search.value.search) || []).find((item) => !/disambiguation/i.test(item.description || ""));
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    if (!ids.length) return [];

    // 2. Their facts, then 3. the names of the places, people and awards those facts point to
    const entities = (await getJson(settings.fetch, { action: "wbgetentities", ids: ids.join("|"), props: "labels|claims", languages: settings.lang }, settings.timeoutMs)).entities || {};
    const referenced = new Set();
    for (const id of ids) {
      const entity = entities[id];
      if (!entity) continue;
      for (const property of ["P19", "P20", "P112", "P166"]) {
        for (const statement of statements(entity, property).slice(0, MAX_AWARDS)) {
          const target = itemId(statement);
          if (target) referenced.add(target);
        }
      }
    }
    const labels = new Map();
    const targets = [...referenced];
    for (let i = 0; i < targets.length; i += 50) {
      const batch = await getJson(settings.fetch, { action: "wbgetentities", ids: targets.slice(i, i + 50).join("|"), props: "labels", languages: settings.lang }, settings.timeoutMs);
      for (const [id, item] of Object.entries(batch.entities || {})) {
        const label = item.labels && item.labels[settings.lang];
        if (label) labels.set(id, label.value);
      }
    }

    const evidence = [];
    for (const id of ids) {
      const entity = entities[id];
      const label = entity && entity.labels && entity.labels[settings.lang] && entity.labels[settings.lang].value;
      if (!label) continue;
      const lines = sentencesFor(label, entity, labels);
      if (!lines.length) continue;
      evidence.push({ id: `wikidata:${id}`, text: lines.join("\n"), source: `Wikidata: ${label}`, url: `https://www.wikidata.org/wiki/${id}`, kind: "wikidata", topic: label });
    }
    return evidence;
  }

  // ---- Relation checks: is the claimed place, river mouth, capital or creator right? ----
  //
  // Wikidata's links settle some claims exactly. "The Eiffel Tower is located in Lyon" is wrong:
  // the tower is in Paris, France, and Lyon is a small place far away. A wrong claim becomes a plain
  // sentence stating the fact ("The Eiffel Tower is in Paris, France, not in Lyon."), which the
  // verifier judges like any passage. A conflict is only stated when every Wikidata item the names
  // could mean rules the claim out; anything unclear stays silent. The one confirmation: a place
  // claim whose every named place is in the subject's current chain of places ("The Taj Mahal is in
  // Agra, India"); other correct claims get no sentence here (their support comes from Wikipedia).

  const SPARQL = "https://query.wikidata.org/sparql";
  const MAX_RELATIONS = 4;
  const SMALL_PLACE_KM2 = 20000; // a named place this small can't contain something far from its centre
  const POINT_LIKE_KM2 = 100; // a building, monument or small site, not a park or a region
  const ITEM = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/;

  // Present tense only: "Strasbourg was in Germany" was true once, so the past is never contradicted
  const RELATION_PATTERNS = [
    { kind: "location", re: /^(.+?)\s+(?:is|are|lies|lie|sits|stands)\s+(?:(?:located|situated|found|based)\s+)?in\s+(.+)$/i },
    { kind: "through", re: /^(.+?)\s+(?:flows|runs|passes)\s+through\s+(.+)$/i },
    { kind: "mouth", re: /^(.+?)\s+(?:flows|empties|drains|discharges)\s+into\s+(.+)$/i },
    { kind: "capital", re: /^(.+?)\s+is\s+the\s+capital(?:\s+city)?\s+of\s+(.+)$/i },
    { kind: "creator", re: /^(.+?)\s+(painted|wrote|composed|directed|sculpted)\s+(.+)$/i },
  ];

  // What each creative verb means on Wikidata, which items it can apply to, and its sentence forms
  const CREATOR_VERBS = {
    painted: { props: ["P170"], fits: /\b(painting|fresco|mural|portrait|triptych|altarpiece)\b/i, base: "paint", passive: "painted" },
    sculpted: { props: ["P170"], fits: /\b(sculpture|statue|bust)\b/i, base: "sculpt", passive: "sculpted" },
    wrote: { props: ["P50", "P58", "P676", "P86"], fits: /\b(novel|book|play|poem|essay|story|treatise|novella|tragedy|comedy|memoir|literary work|song|opera)\b/i, base: "write", passive: "written" },
    composed: { props: ["P86", "P676"], fits: /\b(symphony|opera|composition|song|concerto|sonata|ballet|musical|suite|requiem)\b/i, base: "compose", passive: "composed" },
    directed: { props: ["P57"], fits: /\b(film|movie|documentary)\b/i, base: "direct", passive: "directed" },
  };
  // Wikidata describes some seas only as "body of water" (the Adriatic Sea)
  const WATER = /\b(ocean|sea|river|lake|gulf|bay|strait|lagoon|estuary|water|waterway|channel|reservoir|tributary)\b/i;

  const RELATION_SUBJECT_STOPWORDS = new Set([
    "It", "Its", "This", "That", "These", "Those", "They", "He", "She", "We", "You", "I", "There", "Here",
    "What", "Which", "Who", "Where", "When", "Why", "How", "Today", "Now", "Then", "Also", "However",
    "Instead", "Currently", "Historically", "Officially", "Technically", "Actually", "Another", "Each",
    "Every", "Some", "Many", "Most", "One", "Both", "Neither", "Either", "Such", "Our", "Their", "His", "Her",
  ]);
  const stripArticle = (text) => String(text || "").trim().replace(/^the\s+/i, "");
  const same = (a, b) => stripArticle(a).toLowerCase() === stripArticle(b).toLowerCase();

  /** { claim, kind, verb, subject, object } when the claim states a checkable relation between two names. */
  function parseRelation(claim) {
    const text = String((claim && claim.text) || "").trim().replace(/[.!;]+$/, "");
    const names = ((claim && claim.entities) || []).map(stripArticle);
    for (const { kind, re } of RELATION_PATTERNS) {
      const match = re.exec(text);
      if (!match) continue;
      const verb = kind === "creator" ? match[2].toLowerCase() : null;
      const subjectText = stripArticle(match[1]);
      const objectText = stripArticle(kind === "creator" ? match[3] : match[2]);
      // A one-word subject opening the sentence ("Toronto is the capital of…") isn't always marked as
      // a name, since every sentence starts with a capital; accept it unless it's a pronoun or filler
      const subject = names.find((name) => same(name, subjectText)) ||
        (/^[\p{Lu}][\p{Ll}]+$/u.test(subjectText) && !RELATION_SUBJECT_STOPWORDS.has(subjectText) ? subjectText : null);
      // The object is the name the rest of the sentence starts with ("Paris, France" -> "Paris")
      const object = names.find((name) => objectText.toLowerCase().startsWith(name.toLowerCase()) && /^(?:$|[\s,])/.test(objectText.slice(name.length)));
      if (!subject || !object || same(subject, object)) return null;
      const rawObject = (kind === "creator" ? match[3] : match[2]).trim();
      const written = rawObject.slice(0, rawObject.toLowerCase().indexOf(object.toLowerCase()) + object.length);
      // Every name the place part mentions ("Agra, India"), for confirming the whole claim
      const placeText = rawObject.replace(/[.!;]+$/, "");
      const objects = names.filter((name) => !same(name, subject) && placeText.toLowerCase().includes(name.toLowerCase()));
      return { claim, kind, verb, subject, object, written, objects, placeText: stripArticle(placeText) };
    }
    return null;
  }

  /**
   * Items one of whose names (label or alias) is exactly this name: a name can mean several items
   * ("Nile" is a river, a band and a town). Search's own "matched" text isn't reliable ("China" comes
   * back as "China PR"), so each hit's names are fetched and compared. The top hit always stays: it's
   * what Wikidata thinks the name means, even when that name isn't listed ("China" for the PRC).
   * Extra candidates only ever make a conflict harder to state.
   */
  async function candidatesFor(settings, name) {
    const body = await getJson(settings.fetch, { action: "wbsearchentities", search: name, language: settings.lang, uselang: settings.lang, type: "item", limit: "7" }, settings.timeoutMs);
    const hits = ((body && body.search) || []).filter((hit) => !/disambiguation|Wikimedia/i.test(hit.description || ""));
    if (!hits.length) return [];
    const terms = (await getJson(settings.fetch, { action: "wbgetentities", ids: hits.map((hit) => hit.id).join("|"), props: "labels|aliases", languages: settings.lang }, settings.timeoutMs)).entities || {};
    return hits
      .map((hit) => {
        const entity = terms[hit.id] || {};
        const label = ((entity.labels || {})[settings.lang] || {}).value || "";
        const names = [label, ...(((entity.aliases || {})[settings.lang]) || []).map((alias) => alias.value)];
        return { id: hit.id, description: hit.description || "", label, exact: names.some((candidate) => candidate && same(candidate, name)) };
      })
      .filter((candidate, i) => i === 0 || candidate.exact);
  }

  async function sparql(settings, query) {
    const url = `${SPARQL}?${new URLSearchParams({ query, format: "json" })}`;
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body;
    const body = await withSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      try {
        const response = await settings.fetch(url, { headers: { ...HEADERS, Accept: "application/sparql-results+json" }, credentials: "omit", signal: controller.signal });
        if (!response.ok) throw new Error(`Wikidata query service returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    });
    cache.set(url, { at: Date.now(), body });
    return body;
  }

  // One query per relation, small and bounded: no open-ended "part of" chains, which on Wikidata
  // lead from any place to every continent (France spans five through its overseas regions).
  const QUERY_PARTS = {
    place: [
      `{ ?e wdt:P131+ ?x . BIND("inside" AS ?how) }`,
      `{ ?e wdt:P131 ?x . BIND("admin1" AS ?how) }`,
      `{ ?e wdt:P131/wdt:P131 ?x . BIND("admin2" AS ?how) }`,
      // Every country, historical ones too, can rule a conflict out; only current ones are named
      `{ ?e wdt:P131*/(p:P17/ps:P17) ?x . BIND("country" AS ?how) }`,
      `{ ?e wdt:P17 ?x . FILTER NOT EXISTS { ?x wdt:P576 ?dissolved } BIND("country-now" AS ?how) }`,
      `{ ?e (wdt:P706|wdt:P4552) ?x . BIND("inside" AS ?how) }`,
      `{ ?e (wdt:P706|wdt:P4552)/wdt:P361 ?x . BIND("inside" AS ?how) }`,
      `{ ?e wdt:P30 ?x . BIND("continent" AS ?how) }`,
      `{ ?e wdt:P17 ?c . ?c wdt:P30 ?x . FILTER NOT EXISTS { ?c wdt:P30 ?other . FILTER(?other != ?x) } BIND("continent" AS ?how) }`,
      `{ ?e wdt:P31 wd:Q5107 . BIND(?e AS ?x) BIND("continent" AS ?how) }`,
      `{ ?e wdt:P31 wd:Q3624078 . BIND("sovereign" AS ?how) }`,
      `{ ?e wdt:P625 ?v . BIND("coord" AS ?how) }`,
      `{ ?e p:P2046/psn:P2046/wikibase:quantityAmount ?v . BIND("area" AS ?how) }`,
      `{ ?e p:P2043/psn:P2043/wikibase:quantityAmount ?v . BIND("length" AS ?how) }`,
    ],
    mouth: [
      `{ ?e wdt:P403 ?x . BIND("mouth1" AS ?how) }`,
      `{ ?e wdt:P403+ ?x . BIND("mouth" AS ?how) }`,
      `{ ?e wdt:P403+/wdt:P361 ?x . BIND("mouth" AS ?how) }`,
      `{ ?e wdt:P403+/wdt:P361/wdt:P361 ?x . BIND("mouth" AS ?how) }`,
    ],
    capital: [
      `{ ?e p:P36 ?st . ?st ps:P36 ?x . BIND(IF(EXISTS { ?st pq:P582 ?end }, "former-capital", "capital") AS ?how) }`,
      `{ ?e p:P1376 ?st . ?st ps:P1376 ?x . FILTER NOT EXISTS { ?st pq:P582 ?end } BIND("capital-of" AS ?how) }`,
    ],
  };

  function creatorParts(verb, objectIds) {
    const props = CREATOR_VERBS[verb].props;
    const path = `(${props.map((p) => `p:${p}`).join("|")})/(${props.map((p) => `ps:${p}`).join("|")})`;
    return [
      // Only real people count: "unknown value" and "anonymous" (Q4233718) never rule anyone out
      `{ ?e ${path} ?x . FILTER(STRSTARTS(STR(?x), "http://www.wikidata.org/entity/Q") && ?x != wd:Q4233718) BIND("creator" AS ?how) }`,
      `{ ?e wdt:P1773 ?x . BIND("creator" AS ?how) }`,
      `{ ?e wdt:P800 ?x . FILTER(?x IN (${objectIds.map((id) => `wd:${id}`).join(", ")})) BIND("notable-work" AS ?how) }`,
    ];
  }

  /** Facts per item id: { inside, admin1, admin2, country, continent, mouth, mouth1, capital, ... : Map(id -> label), sovereign, coord: [], area: [], length: [] } */
  async function factsFor(settings, ids, parts) {
    const query = `SELECT DISTINCT ?e ?how ?x ?xLabel ?v WHERE { VALUES ?e { ${ids.map((id) => `wd:${id}`).join(" ")} } ${parts.join(" UNION ")} SERVICE wikibase:label { bd:serviceParam wikibase:language "${settings.lang}". } }`;
    const body = await sparql(settings, query);
    const facts = new Map(ids.map((id) => [id, { coord: [], area: [], length: [], sovereign: false }]));
    for (const row of (body && body.results && body.results.bindings) || []) {
      const id = (ITEM.exec((row.e || {}).value || "") || [])[1];
      const fact = facts.get(id);
      const how = row.how && row.how.value;
      if (!fact || !how) continue;
      if (how === "sovereign") fact.sovereign = true;
      else if (how === "coord" || how === "area" || how === "length") fact[how].push(row.v.value);
      else {
        const target = (ITEM.exec((row.x || {}).value || "") || [])[1];
        if (!target) continue;
        if (!fact[how]) fact[how] = new Map();
        fact[how].set(target, (row.xLabel && row.xLabel.value) || target);
      }
    }
    return facts;
  }

  const ids = (fact, ...keys) => new Set(keys.flatMap((key) => [...((fact && fact[key]) || new Map()).keys()]));
  const labels = (fact, key) => [...((fact && fact[key]) || new Map()).values()].filter((label) => !/^Q\d+$/.test(label));

  /** "Point(2.29 48.85)" -> [lat, lon] */
  function point(wkt) {
    const match = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt || "");
    return match ? [Number(match[2]), Number(match[1])] : null;
  }

  function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Why the subject can't be in this place, or null if it might be. Areas come in m², lengths in m. */
  function placeConflict(kind, s, sId, o, oId) {
    if (sId === oId || ids(s, "inside", "admin1", "admin2", "country", "continent").has(oId)) return null;
    const sContinents = ids(s, "continent");
    const oContinents = ids(o, "continent");
    if (sContinents.size && oContinents.size && ![...sContinents].some((c) => oContinents.has(c))) return "continent";
    const sCountries = ids(s, "country");
    if (o.sovereign && !s.sovereign && sCountries.size && !sCountries.has(oId)) return "country";
    if (kind === "location" && o.area.length === 1 && o.coord.length === 1 && s.coord.length === 1 && !s.length.length) {
      const oKm2 = Number(o.area[0]) / 1e6;
      const sKm2 = s.area.length ? Math.max(...s.area.map(Number)) / 1e6 : 0;
      const from = point(s.coord[0]);
      const to = point(o.coord[0]);
      if (oKm2 > 0 && oKm2 < SMALL_PLACE_KM2 && sKm2 < POINT_LIKE_KM2 && from && to) {
        if (distanceKm(from, to) > 50 + 3 * Math.sqrt(oKm2 / Math.PI)) return "distance";
      }
    }
    return null;
  }

  /** Every pair of candidates must be ruled out; returns the sentence stating the fact, or null. */
  async function checkRelation(settings, relation) {
    const { kind, verb, subject, object, written, objects: placeNames = [], placeText } = relation;
    const [subjects, objects] = await Promise.all([candidatesFor(settings, subject), candidatesFor(settings, object)]);
    const verbInfo = verb && CREATOR_VERBS[verb];
    // Only items the relation can apply to: a river's mouth is water, a painting's creator paints
    const objectsThatFit = objects.filter((o) => (kind === "mouth" ? WATER.test(o.description) : kind === "creator" ? verbInfo.fits.test(o.description) : true));
    if (!subjects.length || !objectsThatFit.length) return null;

    const all = [...new Set([...subjects, ...objectsThatFit].map((c) => c.id))];
    const parts = kind === "location" || kind === "through" ? QUERY_PARTS.place : kind === "creator" ? creatorParts(verb, objectsThatFit.map((o) => o.id)) : QUERY_PARTS[kind];
    const facts = await factsFor(settings, all, parts);

    if (kind === "location" || kind === "through") {
      // Only real places count (a painting or a football club called "Lyon" isn't somewhere);
      // every place each name could mean must be ruled out
      const places = (list) => list.filter((c) => {
        const f = facts.get(c.id);
        return f && (f.coord.length || f.sovereign || ids(f, "continent").has(c.id));
      });
      const ss = places(subjects);
      const os = places(objectsThatFit);
      if (!ss.length || !os.length) return null;
      const primary = facts.get(ss[0].id);

      // Confirmation: every place the claim names ("Agra, India") is in the current chain of places of
      // the most likely item for the subject. Historical countries don't count ("in the Mughal Empire").
      const chainNow = ids(primary, "inside", "country-now", "continent");
      if (os.some((o) => chainNow.has(o.id))) {
        const others = placeNames.filter((name) => !same(name, object));
        const otherCandidates = await Promise.all(others.map((name) => candidatesFor(settings, name)));
        if (otherCandidates.every((list) => list.some((c) => chainNow.has(c.id)))) {
          return kind === "through" ? `${subject} flows through ${placeText}.` : `${subject} is in ${placeText}.`;
        }
        return null;
      }

      const reasons = [];
      for (const s of ss) for (const o of os) reasons.push(placeConflict(kind, facts.get(s.id), s.id, facts.get(o.id), o.id));
      if (reasons.some((reason) => !reason)) return null;
      const countries = labels(primary, "country-now");
      if (!countries.length) return null;
      if (kind === "through") return `${subject} flows through ${joinNames(countries)}, not through ${object}.`;
      // The nearest named area without numbers ("7th arrondissement of Paris" -> "Paris"); numbers in
      // these sentences could look like a conflict with some other claim's numbers
      const area = reasons.every((reason) => reason === "distance") ? [...labels(primary, "admin1"), ...labels(primary, "admin2")].find((label) => !/\d/.test(label)) : null;
      const where = area && !countries.includes(area) ? `${area}, ${joinNames(countries)}` : joinNames(countries);
      return `${subject} is in ${where}, not in ${object}.`;
    }

    if (kind === "mouth") {
      // Only rivers with a known mouth ("Nile" is also a band and a town)
      const rivers = subjects.filter((s) => ids(facts.get(s.id), "mouth1").size);
      if (!rivers.length) return null;
      const reaches = rivers.some((s) => objectsThatFit.some((o) => ids(facts.get(s.id), "mouth", "mouth1").has(o.id)));
      const mouths = labels(facts.get(rivers[0].id), "mouth1");
      if (reaches || !mouths.length) return null;
      return `${subject} flows into ${joinNames(mouths)}, not into ${object}.`;
    }

    if (kind === "capital") {
      // "Is the capital of" can only mean something with a capital today ("china" is also porcelain,
      // and the 1912-1949 Republic of China only has former ones). Present tense: a former capital
      // ("Toronto", "Kyoto") isn't the capital now. Past-tense claims never reach this check.
      const places = objectsThatFit.filter((o) => ids(facts.get(o.id), "capital").size);
      if (!places.length) return null;
      const isCapital = subjects.some((s) => places.some((o) => ids(facts.get(o.id), "capital").has(s.id) || ids(facts.get(s.id), "capital-of").has(o.id)));
      if (isCapital) return null;
      const actual = labels(facts.get(places[0].id), "capital");
      if (!actual.length) return null;
      // "X is not China's capital": the negation sits right before the object, and no "capital of"
      // phrase states a value that other capital claims about X could be compared with
      return `${subject} is not ${object}'s capital. ${object}'s capital is ${joinNames(actual)}.`;
    }

    if (kind === "creator") {
      const works = objectsThatFit.filter((o) => ids(facts.get(o.id), "creator").size);
      if (!works.length || works.length !== objectsThatFit.length) return null;
      const made = subjects.some((s) => works.some((o) => ids(facts.get(o.id), "creator").has(s.id) || ids(facts.get(s.id), "notable-work").has(o.id)));
      if (made) return null;
      // Name the work as the claim wrote it ("The Starry Night", not Munch's "Starry Night")
      const work = works.find((o) => o.label && o.label.toLowerCase() === String(written || "").toLowerCase()) || works.find((o) => o.exact) || works[0];
      const creators = labels(facts.get(work.id), "creator");
      if (!creators.length) return null;
      return `${subject} did not ${verbInfo.base} ${object}. ${work.label || object} was ${verbInfo.passive} by ${joinNames(creators)}.`;
    }
    return null;
  }

  function joinNames(names) {
    const list = [...new Set(names)].slice(0, 4);
    return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] || "";
  }

  /** Evidence sentences for the claims Wikidata's links prove wrong. Failures stay silent. */
  async function relationEvidence(claims, options) {
    const settings = { fetch: typeof fetch === "function" ? fetch.bind(root) : null, timeoutMs: TIMEOUT_MS, lang: "en", ...(options || {}) };
    const relations = (Array.isArray(claims) ? claims : [])
      .filter((claim) => claim.weight !== 0)
      .map(parseRelation)
      .filter(Boolean)
      .slice(0, MAX_RELATIONS);
    const outcomes = await Promise.allSettled(relations.map((relation) => checkRelation(settings, relation)));
    const evidence = [];
    outcomes.forEach((outcome, i) => {
      if (outcome.status === "rejected" && typeof settings.onError === "function") settings.onError(outcome.reason);
      if (outcome.status !== "fulfilled" || !outcome.value) return;
      const { subject } = relations[i];
      // No topic: these sentences name their subjects outright, and a topic would let "China's capital
      // is Beijing" count as being about the subject ("Tokyo")
      // exact: a conflict from these structured checks outweighs a loose word match (see verifier.js)
      evidence.push({ id: `wikidata-check:${i + 1}`, text: outcome.value, source: `Wikidata: ${subject}`, url: "https://www.wikidata.org/", kind: "wikidata", exact: true });
    });
    return evidence;
  }

  /** Facts about the names in these claims (used when checking an answer). */
  async function lookup(claims, options) {
    const [facts, checks] = await Promise.all([lookupNames(namesFor(claims), options), relationEvidence(claims, options).catch(() => [])]);
    return [...facts, ...checks];
  }

  AH.wikidata = { lookup, namesFor, formatTime, parseRelation, placeConflict, relationEvidence, clearCache: () => cache.clear() };

  if (typeof module !== "undefined") {
    module.exports = AH.wikidata;
  }
})(globalThis);
