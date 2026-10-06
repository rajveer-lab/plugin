/**
 * Unit Tests for User Page Sources Evidence Module.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const pageSources = require("../evidence/page-sources.js");

test("pageSources manages user added pages", async () => {
  await pageSources.clear();
  let list = await pageSources.list();
  assert.strictEqual(list.length, 0);

  await pageSources.add({
    title: "Project Notes",
    url: "https://internal.company.com/notes",
    text: "The Q3 roadmap was finalized on August 15.",
  });

  list = await pageSources.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].kind, "page");
  assert.strictEqual(list[0].source, "Project Notes");
  assert.strictEqual(list[0].url, "https://internal.company.com/notes");
  assert.ok(list[0].text.includes("roadmap"));

  await pageSources.clear();
  list = await pageSources.list();
  assert.strictEqual(list.length, 0);
});

test("an AI chat page can't be added as a source, and old ones aren't used", async () => {
  const pageSources = require("../evidence/page-sources.js");
  await assert.rejects(() => pageSources.add({ title: "ChatGPT", url: "https://chatgpt.com/c/6ac3f842", text: "Sure: Bananas grow underground on trees." }), /AI chats can't be used as sources/);
  await pageSources.add({ title: "Bananas - Wikipedia", url: "https://en.wikipedia.org/wiki/Banana", text: "Bananas grow on large herbaceous plants." });
  const sources = await pageSources.list();
  assert.ok(sources.every((source) => !/chatgpt\.com/.test(source.url || "")));
  assert.ok(sources.some((source) => /wikipedia/.test(source.url)));
});
