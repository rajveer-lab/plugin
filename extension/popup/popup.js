/**
 * Popup: quick controls for the current tab.
 * Settings live in chrome.storage.local under "settings"; saved pages in
 * chrome.storage.session under "pageSources".
 */
"use strict";

const SITES = [
  { host: "chatgpt.com", name: "ChatGPT" },
  { host: "claude.ai", name: "Claude" },
  { host: "gemini.google.com", name: "Gemini" },
];

const DEFAULTS = {
  enabled: true,
  strictness: "strict",
  sources: { links: true, wikipedia: true, webSearch: false, pages: true },
  braveApiKey: "",
};

const $ = (id) => document.getElementById(id);

async function readSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}), sources: { ...DEFAULTS.sources, ...((settings || {}).sources || {}) } };
}

async function writeSettings(changes) {
  const settings = await readSettings();
  Object.assign(settings, changes);
  await chrome.storage.local.set({ settings });
  return settings;
}

async function refreshPageCount() {
  const { pageSources } = await chrome.storage.session.get("pageSources");
  const count = (pageSources || []).length;
  $("pageCount").textContent = count ? `${count} saved page${count === 1 ? "" : "s"}` : "No saved pages";
}

async function showAiStatus() {
  const status = await AH.aiJudge.status();
  const display = AH.aiStatus.describe(status);
  const label = $("aiStatus");
  label.className = `ai-status ${display.tone}`;
  label.replaceChildren();
  const mark = document.createElement("span");
  mark.className = "ai-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = display.mark;
  label.append(mark, document.createTextNode(`AI checker: ${display.text}`));
  $("aiSetup").hidden = status !== "downloadable";
}

function paintSources(settings) {
  for (const button of document.querySelectorAll(".chip")) {
    const key = button.dataset.source;
    const on = Boolean(settings.sources[key]);
    button.setAttribute("aria-pressed", String(on));
    if (key === "webSearch") {
      if (settings.braveApiKey) {
        button.hidden = false;
        button.disabled = false;
        button.title = "";
      } else {
        button.hidden = true;
      }
    }
  }
}

async function showSiteStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? new URL(tab.url) : null;
  const match = url && SITES.find((site) => url.hostname === site.host || url.hostname.endsWith(`.${site.host}`));
  const el = $("siteStatus");
  if (match) {
    el.textContent = `Checking answers on ${match.name}`;
    el.classList.add("ok");
  } else {
    el.textContent = "Open ChatGPT, Claude or Gemini to check answers automatically";
    el.classList.remove("ok");
  }
  return tab;
}

function applyEnabledState(enabled) {
  $("controlsWrap").classList.toggle("paused", !enabled);
  $("pausedBanner").classList.toggle("visible", !enabled);
  $("toggleLabel").textContent = enabled ? "On" : "Off";
}

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await readSettings();
  const enabled = settings.enabled !== false;
  $("enabled").checked = enabled;
  $("strictness").value = settings.strictness || "strict";
  applyEnabledState(enabled);
  paintSources(settings);
  const tab = await showSiteStatus();
  refreshPageCount();
  showAiStatus();
  $("aiSetup").addEventListener("click", () => {
    window.open(chrome.runtime.getURL("welcome/welcome.html"));
  });

  let latestText = "";
  $("pasteCheck").addEventListener("click", async () => {
    let text = $("pasteText").value;
    if (!text.trim()) { $("pasteResult").textContent = "Paste some text to check."; return; }
    const truncated = text.length > 20000;
    if (truncated) text = text.slice(0, 20000);
    latestText = text;
    const button = $("pasteCheck"); button.disabled = true; button.textContent = "Checking…";
    try {
      const response = await chrome.runtime.sendMessage({ type: "CHECK_ANSWER", site: "checker", question: "", answerText: text, links: AH.reportView.findLinks(text) });
      AH.reportView.render($("pasteResult"), response || { error: "No response from the checker." }, { compact: true });
      if (truncated) { const note = document.createElement("p"); note.className = "hg-note"; note.textContent = "Text over 20,000 characters was shortened before checking."; $("pasteResult").append(note); }
      $("fullReport").hidden = false;
    } catch (error) { AH.reportView.render($("pasteResult"), { error: error.message || "The check could not be completed." }, { compact: true }); }
    finally { button.disabled = false; button.textContent = "Check facts"; }
  });
  $("fullReport").addEventListener("click", async () => {
    await chrome.storage.session.set({ checkerInput: { text: latestText, pageTitle: "Pasted text", pageUrl: "", at: Date.now() } });
    await chrome.windows.create({ url: chrome.runtime.getURL("checker/checker.html"), type: "popup", width: 480, height: 680 });
  });

  const isUsefulTab = (() => {
    try {
      if (!tab || !tab.url) return false;
      const url = new URL(tab.url);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch { return false; }
  })();
  // An AI chat can't be a source: its own answers would confirm themselves
  const isAiChat = (() => {
    try {
      return /(^|\.)(chatgpt\.com|openai\.com|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com|deepseek\.com|grok\.com|x\.ai|character\.ai|meta\.ai|mistral\.ai)$/i.test(new URL(tab.url).hostname);
    } catch { return false; }
  })();
  if (!isUsefulTab) {
    $("addPage").disabled = true;
    $("addStatus").textContent = "Navigate to a page first, then add it as a source.";
  } else if (isAiChat) {
    $("addPage").disabled = true;
    $("addStatus").textContent = "AI chats can't be sources: the AI's answers would confirm themselves.";
  }

  $("enabled").addEventListener("change", (event) => {
    applyEnabledState(event.target.checked);
    writeSettings({ enabled: event.target.checked });
  });
  $("strictness").addEventListener("change", (event) => writeSettings({ strictness: event.target.value }));

  for (const button of document.querySelectorAll(".chip")) {
    button.addEventListener("click", async () => {
      const current = await readSettings();
      const key = button.dataset.source;
      const sources = { ...current.sources, [key]: !current.sources[key] };
      paintSources(await writeSettings({ sources }));
    });
  }

  $("addPage").addEventListener("click", async () => {
    const status = $("addStatus");
    status.className = "hint";
    status.textContent = "Reading this page…";
    $("addPage").disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("No open tab to read.");
      const response = await chrome.runtime.sendMessage({ type: "ADD_PAGE_SOURCE", tabId: tab.id });
      if (!response || response.error) throw new Error((response && response.error) || "Couldn't read this page.");

      const source = response.source || {};
      const rawTitle = source.title || "This page";
      const title = rawTitle.length > 32 ? rawTitle.slice(0, 32) + "…" : rawTitle;
      status.className = "hint ok";
      status.textContent = `Saved “${title}” (${Number(source.chars || 0).toLocaleString()} characters).`;
      refreshPageCount();
    } catch (error) {
      status.className = "hint bad";
      status.textContent = error.message || String(error);
    } finally {
      $("addPage").disabled = false;
    }
  });

  $("openOptions").addEventListener("click", (event) => {
    event.preventDefault();
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL("options/options.html"));
  });
});
