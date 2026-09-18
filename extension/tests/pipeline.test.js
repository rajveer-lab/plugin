"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pipeline = require("../background/service-worker.js");

const AH = globalThis.AH;
const ENGINE_KEYS = ["claims", "verifier", "scorer", "mitigator", "factMemory", "links", "wikipedia", "webSearch", "pageSources"];

function settings(overrides = {}) {
  return pipeline.mergeSettings({ onDeviceAI: false, ...overrides });
}

function installStubs(calls, overrides = {}) {
  for (const key of ENGINE_KEYS) delete AH[key];
  const claims = [
    { id: "c1", text: "Water boils at 100 C", weight: 0.2, sentenceIndex: 0 },
    { id: "c2", text: "The tower opened in 1889", weight: 0.9, sentenceIndex: 1 },
  ];
  Object.assign(AH, {
    claims: {
      extract: (text, options) => {
        calls.extract = { text, options };
        return claims;
      },
    },
    verifier: {
      verifyClaim: (claim, evidence) => {
        calls.verified = [...(calls.verified || []), claim.id];
        calls.evidenceSeen = evidence.map((item) => item.id);
        return { claimId: claim.id, status: "unsupported", confidence: 0.3, judge: "heuristic", evidenceId: evidence[0] && evidence[0].id };
      },
    },
    scorer: {
      score: (verdicts, options) => {
        calls.scored = { verdicts, options };
        return { riskLevel: "LOW", verdicts };
      },
    },
    mitigator: {
      annotate: (...args) => {
        calls.annotated = args;
        return [{ sentenceIndex: 0, status: "supported" }];
      },
    },
    factMemory: {
      lookup: async () => [{ claimId: "c1", status: "supported", judge: "memory" }],
      record: async (verdicts) => {
        calls.recorded = verdicts;
      },
    },
    links: {
      check: async (links, options) => {
        calls.links = { links, options };
        return {
          linkChecks: [{ url: links[0].url, status: "not_found" }],
          evidence: [{ id: "link:1", kind: "link", text: "x".repeat(900) }],
        };
      },
    },
    wikipedia: {
      lookup: async (pending) => {
        calls.wikipedia = pending.map((claim) => claim.id);
        return [
          { id: "wiki:1", kind: "wikipedia", text: "The tower opened in 1889." },
          { id: "wiki:1", kind: "wikipedia", text: "Second passage." },
        ];
      },
    },
    webSearch: {
      search: async () => {
        calls.webSearch = true;
        return [];
      },
    },
    pageSources: { list: async () => [{ id: "page:1", kind: "page", text: "The tower opened in 1889." }] },
  }, overrides);
}

test("returns an empty result when the engine isn't built yet", async () => {
  for (const key of ENGINE_KEYS) delete AH[key];
  const result = await pipeline.checkAnswer({ answerText: "Some answer." }, { settings: settings(), missingModules: ["/engine/claims.js"] });
  assert.equal(result.report, null);
  assert.deepEqual(result.missingModules, ["/engine/claims.js"]);
});

test("does nothing when disabled or the answer is empty", async () => {
  const calls = {};
  installStubs(calls);
  assert.equal((await pipeline.checkAnswer({ answerText: "Hi there." }, { settings: settings({ enabled: false }) })).report, null);
  assert.equal((await pipeline.checkAnswer({ answerText: "   " }, { settings: settings() })).report, null);
  assert.equal(calls.extract, undefined);
});

test("runs the full pipeline and skips claims answered from memory", async () => {
  const calls = {};
  installStubs(calls);
  const result = await pipeline.checkAnswer(
    {
      site: "chatgpt",
      question: "When did it open?",
      answerText: "Water boils at 100 C. The tower opened in 1889.",
      links: ["https://example.com/a", { url: "https://example.com/a" }, "javascript:alert(1)"],
    },
    { settings: settings({ minInformation: 2 }) },
  );

  assert.deepEqual(calls.extract.options, { question: "When did it open?" });
  assert.deepEqual(calls.verified, ["c2"], "only the claim not in memory is verified");
  assert.deepEqual(calls.wikipedia, ["c2"], "only pending claims are looked up");
  assert.equal(calls.webSearch, undefined, "web search is off by default");
  assert.deepEqual(calls.links.links, [{ url: "https://example.com/a", text: "" }]);
  assert.equal(calls.scored.verdicts[0].judge, "memory", "verdicts stay in claim order");
  assert.equal(calls.scored.options.minInformation, 2);
  assert.deepEqual(calls.recorded.map((v) => v.claimId), ["c2"], "memory hits aren't re-recorded");
  assert.equal(calls.annotated[4].strictness, "strict");

  assert.deepEqual(result.linkChecks, [{ url: "https://example.com/a", status: "not_found" }]);
  assert.deepEqual(calls.evidenceSeen, ["link:1#1", "link:1#2", "wiki:1", "wiki:1'"], "long evidence split, duplicate text dropped, duplicate ids renamed");
  assert.deepEqual(result.evidence.map((e) => e.id), ["link:1#1"], "only referenced evidence is returned");
  assert.equal(result.evidence[0].text.length, 501, "evidence previews are truncated");
  assert.deepEqual(result.errors, {});
});

test("a failing source is reported and the others still count", async () => {
  const calls = {};
  installStubs(calls, {
    wikipedia: {
      lookup: async () => {
        throw new Error("offline");
      },
    },
  });
  const result = await pipeline.checkAnswer({ answerText: "The tower opened in 1889." }, { settings: settings() });
  assert.equal(result.errors.wikipedia, "offline");
  assert.deepEqual(calls.evidenceSeen, ["page:1"]);
  assert.ok(result.report);
});

test("web search runs only with a key", async () => {
  const calls = {};
  installStubs(calls);
  await pipeline.checkAnswer({ answerText: "The tower opened in 1889." }, { settings: settings({ sources: { webSearch: true } }) });
  assert.equal(calls.webSearch, undefined);
  await pipeline.checkAnswer(
    { answerText: "The tower opened in 1889." },
    { settings: settings({ sources: { webSearch: true }, braveApiKey: "key" }) },
  );
  assert.equal(calls.webSearch, true);
});

test("on-device AI re-judges pending claims, most informative first", async () => {
  const calls = {};
  installStubs(calls, { factMemory: undefined });
  const judged = [];
  const result = await pipeline.checkAnswer({ answerText: "Water boils at 100 C. The tower opened in 1889." }, {
    settings: settings({ onDeviceAI: true }),
    aiAvailable: async () => true,
    aiJudge: async (claim) => {
      judged.push(claim.id);
      return { claimId: claim.id, status: "supported", judge: "on-device-ai" };
    },
  });
  assert.deepEqual(judged, ["c2", "c1"]);
  assert.ok(result.report.verdicts.every((v) => v.judge === "on-device-ai"));
});

test("an AI judge failure keeps heuristic verdicts", async () => {
  const calls = {};
  installStubs(calls, { factMemory: undefined });
  const result = await pipeline.checkAnswer({ answerText: "Water boils at 100 C. The tower opened in 1889." }, {
    settings: settings({ onDeviceAI: true }),
    aiAvailable: async () => true,
    aiJudge: async () => {
      throw new Error("model busy");
    },
  });
  assert.equal(result.errors.aiJudge, "model busy");
  assert.ok(result.report.verdicts.every((v) => v.judge === "heuristic"));
});

test("pages are split into sentences so unrelated sentences can't combine to support a claim", () => {
  const page = {
    id: "page:1",
    kind: "page",
    source: "Eiffel Tower",
    text: "The Eiffel Tower is a lattice tower in Paris, France. It was completed in 1889.\n\nBerlin is the capital of Germany and is located in Europe.",
  };
  const passages = pipeline.toPassages([page]);
  assert.deepEqual(passages.map((p) => p.id), ["page:1#1", "page:1#2", "page:1#3"]);
  assert.equal(passages[1].text, "The Eiffel Tower is a lattice tower in Paris, France. It was completed in 1889.", "pronoun sentence keeps its subject");
  assert.equal(passages[2].source, "Eiffel Tower");
  assert.deepEqual(pipeline.toPassages([{ id: "short", text: "One sentence only." }]).map((p) => p.id), ["short"]);
  assert.ok(pipeline.toPassages([{ id: "long", text: "y".repeat(1500) }]).every((p) => p.text.length <= 600));

  // With the real engine, sentence passages don't combine "Eiffel Tower" and "Berlin" from different sentences
  for (const key of ENGINE_KEYS) delete AH[key];
  const claims = require("../engine/claims.js");
  const verifier = require("../engine/verifier.js");
  const falseClaim = claims.extract("The Eiffel Tower is located in Berlin.")[0];
  assert.notEqual(verifier.verifyClaim(falseClaim, passages).status, "supported");
  const trueClaim = claims.extract("The Eiffel Tower was completed in 1889.")[0];
  assert.equal(verifier.verifyClaim(trueClaim, passages).status, "supported");
});

test("settings merge keeps nested source defaults", () => {
  const merged = pipeline.mergeSettings({ strictness: "moderate", sources: { wikipedia: false } });
  assert.equal(merged.strictness, "moderate");
  assert.deepEqual(merged.sources, { links: true, wikipedia: false, webSearch: false, pages: true });
  assert.equal(merged.minInformation, 1.0);
});
