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

      // Contenteditable (ProseMirror on claude.ai)
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
      const lastReportedTexts = new WeakMap();
      let settleTimer = null;

      const BLOCK_TAGS = new Set([
        "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
        "TR", "BR", "BLOCKQUOTE", "SECTION", "ARTICLE", "TABLE", "HEADER", "FOOTER"
      ]);

      const IGNORE_SELECTORS =
        ".ah-summary, .ah-chip, .ah-panel, .ah-tooltip, .ah-convo-badge, .ah-link-badge, " +
        ".ah-report-banner, .ah-banner, button, [role=\"button\"]";

      function extractResponseText(container) {
        if (!container) return "";

        function walk(node) {
          if (!node) return "";
          if (node.nodeType === 1) { // ELEMENT_NODE
            if (node.matches && node.matches(IGNORE_SELECTORS)) {
              return "";
            }
            if (node.closest && node.closest(".ah-summary, .ah-tooltip")) {
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
        const anchors = container.querySelectorAll("a[href], [data-url], [data-href], [data-external-link]");
        const links = [];
        const seen = new Set();
        for (const a of anchors) {
          const raw =
            a.getAttribute("href") ||
            a.href ||
            a.getAttribute("data-url") ||
            a.getAttribute("data-href") ||
            a.getAttribute("data-external-link");
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
            return (userMsg.innerText || userMsg.textContent || "").trim();
          }
          prev = prev.previousElementSibling;
        }
        return "";
      }

      function buildHistory(assistantTurn) {
        if (!AH.siteHistory || typeof AH.siteHistory.build !== "function") return [];
        const selector = '[data-testid="user-message"], .font-user-message, [data-is-streaming="false"], .font-claude-message, [data-testid="assistant-message"], .standard-markdown';
        const candidates = [...document.querySelectorAll(selector)].map((el) => {
          const user = el.matches('[data-testid="user-message"], .font-user-message');
          const container = el.closest('[data-testid^="chat-turn"]') || el;
          const content = user ? el : container.querySelector(".standard-markdown, .prose") || el;
          return { el, container, content, role: user ? "user" : "assistant" };
        }).filter((item) => {
          if (item.el.contains(assistantTurn) || assistantTurn.contains(item.el) || item.container.contains(assistantTurn) || assistantTurn.contains(item.container)) return false;
          return assistantTurn.compareDocumentPosition(item.container) & Node.DOCUMENT_POSITION_PRECEDING;
        }).filter((item, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.role === item.role && (item.el.contains(other.el) || item.container !== other.container && item.container.contains(other.container))))
          .map((item) => ({ role: item.role, text: extractResponseText(item.content), element: item.el }))
          .sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const unique = turns.filter((turn, index) => index === 0 || turn.element !== turns[index - 1].element);
        return AH.siteHistory.build(unique.map(({ role, text }) => ({ role, text })));
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
          if (contentEl) {
            const text = extractResponseText(contentEl);
            if (text.length > 10) {
              const prevText = lastReportedTexts.get(contentEl);
              if (prevText === text) {
                continue;
              }
              lastReportedTexts.set(contentEl, text);

              const links = extractLinks(contentEl);
          const question = findPrecedingQuestion(turn.closest('[data-testid^="chat-turn"]') || turn);
          const answerTurn = turn.closest('[data-testid^="chat-turn"]') || turn;
          callback({
                element: contentEl,
                text: text,
                links: links,
            question: question,
            history: buildHistory(answerTurn),
              });
            }
          }
        }
      }

      // Throttled, not debounced: a busy page rarely goes fully quiet, so waiting for silence could
      // mean never checking
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

      const timer = setInterval(checkTurns, 1500);
      checkTurns();

      return function stop() {
        if (settleTimer) clearTimeout(settleTimer);
        clearInterval(timer);
        observer.disconnect();
      };
    },
  };

  AH.sites.claude = claude;
  if (typeof module !== "undefined") {
    module.exports = claude;
  }
})(globalThis);
