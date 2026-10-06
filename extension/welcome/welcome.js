"use strict";

const $ = (id) => document.getElementById(id);
let pollTimer = null;
let preparing = false;

function showState(mark, tone, text) {
  const state = $("aiState");
  state.className = `state ${tone}`;
  state.replaceChildren();
  const symbol = document.createElement("span");
  symbol.className = "mark";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = mark;
  const label = document.createElement("span");
  label.textContent = text;
  state.append(symbol, label);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => refreshStatus(), 2000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshStatus() {
  const status = await AH.aiJudge.status();
  const display = AH.aiStatus.describe(status);
  $("prepare").hidden = status !== "downloadable";
  $("aiNote").hidden = true;
  if (status === "available") {
    showState("✓", "ok", "Ready. The AI checker runs on this computer.");
    $("progressWrap").hidden = true;
    $("prepareError").hidden = true;
    stopPolling();
  } else if (status === "downloadable") {
    showState("?", "warn", "The AI checker is ready to set up.");
    $("aiNote").textContent = "One-time download of Chrome's built-in AI model. It runs on this computer; nothing is sent anywhere.";
    $("aiNote").hidden = false;
    if (!preparing) $("progressWrap").hidden = true;
    stopPolling();
  } else if (status === "downloading") {
    showState("…", "warn", "Chrome is downloading its built-in AI model.");
    $("progressWrap").hidden = false;
    startPolling();
  } else {
    showState("?", "mute", "Your computer or Chrome version can't run Chrome's built-in AI. The basic checker still works.");
    $("progressWrap").hidden = true;
    stopPolling();
  }
  return status;
}

document.addEventListener("DOMContentLoaded", () => {
  refreshStatus();
  $("prepare").addEventListener("click", async () => {
    preparing = true;
    $("prepare").disabled = true;
    $("prepareError").hidden = true;
    $("progressWrap").hidden = false;
    showState("…", "warn", "Setting up the AI checker.");
    startPolling();
    try {
      await AH.aiJudge.prepare((loaded) => {
        const percent = Math.max(0, Math.min(100, Math.round(Number(loaded) * 100)));
        $("aiProgress").value = percent;
        $("progressLabel").textContent = `${percent}%`;
      });
      $("aiProgress").value = 100;
      $("progressLabel").textContent = "100%";
      await refreshStatus();
    } catch (error) {
      stopPolling();
      showState("?", "bad", "The AI checker couldn't be set up.");
      $("prepareError").textContent = error.message || "Try again when you have a stable connection.";
      $("prepareError").hidden = false;
      $("progressWrap").hidden = true;
      $("prepare").hidden = false;
    } finally {
      preparing = false;
      $("prepare").disabled = false;
    }
  });
});
