/**
 * Unit Tests for Web Search Evidence Retriever.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const webSearch = require("../evidence/web-search.js");

test("webSearch returns empty array when no query or api key is provided", async () => {
  const r1 = await webSearch.search("", { apiKey: "any" });
  assert.deepStrictEqual(r1, []);

  const r2 = await webSearch.search("test query", { apiKey: "" });
  assert.deepStrictEqual(r2, []);
});

test("webSearch parses results using injected fetch", async () => {
  const fakeFetch = async (url, init) => {
    assert.ok(url.includes("quantum%20computing"));
    assert.strictEqual(init.headers["X-Subscription-Token"], "test-user-api-key");
    return {
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: "Quantum Computing Overview",
              url: "https://example.com/quantum",
              description: "Quantum computing uses qubits to process information.",
            },
          ],
        },
      }),
    };
  };

  const results = await webSearch.search("quantum computing", {
    apiKey: "test-user-api-key",
    limit: 3,
    fetch: fakeFetch,
  });

  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].kind, "web");
  assert.strictEqual(results[0].source, "example.com");
  assert.ok(results[0].text.includes("Quantum computing"));
});
