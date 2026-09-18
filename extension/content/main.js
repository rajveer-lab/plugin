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
    stopObserver = site.observeAnswers(({ element, text, links, question }) => {
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

      try {
        chrome.runtime.sendMessage(
          {
            type: "CHECK_ANSWER",
            site: site.id,
            question: question || "",
            answerText: text,
            links: links,
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
              AH.overlay.renderAnswer(element, response);
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

    // Wire booster button if prompt input and booster module are present
    function setupPromptBooster() {
      const inputEl = site.getPromptInput();
      if (!inputEl) return;

      if (AH.overlay && typeof AH.overlay.addBoosterButton === "function") {
        AH.overlay.addBoosterButton(inputEl, () => {
          const currentText = site.readPrompt(inputEl);
          if (AH.grounder && typeof AH.grounder.boost === "function") {
            const boosted = AH.grounder.boost(currentText, { strictness: "strict" });
            site.writePrompt(inputEl, boosted);
          }
        });
      }
    }

    // Try setting up booster once DOM is interactive
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setupPromptBooster);
    } else {
      setupPromptBooster();
    }
  }

  // Run initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(globalThis);
