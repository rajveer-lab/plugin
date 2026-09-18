/* Offscreen helper document.
 *
 * The service worker has no DOMParser and may not expose Chrome's built-in AI,
 * so it sends these jobs here:
 *   PARSE_HTML   { html, url }       -> { title, text }
 *   AI_AVAILABLE {}                  -> { available }
 *   AI_JUDGE     { claim, evidence } -> { verdict }
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const MAX_HTML_CHARS = 2_000_000;
  const MAX_TEXT_CHARS = 200_000;
  const NOISE = "script, style, noscript, template, svg, canvas, iframe, form, nav, header, footer, aside, [aria-hidden='true']";
  const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, pre, figcaption, caption, tr, div, section, article, br";

  function parseHtml(html, url) {
    const doc = new DOMParser().parseFromString(String(html || "").slice(0, MAX_HTML_CHARS), "text/html");
    const title = (doc.querySelector("title") || {}).textContent || "";
    doc.querySelectorAll(NOISE).forEach((el) => el.remove());

    const main = doc.querySelector("main, article, [role='main']") || doc.body;
    if (!main) return { title: title.trim(), text: "" };

    // Keep block boundaries so words from neighbouring elements don't run together
    main.querySelectorAll(BLOCKS).forEach((el) => el.append("\n"));
    const text = main.textContent
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_CHARS);

    return { title: title.replace(/\s+/g, " ").trim(), text, url };
  }

  AH.offscreen = { parseHtml };
  if (typeof module !== "undefined") module.exports = AH.offscreen;

  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.onMessage) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return false;

    if (message.type === "PARSE_HTML") {
      try {
        sendResponse(parseHtml(message.html, message.url));
      } catch (error) {
        sendResponse({ error: String((error && error.message) || error) });
      }
      return false;
    }

    if (message.type === "AI_AVAILABLE" || message.type === "AI_JUDGE") {
      if (!AH.aiJudge) {
        sendResponse(message.type === "AI_AVAILABLE" ? { available: false } : { error: "AI judge isn't built yet." });
        return false;
      }
      const job = message.type === "AI_AVAILABLE"
        ? AH.aiJudge.available().then((available) => ({ available }))
        : AH.aiJudge.judge(message.claim, message.evidence).then((verdict) => ({ verdict }));
      job.then(sendResponse, (error) => sendResponse({ error: String((error && error.message) || error) }));
      return true;
    }

    return false;
  });
})(globalThis);
