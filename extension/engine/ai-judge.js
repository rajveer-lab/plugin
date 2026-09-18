/**
 * On-device AI judge (Chrome's built-in Prompt API / Gemini Nano).
 *
 * Asks the local model whether a few relevant passages support, contradict, or don't
 * address a claim. Nothing leaves the computer. If the model isn't available, the
 * pipeline keeps the heuristic verdict.
 *
 * Guards against the model accepting false claims (zero false accepts):
 * - "supported" or "contradicted" must cite a real passage, or the verdict becomes "unsupported".
 * - "supported" is downgraded if a number or year in the claim doesn't appear in the cited passage.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const MAX_PASSAGES = 3;
  const TIMEOUT_MS = 20000;
  const CONFIDENCE = { supported: 0.85, contradicted: 0.85, unsupported: 0.5 };
  const LANGUAGE = [{ type: "text", languages: ["en"] }];
  const STOPWORDS = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "with", "by", "from", "of", "and", "or", "is", "was", "are", "were", "be", "been", "it", "this", "that"]);

  const SYSTEM_PROMPT = [
    "You are a strict fact-checking judge. You compare one CLAIM with numbered SOURCE passages.",
    "Decide only from the passages. Never use your own knowledge.",
    "- supported: a passage clearly states the claim (a paraphrase is fine). Every name, number and date in the claim must match the passage.",
    "- contradicted: a passage clearly states something incompatible with the claim, such as a different name, place, number or date for the same thing, or the opposite.",
    "- unsupported: the passages don't clearly say either way.",
    "If you are unsure, answer unsupported. Set source to the passage number you relied on, or 0 for unsupported.",
  ].join("\n");

  function tokens(text) {
    return ((text || "").toLowerCase().match(/\b[a-z0-9]+\b/g) || []).filter((w) => !STOPWORDS.has(w));
  }

  /** Picks the passages most likely to decide the claim (by shared words). */
  function selectEvidence(claim, evidence, max) {
    const claimTokens = new Set(tokens(claim && claim.text));
    return (Array.isArray(evidence) ? evidence : [])
      .map((item) => {
        const passageTokens = new Set(tokens(item.text));
        let score = 0;
        for (const token of claimTokens) if (passageTokens.has(token)) score++;
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max || MAX_PASSAGES)
      .map(({ item }) => item);
  }

  function buildPrompt(claim, passages) {
    const sources = passages.map((p, i) => `[${i + 1}] ${String(p.text).replace(/\s+/g, " ").trim()}`).join("\n");
    return `CLAIM: ${claim.text}\n\nSOURCES:\n${sources}`;
  }

  function responseSchema(passageCount) {
    return {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["supported", "contradicted", "unsupported"] },
        source: { type: "integer", minimum: 0, maximum: passageCount },
        reason: { type: "string" },
      },
      required: ["verdict", "source", "reason"],
      additionalProperties: false,
    };
  }

  function numbersIn(text) {
    return (String(text || "").match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));
  }

  /** Turns the model's reply into a Verdict, applying the guards. Returns null if unreadable. */
  function parseResponse(reply, claim, passages) {
    let data = reply;
    if (typeof reply === "string") {
      try {
        data = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
      } catch (error) {
        return null;
      }
    }
    if (!data || !["supported", "contradicted", "unsupported"].includes(data.verdict)) return null;

    let status = data.verdict;
    let reason = String(data.reason || "").trim();
    const passage = Number.isInteger(data.source) && data.source >= 1 ? passages[data.source - 1] : null;

    if (status !== "unsupported" && !passage) {
      status = "unsupported";
      reason = "The AI's answer didn't point to a source passage.";
    }
    if (status === "supported") {
      const passageNumbers = new Set(numbersIn(passage.text));
      const missing = numbersIn(claim.text).filter((n) => !passageNumbers.has(n));
      if (missing.length) {
        status = "unsupported";
        reason = `The AI said supported, but ${missing.join(", ")} doesn't appear in the source.`;
      }
    }

    const cited = status === "unsupported" ? null : passage;
    return {
      claimId: claim.id,
      claimText: claim.text,
      status,
      confidence: CONFIDENCE[status],
      weight: typeof claim.weight === "number" ? claim.weight : 1,
      evidenceId: cited ? cited.id : null,
      evidenceText: cited ? cited.text : null,
      evidenceUrl: cited ? cited.url || null : null,
      reasoning: `On-device AI: ${reason || status}`,
      judge: "on-device-ai",
      checkedAt: new Date().toISOString(),
    };
  }

  function createJudge(options) {
    const settings = { LanguageModel: root.LanguageModel, timeoutMs: TIMEOUT_MS, ...(options || {}) };
    let baseSession = null;

    function api() {
      return settings.LanguageModel || root.LanguageModel;
    }

    /** "unsupported" (no Prompt API), or the API's "unavailable" | "downloadable" | "downloading" | "available". */
    async function status() {
      const model = api();
      if (!model || typeof model.availability !== "function") return "unsupported";
      try {
        return await model.availability({ expectedInputs: LANGUAGE, expectedOutputs: LANGUAGE });
      } catch (error) {
        return "unavailable";
      }
    }

    async function available() {
      return (await status()) === "available";
    }

    /** Downloads the model. Must be called from a user click (e.g. in Options). onProgress gets 0..1. */
    async function prepare(onProgress) {
      const model = api();
      if (!model) throw new Error("This version of Chrome doesn't have built-in AI.");
      const session = await model.create({
        expectedInputs: LANGUAGE,
        expectedOutputs: LANGUAGE,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => onProgress && onProgress(event.loaded));
        },
      });
      session.destroy();
      return status();
    }

    async function session() {
      if (!baseSession) {
        baseSession = await api().create({
          initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
          expectedInputs: LANGUAGE,
          expectedOutputs: LANGUAGE,
        });
      }
      // A fresh copy per claim so earlier claims don't influence later ones
      return baseSession.clone ? baseSession.clone() : baseSession;
    }

    async function judge(claim, evidence) {
      const passages = selectEvidence(claim, evidence);
      if (!passages.length || !(await available())) return null;

      const judgeSession = await session();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      try {
        const reply = await judgeSession.prompt(buildPrompt(claim, passages), {
          responseConstraint: responseSchema(passages.length),
          signal: controller.signal,
        });
        return parseResponse(reply, claim, passages);
      } finally {
        clearTimeout(timer);
        if (judgeSession !== baseSession && judgeSession.destroy) judgeSession.destroy();
      }
    }

    return { status, available, prepare, judge };
  }

  AH.aiJudge = { ...createJudge(), createJudge, selectEvidence, buildPrompt, parseResponse, SYSTEM_PROMPT };

  if (typeof module !== "undefined") {
    module.exports = AH.aiJudge;
  }
})(globalThis);
