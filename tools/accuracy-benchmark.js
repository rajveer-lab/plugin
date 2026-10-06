/**
 * Accuracy benchmark: runs statements with known truth through the real checking
 * pipeline against live Wikipedia.
 *
 *   node tools/accuracy-benchmark.js
 *
 * Uses the network (Wikipedia only), throttled to stay under its rate limit.
 * The most important number is FALSE ACCEPTS (a false statement marked supported): it must be 0.
 */
"use strict";

const path = require("path");
const ext = path.join(__dirname, "..", "extension");
for (const file of ["engine/claims.js", "engine/verifier.js", "engine/scorer.js", "engine/mitigator.js", "evidence/wikipedia.js", "evidence/wikidata.js"]) {
  require(path.join(ext, file));
}
const pipeline = require(path.join(ext, "background/service-worker.js"));
const AH = globalThis.AH;

// Wikimedia asks scripts to identify themselves honestly and go slowly. One request per
// ~1.1s, and on HTTP 429 wait and retry instead of failing the whole run.
const UA = "HallucinationGuard-accuracy-benchmark/0.1 (developer test script; Node.js)";
const GAP_MS = 1100;
let last = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch = globalThis.fetch;

// Successful Wikipedia responses are saved, so reruns while tuning don't call Wikipedia again.
// --fresh ignores the saved copies.
const fs = require("fs");
const CACHE_FILE = path.join(__dirname, ".cache", "wikipedia-responses.json");
const useCache = !process.argv.includes("--fresh");
let cache = {};
try {
  if (useCache) cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch (error) {
  cache = {};
}
process.on("exit", () => {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
});

globalThis.fetch = async (url, init = {}) => {
  if (useCache && cache[url]) return new Response(cache[url], { status: 200, headers: { "content-type": "application/json" } });
  const response = await politeFetch(url, init);
  if (response.ok) cache[url] = await response.clone().text();
  return response;
};

async function politeFetch(url, init) {
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, last + GAP_MS - Date.now());
    last = Date.now() + wait;
    if (wait) await sleep(wait);
    // Not the extension's abort signal: its timeouts would count this script's polite queueing and
    // rate-limit waits as slowness (the benchmark measures accuracy, not speed). A generous limit
    // per request still keeps a server that never answers from hanging the run.
    const response = await realFetch(url, { ...init, signal: AbortSignal.timeout(30000), headers: { ...(init.headers || {}), "User-Agent": UA } });
    if (response.status !== 429 || attempt >= 4) return response;
    const retryAfter = Number(response.headers.get("retry-after")) || 5 * (attempt + 1);
    process.stderr.write(`  rate-limited, waiting ${retryAfter}s…\n`);
    await sleep(retryAfter * 1000);
  }
}

// Each answer is written the way an AI would phrase it. T = true, F = false.
const ANSWERS = [
  { question: "Tell me about the Eiffel Tower.", facts: [
    ["T", "The Eiffel Tower is located in Paris."],
    ["T", "The Eiffel Tower was completed in 1889."],
    ["F", "The Eiffel Tower was completed in 1901."],
    ["F", "The Eiffel Tower is located in Lyon."] ] },
  { question: "Tell me about Mount Everest.", facts: [
    ["T", "Mount Everest is the highest mountain above sea level."],
    ["T", "Mount Everest is located in the Himalayas."],
    ["F", "Mount Everest is located in the Andes."] ] },
  { question: "Tell me about Albert Einstein.", facts: [
    ["T", "Albert Einstein was born in Ulm."],
    ["T", "Albert Einstein received the Nobel Prize in Physics in 1921."],
    ["F", "Albert Einstein was born in Vienna."],
    ["F", "Albert Einstein received the Nobel Prize in Chemistry."] ] },
  { question: "Tell me about the Python programming language.", facts: [
    ["T", "Python was created by Guido van Rossum."],
    ["T", "Python was first released in 1991."],
    ["F", "Python was first released in 2005."] ] },
  { question: "Tell me about Marie Curie.", facts: [
    ["T", "Marie Curie was born in Warsaw."],
    ["T", "Marie Curie won the Nobel Prize in Chemistry in 1911."],
    ["F", "Marie Curie was born in Berlin."] ] },
  { question: "Tell me about the Amazon River.", facts: [
    ["T", "The Amazon River flows through Brazil."],
    ["F", "The Amazon River flows through Egypt."] ] },
  { question: "Tell me about the Statue of Liberty.", facts: [
    ["T", "The Statue of Liberty was dedicated in 1886."],
    ["T", "The Statue of Liberty was a gift from France."],
    ["F", "The Statue of Liberty was dedicated in 1920."] ] },
  { question: "Tell me about William Shakespeare.", facts: [
    ["T", "William Shakespeare was born in Stratford-upon-Avon."],
    ["T", "William Shakespeare wrote Hamlet."],
    ["F", "William Shakespeare was born in London."] ] },
  { question: "Tell me about Apollo 11.", facts: [
    ["T", "Apollo 11 landed on the Moon in 1969."],
    ["T", "Neil Armstrong was the first person to walk on the Moon."],
    ["F", "Apollo 11 landed on the Moon in 1972."] ] },
  { question: "Tell me about Isaac Newton.", facts: [
    ["T", "Isaac Newton was an English mathematician."],
    ["F", "Isaac Newton was a French painter."] ] },
  { question: "Tell me about Tokyo.", facts: [
    ["T", "Tokyo is the capital of Japan."],
    ["F", "Tokyo is the capital of China."] ] },
  { question: "Tell me about the Great Wall of China.", facts: [
    ["F", "The Great Wall of China is visible from the Moon with the naked eye."] ] },
];

// Held-out set: never used for tuning. Run with --holdout to check the rules generalize.
const HOLDOUT = [
  { question: "Tell me about Leonardo da Vinci.", facts: [
    ["T", "Leonardo da Vinci painted the Mona Lisa."],
    ["F", "Leonardo da Vinci painted The Starry Night."] ] },
  { question: "Tell me about the Great Pyramid of Giza.", facts: [
    ["T", "The Great Pyramid of Giza is located in Egypt."],
    ["F", "The Great Pyramid of Giza is located in Mexico."] ] },
  { question: "Tell me about Charles Darwin.", facts: [
    ["T", "Charles Darwin wrote On the Origin of Species."],
    ["T", "Charles Darwin was born in 1809."],
    ["F", "Charles Darwin was born in 1850."] ] },
  { question: "Tell me about Mahatma Gandhi.", facts: [
    ["T", "Mahatma Gandhi was born in Porbandar."],
    ["F", "Mahatma Gandhi was born in Delhi."] ] },
  { question: "Tell me about the Titanic.", facts: [
    ["T", "The Titanic sank in 1912."],
    ["F", "The Titanic sank in 1920."] ] },
  { question: "Tell me about the Nile.", facts: [
    ["T", "The Nile flows into the Mediterranean Sea."],
    ["F", "The Nile flows into the Pacific Ocean."] ] },
  { question: "Tell me about Microsoft.", facts: [
    ["T", "Microsoft was founded by Bill Gates and Paul Allen."],
    ["T", "Microsoft was founded in 1975."],
    ["F", "Microsoft was founded in 1995."] ] },
  { question: "Tell me about the Taj Mahal.", facts: [
    ["T", "The Taj Mahal is located in Agra."],
    ["F", "The Taj Mahal is located in Mumbai."] ] },
  { question: "Tell me about Beethoven.", facts: [
    ["T", "Ludwig van Beethoven was born in Bonn."],
    ["F", "Ludwig van Beethoven was born in Vienna."] ] },
  { question: "Tell me about Mars.", facts: [
    ["T", "Mars is the fourth planet from the Sun."],
    ["F", "Mars is the second planet from the Sun."] ] },
];

// Second held-out set (written 2026-10-06, after the Wikidata relation checks were built while
// looking at HOLDOUT). Run with --holdout2. Don't tune on it: when it's been looked at, write a new one.
const HOLDOUT2 = [
  { question: "Tell me about the Colosseum.", facts: [
    ["T", "The Colosseum is located in Rome."],
    ["F", "The Colosseum is located in Athens."] ] },
  { question: "Tell me about Canada.", facts: [
    ["T", "Ottawa is the capital of Canada."],
    ["F", "Toronto is the capital of Canada."] ] },
  { question: "Tell me about the Danube.", facts: [
    ["T", "The Danube flows into the Black Sea."],
    ["F", "The Danube flows into the North Sea."] ] },
  { question: "Tell me about Mount Kilimanjaro.", facts: [
    ["T", "Mount Kilimanjaro is located in Tanzania."],
    ["F", "Mount Kilimanjaro is located in Kenya."] ] },
  { question: "Tell me about Pablo Picasso.", facts: [
    ["T", "Pablo Picasso painted Guernica."],
    ["F", "Pablo Picasso painted the Mona Lisa."] ] },
  { question: "Tell me about Charles Dickens.", facts: [
    ["T", "Charles Dickens wrote Oliver Twist."],
    ["T", "Charles Dickens was born in Portsmouth."],
    ["F", "Charles Dickens was born in 1850."] ] },
  { question: "Tell me about Big Ben.", facts: [
    ["T", "Big Ben is located in London."],
    ["F", "Big Ben is located in Manchester."] ] },
  { question: "Tell me about the Mississippi River.", facts: [
    ["T", "The Mississippi River flows into the Gulf of Mexico."],
    ["F", "The Mississippi River flows into the Pacific Ocean."] ] },
  { question: "Tell me about Australia.", facts: [
    ["T", "Canberra is the capital of Australia."],
    ["F", "Sydney is the capital of Australia."] ] },
  { question: "Tell me about the Berlin Wall.", facts: [
    ["T", "The Berlin Wall fell in 1989."],
    ["F", "The Berlin Wall fell in 1995."] ] },
  { question: "Tell me about Nikola Tesla.", facts: [
    ["T", "Nikola Tesla was born in Smiljan."],
    ["F", "Nikola Tesla was born in Paris."] ] },
];

// Third held-out set (written 2026-10-06 before HOLDOUT2's fixes were scored). Run with --holdout3.
const HOLDOUT3 = [
  { question: "Tell me about the Louvre.", facts: [
    ["T", "The Louvre is located in Paris."],
    ["F", "The Louvre is located in London."] ] },
  { question: "Tell me about Brazil.", facts: [
    ["T", "Brasília is the capital of Brazil."],
    ["F", "Rio de Janeiro is the capital of Brazil."] ] },
  { question: "Tell me about the Rhine.", facts: [
    ["T", "The Rhine flows into the North Sea."],
    ["F", "The Rhine flows into the Black Sea."] ] },
  { question: "Tell me about Mount Fuji.", facts: [
    ["T", "Mount Fuji is located in Japan."],
    ["F", "Mount Fuji is located in China."] ] },
  { question: "Tell me about Michelangelo.", facts: [
    ["T", "Michelangelo sculpted David."],
    ["F", "Michelangelo painted The Last Supper."] ] },
  { question: "Tell me about Jane Austen.", facts: [
    ["T", "Jane Austen wrote Pride and Prejudice."],
    ["F", "Jane Austen wrote Wuthering Heights."] ] },
  { question: "Tell me about Turkey.", facts: [
    ["T", "Ankara is the capital of Turkey."],
    ["F", "Istanbul is the capital of Turkey."] ] },
  { question: "Tell me about Galileo Galilei.", facts: [
    ["T", "Galileo Galilei was born in Pisa."],
    ["F", "Galileo Galilei was born in Rome."] ] },
  { question: "Tell me about the Thames.", facts: [
    ["T", "The Thames flows through London."],
    ["F", "The Thames flows through Paris."] ] },
  { question: "Tell me about the Golden Gate Bridge.", facts: [
    ["T", "The Golden Gate Bridge is located in San Francisco."],
    ["F", "The Golden Gate Bridge is located in Los Angeles."] ] },
  { question: "Tell me about World War II.", facts: [
    ["T", "World War II ended in 1945."],
    ["F", "World War II ended in 1950."] ] },
  { question: "Tell me about Amazon, the company.", facts: [
    ["T", "Amazon was founded by Jeff Bezos."],
    ["F", "Amazon was founded by Bill Gates."] ] },
  { question: "Tell me about Harvard University.", facts: [
    ["T", "Harvard University is located in Cambridge, Massachusetts."],
    ["F", "Harvard University is located in New York."] ] },
];

// Fourth held-out set: realistic answer style, written 2026-10-06. Run with --holdout4.
const HOLDOUT4 = [
  { question: "Tell me about the Danube River.", facts: [
    ["T", "The Danube flows through several countries in central and southeastern Europe."], // en.wikipedia.org/wiki/Danube
    ["F", "It empties into the Adriatic Sea."], // en.wikipedia.org/wiki/Danube
    ["T", "Its delta lies on the Black Sea."], // en.wikipedia.org/wiki/Danube_Delta
  ], extra: ["It is generally considered one of Europe's most important waterways."] },
  { question: "Give me a quick overview of the Taj Mahal.", facts: [
    ["T", "The Taj Mahal is in Agra, India."], // en.wikipedia.org/wiki/Taj_Mahal
    ["T", "It was commissioned by the Mughal emperor Shah Jahan."], // en.wikipedia.org/wiki/Taj_Mahal
    ["F", "They began building it in 1750."], // en.wikipedia.org/wiki/Taj_Mahal
  ], extra: ["It is often described as a symbol of enduring love."] },
  { question: "What should I know about the Amazon River?", facts: [
    ["T", "The Amazon River system drains a large part of South America."], // en.wikipedia.org/wiki/Amazon_River
    ["F", "It flows west from the Andes and reaches the Pacific Ocean."], // en.wikipedia.org/wiki/Amazon_River
    ["T", "The river's mouth is on the Atlantic coast of Brazil."], // en.wikipedia.org/wiki/Amazon_River
  ], extra: ["Its exact ranking by length depends on how the river is measured."] },
  { question: "Summarize Ada Lovelace's work.", facts: [
    ["T", "Ada Lovelace was an English mathematician and writer."], // en.wikipedia.org/wiki/Ada_Lovelace
    ["T", "She wrote notes on Charles Babbage's proposed Analytical Engine."], // en.wikipedia.org/wiki/Ada_Lovelace
    ["F", "She published those notes in 1853."], // en.wikipedia.org/wiki/Ada_Lovelace
  ], extra: ["She is often called the first computer programmer, though that label can be debated."] },
  { question: "Tell me about Mount Fuji.", facts: [
    ["T", "Mount Fuji is Japan's highest mountain."], // en.wikipedia.org/wiki/Mount_Fuji
    ["F", "It is an active volcano on the island of Hokkaido."], // en.wikipedia.org/wiki/Mount_Fuji
    ["T", "Its last known eruption began in 1707."], // en.wikipedia.org/wiki/Mount_Fuji
  ], extra: ["On clear days, it can be seen from parts of Tokyo."] },
  { question: "How did the Berlin Wall come down?", facts: [
    ["T", "The Berlin Wall opened on 9 November 1989."], // en.wikipedia.org/wiki/Berlin_Wall
    ["T", "The opening followed an announcement by East German official Günter Schabowski."], // en.wikipedia.org/wiki/Berlin_Wall
    ["F", "They officially opened it in 1991."], // en.wikipedia.org/wiki/Berlin_Wall
  ], extra: ["The night is widely remembered as a turning point in the end of the Cold War."] },
  { question: "Give me an overview of Frankenstein.", facts: [
    ["T", "Mary Shelley wrote Frankenstein; or, The Modern Prometheus."], // en.wikipedia.org/wiki/Frankenstein
    ["T", "The novel was first published anonymously in 1818."], // en.wikipedia.org/wiki/Frankenstein
    ["F", "It was first published in 1831."], // en.wikipedia.org/wiki/Frankenstein
  ], extra: ["The book is often discussed as an early work of science fiction."] },
  { question: "What is notable about the Great Barrier Reef?", facts: [
    ["T", "The Great Barrier Reef lies in the Coral Sea off the coast of Queensland, Australia."], // en.wikipedia.org/wiki/Great_Barrier_Reef
    ["F", "It is located in the South Atlantic Ocean near Brazil."], // en.wikipedia.org/wiki/Great_Barrier_Reef
    ["T", "It is the world's largest coral reef system."], // en.wikipedia.org/wiki/Great_Barrier_Reef
  ], extra: ["Scientists continue to study the effects of warming seas on its health."] },
];

// Fifth held-out set: fresh topics and realistic answer style, written 2026-10-06. Run with --holdout5.
const HOLDOUT5 = [
  { question: "Tell me about Frida Kahlo.", facts: [
    ["T", "Frida Kahlo was born in Coyoacán, Mexico City."], // en.wikipedia.org/wiki/Frida_Kahlo
    ["T", "She painted The Two Fridas."], // en.wikipedia.org/wiki/Frida_Kahlo
    ["F", "She was born in 1910."] // en.wikipedia.org/wiki/Frida_Kahlo
  ], extra: ["Her work is often associated with surrealism, although she rejected that label."] },
  { question: "Give me a short overview of Kyoto.", facts: [
    ["T", "Kyoto is located in Japan's Kansai region."], // en.wikipedia.org/wiki/Kyoto
    ["T", "It served as Japan's capital for more than a thousand years."], // en.wikipedia.org/wiki/Kyoto
    ["F", "It is currently the capital of Japan."] // en.wikipedia.org/wiki/Kyoto
  ], extra: ["The city is especially known for its temples and traditional gardens."] },
  { question: "What should I know about the Mekong River?", facts: [
    ["T", "The Mekong flows through Laos."], // en.wikipedia.org/wiki/Mekong
    ["T", "It reaches the South China Sea through the Mekong Delta."], // en.wikipedia.org/wiki/Mekong
    ["F", "Its source is in the Himalayas."] // en.wikipedia.org/wiki/Mekong
  ], extra: ["Its seasonal floods support farming and fisheries across the region."] },
  { question: "Tell me about the Sydney Opera House.", facts: [
    ["T", "The Sydney Opera House was designed by Danish architect Jørn Utzon."], // en.wikipedia.org/wiki/Sydney_Opera_House
    ["T", "It officially opened in 1973."], // en.wikipedia.org/wiki/Sydney_Opera_House
    ["F", "It was designed by Frank Lloyd Wright."] // en.wikipedia.org/wiki/Sydney_Opera_House
  ], extra: ["Its roof shells have become a familiar part of Sydney's harbour skyline."] },
  { question: "How did Nintendo get started?", facts: [
    ["T", "Nintendo was founded in Kyoto in 1889."], // en.wikipedia.org/wiki/Nintendo
    ["T", "It originally produced handmade hanafuda playing cards."], // en.wikipedia.org/wiki/Nintendo
    ["F", "They founded the company in 1947."] // en.wikipedia.org/wiki/Nintendo
  ], extra: ["The company later became known around the world for video games."] },
  { question: "Give me an overview of The Hobbit.", facts: [
    ["T", "J. R. R. Tolkien wrote The Hobbit."], // en.wikipedia.org/wiki/The_Hobbit
    ["T", "It was first published in 1937."], // en.wikipedia.org/wiki/The_Hobbit
    ["F", "It was first published in 1954."] // en.wikipedia.org/wiki/The_Hobbit
  ], extra: ["The story follows Bilbo Baggins on an unexpected journey."] },
  { question: "Tell me about Spirited Away.", facts: [
    ["T", "Spirited Away was directed by Hayao Miyazaki."], // en.wikipedia.org/wiki/Spirited_Away
    ["T", "The film was released in 2001."], // en.wikipedia.org/wiki/Spirited_Away
    ["F", "It was directed by Isao Takahata."] // en.wikipedia.org/wiki/Spirited_Away
  ], extra: ["It is widely regarded as one of the most influential animated films."] },
  { question: "What did Alexander Fleming discover?", facts: [
    ["T", "Alexander Fleming discovered penicillin in 1928."], // en.wikipedia.org/wiki/Alexander_Fleming
    ["T", "He was born in Scotland."], // en.wikipedia.org/wiki/Alexander_Fleming
    ["F", "He discovered penicillin in 1938."] // en.wikipedia.org/wiki/Alexander_Fleming
  ], extra: ["The discovery eventually helped transform the treatment of bacterial infections."] },
];

function settings() {
  return pipeline.mergeSettings({ onDeviceAI: false, sources: { links: false, wikipedia: true, webSearch: false, pages: false } });
}

async function runChecks() {
  const rows = [];
  const set = process.argv.includes("--holdout5") ? HOLDOUT5 : process.argv.includes("--holdout4") ? HOLDOUT4 : process.argv.includes("--holdout3") ? HOLDOUT3 : process.argv.includes("--holdout2") ? HOLDOUT2 : process.argv.includes("--holdout") ? HOLDOUT : ANSWERS;
  for (const answer of set) {
    // Unlabelled sentences (hedges, opinions) sit inside the answer the way a chat AI writes them
    const sentences = answer.facts.map(([, sentence]) => sentence);
    if (answer.extra) sentences.splice(1, 0, ...answer.extra);
    const text = sentences.join(" ");
    const result = await pipeline.checkAnswer({ question: answer.question, answerText: text, links: [] }, { settings: settings() });
    const verdicts = (result.report && result.report.verdicts) || [];
    const claims = AH.claims.extract(text, { question: answer.question });

    for (const [truth, sentence] of answer.facts) {
      // Match the verdicts of claims that came from this sentence; the sentence takes its worst verdict
      const own = claims.map((claim, i) => (claim.sentence.trim() === sentence ? verdicts[i] : null)).filter(Boolean);
      const status = own.some((v) => v.status === "contradicted") ? "contradicted" : own.some((v) => v.status === "unsupported") || !own.length ? "unsupported" : "supported";
      const reason = own.map((v) => v.reasoning).join(" | ");
      rows.push({ truth, sentence, status, reason, errors: result.errors });
    }
  }
  return rows;
}

(async () => {
  const started = Date.now();
  const checks = await runChecks();

  const t = checks.filter((r) => r.truth === "T");
  const f = checks.filter((r) => r.truth === "F");
  const count = (rows, status) => rows.filter((r) => r.status === status).length;

  printChecks(checks, t, f, count);
  console.log(`\n(${Math.round((Date.now() - started) / 1000)}s)`);
})().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});

function printChecks(checks, t, f, count) {
  console.log("\n=== Answer checking (live Wikipedia, word-matching judge) ===");
  for (const row of checks) {
    const wrong = (row.truth === "F" && row.status === "supported") || (row.truth === "T" && row.status === "contradicted");
    const tag = wrong ? "WRONG" : row.truth === "T" ? (row.status === "supported" ? "ok   " : "miss ") : row.status === "contradicted" ? "caught" : "miss ";
    console.log(`${tag} ${row.truth} ${row.status.padEnd(12)} ${row.sentence}${wrong || tag.startsWith("miss") ? `\n        ↳ ${row.reason.slice(0, 160)}` : ""}`);
  }
  const errors = [...new Set(checks.flatMap((r) => Object.values(r.errors || {})))];
  if (errors.length) console.log("\nErrors:", errors.join("; "));

  console.log("\n=== Summary ===");
  console.log(`False accepts (false marked supported):     ${count(f, "supported")} of ${f.length}   <- must be 0`);
  console.log(`False alarms (true marked contradicted):    ${count(t, "contradicted")} of ${t.length}`);
  console.log(`True facts confirmed:                       ${count(t, "supported")} of ${t.length} (${Math.round((100 * count(t, "supported")) / t.length)}%)`);
  console.log(`False facts caught as contradicted:         ${count(f, "contradicted")} of ${f.length} (${Math.round((100 * count(f, "contradicted")) / f.length)}%)`);
  console.log(`False facts left as unverified:             ${count(f, "unsupported")} of ${f.length}`);
}
