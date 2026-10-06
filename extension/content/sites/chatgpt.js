/**
 * ChatGPT Site Adapter (chatgpt.com / chat.openai.com)
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});
  AH.sites = AH.sites || {};

  const chatgpt = {
    id: "chatgpt",

    matches(location) {
      const host = (location && location.hostname) || "";
      return host.includes("chatgpt.com") || host.includes("chat.openai.com");
    },

    getPromptInput() {
      return (
        document.querySelector("#prompt-textarea") ||
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

      // Contenteditable (ProseMirror on chatgpt.com)
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
      const seenElements = new WeakSet();

      const BLOCK_TAGS = new Set([
        "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
        "TR", "BR", "BLOCKQUOTE", "SECTION", "ARTICLE", "TABLE", "HEADER", "FOOTER"
      ]);

      const IGNORE_SELECTORS =
        ".ah-summary, .ah-chip, .ah-panel, .ah-tooltip, .ah-convo-badge, .ah-link-badge, " +
        ".ah-report-banner, .ah-banner, button, [role=\"button\"], " +
        // ChatGPT's citation chips ("toureiffel.paris +1") sit inside sentences; they're links, not words
        "a[data-testid=\"chatgpt-citation\"]";

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
        const anchors = container.querySelectorAll("a[href]");
        const links = [];
        for (const a of anchors) {
          const href = a.getAttribute("href");
          if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
            links.push({ url: href, text: a.textContent.trim() });
          }
        }
        return links;
      }

      // ChatGPT's markup keeps changing: older pages mark messages with data-message-author-role or
      // data-turn; the 2026 page marks each turn with a search key ending in :user or :assistant
      const USER_SELECTORS =
        '[data-message-author-role="user"], [data-turn="user"], [data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"]';

      /** The user's message just before this answer, in page order. */
      function findPrecedingQuestion(assistantTurn) {
        const before = [...document.querySelectorAll(USER_SELECTORS)].filter(
          (el) => !el.contains(assistantTurn) && assistantTurn.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING,
        );
        const userMsg = before.filter((el) => !before.some((other) => other !== el && el.contains(other))).pop();
        return userMsg ? (userMsg.innerText || userMsg.textContent || "").replace(/^\s*You said:\s*/i, "").trim() : "";
      }

      function buildHistory(assistantTurn) {
        if (!AH.siteHistory || typeof AH.siteHistory.build !== "function") return [];
        const USER = USER_SELECTORS;
        const candidates = [...document.querySelectorAll(`${TURN_SELECTORS}, ${USER}`)];
        const turns = candidates.map((el) => {
          const isUser = el.matches(USER);
          const role = isUser ? "user" : "assistant";
          const container = el.closest('article[data-turn], [data-testid^="conversation-turn"]') || el;
          return { el, container, role, content: isUser ? el : el.querySelector(CONTENT_SELECTORS) || el };
        }).filter((item) => {
          if (item.el.contains(assistantTurn) || assistantTurn.contains(item.el) || item.container.contains(assistantTurn) || assistantTurn.contains(item.container)) return false;
          return assistantTurn.compareDocumentPosition(item.container) & Node.DOCUMENT_POSITION_PRECEDING;
        }).filter((item, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.role === item.role && (item.el.contains(other.el) || item.container !== other.container && item.container.contains(other.container))))
          .map((item) => ({ role: item.role, text: extractResponseText(item.content), element: item.el }))
          .sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
          .map(({ role, text }) => ({ role, text }));
        return AH.siteHistory.build(turns);
      }

      // ChatGPT has changed its markup over time, so every known shape of an answer is tried
      const TURN_SELECTORS =
        '[data-message-author-role="assistant"], [data-turn="assistant"], .agent-turn, ' +
        '[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"]';
      // The answer's own text, without the hidden "ChatGPT said:" heading
      const CONTENT_SELECTORS = '.markdown, .prose, [class*="markdown"], [data-chatgpt-selection-message-id]';
      const SETTLE_MS = 1500; // an answer is finished once its text stops changing for this long
      const pending = new WeakMap();
      let lastCount = -1;

      function findTurns() {
        const found = new Set(document.querySelectorAll(TURN_SELECTORS));
        for (const turn of document.querySelectorAll('[data-testid^="conversation-turn"]')) {
          if (turn.querySelector('[data-message-author-role="user"]') || turn.getAttribute("data-turn") === "user") continue;
          if (turn.querySelector(CONTENT_SELECTORS)) found.add(turn);
        }
        // Innermost only: an <article> and the answer inside it are the same answer
        const list = [...found];
        return list.filter((turn) => !list.some((other) => other !== turn && turn.contains(other)));
      }

      function checkAssistantTurns() {
        const stopButton = document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i]');
        const turns = findTurns();
        if (turns.length !== lastCount) {
          lastCount = turns.length;
          console.info(`[Anti-Hallucination] chatgpt: ${turns.length} answer(s) on the page`);
        }
        const now = Date.now();
        turns.forEach((turn, index) => {
          const contentEl = turn.querySelector(CONTENT_SELECTORS) || turn;
          if (seenElements.has(contentEl)) return;
          const text = extractResponseText(contentEl);
          if (text.length <= 10) return;
          const entry = pending.get(contentEl);
          if (!entry || entry.text !== text) {
            pending.set(contentEl, { text, since: now });
            return;
          }
          const streaming = Boolean(contentEl.closest(".result-streaming") || contentEl.querySelector(".result-streaming"));
          // The stop button only means the newest answer is still being written
          if (now - entry.since < SETTLE_MS || streaming || (stopButton && index === turns.length - 1)) return;
          seenElements.add(contentEl);
          pending.delete(contentEl);
          callback({
            element: contentEl,
            text: text,
            links: extractLinks(contentEl),
            question: findPrecedingQuestion(turn),
            history: buildHistory(turn),
          });
        });
      }

      let scheduled = false;
      const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          checkAssistantTurns();
        }, 250);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // "Finished" is about time passing, so also look again regularly, and once right away
      const timer = setInterval(checkAssistantTurns, 1000);
      checkAssistantTurns();

      return function stop() {
        observer.disconnect();
        clearInterval(timer);
      };
    },
  };

  AH.sites.chatgpt = chatgpt;
  if (typeof module !== "undefined") {
    module.exports = chatgpt;
  }
})(globalThis);
