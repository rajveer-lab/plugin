/**
 * Anti-Hallucination Extension: Main Content Script Entry Point.
 *
 * Detects matching site adapter (ChatGPT, Claude, Gemini), observes generated answers,
 * and sends CHECK_ANSWER messages to the background service worker.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  function findActiveSite() {
    const sites = Object.values(AH.sites || {});
    for (const site of sites) {
      if (typeof site.matches === "function" && site.matches(window.location)) {
        return site;
      }
    }
    return null;
  }

  function init() {
    const site = findActiveSite();
    if (!site) {
      return;
    }

    console.info(`[Anti-Hallucination] Active adapter initialized: ${site.id}`);

    // Attach answer observer with context invalidation protection
    let stopObserver = null;
    stopObserver = site.observeAnswers(({ element, text, links, question, history }) => {
      // Detect if extension was reloaded or updated in another tab
      if (!chrome.runtime || !chrome.runtime.id) {
        if (typeof stopObserver === "function") stopObserver();
        return;
      }

      console.info(`[Anti-Hallucination] Processing answer from ${site.id}:`, {
        questionLength: question ? question.length : 0,
        textLength: text.length,
        linksFound: links.length,
      });

      // With the on-device AI a check takes several seconds: say it's happening right away
      if (AH.overlay && typeof AH.overlay.renderPending === "function") AH.overlay.renderPending(element);

      try {
        chrome.runtime.sendMessage(
          {
            type: "CHECK_ANSWER",
            site: site.id,
            question: question || "",
            answerText: text,
            links: links,
            history: Array.isArray(history) ? history : [],
          },
          (response) => {
            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || "";
              if (msg.includes("Extension context invalidated")) {
                if (typeof stopObserver === "function") stopObserver();
                return;
              }
              console.warn("[Anti-Hallucination] Error checking answer:", msg);
              return;
            }

            if (!response) {
              console.warn("[Anti-Hallucination] No response from background service worker.");
              return;
            }

            console.info("[Anti-Hallucination] Received check report:", response);

            // Render overlay if overlay module is loaded
            if (AH.overlay && typeof AH.overlay.renderAnswer === "function") {
              AH.overlay.renderAnswer(element, response, {
                onFix: (items) => {
                  const inputEl = site.getPromptInput();
                  if (!inputEl) return;
                  if (AH.grounder && typeof AH.grounder.correctionPrompt === "function") {
                    const correction = AH.grounder.correctionPrompt(items);
                    if (correction) {
                      site.writePrompt(inputEl, correction);
                      if (typeof inputEl.focus === "function") {
                        inputEl.focus();
                      }
                    }
                  }
                },
                onPushback: (sentence) => {
                  const inputEl = site.getPromptInput();
                  if (!inputEl || !AH.grounder || typeof AH.grounder.pushbackPrompt !== "function") return;
                  const prompt = AH.grounder.pushbackPrompt(sentence);
                  if (!prompt) return;
                  site.writePrompt(inputEl, prompt);
                  if (typeof inputEl.focus === "function") inputEl.focus();
                },
                onFeedback: ({ head, features, label }) => new Promise((resolve) => {
                  try {
                    chrome.runtime.sendMessage({ type: "FEEDBACK", head, features, label }, (feedbackResponse) => {
                      if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message || "";
                        if (msg.includes("Extension context invalidated") && typeof stopObserver === "function") stopObserver();
                        resolve(null);
                        return;
                      }
                      resolve(feedbackResponse || null);
                    });
                  } catch (error) {
                    if (error && error.message && error.message.includes("Extension context invalidated") && typeof stopObserver === "function") stopObserver();
                    resolve(null);
                  }
                }),
              });
            }
          }
        );
      } catch (err) {
        if (err && err.message && err.message.includes("Extension context invalidated")) {
          if (typeof stopObserver === "function") stopObserver();
        } else {
          console.warn("[Anti-Hallucination] Message send failed:", err);
        }
      }
    });
  }

  // Run initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(globalThis);
