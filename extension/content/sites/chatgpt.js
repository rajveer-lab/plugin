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
      if (el.tagName === "TEXTAREA" || el.value !== undefined) {
        el.value = text;
      } else {
        el.innerText = text;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },

    observeAnswers(callback) {
      let isStreaming = false;
      const seenElements = new WeakSet();

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

      function findPrecedingQuestion(assistantTurn) {
        let prev = assistantTurn.previousElementSibling;
        while (prev) {
          const userMsg = prev.querySelector('[data-message-author-role="user"]');
          if (userMsg) {
            return userMsg.textContent.trim();
          }
          if (prev.getAttribute("data-message-author-role") === "user") {
            return prev.textContent.trim();
          }
          prev = prev.previousElementSibling;
        }
        return "";
      }

      function checkAssistantTurns() {
        const stopButton = document.querySelector('[data-testid="stop-button"]');
        const streamingIndicator = document.querySelector(".result-streaming");
        const streamingNow = Boolean(stopButton || streamingIndicator);

        if (streamingNow) {
          isStreaming = true;
          return;
        }

        // Just stopped streaming or settled
        const turns = document.querySelectorAll('[data-message-author-role="assistant"], article [data-testid^="conversation-turn"]');
        for (const turn of turns) {
          const contentEl = turn.querySelector(".markdown, .prose") || turn;
          if (contentEl && !seenElements.has(contentEl) && contentEl.textContent.trim().length > 10) {
            seenElements.add(contentEl);
            const text = contentEl.textContent.trim();
            const links = extractLinks(contentEl);
            const question = findPrecedingQuestion(turn);
            callback({
              element: contentEl,
              text: text,
              links: links,
              question: question,
            });
          }
        }
        isStreaming = false;
      }

      const observer = new MutationObserver(() => {
        checkAssistantTurns();
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Initial check
      checkAssistantTurns();

      return function stop() {
        observer.disconnect();
      };
    },
  };

  AH.sites.chatgpt = chatgpt;
  if (typeof module !== "undefined") {
    module.exports = chatgpt;
  }
})(globalThis);
