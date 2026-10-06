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
      if (parsed.hostname.includes("google.")) {
        const real =
          parsed.searchParams.get("q") ||
          parsed.searchParams.get("url") ||
          parsed.searchParams.get("target") ||
          parsed.searchParams.get("dest");
        if (real && (real.startsWith("http://") || real.startsWith("https://"))) {
          return decodeURIComponent(real);
        }
      }
    } catch (_) {}
    const match = url.match(/[?&](?:url|q|target|dest)=(https?%3A%2F%2F[^&]+|https?:\/\/[^&]+)/i);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (_) {
        return match[1];
      }
    }
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
      if (typeof el.focus === "function") el.focus();

      if (el.tagName === "TEXTAREA" || el.value !== undefined) {
        if (typeof el.select === "function") el.select();
        let ok = false;
        try {
          ok = document.execCommand("insertText", false, text);
        } catch (_) {}
        if (!ok || el.value !== text) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
          if (setter && setter.set) {
            setter.set.call(el, text);
          } else {
            el.value = text;
          }
          try {
            el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
          } catch (_) {}
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }

      // Contenteditable / rich-textarea
      let execOk = false;
      try {
        const sel = window.getSelection ? window.getSelection() : null;
        if (sel && document.createRange) {
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          execOk = document.execCommand("insertText", false, text);
        }
      } catch (_) {}

      if (!execOk) {
        el.innerText = text;
        try {
          el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
        } catch (_) {}
        try {
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        } catch (_) {}
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },

    observeAnswers(callback) {
      let lastReportedTexts = new WeakMap();
      let settleTimer = null;

      const BLOCK_TAGS = new Set([
        "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
        "TR", "BR", "BLOCKQUOTE", "SECTION", "ARTICLE", "TABLE", "HEADER", "FOOTER"
      ]);

      const IGNORE_SELECTORS =
        ".ah-summary, .ah-chip, .ah-panel, .ah-tooltip, .ah-convo-badge, .ah-link-badge, " +
        ".ah-report-banner, .ah-banner, " +
        "response-action-bar, .response-action-bar, .actions-container, .model-actions, mat-icon, button, [role=\"button\"]";

      function extractResponseText(container) {
        if (!container) return "";

        function walk(node) {
          if (!node) return "";
          if (node.nodeType === 1) { // ELEMENT_NODE
            if (node.matches && node.matches(IGNORE_SELECTORS)) {
              return "";
            }
            if (node.closest && node.closest(".ah-summary, .ah-tooltip, response-action-bar, .actions-container")) {
              return "";
            }
            if (node.tagName === "BR") {
              return "\n";
            }
            let text = "";
            for (let i = 0; i < node.childNodes.length; i++) {
              text += walk(node.childNodes[i]);
            }
            if (BLOCK_TAGS.has(node.tagName)) {
              return "\n" + text + "\n";
            }
            return text;
          } else if (node.nodeType === 3) { // TEXT_NODE
            return node.nodeValue || "";
          }
          return "";
        }

        const raw = walk(container);
        return raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n");
      }

      function extractLinks(container) {
        const links = [];
        const seenUrls = new Set();

        function addLink(rawUrl, text) {
          if (!rawUrl) return;
          const url = unwrapGoogleRedirect(rawUrl);
          if ((url.startsWith("http://") || url.startsWith("https://")) && !seenUrls.has(url)) {
            if (
              url.includes("gemini.google.com") ||
              url.includes("accounts.google.com") ||
              url.includes("policies.google.com") ||
              url.includes("support.google.com")
            ) {
              return;
            }
            seenUrls.add(url);
            links.push({ url, text: (text || "").trim() });
          }
        }

        function extractUrlFromString(str) {
          if (!str) return null;
          const m = str.match(/https?:\/\/[^\s"'`<>]+/i);
          return m ? m[0] : null;
        }

        // Search both container and its turn context
        const searchRoots = new Set(
          [
            container,
            container.parentElement,
            container.closest(".conversation-container, .turn-container, .chat-turn, model-turn, [data-message-id], .model-response-container, chat-window"),
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
            "[data-url], [data-href], [data-source-url], [data-citation-url], [data-original-url], [data-destination-url], [data-target-url], [data-external-link], [url], " +
            "citation-chip, grounding-chip, source-chip, mat-chip, .source-chip, .gds-chip, .citation, .source-item, .citation-item, grounding-source, " +
            ".sources-carousel *, sources-carousel *, .sources-list *, sources-list *, .sources-panel *, sources-panel *, grounding-drawer *"
          );
          for (const el of chipEls) {
            let raw =
              el.getAttribute("data-url") ||
              el.getAttribute("data-href") ||
              el.getAttribute("data-source-url") ||
              el.getAttribute("data-citation-url") ||
              el.getAttribute("data-original-url") ||
              el.getAttribute("data-destination-url") ||
              el.getAttribute("data-target-url") ||
              el.getAttribute("data-external-link") ||
              el.getAttribute("url") ||
              el.getAttribute("href") ||
              el.href;

            if (!raw) {
              const childAnchor = el.querySelector("a[href], [data-url], [data-href], [data-source-url]");
              if (childAnchor) {
                raw = childAnchor.getAttribute("href") || childAnchor.href || childAnchor.getAttribute("data-url") || childAnchor.getAttribute("data-href");
              }
            }

            if (!raw) {
              raw = extractUrlFromString(el.getAttribute("aria-label")) || extractUrlFromString(el.getAttribute("title"));
            }

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

      function buildHistory(answerTurn) {
        if (!AH.siteHistory || typeof AH.siteHistory.build !== "function") return [];
        const selector = "model-response, model-response-text, message-content.model, user-query, .query-text, .user-query-container";
        const candidates = [...document.querySelectorAll(selector)].map((el) => {
          const user = el.matches("user-query, .query-text, .user-query-container");
          const container = el.closest(".conversation-container, .turn-container, .chat-turn, model-turn, [data-message-id]") || el;
          const content = user ? el : el.querySelector(".response-container, .model-response-container, .response-content, .markdown") || el;
          return { el, container, content, role: user ? "user" : "assistant" };
        }).filter((item) => {
          if (item.el.contains(answerTurn) || answerTurn.contains(item.el) || item.container.contains(answerTurn) || answerTurn.contains(item.container)) return false;
          return answerTurn.compareDocumentPosition(item.container) & Node.DOCUMENT_POSITION_PRECEDING;
        }).filter((item, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.role === item.role && (item.el.contains(other.el) || item.container !== other.container && item.container.contains(other.container))))
          .map((item) => ({ role: item.role, text: extractResponseText(item.content), element: item.el }))
          .sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const unique = turns.filter((turn, index) => index === 0 || turn.element !== turns[index - 1].element);
        return AH.siteHistory.build(unique.map(({ role, text }) => ({ role, text })));
      }

      const SETTLE_MS = 1500; // an answer is finished once its text stops changing for this long
      const pending = new WeakMap();

      // Only a visible stop button means Gemini is writing; it keeps hidden progress bars around
      function generating() {
        return [...document.querySelectorAll('button[aria-label*="Stop" i]')].some((button) => button.offsetParent !== null);
      }

      function checkTurns() {
        const busy = generating();
        const responses = document.querySelectorAll("model-response");
        const targets = [...(responses.length > 0 ? responses : document.querySelectorAll(".model-response-text, message-content.model"))];
        const now = Date.now();

        targets.forEach((resp, index) => {
          // Identify primary content container inside this response
          const primaryContainer =
            resp.querySelector(".response-container, .model-response-container, .response-content, .markdown") ||
            resp;
          const text = extractResponseText(primaryContainer);
          if (text.length <= 20) return;
          if (lastReportedTexts.get(primaryContainer) === text) return; // already checked this text

          const entry = pending.get(primaryContainer);
          if (!entry || entry.text !== text) {
            pending.set(primaryContainer, { text, since: now });
            return;
          }
          // The stop button only means the newest answer is still being written
          if (now - entry.since < SETTLE_MS || (busy && index === targets.length - 1)) return;

          lastReportedTexts.set(primaryContainer, text);
          pending.delete(primaryContainer);
          console.log(`[AH] gemini: answer of ${text.length} chars`);
          callback({
            element: primaryContainer,
            text: text,
            links: extractLinks(resp),
            question: findPrecedingQuestion(resp.closest(".conversation-container") || resp),
            history: buildHistory(resp),
          });
        });
      }

      // Throttled, not debounced: Gemini's page rarely goes fully quiet
      const observer = new MutationObserver(() => {
        if (settleTimer) return;
        settleTimer = setTimeout(() => {
          settleTimer = null;
          checkTurns();
        }, 300);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // "Finished" is about time passing, so also look again regularly, and once right away
      const timer = setInterval(checkTurns, 1000);
      checkTurns();

      return function stop() {
        if (settleTimer) clearTimeout(settleTimer);
        clearInterval(timer);
        observer.disconnect();
      };
    },
  };

  AH.sites.gemini = gemini;
  if (typeof module !== "undefined") {
    module.exports = gemini;
  }
})(globalThis);
