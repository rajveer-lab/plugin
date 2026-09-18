/**
 * User-Added Page Sources Evidence Module.
 *
 * Manages user-captured page sources stored in chrome.storage.session.
 * Formats pages into verifiable Evidence objects for the CHECK_ANSWER pipeline.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const STORAGE_KEY = "pageSources";
  const inMemorySources = [];

  function getStorage() {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.session
    ) {
      return chrome.storage.session;
    }
    return null;
  }

  async function getStoredList() {
    const storage = getStorage();
    if (storage) {
      return new Promise((resolve) => {
        storage.get([STORAGE_KEY], (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve([...inMemorySources]);
          } else {
            resolve(items[STORAGE_KEY] || []);
          }
        });
      });
    }
    return [...inMemorySources];
  }

  async function saveStoredList(list) {
    const storage = getStorage();
    if (storage) {
      return new Promise((resolve) => {
        storage.set({ [STORAGE_KEY]: list }, () => resolve());
      });
    }
    inMemorySources.length = 0;
    inMemorySources.push(...list);
  }

  async function list() {
    const rawList = await getStoredList();
    return rawList.map((item, idx) => ({
      id: item.id || `page:${idx + 1}`,
      text: item.text || "",
      source: item.title || item.url || "user-page",
      url: item.url || null,
      kind: "page",
    }));
  }

  async function add(target) {
    let title = "Untitled Page";
    let url = null;
    let text = "";

    if (typeof target === "number") {
      if (typeof chrome !== "undefined" && chrome.scripting && chrome.scripting.executeScript) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: target },
          func: () => ({
            title: document.title || "",
            url: location.href || "",
            text: document.body ? document.body.innerText : "",
          }),
        });
        if (results && results[0] && results[0].result) {
          title = results[0].result.title;
          url = results[0].result.url;
          text = results[0].result.text || "";
        }
      }
    } else if (target && typeof target === "object") {
      title = target.title || "Untitled Page";
      url = target.url || null;
      text = target.text || "";
    }

    if (!text || !text.trim()) {
      throw new Error("No readable text found on page to add as evidence.");
    }

    const current = await getStoredList();
    const id = `page:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    const newEntry = {
      id: id,
      title: title,
      url: url,
      text: text.trim(),
      addedAt: new Date().toISOString(),
    };
    current.push(newEntry);
    await saveStoredList(current);

    return {
      source: {
        title: title,
        url: url,
        chars: text.length,
      },
    };
  }

  async function remove(id) {
    const current = await getStoredList();
    const filtered = current.filter((p) => p.id !== id);
    await saveStoredList(filtered);
  }

  async function clear() {
    await saveStoredList([]);
  }

  AH.pageSources = {
    list,
    add,
    remove,
    clear,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.pageSources;
  }
})(globalThis);
