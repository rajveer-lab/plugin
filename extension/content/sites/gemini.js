/**
 * Gemini Site Adapter (gemini.google.com)
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});
  AH.sites = AH.sites || {};

  function unwrapGoogleRedirect(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, "https://gemini.google.com");
      if (parsed.hostname.includes("google.") && parsed.pathname.includes("/url")) {
        const real = parsed.searchParams.get("q") || parsed.searchParams.get("url");
        if (real) return decodeURIComponent(real);
      }
    } catch (_) {}
    return url;
  }

  const gemini = {
    id: "gemini",

    matches(location) {
      const host = (location && location.hostname) || "";
      return host.includes("gemini.google.com");
    },

    getPromptInput() {
      return (
        document.querySelector('rich-textarea [contenteditable="true"]') ||
        document.querySelector('.ql-editor[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector("textarea")
      );
    },

    readPrompt(el) {
      if (!el) return "";
      if (el.tagName === "TEXTAREA" || el.value !== undefined) {
        return el.value || "";
      }
      return el.innerText || el.textContent || "";
    },

    writePrompt(el, text) {
      if (!el) return;
      if (el.tagName === "TEXTAREA" || el.value !== undefined) {
        el.value = text;
      } else {
        el.innerText = text;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },

    observeAnswers(callback) {
      let lastReportedTexts = new WeakMap();
      let settleTimer = null;

      function extractResponseText(container) {
        if (!container) return "";
        const clone = container.cloneNode(true);
        const overlays = clone.querySelectorAll(
          ".ah-report-banner, .ah-banner, .ah-link-badge, .ah-booster-btn, .ah-prompt-warning, " +
          "response-action-bar, .response-action-bar, .actions-container, .model-actions, mat-icon, button"
        );
        for (const o of overlays) o.remove();
        return (clone.innerText || clone.textContent || "").trim();
      }

      function extractLinks(container) {
        const links = [];
        const seenUrls = new Set();

        function addLink(rawUrl, text) {
          if (!rawUrl) return;
          const url = unwrapGoogleRedirect(rawUrl);
          if ((url.startsWith("http://") || url.startsWith("https://")) && !seenUrls.has(url)) {
            if (url.includes("gemini.google.com") || url.includes("accounts.google.com")) {
              return;
            }
            seenUrls.add(url);
            links.push({ url, text: (text || "").trim() });
          }
        }

        // Search both container and its full turn context (including sources carousel / drawer)
        const searchRoots = new Set(
          [
            container,
            container.parentElement,
            container.closest(".conversation-container, .turn-container, .chat-turn, model-turn, [data-message-id], .model-response-container"),
          ].filter(Boolean)
        );

        for (const root of searchRoots) {
          // 1. Anchors
          const anchors = root.querySelectorAll("a[href]");
          for (const a of anchors) {
            const raw = a.getAttribute("href") || a.href;
            const text = a.textContent || a.getAttribute("title") || a.getAttribute("aria-label") || "";
            addLink(raw, text);
          }

          // 2. Data attributes and citation/source elements
          const chipEls = root.querySelectorAll(
            "[data-url], [data-href], [data-source-url], [data-citation-url], [data-original-url], [data-destination-url], [data-target-url], [url], " +
            "citation-chip, grounding-chip, source-chip, mat-chip, .source-chip, .gds-chip, .citation, .source-item, .citation-item, grounding-source, " +
            ".sources-carousel *, sources-carousel *, .sources-list *, sources-list *, .sources-panel *, sources-panel *, grounding-drawer *"
          );
          for (const el of chipEls) {
            const raw =
              el.getAttribute("data-url") ||
              el.getAttribute("data-href") ||
              el.getAttribute("data-source-url") ||
              el.getAttribute("data-citation-url") ||
              el.getAttribute("data-original-url") ||
              el.getAttribute("data-destination-url") ||
              el.getAttribute("data-target-url") ||
              el.getAttribute("url") ||
              el.getAttribute("href") ||
              el.href;
            const text = el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "";
            addLink(raw, text);
          }
        }

        return links;
      }

      function findPrecedingQuestion(modelTurn) {
        let prev = modelTurn.previousElementSibling;
        while (prev) {
          const query = prev.querySelector("user-query, .query-text, .user-query-container");
          if (query) {
            return (query.innerText || query.textContent || "").trim();
          }
          if (prev.tagName && prev.tagName.toLowerCase() === "user-query") {
            return (prev.innerText || prev.textContent || "").trim();
          }
          prev = prev.previousElementSibling;
        }
        return "";
      }

      function checkTurns() {
        const isStreaming = Boolean(
          document.querySelector(
            'button[aria-label*="Stop"], button[aria-label*="stop"], mat-progress-bar, [role="progressbar"], .loading-spinner, .sparkle-thinking, .pending-response, [aria-label*="Generating"], .streaming'
          )
        );
        if (isStreaming) {
          // Clear previous banners on the actively generating model turn
          const activeBanners = document.querySelectorAll(
            "model-response:last-of-type .ah-report-banner, model-response:last-of-type .ah-banner"
          );
          for (const b of activeBanners) b.remove();
          return; // Wait until response finishes streaming
        }

        // Select distinct top-level model responses
        const modelResponses = document.querySelectorAll("model-response");
        const targets =
          modelResponses.length > 0 ? modelResponses : document.querySelectorAll(".model-response-text, message-content.model");

        for (const resp of targets) {
          // Identify primary content container inside this response
          const primaryContainer =
            resp.querySelector(".response-container, .model-response-container, .response-content") ||
            resp;

          const text = extractResponseText(primaryContainer || resp);

          if (text.length > 20) {
            const prevText = lastReportedTexts.get(primaryContainer);
            if (prevText === text) {
              continue; // Already processed this settled text
            }

            lastReportedTexts.set(primaryContainer, text);
            console.log(`[AH] gemini: answer of ${text.length} chars`);

            const links = extractLinks(resp);
            const question = findPrecedingQuestion(resp.closest(".conversation-container") || resp);

            callback({
              element: primaryContainer,
              text: text,
              links: links,
              question: question,
            });
          }
        }
      }

      const observer = new MutationObserver(() => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(checkTurns, 600);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      checkTurns();

      return function stop() {
        if (settleTimer) clearTimeout(settleTimer);
        observer.disconnect();
      };
    },
  };

  AH.sites.gemini = gemini;
  if (typeof module !== "undefined") {
    module.exports = gemini;
  }
})(globalThis);
