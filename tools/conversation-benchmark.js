/**
 * Conversation benchmark: runs the cases in tools/conversation-cases.js (pasted text, contradicting
 * itself, "Are you sure?", misquotes, controls) through the real checking pipeline.
 *
 *   node tools/conversation-benchmark.js            all cases
 *   node tools/conversation-benchmark.js --verbose  also print every case that passed
 *   node tools/conversation-benchmark.js --offline  no Wikipedia: fast, but pushback cases can't be judged
 *   node tools/conversation-benchmark.js --set2     the second, fresh set (tools/conversation-cases-2.js)
 *
 * Sets are exams, not training data: run a new set once, report it, and never tune rules to pass it.
 *
 * Wikipedia is on (pushback cases need a source to say who was right) and its responses are cached
 * in tools/.cache/ like the accuracy benchmark. The most important number is FALSE ALARMS: anything
 * marked hallucinated, or any consistency warning, that the case doesn't expect. It must be 0.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const ext = path.join(__dirname, "..", "extension");
for (const file of ["engine/claims.js", "engine/verifier.js", "engine/conversation.js", "engine/scorer.js", "engine/mitigator.js", "engine/grounder.js", "evidence/wikipedia.js", "evidence/wikidata.js"]) {
  require(path.join(ext, file));
}
const pipeline = require(path.join(ext, "background/service-worker.js"));
const CASES = require(process.argv.includes("--set3") ? "./conversation-cases-3.js" : process.argv.includes("--set2") ? "./conversation-cases-2.js" : "./conversation-cases.js");

// Same polite, cached Wikipedia access as tools/accuracy-benchmark.js
const UA = "HallucinationGuard-conversation-benchmark/0.1 (developer test script; Node.js)";
const GAP_MS = 1100;
const CACHE_FILE = path.join(__dirname, ".cache", "wikipedia-responses.json");
const useCache = !process.argv.includes("--fresh");
const verbose = process.argv.includes("--verbose");
const offline = process.argv.includes("--offline");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch = globalThis.fetch;
let last = 0;
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
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, last + GAP_MS - Date.now());
    last = Date.now() + wait;
    if (wait) await sleep(wait);
    const response = await realFetch(url, { ...init, signal: AbortSignal.timeout(30000), headers: { ...(init.headers || {}), "User-Agent": UA } });
    if (response.status !== 429 || attempt >= 4) {
      if (response.ok) cache[url] = await response.clone().text();
      return response;
    }
    const retryAfter = Number(response.headers.get("retry-after")) || 5 * (attempt + 1);
    process.stderr.write(`  rate-limited, waiting ${retryAfter}s…\n`);
    await sleep(retryAfter * 1000);
  }
};

function settings() {
  return pipeline.mergeSettings({ onDeviceAI: false, sources: { links: false, wikipedia: !offline, webSearch: false, pages: false } });
}

const same = (a, b) => String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();

async function runCase(testCase) {
  const history = testCase.history || [];
  const lastUser = [...history].reverse().find((turn) => turn.role === "user");
  const result = await pipeline.checkAnswer(
    { site: "chatgpt", question: lastUser ? lastUser.text : "", answerText: testCase.answer, links: [], history },
    { settings: settings() },
  );
  const expect = testCase.expect || {};
  const annotations = result.annotations || [];
  const consistency = result.consistency || [];
  const statusOf = (sentence) => (annotations.find((a) => same(a.sentence, sentence)) || {}).status || "none";
  const out = { id: testCase.id, kind: testCase.kind, problems: [], counts: {} };
  const bump = (key) => (out.counts[key] = (out.counts[key] || 0) + 1);

  for (const sentence of expect.hallucinated || []) {
    bump("hallucinatedExpected");
    if (statusOf(sentence) === "contradicted") bump("hallucinatedCaught");
    else if (statusOf(sentence) === "supported") {
      bump("falseAccept");
      out.problems.push(`FALSE ACCEPT ✓ (should be ✕): ${sentence}`);
    } else out.problems.push(`missed ✕ (got ${statusOf(sentence)}): ${sentence}`);
  }
  for (const sentence of expect.confirmed || []) {
    bump("confirmedExpected");
    if (statusOf(sentence) === "supported") bump("confirmedHit");
    else out.problems.push(`missed ✓ (got ${statusOf(sentence)}): ${sentence}`);
  }
  for (const want of expect.consistency || []) {
    bump("consistencyExpected");
    const got = consistency.find((item) => same(item.sentence, want.sentence));
    if (got && got.type === want.type) bump("consistencyHit");
    else if (got) {
      bump("consistencyWrongType");
      out.problems.push(`wrong type ${got.type} (want ${want.type}): ${want.sentence}`);
    } else out.problems.push(`missed ${want.type}: ${want.sentence}`);
  }
  // False alarms: a ✕ or a warning nobody expected
  for (const annotation of annotations) {
    if (annotation.status === "contradicted" && !(expect.hallucinated || []).some((s) => same(s, annotation.sentence))) {
      bump("falseAlarm");
      out.problems.push(`FALSE ALARM ✕: ${annotation.sentence} | ${annotation.note}`);
    }
  }
  for (const item of consistency) {
    if (!(expect.consistency || []).some((want) => same(want.sentence, item.sentence))) {
      bump("falseAlarm");
      out.problems.push(`FALSE ALARM ${item.type}: ${item.sentence} | ${item.note}`);
    }
  }
  if (Object.keys(result.errors || {}).length) out.problems.push(`errors: ${JSON.stringify(result.errors)}`);
  return out;
}

(async () => {
  const totals = {};
  const byKind = {};
  for (const testCase of CASES) {
    const out = await runCase(testCase);
    for (const [key, n] of Object.entries(out.counts)) {
      totals[key] = (totals[key] || 0) + n;
      byKind[out.kind] = byKind[out.kind] || {};
      byKind[out.kind][key] = (byKind[out.kind][key] || 0) + n;
    }
    if (out.problems.length || verbose) {
      console.log(`${out.problems.length ? "✕" : "✓"} ${out.id}`);
      out.problems.forEach((p) => console.log(`    ${p}`));
    }
  }
  const t = (key) => totals[key] || 0;
  console.log("");
  console.log(`FALSE ACCEPTS: ${t("falseAccept")} (must be 0)`);
  console.log(`FALSE ALARMS: ${t("falseAlarm")} (must be 0)`);
  console.log(`Pasted text, hallucinations caught: ${t("hallucinatedCaught")}/${t("hallucinatedExpected")}`);
  console.log(`Pasted text, statements confirmed: ${t("confirmedHit")}/${t("confirmedExpected")}`);
  console.log(`Consistency warnings found: ${t("consistencyHit")}/${t("consistencyExpected")} (wrong type: ${t("consistencyWrongType")})`);
  for (const [kind, counts] of Object.entries(byKind)) console.log(`  ${kind}: ${JSON.stringify(counts)}`);
})();
