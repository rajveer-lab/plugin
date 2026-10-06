"use strict";

const $ = (id) => document.getElementById(id);
const LIMIT = 20000;

/** Shows the loading state, or the finished result, at the top of the window. */
function showResult(response) {
  $("resultSection").hidden = false;
  $("loading").hidden = true;
  AH.reportView.render($("result"), response, { onFeedback: ({ head, features, label }) => chrome.runtime.sendMessage({ type: "FEEDBACK", head, features, label }) });
}

function showLoading(text) {
  $("resultSection").hidden = false;
  $("result").replaceChildren();
  $("loadingText").textContent = text;
  $("loading").hidden = false;
}

async function runCheck() {
  const button = $("check");
  const status = $("status");
  let text = $("answerText").value;
  if (!text.trim()) {
    status.textContent = "Paste some text first.";
    $("answerText").focus();
    return;
  }
  const truncated = text.length > LIMIT;
  if (truncated) text = text.slice(0, LIMIT);
  status.textContent = "";
  button.disabled = true;
  showLoading(truncated ? "Checking the first 20,000 characters against Wikipedia and Wikidata…" : "Checking against Wikipedia and Wikidata…");
  // Results come first; the text folds away under "Checked text"
  $("inputBox").open = false;
  $("inputSummary").textContent = "Checked text";
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_ANSWER", site: "checker", question: $("question").value, answerText: text, links: AH.reportView.findLinks(text) });
    showResult(response || { error: "The checker didn't answer. Close this window and try again." });
    if (truncated) status.textContent = "Only the first 20,000 characters were checked.";
  } catch (error) {
    showResult({ error: (error && error.message) || "The check couldn't be completed." });
  } finally {
    button.disabled = false;
    window.scrollTo({ top: 0 });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  $("check").addEventListener("click", runCheck);
  $("answerText").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) runCheck();
  });
  try {
    const { checkerInput } = await chrome.storage.session.get("checkerInput");
    if (!checkerInput || typeof checkerInput.text !== "string" || !checkerInput.text.trim()) {
      $("answerText").focus();
      return;
    }
    await chrome.storage.session.remove("checkerInput");
    $("answerText").value = checkerInput.text;
    if (checkerInput.pageTitle) {
      const from = $("fromSource");
      from.hidden = false;
      from.append(document.createTextNode("From "));
      if (/^https?:\/\//i.test(checkerInput.pageUrl || "")) {
        const link = document.createElement("a");
        link.href = checkerInput.pageUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = checkerInput.pageTitle;
        from.append(link);
      } else {
        from.append(document.createTextNode(checkerInput.pageTitle));
      }
    }
    await runCheck();
  } catch (error) {
    $("status").textContent = (error && error.message) || "Couldn't load the selected text.";
  }
});
