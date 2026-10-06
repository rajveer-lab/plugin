/**
 * Runs the conversation exams through the real CHECK_ANSWER pipeline with Chrome's built-in AI model,
 * scored exactly like tools/conversation-benchmark.js. Developer tool; see index.html.
 */
"use strict";

(function () {
  const AH = window.AH;
  const pipeline = AH.pipeline;
  const $ = (id) => document.getElementById(id);
  const out = $("out");
  const log = (line) => {
    out.textContent += `${line}\n`;
  };

  // ---- Wikipedia: the responses the Node exams saved, so both runs see the same sources ----
  let cache = null;
  const realFetch = window.fetch.bind(window);
  async function loadCache() {
    if (!cache) cache = await (await realFetch("/tools/.cache/wikipedia-responses.json")).json();
    return cache;
  }
  window.fetch = async (url) => {
    const saved = (await loadCache())[String(url)];
    if (saved) return new Response(saved, { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not in the saved responses", { status: 503 });
  };

  // ---- the model ----
  async function showStatus() {
    const status = await AH.aiJudge.status();
    $("status").textContent = status;
    $("download").hidden = status !== "downloadable";
    return status;
  }

  $("download").addEventListener("click", async () => {
    $("download").disabled = true;
    try {
      await AH.aiJudge.prepare((loaded) => ($("progress").textContent = `${Math.round(loaded * 100)}%`));
    } catch (error) {
      $("progress").textContent = `Download failed: ${error.message}`;
    }
    $("download").disabled = false;
    showStatus();
  });

  // ---- one case, scored like the Node runner ----
  const same = (a, b) => String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();
  const timing = { calls: 0, ms: 0, failures: 0 };

  async function judgeWithTiming(claim, evidence) {
    const started = performance.now();
    timing.calls++;
    try {
      return await AH.aiJudge.judge(claim, evidence);
    } catch (error) {
      timing.failures++;
      throw error;
    } finally {
      timing.ms += performance.now() - started;
    }
  }

  async function runCase(testCase) {
    const history = testCase.history || [];
    const lastUser = [...history].reverse().find((turn) => turn.role === "user");
    const settings = pipeline.mergeSettings({ onDeviceAI: true, sources: { links: false, wikipedia: true, webSearch: false, pages: false } });
    const result = await pipeline.checkAnswer(
      { site: "chatgpt", question: lastUser ? lastUser.text : "", answerText: testCase.answer, links: [], history },
      { settings, aiAvailable: AH.aiJudge.available, aiJudge: judgeWithTiming },
    );
    const expect = testCase.expect || {};
    const annotations = result.annotations || [];
    const consistency = result.consistency || [];
    const statusOf = (sentence) => (annotations.find((a) => same(a.sentence, sentence)) || {}).status || "none";
    const counts = {};
    const problems = [];
    const bump = (key) => (counts[key] = (counts[key] || 0) + 1);

    for (const sentence of expect.hallucinated || []) {
      bump("hallucinatedExpected");
      if (statusOf(sentence) === "contradicted") bump("hallucinatedCaught");
      else if (statusOf(sentence) === "supported") {
        bump("falseAccept");
        problems.push(`FALSE ACCEPT ✓ (should be ✕): ${sentence}`);
      } else problems.push(`missed ✕ (got ${statusOf(sentence)}): ${sentence}`);
    }
    for (const sentence of expect.confirmed || []) {
      bump("confirmedExpected");
      if (statusOf(sentence) === "supported") bump("confirmedHit");
      else problems.push(`missed ✓ (got ${statusOf(sentence)}): ${sentence}`);
    }
    for (const want of expect.consistency || []) {
      bump("consistencyExpected");
      const got = consistency.find((item) => same(item.sentence, want.sentence));
      if (got && got.type === want.type) bump("consistencyHit");
      else if (got) {
        bump("consistencyWrongType");
        problems.push(`wrong type ${got.type} (want ${want.type}): ${want.sentence}`);
      } else problems.push(`missed ${want.type}: ${want.sentence}`);
    }
    for (const annotation of annotations) {
      if (annotation.status === "contradicted" && !(expect.hallucinated || []).some((s) => same(s, annotation.sentence))) {
        bump("falseAlarm");
        problems.push(`FALSE ALARM ✕ (${annotation.judge}): ${annotation.sentence} | ${annotation.note}`);
      }
    }
    for (const item of consistency) {
      if (!(expect.consistency || []).some((want) => same(want.sentence, item.sentence))) {
        bump("falseAlarm");
        problems.push(`FALSE ALARM ${item.type}: ${item.sentence} | ${item.note}`);
      }
    }
    const errors = Object.entries(result.errors || {}).filter(([name]) => name !== "wikipedia" && name !== "wikidata");
    if (errors.length) problems.push(`errors: ${JSON.stringify(Object.fromEntries(errors))}`);
    return { counts, problems };
  }

  async function runSet(name, cases) {
    out.textContent = "";
    if ((await showStatus()) !== "available") {
      log("The model isn't available yet: download it first.");
      return;
    }
    await loadCache();
    Object.assign(timing, { calls: 0, ms: 0, failures: 0 });
    const totals = {};
    const started = performance.now();
    log(`${name}: ${cases.length} cases, on-device AI on\n`);
    for (const testCase of cases) {
      const { counts, problems } = await runCase(testCase);
      for (const [key, n] of Object.entries(counts)) totals[key] = (totals[key] || 0) + n;
      log(`${problems.length ? "✕" : "✓"} ${testCase.id}`);
      problems.forEach((p) => log(`    ${p}`));
    }
    const t = (key) => totals[key] || 0;
    log("");
    log(`FALSE ACCEPTS: ${t("falseAccept")} (must be 0)`);
    log(`FALSE ALARMS: ${t("falseAlarm")} (must be 0)`);
    log(`Pasted text, hallucinations caught: ${t("hallucinatedCaught")}/${t("hallucinatedExpected")}`);
    log(`Pasted text, statements confirmed: ${t("confirmedHit")}/${t("confirmedExpected")}`);
    log(`Consistency warnings found: ${t("consistencyHit")}/${t("consistencyExpected")} (wrong type: ${t("consistencyWrongType")})`);
    log(`On-device AI: ${timing.calls} questions, ${timing.failures} failed, ${(timing.ms / Math.max(1, timing.calls) / 1000).toFixed(2)} s each on average`);
    log(`Total time: ${((performance.now() - started) / 1000).toFixed(0)} s`);
    window.__validation = { name, totals, timing: { ...timing }, text: out.textContent };
  }

  $("run1").addEventListener("click", () => runSet("Set 1", window.CASES_1));
  $("run2").addEventListener("click", () => runSet("Set 2", window.CASES_2));
  $("run3").addEventListener("click", () => runSet("Set 3", window.CASES_3));
  showStatus();
})();
