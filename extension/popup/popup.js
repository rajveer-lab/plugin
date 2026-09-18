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

function paintSources(settings) {
  for (const button of document.querySelectorAll(".chip")) {
    const key = button.dataset.source;
    const on = Boolean(settings.sources[key]);
    button.setAttribute("aria-pressed", String(on));
    if (key === "webSearch") {
      button.disabled = !settings.braveApiKey;
      button.title = settings.braveApiKey ? "" : "Add your own search key in Settings to use web search";
    }
  }
}

async function showSiteStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? new URL(tab.url) : null;
  const match = url && SITES.find((site) => url.hostname === site.host || url.hostname.endsWith(`.${site.host}`));
  $("siteStatus").textContent = match
    ? `Checking answers on ${match.name}.`
    : "Open ChatGPT, Claude or Gemini to see answers checked.";
}

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await readSettings();
  $("enabled").checked = settings.enabled !== false;
  $("strictness").value = settings.strictness || "strict";
  paintSources(settings);
  showSiteStatus();
  refreshPageCount();

  $("enabled").addEventListener("change", (event) => writeSettings({ enabled: event.target.checked }));
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
      const title = (source.title || "This page").slice(0, 32);
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
