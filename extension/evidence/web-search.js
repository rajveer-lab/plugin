/**
 * Web Search Evidence Retriever (Brave Search API).
 *
 * Uses the user's optional Brave Search API key to retrieve web search snippets
 * as verifiable reference evidence.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

  async function search(query, options) {
    if (!query || typeof query !== "string" || !query.trim()) {
      return [];
    }

    const apiKey = (options && options.apiKey) || "";
    if (!apiKey) {
      return [];
    }

    const limit = (options && options.limit) || 5;
    const fetchFn = (options && options.fetch) || (typeof fetch === "function" ? fetch : root.fetch);
    if (typeof fetchFn !== "function") {
      throw new Error("fetch is not available in current environment");
    }

    const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query.trim())}&count=${Math.min(limit, 10)}`;

    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Brave Search API error (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    const results = (data.web && Array.isArray(data.web.results)) ? data.web.results : [];

    const evidence = [];
    results.forEach((r, idx) => {
      const title = (r.title || "").trim();
      const snippet = (r.description || "").trim();
      const text = [title, snippet].filter(Boolean).join(". ");

      if (text.length > 10) {
        let domain = "web";
        try {
          domain = new URL(r.url).hostname;
        } catch (_) {}

        evidence.push({
          id: `web:${idx + 1}`,
          text: text,
          source: domain,
          url: r.url || null,
          kind: "web",
        });
      }
    });

    return evidence;
  }

  AH.webSearch = {
    search,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.webSearch;
  }
})(globalThis);
