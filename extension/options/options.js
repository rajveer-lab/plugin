/**
 * Settings page.
 *
 * Every control saves as soon as it changes (chrome.storage.local "settings").
 * The fact memory list reads and edits chrome.storage.local "factMemory"
 * through AH.factMemory, and refreshes when checks add new facts.
 */
"use strict";

const LINK_ORIGINS = { origins: ["https://*/*", "http://*/*"] };
const DEFAULTS = {
  enabled: true,
  strictness: "strict",
  sources: { links: true, wikipedia: true, webSearch: false, pages: true },
  braveApiKey: "",
  onDeviceAI: true,
};

const $ = (id) => document.getElementById(id);

// ---- settings ----

async function readSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}), sources: { ...DEFAULTS.sources, ...((settings || {}).sources || {}) } };
}

let savedTimer = null;
async function save(changes) {
  const settings = { ...(await readSettings()), ...changes };
  await chrome.storage.local.set({ settings });
  $("saved").textContent = "Saved.";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
  return settings;
}

function showKeyField(settings) {
  $("keyField").hidden = !settings.sources.webSearch;
}

async function initSettings() {
  const settings = await readSettings();
  $("strictness").value = settings.strictness;
  $("onDeviceAI").checked = settings.onDeviceAI !== false;
  $("braveApiKey").value = settings.braveApiKey || "";
  for (const box of document.querySelectorAll("[data-source]")) box.checked = Boolean(settings.sources[box.dataset.source]);
  showKeyField(settings);

  $("strictness").addEventListener("change", (e) => save({ strictness: e.target.value }));
  $("onDeviceAI").addEventListener("change", (e) => save({ onDeviceAI: e.target.checked }));
  $("braveApiKey").addEventListener("change", (e) => save({ braveApiKey: e.target.value.trim() }));

  for (const box of document.querySelectorAll("[data-source]")) {
    box.addEventListener("change", async () => {
      const current = await readSettings();
      const updated = await save({ sources: { ...current.sources, [box.dataset.source]: box.checked } });
      showKeyField(updated);
    });
  }
}

// ---- on-device AI ----

async function showAiStatus() {
  const pill = $("aiStatus");
  const prepare = $("aiPrepare");
  const status = AH.aiJudge ? await AH.aiJudge.status() : "unsupported";
  const text = {
    available: ["Ready on this computer", "ok"],
    downloadable: ["Model not downloaded yet", "warn"],
    downloading: ["Downloading…", "warn"],
    unavailable: ["Not supported on this computer — word matching is used instead", ""],
    unsupported: ["Not available in this Chrome — word matching is used instead", ""],
  }[status] || [status, ""];
  pill.textContent = text[0];
  pill.className = `pill ${text[1]}`;
  prepare.hidden = status !== "downloadable";
}

function initAi() {
  showAiStatus();
  $("aiPrepare").addEventListener("click", async () => {
    $("aiPrepare").disabled = true;
    try {
      await AH.aiJudge.prepare((loaded) => ($("aiProgress").textContent = `${Math.round(loaded * 100)}%`));
      $("aiProgress").textContent = "";
    } catch (error) {
      $("aiProgress").textContent = `Couldn't download: ${error.message || error}`;
    }
    $("aiPrepare").disabled = false;
    showAiStatus();
  });
}

// ---- link permission ----

async function showPermission() {
  const granted = await chrome.permissions.contains(LINK_ORIGINS);
  $("permStatus").textContent = granted ? "Allowed" : "Not allowed — links show as “Not checked”";
  $("permStatus").className = `pill ${granted ? "ok" : "warn"}`;
  $("permGrant").hidden = granted;
  $("permRevoke").hidden = !granted;
}

function initPermission() {
  showPermission();
  // Must run straight from the click: Chrome only shows the prompt for a user gesture
  $("permGrant").addEventListener("click", () => chrome.permissions.request(LINK_ORIGINS).then(showPermission));
  $("permRevoke").addEventListener("click", () => chrome.permissions.remove(LINK_ORIGINS).then(showPermission));
}

// ---- fact memory ----

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function factRow(fact) {
  const item = document.createElement("li");
  const isTrue = fact.status === "supported";

  const mark = document.createElement("span");
  mark.className = `fact-mark ${isTrue ? "true" : "false"}`;
  mark.title = isTrue ? "Remembered as true" : "Remembered as false";
  if (AH.icons) mark.append(AH.icons.icon(isTrue ? "check" : "cross", { title: mark.title }));
  else mark.textContent = isTrue ? "✓" : "✕";

  const body = document.createElement("div");
  const text = document.createElement("div");
  text.className = "fact-text";
  text.textContent = fact.claimText;

  const meta = document.createElement("div");
  meta.className = "fact-meta";
  meta.append(`${isTrue ? "True" : "False"} · checked ${formatDate(fact.checkedAt)}`);
  const url = hostOf(fact.evidenceUrl);
  if (url) {
    meta.append(" · ");
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url.hostname;
    meta.append(link);
  }
  body.append(text, meta);

  if (fact.evidenceText) {
    const quote = document.createElement("div");
    quote.className = "fact-quote";
    quote.textContent = `“${fact.evidenceText}”`;
    body.append(quote);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn ghost small";
  remove.textContent = "Delete";
  remove.setAttribute("aria-label", `Delete remembered fact: ${fact.claimText}`);
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    await AH.factMemory.remove(fact.key);
    renderMemory();
  });

  item.append(mark, body, remove);
  return item;
}

async function renderMemory() {
  const facts = await AH.factMemory.list();
  const query = $("memoryFilter").value.trim().toLowerCase();
  const shown = query ? facts.filter((fact) => String(fact.claimText).toLowerCase().includes(query)) : facts;

  $("memoryFilter").hidden = facts.length < 6;
  $("memoryClear").hidden = facts.length === 0;
  $("memorySummary").textContent = facts.length === 0
    ? "Nothing remembered yet. Facts appear here after answers are checked."
    : query
      ? `${shown.length} of ${facts.length} remembered facts match.`
      : `${facts.length} remembered fact${facts.length === 1 ? "" : "s"}, newest first.`;

  $("memoryList").replaceChildren(...shown.map(factRow));
}

function initMemory() {
  renderMemory();
  $("memoryFilter").addEventListener("input", renderMemory);
  $("memoryClear").addEventListener("click", async () => {
    if (!confirm("Delete every remembered fact? This can't be undone.")) return;
    await AH.factMemory.clear();
    renderMemory();
  });
  // New facts arrive while the page is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.factMemory) renderMemory();
  });
}

async function renderLearnerStats() {
  const summary = $("learnerSummary");
  try {
    const response = await chrome.runtime.sendMessage({ type: "LEARNER_STATS" });
    const stats = response && response.stats || {};
    const marked = (Number(stats.right) || 0) + (Number(stats.wrong) || 0);
    const automatic = Number(stats.auto) || 0;
    summary.textContent = `You've marked ${marked} check${marked === 1 ? "" : "s"}; it also learned from ${automatic} exact fact${automatic === 1 ? "" : "s"}.`;
  } catch (error) {
    summary.textContent = "Learning totals aren't available right now.";
  }
}

function initLearner() {
  const button = $("learnerReset");
  let confirmTimer = null;
  renderLearnerStats();
  button.addEventListener("click", async () => {
    if (button.dataset.confirm !== "yes") {
      button.dataset.confirm = "yes";
      button.textContent = "Click again to confirm";
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        delete button.dataset.confirm;
        button.textContent = "Forget what it learned";
      }, 5000);
      return;
    }
    clearTimeout(confirmTimer);
    delete button.dataset.confirm;
    button.disabled = true;
    button.textContent = "Forgetting…";
    try {
      await chrome.runtime.sendMessage({ type: "LEARNER_RESET" });
      await renderLearnerStats();
      button.textContent = "Forget what it learned";
    } catch (error) {
      button.textContent = "Couldn't forget — try again";
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  $("version").textContent = `Version ${chrome.runtime.getManifest().version}`;
  initSettings();
  initAi();
  initPermission();
  initMemory();
  initLearner();
});
