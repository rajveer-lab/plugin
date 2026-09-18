/**
 * Claude Site Adapter (claude.ai)
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});
  AH.sites = AH.sites || {};

  function unwrapRedirect(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, "https://claude.ai");
      if (parsed.hostname.includes("google.") && parsed.pathname.includes("/url")) {
        const real = parsed.searchParams.get("q") || parsed.searchParams.get("url");
        if (real) return decodeURIComponent(real);
      }
    } catch (_) {}
    return url;
  }

  const claude = {
    id: "claude",

    matches(location) {
      const host = (location && location.hostname) || "";
      return host.includes("claude.ai");
    },

    getPromptInput() {
      return (
        document.querySelector('div[contenteditable="true"].ProseMirror') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector("fieldset [contenteditable='true']") ||
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
      const seenElements = new WeakSet();
      let settleTimer = null;

      function extractLinks(container) {
        const anchors = container.querySelectorAll("a[href], [data-url], [data-href]");
        const links = [];
        const seen = new Set();
        for (const a of anchors) {
          const raw =
            a.getAttribute("href") ||
            a.href ||
            a.getAttribute("data-url") ||
            a.getAttribute("data-href");
          const href = unwrapRedirect(raw);
          if (href && (href.startsWith("http://") || href.startsWith("https://")) && !seen.has(href)) {
            if (href.includes("claude.ai")) continue;
            seen.add(href);
            links.push({ url: href, text: (a.textContent || a.getAttribute("title") || "").trim() });
          }
        }
        return links;
      }

      function findPrecedingQuestion(turn) {
        let prev = turn.previousElementSibling;
        while (prev) {
          const userMsg =
            prev.querySelector('[data-testid="user-message"]') || prev.querySelector(".font-user-message");
          if (userMsg) {
            return userMsg.textContent.trim();
          }
          prev = prev.previousElementSibling;
        }
        return "";
      }

      function checkTurns() {
        const streamingEl = document.querySelector('[data-is-streaming="true"]');
        if (streamingEl) {
          return; // Still generating
        }

        const assistantTurns = document.querySelectorAll(
          '[data-is-streaming="false"], .font-claude-message, [data-testid="assistant-message"], .standard-markdown'
        );

        for (const turn of assistantTurns) {
          const contentEl = turn.querySelector(".standard-markdown, .prose") || turn;
          if (contentEl && !seenElements.has(contentEl) && contentEl.textContent.trim().length > 10) {
            seenElements.add(contentEl);
            const text = contentEl.textContent.trim();
            const links = extractLinks(contentEl);
            const question = findPrecedingQuestion(turn.closest('[data-testid^="chat-turn"]') || turn);
            callback({
              element: contentEl,
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

  AH.sites.claude = claude;
  if (typeof module !== "undefined") {
    module.exports = claude;
  }
})(globalThis);
