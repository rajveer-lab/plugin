/**
 * VeriGuard Options Controller.
 */
"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const strictnessSelect = document.getElementById("strictnessSelect");
  const toggleBooster = document.getElementById("toggleBooster");
  const toggleOnDeviceAI = document.getElementById("toggleOnDeviceAI");
  const sourceLinks = document.getElementById("sourceLinks");
  const sourceWikipedia = document.getElementById("sourceWikipedia");
  const sourceWebSearch = document.getElementById("sourceWebSearch");
  const sourcePages = document.getElementById("sourcePages");
  const braveApiKey = document.getElementById("braveApiKey");
  const permStatusBadge = document.getElementById("permStatusBadge");
  const btnRequestPerm = document.getElementById("btnRequestPerm");
  const memoryCount = document.getElementById("memoryCount");
  const btnClearMemory = document.getElementById("btnClearMemory");
  const btnSave = document.getElementById("btnSave");
  const saveNotification = document.getElementById("saveNotification");

  // 1. Load Settings
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["settings", "factMemory"], (data) => {
      const settings = data.settings || {};
      strictnessSelect.value = settings.strictness || "strict";
      toggleBooster.checked = settings.boosterEnabled !== false;
      toggleOnDeviceAI.checked = settings.onDeviceAI !== false;

      const sources = settings.sources || {};
      sourceLinks.checked = sources.links !== false;
      sourceWikipedia.checked = sources.wikipedia !== false;
      sourceWebSearch.checked = Boolean(sources.webSearch);
      sourcePages.checked = sources.pages !== false;

      braveApiKey.value = settings.braveApiKey || "";

      const mem = data.factMemory || [];
      memoryCount.textContent = `${mem.length} fact${mem.length === 1 ? "" : "s"} recorded in memory`;
    });
  }

  // 2. Check On-Device AI Status
  const aiStatusBadge = document.getElementById("aiStatusBadge");
  const btnPrepareAI = document.getElementById("btnPrepareAI");
  const aiProgress = document.getElementById("aiProgress");

  async function checkAIStatus() {
    if (typeof AH !== "undefined" && AH.aiJudge && typeof AH.aiJudge.status === "function") {
      try {
        const st = await AH.aiJudge.status();
        if (st === "available") {
          aiStatusBadge.textContent = "Ready (On-device model active)";
          aiStatusBadge.className = "badge badge-granted";
          btnPrepareAI.style.display = "none";
        } else if (st === "downloadable") {
          aiStatusBadge.textContent = "Downloadable (Ready to install)";
          aiStatusBadge.className = "badge badge-denied";
          btnPrepareAI.style.display = "inline-block";
        } else if (st === "downloading") {
          aiStatusBadge.textContent = "Downloading model...";
          aiStatusBadge.className = "badge badge-denied";
          btnPrepareAI.style.display = "none";
        } else {
          aiStatusBadge.textContent = `Prompt API: ${st}`;
          aiStatusBadge.className = "badge badge-denied";
          btnPrepareAI.style.display = "none";
        }
      } catch (err) {
        aiStatusBadge.textContent = "Prompt API unavailable";
        aiStatusBadge.className = "badge badge-denied";
      }
    } else {
      aiStatusBadge.textContent = "Heuristic fallback active";
      aiStatusBadge.className = "badge badge-granted";
    }
  }

  checkAIStatus();

  if (btnPrepareAI) {
    btnPrepareAI.addEventListener("click", async () => {
      btnPrepareAI.disabled = true;
      btnPrepareAI.textContent = "Starting download...";
      try {
        await AH.aiJudge.prepare((progress) => {
          aiProgress.textContent = `${Math.round(progress * 100)}%`;
        });
        aiProgress.textContent = "Done!";
        checkAIStatus();
      } catch (err) {
        aiProgress.textContent = `Failed: ${err.message}`;
        btnPrepareAI.disabled = false;
      }
    });
  }

  // 3. Check & Manage Optional Permissions
  const btnRevokePerm = document.getElementById("btnRevokePerm");

  function checkPermissions() {
    if (typeof chrome !== "undefined" && chrome.permissions) {
      chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] }, (granted) => {
        if (granted) {
          permStatusBadge.textContent = "Granted (Deep link inspection enabled)";
          permStatusBadge.className = "badge badge-granted";
          btnRequestPerm.style.display = "none";
          if (btnRevokePerm) btnRevokePerm.style.display = "inline-block";
        } else {
          permStatusBadge.textContent = "Not Granted (Links checked on-page only)";
          permStatusBadge.className = "badge badge-denied";
          btnRequestPerm.style.display = "inline-block";
          if (btnRevokePerm) btnRevokePerm.style.display = "none";
        }
      });
    }
  }

  checkPermissions();

  btnRequestPerm.addEventListener("click", () => {
    if (chrome.permissions) {
      chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }, (granted) => {
        checkPermissions();
      });
    }
  });

  if (btnRevokePerm) {
    btnRevokePerm.addEventListener("click", () => {
      if (chrome.permissions && chrome.permissions.remove) {
        chrome.permissions.remove({ origins: ["https://*/*", "http://*/*"] }, () => {
          checkPermissions();
        });
      }
    });
  }

  // 3. Clear Fact Memory
  btnClearMemory.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all learned fact memory?")) {
      chrome.storage.local.remove("factMemory", () => {
        memoryCount.textContent = "0 facts recorded in memory";
      });
    }
  });

  // 4. Save Settings
  btnSave.addEventListener("click", () => {
    const newSettings = {
      strictness: strictnessSelect.value,
      boosterEnabled: toggleBooster.checked,
      onDeviceAI: toggleOnDeviceAI.checked,
      sources: {
        links: sourceLinks.checked,
        wikipedia: sourceWikipedia.checked,
        webSearch: sourceWebSearch.checked,
        pages: sourcePages.checked,
      },
      braveApiKey: braveApiKey.value.trim(),
    };

    chrome.storage.local.get(["settings"], (data) => {
      const merged = { ...(data.settings || {}), ...newSettings };
      chrome.storage.local.set({ settings: merged }, () => {
        saveNotification.textContent = "✓ Settings saved successfully!";
        setTimeout(() => {
          saveNotification.textContent = "";
        }, 3000);
      });
    });
  });
});
