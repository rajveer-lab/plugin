# Instructions for Codex

You're building **Hallucination Guard**, a Chrome extension (Manifest V3) that fact-checks AI answers on ChatGPT, Claude and Gemini against Wikipedia, Wikidata and the user's own sources. You work together with Claude (Claude Code) on this repo.

## Who leads
**Claude is the lead on this project; you work under Claude's direction.** The user set this up (2026-10-06).
- Your work comes from Claude's messages in `agent-bridge/to-codex.md`. Do what the newest unanswered message asks: no more, no less. Don't start features, refactors or "improvements" of your own.
- If you disagree with an instruction or see a better way, do the task as asked, then say so in your reply. Claude decides.
- If the user asks you directly for something that conflicts with Claude's plan or touches files outside your list, tell the user it needs to go through Claude, and post it as a QUESTION in `from-codex.md`.
- Claude reviews and re-tests everything you hand in. Your work counts as done only after Claude accepts it.
- Claude usually runs you from the command line (`codex exec`). Answer through the mailbox, not by calling the Claude CLI.
- Only one Codex works on a task at a time. If `from-codex.md` shows another Codex run is still working on the same message, stop and ask instead of editing.

## Start of every session
1. Read `NOTES.md`: the plan, the shared contracts, and who owns which file. **Round 3** is the current work and lists your files.
2. Read `agent-bridge/to-codex.md`: Claude's messages to you. Handle the newest ones you haven't answered yet.
3. Reply in `agent-bridge/from-codex.md`. Append, never rewrite. Format:
   `## X-<n> | re: C-<n> | UPDATE / DONE / QUESTION` and a short plain-language body: what you changed (file paths), what you tested, the test output's summary line, and anything left open.

## Hard rules (the user's decisions)
- **Everything runs in the user's browser.** No servers, no paid APIs, no hosted backends.
- **Plain JavaScript, no build step, no npm packages.** Load `extension/` unpacked in Chrome.
- No remotely hosted code, no `eval`, no inline `<script>` blocks or inline event handlers (Manifest V3 CSP). Keep permissions minimal.
- Never put the user's text in URLs or query strings.
- Only edit files NOTES.md assigns to you. If you need a change in someone else's file (or a contract change), ask in `from-codex.md` instead.
- Don't edit `NOTES.md` or this file. Don't touch `src/`, `tests/` (Python, frozen) or `agent-bridge/to-codex.md`.
- Commits: only when the user asks. Plain messages under the user's name; never add AI co-author lines or "Generated with" footers.

## Conventions
- `engine/`, `evidence/` and `ui/` scripts are classic scripts that attach to a shared namespace and also export for Node tests:
  ```js
  (function (root) {
    const AH = (root.AH = root.AH || {});
    AH.reportView = { render, headline, findLinks };
    if (typeof module !== "undefined") module.exports = AH.reportView;
  })(globalThis);
  ```
- Tests: `node --test "extension/tests/*.test.js"` (Node's built-in runner, `node:test` + `node:assert`). The whole suite must pass before you report DONE; paste the `ℹ pass` / `ℹ fail` lines.
- Syntax-check every file you touch: `node --check <file>`.
- UI wording is plain language, no jargon. Every state has a symbol as well as a colour (✓ ✕ ?). Support light and dark mode (`prefers-color-scheme`). Match the existing popup style (`extension/popup/popup.css` variables).
- Accuracy rule for anything touching checking logic: `node tools/accuracy-benchmark.js` and `--holdout` must keep **0 false accepts and 0 false alarms**.

## Claude reviews your work
Claude re-runs your tests and reads your code before wiring it in. Report exactly what you ran and what it printed; if something is untested (e.g. needs a real Chrome), say so rather than claiming it works.
