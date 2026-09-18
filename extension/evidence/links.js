/**
 * Fake link detector.
 *
 * For each link in an AI answer:
 * - not_found:   the page is a 404/410, or a "page not found" page. The AI likely invented it.
 * - unreachable: blocked (e.g. 403), timed out or failed. We couldn't check it; it isn't necessarily fake.
 * - mismatch:    the page loads but says something that conflicts with the sentence it's attached to.
 * - skipped:     no permission for that site, a link back to the chat site, or over the per-answer limit.
 * - ok:          the page loads and supports the sentence (or there's no sentence to compare).
 * Loaded pages are also returned as evidence for the rest of the check.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const TIMEOUT_MS = 8000;
  const MAX_LINKS = 8;
  const CONCURRENCY = 4;
  const MAX_BYTES = 5 * 1024 * 1024;
  const CHAT_HOSTS = /(^|\.)(chatgpt\.com|openai\.com|claude\.ai|gemini\.google\.com)$/i;
  const SOFT_404 = /\b(404|page not found|not found|page (?:doesn't|does not|no longer) exist|no longer available|page unavailable)\b/i;

  function defaultHasPermission(origin) {
    if (typeof chrome === "undefined" || !chrome.permissions) return Promise.resolve(true);
    return chrome.permissions.contains({ origins: [`${origin}/*`] });
  }

  function sentenceFor(link, answerText) {
    const text = String(answerText || "");
    const needle = (link.text || "").trim();
    const sentences = AH.claims && AH.claims.splitSentences ? AH.claims.splitSentences(text) : text.split(/(?<=[.!?])\s+/);
    const match = sentences.find((s) => (needle && s.includes(needle)) || s.includes(link.url));
    return match ? match.trim() : "";
  }

  async function fetchPage(url, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        credentials: "omit",
        signal: controller.signal,
        headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Compares the page with the sentence the link is attached to.
   * Only a conflict counts as "mismatch": word matching rarely confirms a paraphrase,
   * so "the page doesn't mention it" would otherwise flag almost every real link.
   */
  function compare(sentence, page) {
    const unknown = { status: "ok", confirmed: false, note: "" };
    if (!sentence || !AH.claims || !AH.verifier) return unknown;
    const claims = AH.claims.extract(sentence).filter((claim) => claim.weight !== 0);
    if (!claims.length) return unknown;

    const passages = AH.pipeline && AH.pipeline.toPassages ? AH.pipeline.toPassages([page]) : [page];
    const verdicts = claims.map((claim) => AH.verifier.verifyClaim(claim, passages));
    const conflict = verdicts.find((verdict) => verdict.status === "contradicted");
    if (conflict) {
      return { status: "mismatch", confirmed: false, note: `The page conflicts with this sentence: ${conflict.reasoning}` };
    }
    if (verdicts.some((verdict) => verdict.status === "supported")) {
      return { status: "ok", confirmed: true, note: "The page backs up this sentence." };
    }
    return { ...unknown, note: "The page exists, but it doesn't clearly confirm this sentence." };
  }

  async function checkOne(link, index, options) {
    const sentence = sentenceFor(link, options.answerText);
    const result = { url: link.url, status: "skipped", httpStatus: null, title: "", sentence, note: "" };

    let parsed;
    try {
      parsed = new URL(link.url);
    } catch (error) {
      return { ...result, status: "not_found", note: "This isn't a valid web address." };
    }
    if (CHAT_HOSTS.test(parsed.hostname)) return { ...result, note: "Link to the chat site itself." };
    if (!(await options.hasPermission(parsed.origin))) {
      return { ...result, note: "Allow link checking in the extension's options to check this link." };
    }

    let response;
    try {
      response = await fetchPage(link.url, options.fetch, options.timeoutMs);
    } catch (error) {
      const timedOut = error && error.name === "AbortError";
      return { ...result, status: "unreachable", note: timedOut ? "The page took too long to respond." : "The site couldn't be reached. The address may be wrong." };
    }

    result.httpStatus = response.status;
    if (response.status === 404 || response.status === 410) {
      return { ...result, status: "not_found", note: `The page doesn't exist (HTTP ${response.status}). The AI may have made up this link.` };
    }
    if (!response.ok) {
      return { ...result, status: "unreachable", note: `The site refused the check (HTTP ${response.status}), so this link couldn't be verified.` };
    }

    const type = (response.headers.get("content-type") || "").toLowerCase();
    const size = Number(response.headers.get("content-length") || 0);
    if (!/text\/html|text\/plain|application\/xhtml/.test(type) || size > MAX_BYTES) {
      return { ...result, status: "ok", note: "The page exists, but its content can't be read for checking." };
    }

    const body = await response.text();
    const page = /text\/plain/.test(type) ? { title: "", text: body } : await options.parseHtml(body, link.url);
    const title = (page && page.title) || "";
    const text = (page && page.text) || "";

    if (SOFT_404.test(title) || (text.length < 600 && SOFT_404.test(text))) {
      return { ...result, title, status: "not_found", note: "The page says it doesn't exist. The AI may have made up this link." };
    }

    const evidence = text.trim()
      ? { id: `link:${index + 1}`, text, source: title || parsed.hostname, url: response.url || link.url, kind: "link" }
      : null;
    // The link's own label ("source", "Wikipedia") isn't part of the claim
    const claimText = link.text ? sentence.split(link.text.trim()).join(" ") : sentence;
    const comparison = evidence ? compare(claimText, evidence) : { status: "ok", confirmed: false, note: "" };
    return { linkCheck: { ...result, title, ...comparison }, evidence };
  }

  async function check(links, options) {
    const settings = {
      answerText: "",
      fetch: typeof fetch === "function" ? fetch.bind(root) : null,
      parseHtml: async (html) => ({ title: "", text: String(html).replace(/<[^>]+>/g, " ") }),
      hasPermission: defaultHasPermission,
      timeoutMs: TIMEOUT_MS,
      maxLinks: MAX_LINKS,
      concurrency: CONCURRENCY,
      ...(options || {}),
    };
    const list = (Array.isArray(links) ? links : []).map((link) => (typeof link === "string" ? { url: link, text: "" } : link));

    const linkChecks = new Array(list.length);
    const evidence = [];
    let next = 0;
    async function worker() {
      while (next < list.length) {
        const index = next++;
        if (index >= settings.maxLinks) {
          linkChecks[index] = { url: list[index].url, status: "skipped", httpStatus: null, title: "", sentence: sentenceFor(list[index], settings.answerText), note: "Too many links in one answer; only the first ones were checked." };
          continue;
        }
        try {
          const outcome = await checkOne(list[index], index, settings);
          linkChecks[index] = outcome.linkCheck || outcome;
          if (outcome.evidence) evidence.push(outcome.evidence);
        } catch (error) {
          linkChecks[index] = { url: list[index].url, status: "unreachable", httpStatus: null, title: "", sentence: "", note: `The check failed: ${(error && error.message) || error}` };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(settings.concurrency, list.length) }, worker));
    return { linkChecks, evidence };
  }

  AH.links = { check };

  if (typeof module !== "undefined") {
    module.exports = AH.links;
  }
})(globalThis);
