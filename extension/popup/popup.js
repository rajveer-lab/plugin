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
    el.textContent = `● Checking answers on ${match.name}.`;
    el.classList.add("ok");
  } else {
    el.textContent = "Open ChatGPT, Claude or Gemini to see answers checked.";
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

  const isUsefulTab = (() => {
    try {
      if (!tab || !tab.url) return false;
      const url = new URL(tab.url);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch { return false; }
  })();
  if (!isUsefulTab) {
    $("addPage").disabled = true;
    $("addStatus").textContent = "Navigate to a page first, then add it as a source.";
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
