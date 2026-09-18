/**
 * Wikipedia evidence (free, no API key).
 *
 * For the most informative claims, searches Wikipedia by the names they mention
 * (searching whole claims tends to find side articles like "Eiffel Tower replicas"),
 * then fetches the plain text of the top articles. The pipeline splits each article
 * into sentence passages before verification.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const MAX_CLAIMS = 4;
  const MAX_QUERIES = 6;
  const MAX_PAGES = 4;
  const TIMEOUT_MS = 8000;
  const HEADERS = { "Api-User-Agent": "HallucinationGuard/0.1 (Chrome extension; fact checking)" };

  function queriesFor(claims, question) {
    const ranked = [...(Array.isArray(claims) ? claims : [])]
      .filter((claim) => claim.weight !== 0)
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, MAX_CLAIMS);

    const queries = [];
    const add = (query) => {
      const clean = String(query || "").replace(/^(the|a|an)\s+/i, "").trim();
      if (clean.length > 1 && !queries.some((q) => q.toLowerCase() === clean.toLowerCase())) queries.push(clean);
    };

    for (const claim of ranked) {
      // Longest names first; skip parts of a name already used ("Thomas" after "Thomas Edison")
      const names = [...new Set(claim.entities || [])].sort((a, b) => b.length - a.length);
      const chosen = [];
      for (const name of names) {
        if (!chosen.some((c) => c.toLowerCase().includes(name.toLowerCase()))) chosen.push(name);
      }
      if (chosen.length) chosen.slice(0, 2).forEach(add);
      else add(claim.text);
    }
    if (!queries.length && question) add(question);
    return queries.slice(0, MAX_QUERIES);
  }

  // Wikipedia rate-limits bursts (HTTP 429), so cache responses and cap parallel requests
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const CACHE_MAX = 200;
  const MAX_PARALLEL = 3;
  const cache = new Map();
  let active = 0;
  const waiting = [];

  async function withSlot(task) {
    if (active >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      if (waiting.length) waiting.shift()();
    }
  }

  async function getJson(fetchImpl, url, timeoutMs) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body;

    const body = await withSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: HEADERS, credentials: "omit", signal: controller.signal });
        if (response.status === 429) throw new Error("Wikipedia is rate-limiting requests right now (HTTP 429). Try again in a minute.");
        if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    });

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), body });
    return body;
  }

  async function lookup(claims, options) {
    const settings = {
      question: "",
      lang: "en",
      maxPages: MAX_PAGES,
      timeoutMs: TIMEOUT_MS,
      fetch: typeof fetch === "function" ? fetch.bind(root) : null,
      ...(options || {}),
    };
    const base = `https://${settings.lang}.wikipedia.org`;
    const queries = queriesFor(claims, settings.question);
    if (!queries.length) return [];

    const searches = await Promise.allSettled(
      queries.map((query) =>
        getJson(settings.fetch, `${base}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=2`, settings.timeoutMs),
      ),
    );
    if (searches.every((s) => s.status === "rejected")) throw searches[0].reason;

    // Take each query's best result first, then the runners-up
    const pages = [];
    for (let rank = 0; rank < 2 && pages.length < settings.maxPages; rank++) {
      for (const search of searches) {
        const page = search.status === "fulfilled" && search.value && (search.value.pages || [])[rank];
        if (page && page.key && !pages.some((p) => p.key === page.key)) pages.push(page);
        if (pages.length >= settings.maxPages) break;
      }
    }

    const extracts = await Promise.allSettled(
      pages.map((page) =>
        getJson(
          settings.fetch,
          `${base}/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(page.title)}`,
          settings.timeoutMs,
        ),
      ),
    );

    const evidence = [];
    extracts.forEach((outcome, i) => {
      if (outcome.status !== "fulfilled") return;
      const found = ((outcome.value && outcome.value.query && outcome.value.query.pages) || [])[0];
      if (!found || found.missing || !found.extract) return;
      const key = String(found.title).replace(/ /g, "_");
      evidence.push({
        id: `wikipedia:${key}`,
        text: found.extract,
        source: `Wikipedia: ${found.title}`,
        url: `${base}/wiki/${encodeURIComponent(key)}`,
        kind: "wikipedia",
      });
    });
    return evidence;
  }

  AH.wikipedia = { lookup, queriesFor, clearCache: () => cache.clear() };

  if (typeof module !== "undefined") {
    module.exports = AH.wikipedia;
  }
})(globalThis);
