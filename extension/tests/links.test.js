"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
require("../engine/claims.js");
require("../engine/verifier.js");
require("../background/service-worker.js"); // AH.pipeline.toPassages
const links = require("../evidence/links.js");

const ANSWER = "The Eiffel Tower was completed in 1889 (see [the history page]). It is located in Berlin, per [city guide].";

function page(status, body, type = "text/html", url) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
    text: async () => body,
  };
}

function fakeFetch(routes, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    const route = routes[url];
    if (!route) throw new TypeError("Failed to fetch");
    if (route === "timeout") {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return route;
  };
}

const parseHtml = async (html) => ({
  title: (html.match(/<title>(.*?)<\/title>/) || [])[1] || "",
  text: html.replace(/<title>.*?<\/title>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
});

const allow = async () => true;

test("classifies ok, mismatch, not_found, soft 404 and unreachable links", async () => {
  const seen = [];
  const { linkChecks, evidence } = await links.check(
    [
      { url: "https://history.example/eiffel", text: "the history page" },
      { url: "https://guide.example/berlin", text: "city guide" },
      { url: "https://made-up.example/paper" },
      { url: "https://soft.example/missing" },
      { url: "https://blocked.example/" },
      { url: "https://down.example/" },
      { url: "https://slow.example/" },
    ],
    {
      answerText: ANSWER,
      parseHtml,
      hasPermission: allow,
      fetch: fakeFetch({
        "https://history.example/eiffel": page(200, "<title>Eiffel Tower history</title><p>The Eiffel Tower was completed in 1889 for the World's Fair.</p>"),
        "https://guide.example/berlin": page(200, "<title>Paris guide</title><p>The Eiffel Tower is located in Paris, France.</p>"),
        "https://made-up.example/paper": page(404, "Not here"),
        "https://soft.example/missing": page(200, "<title>Page Not Found</title><p>Sorry.</p>"),
        "https://blocked.example/": page(403, "Forbidden"),
        "https://slow.example/": "timeout",
      }, seen),
    },
  );

  assert.deepEqual(linkChecks.map((c) => c.status), ["ok", "mismatch", "not_found", "not_found", "unreachable", "unreachable", "unreachable"]);
  assert.equal(linkChecks[0].confirmed, true, "a page that backs the sentence is confirmed");
  assert.match(linkChecks[1].note, /conflicts with this sentence/);
  assert.equal(linkChecks[0].sentence, "The Eiffel Tower was completed in 1889 (see [the history page]).");
  assert.equal(linkChecks[0].title, "Eiffel Tower history");
  assert.match(linkChecks[2].note, /may have made up this link/);
  assert.equal(linkChecks[4].httpStatus, 403);
  assert.match(linkChecks[6].note, /too long/);
  assert.deepEqual(evidence.map((e) => [e.id, e.kind, e.source]), [["link:1", "link", "Eiffel Tower history"], ["link:2", "link", "Paris guide"]]);
  assert.equal(seen[0].init.credentials, "omit", "never sends the user's cookies");
});

test("skips links without permission, chat-site links and links over the limit", async () => {
  const seen = [];
  const { linkChecks } = await links.check(
    ["https://no-permission.example/", "https://chatgpt.com/c/123", "https://a.example/", "https://b.example/"],
    {
      parseHtml,
      maxLinks: 3,
      hasPermission: async (origin) => origin !== "https://no-permission.example",
      fetch: fakeFetch({ "https://a.example/": page(200, "<p>Hello</p>") }, seen),
    },
  );
  assert.deepEqual(linkChecks.map((c) => c.status), ["skipped", "skipped", "ok", "skipped"]);
  assert.match(linkChecks[0].note, /Allow link checking/);
  assert.deepEqual(seen.map((s) => s.url), ["https://a.example/"]);
});

test("invalid addresses, unreadable content and plain text pages", async () => {
  const { linkChecks, evidence } = await links.check(
    ["not a url", "https://files.example/report.pdf", "https://text.example/notes.txt"],
    {
      parseHtml,
      hasPermission: allow,
      fetch: fakeFetch({
        "https://files.example/report.pdf": page(200, "%PDF", "application/pdf"),
        "https://text.example/notes.txt": page(200, "Plain notes about towers.", "text/plain; charset=utf-8"),
      }),
    },
  );
  assert.deepEqual(linkChecks.map((c) => c.status), ["not_found", "ok", "ok"]);
  assert.match(linkChecks[1].note, /can't be read/);
  assert.deepEqual(evidence.map((e) => e.text), ["Plain notes about towers."]);
});

test("a whole page can't combine unrelated sentences to confirm a link", async () => {
  const { linkChecks } = await links.check([{ url: "https://mixed.example/", text: "city guide" }], {
    answerText: "The Eiffel Tower is located in Berlin, per [city guide].",
    parseHtml,
    hasPermission: allow,
    fetch: fakeFetch({
      "https://mixed.example/": page(200, "<p>The Eiffel Tower is in Paris.</p><p>Berlin is located in Germany.</p>"),
    }),
  });
  assert.equal(linkChecks[0].confirmed, false, "'Eiffel Tower' and 'Berlin' from different sentences must not confirm the link");
});

test("a page that simply doesn't mention the sentence is ok but not confirmed", async () => {
  const { linkChecks } = await links.check([{ url: "https://silent.example/", text: "source" }], {
    answerText: "The Eiffel Tower was completed in 1889, per [source].",
    parseHtml,
    hasPermission: allow,
    fetch: fakeFetch({ "https://silent.example/": page(200, "<title>Cheese</title><p>Cheddar is a firm cheese from Somerset.</p>") }),
  });
  assert.equal(linkChecks[0].status, "ok");
  assert.equal(linkChecks[0].confirmed, false);
  assert.match(linkChecks[0].note, /doesn't clearly confirm/);
});

test("no links returns empty results", async () => {
  assert.deepEqual(await links.check([], {}), { linkChecks: [], evidence: [] });
});
