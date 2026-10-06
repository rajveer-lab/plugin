# Anti-Hallucination Chrome Extension: Plan & Work Split

## Goal
A Chrome extension, published on the Chrome Web Store, that reduces AI hallucinations on **ChatGPT (chatgpt.com), Claude (claude.ai) and Gemini (gemini.google.com)**.

## User's decisions (don't change without asking the user)
- **Everything runs locally in the user's browser.** No servers, no hosting, no paid services.
- **Plain JavaScript, no build step, no npm packages.** Load the `extension/` folder unpacked.
- **Evidence sources:** links in the AI's answer, Wikipedia (free, no key), web search with the user's *own* optional API key, and pages the user adds as sources.
- **First-version features:**
  1. **Answer checker:** highlights each sentence of an AI answer as supported / unverified / contradicted, with the evidence on hover.
  2. **Fake link detector:** checks that each link in the answer exists and that the page supports the sentence it's attached to.
  3. **Prompt booster:** a button in the chat box that adds "cite sources / say I don't know" instructions, and warns about vague prompts ("the latest on it?").
  4. **Free Wikipedia check:** claims are checked against Wikipedia by default.
  5. **On-device AI check:** uses Chrome's built-in AI (Prompt API / Gemini Nano) to judge claim vs evidence where the computer supports it; otherwise falls back to word matching.
  6. **Fact memory:** remembers claims the tools proved true or false (never unverified ones), so a repeated false claim is flagged instantly.

## Borrowed from reverify (github.com/2akouwu/reverify, MIT), adapted from binary files to chat answers
- **The model proposes; tools judge.** Every verdict carries its evidence and which judge decided.
- **Information weight:** trivial claims ("Paris is a city"), duplicates, and restatements of the user's question weigh ~0. Specific claims (numbers, dates, rare names) weigh more. An answer is only **grounded** when nothing is contradicted *and* verified weight reaches a minimum (default 1.0), so an answer can't look trustworthy by verifying only filler.
- **Fact memory** (reverify's ledger): stores only tool-verified results, both "established" and "known false", with their evidence. It's bounded in size.
- **Zero false accepts:** the verifier tests include known-true and known-false claim/evidence pairs, and the suite fails if any known-false claim comes back `supported`.
- The Python code in `src/`, `tests/` and `demo.py` is **frozen reference** for porting. No new Python work, and don't delete it without asking the user.

---

## How it works
```
AI site tab (content scripts)                 Extension service worker                  Offscreen document
- site adapter finds the prompt box    --->   CHECK_ANSWER pipeline:               --->   PARSE_HTML (DOMParser)
  and finished answers                        claims -> evidence -> verdicts              AI_JUDGE (Prompt API)
- prompt booster (runs locally)               -> score -> annotations
- overlay draws highlights & link badges <--- returns report, annotations, link checks
```
- Content scripts can't make cross-origin requests, so **all fetching happens in the service worker**.
- The service worker has no `DOMParser`, so HTML-to-text runs in an **offscreen document** (reason `DOM_PARSER`). The on-device AI judge also runs there if the Prompt API isn't exposed in the service worker.

## Coding conventions
- Every `engine/` and `evidence/` file is a classic script that attaches to a shared namespace and also exports for Node tests:
  ```js
  (function (root) {
    const AH = (root.AH = root.AH || {});
    AH.claims = { extract, splitSentences };
    if (typeof module !== "undefined") module.exports = AH.claims;
  })(globalThis);
  ```
- Service worker loads scripts with `importScripts(...)`. Content scripts are listed in order in `manifest.json`.
- Tests: `node --test "extension/tests/*.test.js"` (Node's built-in runner, no packages; passing the folder alone runs nothing). Test files are `*.test.js` and use `node:test` + `node:assert`.
- Try it: `chrome://extensions` > Developer mode > Load unpacked > select `extension/`.
- No remotely hosted code (Manifest V3 rule). No `eval`. Keep permissions minimal: link checks use **optional** host permissions the user grants in Options.
- Chats never leave the browser except for the lookups the user turned on (the linked pages, Wikipedia, their own search API).

---

## Shared contracts

### Data shapes
```js
Claim      { id, text, type, sentence, sentenceIndex, entities: [], weight /* 0..1+, see information weight */ }
Evidence   { id, text, source, url, kind: "link" | "wikipedia" | "wikidata" | "web" | "page" | "memory",
             topic /* optional: what the page is about, e.g. the Wikipedia article title "Statue of Liberty".
                      Passages often say "the statue" instead of the full name; the verifier may treat
                      topic words as present in every passage of that page */ }
Verdict    { claimId, claimText, status: "supported" | "contradicted" | "unsupported",
             confidence, weight, evidenceId, evidenceText, evidenceUrl, reasoning,
             judge: "heuristic" | "on-device-ai" | "memory", checkedAt /* ISO time */ }
Report     { riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", hallucinationScore, confidenceScore,
             verifiedWeight, grounded /* no contradictions && verifiedWeight >= minInformation */,
             counts: { supported, unsupported, contradicted }, verdicts: [Verdict] }
MemoryFact { key /* normalized claim text */, claimText, status: "supported" | "contradicted",
             evidenceText, evidenceUrl, judge, checkedAt }
LinkCheck  { url, status: "ok" | "not_found" | "unreachable" | "mismatch" | "skipped", httpStatus, title, sentence }
Annotation { sentenceIndex, sentence, status, confidence, evidenceIds: [], note }
```

### Engine APIs
- `AH.claims.extract(text, { question }) -> Claim[]` (sets `weight`; restating the question or an earlier claim gives weight 0), `AH.claims.splitSentences(text) -> string[]`
- `AH.verifier.verifyClaim(claim, Evidence[]) -> Verdict`, `AH.verifier.verifyAll(claims, Evidence[]) -> Verdict[]`
- `AH.scorer.score(Verdict[], { minInformation = 1.0 }) -> Report`
- `AH.factMemory.lookup(claims) -> Promise<Verdict[]>` (hits only), `AH.factMemory.record(Verdict[]) -> Promise<void>` (stores supported/contradicted only), `AH.factMemory.clear()`. Stored in `chrome.storage.local` key `factMemory`, newest 500 facts.
- `AH.grounder.assess(prompt, history) -> { flags: [{ type, detail, clarifyingQuestion }], needsClarification }`
- `AH.grounder.boost(prompt, { strictness }) -> string` (the prompt with instructions appended; web chats have no system prompt)
- `AH.mitigator.annotate(answerText, report, claims, evidence, { strictness }) -> Annotation[]`
- `AH.aiJudge.available() -> Promise<boolean>`, `AH.aiJudge.judge(claim, evidence) -> Promise<Verdict>`

### Site adapter interface (`AH.sites.<id>`)
```js
{ id, matches(location), getPromptInput(), readPrompt(el), writePrompt(el, text),
  observeAnswers(callback) /* callback({ element, text, links, question }) after streaming finishes; returns stop() */ }
```

### Overlay
- `AH.overlay.renderAnswer(answerElement, { report, annotations, linkChecks })`
- `AH.overlay.addBoosterButton(inputElement, onClick)`
- `AH.overlay.showPromptWarnings(inputElement, flags)`

### Messages (`chrome.runtime.sendMessage`)
| type | from -> to | request | response |
|---|---|---|---|
| `CHECK_ANSWER` | content -> service worker | `{ site, question, answerText, links }` | `{ report, annotations, linkChecks, evidence }` |
| `ADD_PAGE_SOURCE` | popup -> service worker | `{ tabId }` | `{ source: { title, url, chars } }` |
| `PARSE_HTML` | service worker -> offscreen | `{ html, url }` | `{ title, text }` |
| `AI_JUDGE` | service worker -> offscreen | `{ claim, evidence }` | `{ verdict }` |

### Settings (`chrome.storage.local`, key `settings`)
```js
{ enabled: true, strictness: "strict", sources: { links: true, wikipedia: true, webSearch: false, pages: true },
  braveApiKey: "", onDeviceAI: true, boosterEnabled: true }
```
Page sources the user adds live in `chrome.storage.session`, key `pageSources`.

---

## File ownership

### Antigravity
- `extension/engine/claims.js`: port of `claim_extractor.py`
- `extension/engine/verifier.js`: port of `verifier.py` (heuristic judge)
- `extension/engine/scorer.js`: port of `scorer.py`
- `extension/content/sites/chatgpt.js`, `claude.js`, `gemini.js`: site adapters (keep each site's DOM selectors in its own file)
- `extension/content/main.js`: wires adapter + overlay + messages
- `extension/evidence/web-search.js`: optional web search with the user's own key (Brave Search)
- `extension/evidence/page-sources.js`: ADD_PAGE_SOURCE handling and stored page sources
- `STORE_LISTING.md`
- `extension/tests/claims.test.js`, `verifier.test.js`, `scorer.test.js`, `web-search.test.js`, `page-sources.test.js`

### Claude
- `extension/manifest.json`
- `extension/background/service-worker.js`: message router and CHECK_ANSWER pipeline
- `extension/background/offscreen.html`, `offscreen.js`: PARSE_HTML, AI_JUDGE
- `extension/engine/grounder.js`: port of `prompt_grounder.py`
- `extension/engine/mitigator.js`: port of `mitigator.py`, producing annotations
- `extension/engine/ai-judge.js`: Chrome built-in AI judge with heuristic fallback
- `extension/engine/fact-memory.js`: fact memory
- `extension/content/overlay.js`, `extension/content/overlay.css`: highlights, hover cards, link badges, booster button, prompt warnings (moved from Antigravity on 2026-09-18, user's decision)
- `extension/popup/*`, `extension/options/*`, `extension/icons/*` (moved from Antigravity on 2026-09-18, user's decision)
- `extension/evidence/links.js`, `extension/evidence/wikipedia.js`, `extension/evidence/wikidata.js` (exact facts as plain sentences; runs under the Wikipedia setting)
- `extension/tests/grounder.test.js`, `mitigator.test.js`, `ai-judge.test.js`, `fact-memory.test.js`, `links.test.js`, `wikipedia.test.js`, `pipeline.test.js`
- `README.md`, `PRIVACY.md`

### Temporary (2026-09-21, user's instruction)
The user is away and asked Claude to do everything, with Antigravity paused. Until the user resumes Antigravity, Claude may edit Antigravity's files as well; each change is listed in Claude's UPDATE messages so Antigravity can catch up.

### Shared
- `NOTES.md`: change only with the user's OK. Report progress with UPDATE messages, not by editing this file.
- `agent-bridge/`: mailbox.

---

## Round 2: prevent and correct (user approved 2026-09-21)

Two features that reduce hallucinations instead of only flagging them:

1. **Grounded prompts (prevention).** The "Improve prompt" button looks up sources for the question *before* it's sent (Wikipedia + the user's saved pages), picks the most relevant passages, and adds them to the prompt with instructions to answer only from them and cite them. If no sources are found, it falls back to the instructions-only booster.
2. **One-click correction (fixing).** A sentence marked "conflicts with sources" gets an "Ask AI to fix this" button (hover card), and the summary panel gets "Ask AI to fix all" when there are conflicts. It writes a correction request into the chat box, quoting the sentence and the conflicting source. **It never sends automatically**: the user reviews and presses send.

### Contracts
- Message `GROUND_PROMPT` (content -> service worker): request `{ site, prompt, history }`, response `{ prompt, sources: [{ title, url }], flags }`. `prompt` is ready to write into the chat box. If nothing relevant was found, `sources` is `[]` and `prompt` has the instructions-only booster.
- `AH.grounder.withSources(prompt, passages, { strictness }) -> string`. `passages` = `[{ text, source, url }]`, numbered [1]..[n] in the prompt, capped at ~3,000 characters of source text.
- `AH.grounder.correctionPrompt(items) -> string`. `items` = `[{ sentence, evidenceText, source, url }]`.
- `AH.wikipedia.lookupQuestion(question, options) -> Promise<Evidence[]>` (a question has no claims to extract names from).
- Overlay: `AH.overlay.renderAnswer(el, { report, annotations, linkChecks, evidence }, { onFix })`. `onFix(items)` is called with the `correctionPrompt` items when the user clicks a fix button. `addBoosterButton(inputEl, onClick)`: `onClick` may return a Promise; the button shows "Finding sources…" until it settles.
- Content (`main.js`): the booster's `onClick` sends `GROUND_PROMPT` and writes `response.prompt` with `adapter.writePrompt`. `onFix(items)` writes `AH.grounder.correctionPrompt(items)` into the chat box and focuses it, without sending.
- Adapters: `writePrompt(el, text)` must work on each site's real editor (ChatGPT/Claude use contenteditable ProseMirror, Gemini a rich-text box). Fire the input events the site listens for so its send button enables, and preserve line breaks.

### Ownership for round 2
- Claude: the `GROUND_PROMPT` handler + passage ranking in `service-worker.js`, `grounder.js` (`withSources`, `correctionPrompt`), `wikipedia.js` (`lookupQuestion`), overlay buttons and states, tests, and the PRIVACY.md update.
- Antigravity: `main.js` wiring (booster -> GROUND_PROMPT -> writePrompt; onFix -> correctionPrompt -> writePrompt + focus), and making `writePrompt` reliable on all 3 sites.

### Accuracy benchmark
`node tools/accuracy-benchmark.js` runs statements with known truth through the real pipeline against live Wikipedia (slow on purpose: ~1 request/second, waits out rate limits). Run it after any change to claims/verifier/evidence/grounding. Hard rule: **false accepts must stay 0** and false alarms must stay 0; the goal is to raise "true facts confirmed" and "false facts caught".
Baseline 2026-09-21: false accepts 0/14, false alarms 0/19, true confirmed 4/19 (21%), false caught 3/14 (21%), grounded prompts contain the answer 5/6.
After verifier/grounding rework (same day): tuning set false accepts 0/14, false alarms 0/19, true confirmed 15/19 (79%), false caught 7/14 (50%), grounded 6/6. Held-out set (never tuned on): false accepts 0/10, false alarms 0/12, true confirmed 11/12 (92%), false caught 2/10.
With Wikidata + subject/relation candidates + "a direct support beats a year/number conflict": tuning set 0/14 false accepts, 0/19 false alarms, 18/19 confirmed (95%), 8/14 caught (57%); held-out 0/10, 0/12, 11/12 confirmed (92%), 4/10 caught (40%).
`--holdout` runs 21 statements on topics never used for tuning; `--grounding` runs only the booster questions; `--fresh` ignores the saved Wikipedia responses in `tools/.cache/`.

Verifier rules that keep false accepts at 0 (don't loosen without re-running both sets):
- Details (names, numbers) must attach to the claim's subject: within 10 meaningful words, and names after the subject unless it's introduced by "by".
- Relation words need a same-meaning word in the passage, from narrow groups ("born" -> birth/birthplace, never "lived"; "founded" never matches "authored").
- A different year or number only contradicts when the passage is about the same relation ("founded ... 1975" vs "founded in 1995").
- A "not" only counts right before the claim's own words.
- Each claim is judged against the top 5 passages; if sources disagree the result is unverified.

Wikidata (2026-09-21): birth/death place and date, founding year, founders and awards become plain sentences ("Mahatma Gandhi was born in Porbandar.") that the verifier judges like any passage. Slots that can hold several true answers (prizes, founders) only count as conflicts when nothing supports the claim.

## Round 3: hallucination percentage + fact-check any text (user approved 2026-10-06)

Partner for this round: **Codex** (Antigravity stays paused). Codex reads `AGENTS.md`; mailbox is `agent-bridge/to-codex.md` (Claude -> Codex) and `agent-bridge/from-codex.md` (Codex -> Claude).

The user's decisions:
- Every result shows a **3-part breakdown**: Confirmed / Hallucinated (conflicts with sources) / Unverified (no source found). Unverified is never counted as hallucinated.
- It appears in three places: on AI answers (ChatGPT/Claude/Gemini), in a paste-any-text box in the popup, and via right-click "Fact-check with Hallucination Guard" on any website.

### Contracts
- `Report.breakdown = { confirmed, hallucinated, unverified }`: whole-number percentages of the answer's *information* (each claim counts by its weight; weight-0 filler and repeats of the question don't count; a contradicted claim always counts, at least 0.4). They add up to exactly 100, a non-zero share never rounds down to 0%, and all three are 0 when there's nothing specific to check.
- Wording and symbols, everywhere: `✓ Confirmed`, `✕ Hallucinated` (sub-label "conflicts with sources"), `? Unverified` (sub-label "no source found"). Colours: confirmed = ok green, hallucinated = bad red, unverified = warn amber (same values as `overlay.css`). Never colour alone.
- Checking any text reuses `CHECK_ANSWER`: `{ site: "checker", question: "", answerText: text, links: [URLs found in the text] }`, same response `{ report, annotations, linkChecks, evidence, errors }`. Text over 20,000 characters is cut, and the UI says so.
- Right-click: the service worker adds a context-menu item (contexts: selection). On click it reads the selection (keeping line breaks when the page allows), stores `{ text, pageTitle, pageUrl, at }` in `chrome.storage.session` key `checkerInput`, and opens `checker/checker.html` in a popup window (~480x680). Text is never put in the URL.
- `checker/checker.html` on load: reads and removes `checkerInput`; if present, fills the box and runs the check right away.
- Shared renderer for extension pages: `AH.reportView.render(container, result, { compact })` in `extension/ui/report-view.js` (+ `report-view.css`). Draws the breakdown bar and percentages, then (unless `compact`) one row per annotated sentence with its status, note, and source link. Pure helpers it exports for tests: `AH.reportView.headline(report) -> { mark, tone, text }`, `AH.reportView.findLinks(text) -> string[]`.

### Accuracy work in round 3 (2026-10-06)
- **Wikidata relation checks** (`evidence/wikidata.js`, query service `query.wikidata.org`): present-tense "X is (located) in Y", "X flows through/into Y", "X is the capital of Y", "X painted/wrote/composed/directed/sculpted Y". A wrong claim becomes a sentence stating the fact ("The Eiffel Tower is in Paris, France, not in Lyon."). A conflict is only stated when *every* Wikidata item the names could mean is ruled out (different continent, different current country, or a small place far away; a different river mouth; a different current capital; a work with known creators that don't include the subject). Correct claims get no sentence, so these checks can't cause a false accept. Failures stay silent.
- **Evidence contract:** `Evidence.exact = true` marks these structured sentences. A conflict from exact evidence outweighs a loose word match ("Sources disagree" -> unverified, never supported). They carry no `topic`.
- **Verifier rules added:** names built on a common noun need their distinctive words ("North Sea" isn't found in "Black Sea"; "Mount Kenya" isn't Kilimanjaro); a "not" only counts against the claim it's about (no other name right after it, and no other subject right before "is/was/did not"); a denied slot ("is not the capital of") states no value; slot conflicts need the claim's subject in the passage; date-only brackets don't push words apart; the sentence splitter keeps brackets and abbreviations ("O.S.", "St.") together. Sentence-initial one-word names count as names when the answer or question uses them mid-sentence.
- **Benchmark sets:** tuning, `--holdout`, `--holdout2`, `--holdout3`. Each new set is written before the fixes it measures; once its failures have been looked at, it's no longer unseen and a new one is written.
  - Before (morning): tuning 8/14 caught; holdout 4/10 caught; 0 false accepts on both.
  - holdout2, first run (never seen): **4 false accepts of 11** (Toronto/Sydney capitals, Danube->North Sea, Kilimanjaro->Kenya). This exposed the word-matching weaknesses fixed above. After the fixes: 0 false accepts, 0 false alarms.
  - After: tuning 0/14 false accepts, 0/19 false alarms, 18/19 confirmed, 12/14 caught; holdout 0/10, 0/12, 12/12, 9/10 caught; holdout2 0/11, 0/12, 11/12, 7/11 caught.
  - holdout3, first run (never seen): 2 false accepts of 13 (Rio "capital" of a state; Harvard "in New York" from The New York Times). Fixed: capital claims need "capital ... of X" in the present tense; multi-word names inside longer names don't count.
  - holdout4 (Codex, realistic chat-style answers), first run: 2 false accepts of 8, 0/8 caught, 7/16 confirmed. Cause: "It/She" sentences. Fixed: pronoun resolution from the question/last person, pronoun-led claims with no name never confirmed, "first published in YEAR" binds to the year after "first", brackets take no distance, sentence-opening "It" anchors the subject, Wikidata confirms place claims whose every place is in the subject's current chain.
  - holdout5 (Codex, realistic, fresh), first run on that code: 1 false accept of 8 ("Opera House" matched "Wright House"), 1 false alarm of 16 ("born in Scotland" vs "Lochfield"), 9/16 confirmed, 4/8 caught. Fixed: more common-noun name heads (house, hall, theatre...), and a region (country, state, continent) never conflicts with a place by word matching.
  - Latest (2026-10-06, all six sets): 0 false accepts and 0 false alarms everywhere. Confirmed: 95%, 100%, 92%, 85% on the clean sets; 56% and 56% on the realistic sets. Caught: 79%, 90%, 82%, 69%; 38% and 50% on realistic. Recall on realistic answers is the main open work. The next unseen realistic set (HOLDOUT6) should be written before any more tuning.
- **Never a source:** AI chat sites (ChatGPT, Claude, Gemini, Copilot, Perplexity, ...) can't be added as page sources, and fact memory never stores or uses facts whose evidence came from one (found in the user's live test: "Bananas grow underground on trees" was confirmed by ChatGPT's own page).
- **Site readers (live test 2026-10-06):** an answer counts as finished once its text is unchanged for 1.5 s (not by a stop button or a quiet page); readers re-check every 1-1.5 s, and the Improve-prompt button is re-added whenever the chat box is replaced.
- **UI:** shared drawn icon set `ui/icons.js` (`AH.icons.icon(name)`), loaded as a content script before `overlay.js` and by every extension page. No text glyphs or emoji for icons. `tools/ui-preview/` renders every screen with fake Chrome APIs for visual checks (`python tools/ui-preview/serve.py`).

### Ownership for round 3
- Claude: `scorer.js` breakdown (+ tests), overlay % chip and bar on AI answers, service worker context menu + `checkerInput` handoff, `manifest.json` (`contextMenus` permission), PRIVACY.md/README.
- Codex: `extension/ui/report-view.js` + `.css`, `extension/checker/*` (the window page), the paste box section in `popup/*`, and tests in `extension/tests/report-view.test.js`.

## Round 4: check the AI against your own conversation (user approved 2026-10-06)

Why: several extensions already check AI answers against Wikipedia/the web (Fact It, HalluCheck, Theia, AI Fact Checker...). The user wants something new. Ideas taken from iFixAi (Apache 2.0: B17 fact consistency, V03 warranted persistence) and Future AGI (Apache 2.0: groundedness, conversation hallucination). Everything stays local: conversation text is never sent anywhere.

Four checks, all from the conversation already on the page:
1. **Pasted text.** When a user message contains pasted text (a document, article, notes), the answer's claims are checked against it like any source: matches it -> Confirmed, conflicts with it -> Hallucinated ("conflicts with the text you pasted"). Short questions are never sources.
2. **Contradicts itself.** A claim that conflicts with an earlier answer in the same chat is flagged. Sources decide who was right when they can.
3. **"Are you sure?" test.** A hover-card button writes a neutral pushback about that sentence into the chat box (never sent automatically). After the user sends it, the next answer is compared with the earlier one: held a correct answer, fixed a wrong one, caved on a correct one, or dug in on a wrong one.
4. **Misquotes you.** A sentence that says what the user said/wants ("as you mentioned, your budget is $500") is checked against the user's own messages.

### Contracts
- Site adapters: `observeAnswers` callback gets `{ element, text, links, question, history }`. `history` = the turns before this answer, oldest first, ending with the user message it replies to: `[{ role: "user" | "assistant", text }]`, text extracted like the answer (line breaks kept, our own overlay elements skipped). Built with `AH.siteHistory.build(turns)` (`content/sites/history.js`): drops empty turns, keeps the last 20, cuts each to 20,000 chars and the total to 60,000 (oldest dropped first). Turns the page hasn't loaded are simply missing.
- `CHECK_ANSWER` request adds `history` (optional; the checker window may send `[{ role: "user", text: sourceText }]`). Response adds `consistency: ConsistencyItem[]`. `report` and its 3-part breakdown are unchanged; pasted-text verdicts count in it like any source.
- `Evidence.kind: "conversation"` for pasted user text (`source: "Your message"`, no url). Never stored in fact memory. External sources outrank it: it's only consulted for claims external sources leave unverified.
- `ConsistencyItem { type, sentence, sentenceIndex, earlier, earlierRole: "assistant" | "user", afterPushback, tone: "ok" | "bad" | "warn", note }`. Types:
  - `changed_unknown` (warn): conflicts with its earlier answer; no source says which is right.
  - `changed_fixed` (ok): conflicts with its earlier answer, and sources back the new one.
  - `changed_wrong` (bad): sources back the earlier answer (after a pushback: "caved").
  - `held_correct` (ok) / `held_wrong` (bad) / `held_unknown` (warn): after a pushback only; it repeated the questioned claim.
  - `misquote` (bad): says the user said/wants something that conflicts with the user's messages.
- `AH.conversation` (`engine/conversation.js`): `pastedSources(history) -> Evidence[]`, `askOf(text) -> string` (the user's actual request, without pasted text; used as `question` for claims and lookups so pasted text is never searched), `isPushback(text)`, `compare({ claims, verdicts, history, evidence }) -> ConsistencyItem[]`.
- `AH.grounder.pushbackPrompt(sentence) -> string`. Overlay: `renderAnswer(el, result, { onFix, onPushback })`; `onPushback(sentence)` writes the prompt into the chat box and focuses it, without sending.
- Benchmark: `tools/conversation-cases.js` (cases, written by Codex before the engine is tuned) and `tools/conversation-benchmark.js` (runner). Hard rule as before: **0 false alarms** (nothing flagged that shouldn't be).

- Sources, updated after the first test run: what a user **states** (any non-question sentences, 25+ characters) is a source, not only long pasted text; questions never are; a pushback message is never a source (it quotes the AI). `askOf` only trims messages with 200+ characters of statements.

### Ownership for round 4
- Claude: `engine/conversation.js` + tests, service-worker integration, `grounder.pushbackPrompt`, mitigator notes, fact-memory exclusion, overlay (consistency marks, panel line, "Are you sure?" button), `manifest.json`, `tools/conversation-benchmark.js`, README/PRIVACY.
- Codex: `content/sites/history.js` (+ `tests/site-history.test.js`), `content/sites/chatgpt.js`, `claude.js`, `gemini.js` (history), `content/main.js` (history + onPushback wiring), `tools/conversation-cases.js`. Antigravity stays paused; these adapter files move to Codex for this round.

### Learning, not hand-tuning (user's decision, 2026-10-06)
The user doesn't want the checker tuned to predefined data; it should learn. Chosen: **on-device AI + learning from feedback**.
- **Test sets are exams only.** Run once, report honestly, never tune rules to pass them. When a set's failures have been looked at, a fresh unseen set is written (`tools/conversation-cases-2.js` next).
- **On-device AI judges the conversation checks** when Chrome's built-in model (Gemini Nano) is available: it decides whether an answer sentence matches, conflicts with, or doesn't address the pasted text / an earlier statement, using `AH.aiJudge.judge(claim, passages)`. The rules only pick candidate passages, and are the fallback on computers without the model.
- **A local learner** (`engine/learner.js`, nearest neighbours, plain JS): it remembers labelled examples as number vectors and judges a new check by the examples that look almost the same (cosine >= 0.85), on top of a prior of 0.9. Chosen over logistic regression because with a handful of clicks a regression spreads the blame for one wrong flag over features every check shares and starts hiding unrelated checks. `AH.learner.createLearner(state) -> { predict(head, features) -> p, shows(head, features), update(head, features, label, { auto }), toJSON(), stats() }`; also `featuresForVerdict(verdict, claim, evidence)` and `featuresForItem(item, claim, basis)`. Heads: `"supported"`, `"contradicted"`, `"consistency"`. `features` is a flat `{ name: number }` object of 0..1 signals (which judge, which kind of source, exact or not, claim weight, has a name/number/date, first or second person, hedges, word overlap, finding type, after a pushback...). No text is ever stored. State in `chrome.storage.local` key `learner`.
- **It can only make the checker more careful.** A verdict or finding is shown only if `p >= 0.5`; the start state gives p ≈ 0.9 everywhere (no change until it learns). Below 0.5, supported/contradicted become unverified and a finding is dropped. It never turns anything into "supported" (zero false accepts holds).
- **Teachers:** the user's Right/Wrong clicks (a "wrong" counts 3x a "right": caution is learned faster than confidence), and exact Wikidata facts, automatically: when an exact fact settles a claim, the word-matching verdict on that same claim becomes a labelled example (at 0.3x weight). Never its own verdicts.
- Results carry what's needed to learn: `Annotation.learn` and `ConsistencyItem.learn` = `{ head, features }`.
- Messages: `FEEDBACK` `{ head, features, label: 1 | 0 }` -> `{ ok, stats }`; `LEARNER_STATS` -> `{ stats }`; `LEARNER_RESET` -> `{ ok }`. `stats` = `{ right, wrong, auto }` counts.
- Overlay: `renderAnswer(el, result, { onFix, onPushback, onFeedback })`; `onFeedback({ head, features, label })`.
- Ownership: Claude: `learner.js` + tests, features and gating in the service worker, `FEEDBACK`/`LEARNER_*` handlers, AI judging in conversation checks, overlay feedback buttons. Codex: `main.js` `onFeedback` wiring, feedback buttons in the checker window (`ui/report-view.*`), an Options section showing what it has learned with a reset button, tests, and `tools/conversation-cases-2.js` (the fresh exam).

### A real, working model, and easy setup (user, 2026-10-06/07)
- "It should have a valid working model" + "the application should be easy". The on-device model is Gemini Nano through Chrome's Prompt API. It is **only in Google Chrome**: Chromium builds (including the Claude app's built-in browser) ship a placeholder that says "available" and echoes the prompt back. `ai-judge.js` detects that echo once and then reports `"unsupported"`, so checks don't wait on it.
- Validated on the user's laptop (Google Chrome 154, RTX 4050 6 GB): Gemini Nano was already installed. First question ~23 s (warm-up), then ~2-3 s each. Spot checks: true claim supported, "in Lyon" contradicted, "aisle seat" vs pasted "window seat" contradicted (the rules can't), invented "Dr. Elian Moss" vs an unrelated Wikipedia "Moss" unsupported (the rules wrongly contradicted it).
- `tools/ai-validation/` runs the exams through the real pipeline with the real model in a Chrome tab (Wikipedia from the Node exams' saved responses). Node can't run the model, so `tools/conversation-benchmark.js` measures only the rules fallback.
- Setup is one click: on first install the service worker opens `welcome/welcome.html` (Codex) with one "Turn on the AI checker" button; the popup shows the AI status with a Set up button (`ui/ai-status.js`).
- Exam results, set 2 (fresh, run once): rules only (Node): 0 false accepts, 8 false alarms, 4/9 hallucinations caught, 9/18 confirmed, 4/12 conversation findings. With the real model (Chrome 154, same Wikipedia responses): 2 flagged as false alarms, both correct on review (84 vs the user's 48 guests; "Don Quixote was written in Portuguese"), so 0 real false alarms; 5/9 caught; 16/18 confirmed; 8/12 findings; 165 AI questions at 2.6 s each (about 16 s per answer), 1 failed and fell back. **2 false accepts** by the model ("18:00" vs the source's 18:15; "ten" vs "twelve"): its "supported" guard compared digits piece by piece and ignored number words. Fixed: whole values ("18:00" is one value) and number words count, with tests. Set 2 is now seen; set 3 (Codex, C-12) re-measures.
- Open: with the model, checking an answer takes ~15-25 s; a "Checking this answer…" chip shows at once. Better: show the rules' result first and refine it when the AI is done.

### Live test on ChatGPT and removals (2026-10-07)
- Live test in the user's Chrome (temporary chats): chatgpt.com's 2026 markup had no `data-message-author-role` / `article` / `.markdown`, so the extension saw no answers. Fixed in `content/sites/chatgpt.js`: turns are `[data-chatgpt-search-unit-key$=":assistant"]` / `":user"`, the text is in `[data-chatgpt-selection-message-id]`, and citation chips `a[data-testid="chatgpt-citation"]` are skipped. Then on real ChatGPT: "Lyon" flagged from Wikidata and judged by Gemini Nano, the true sentences confirmed, and "Are you sure?" -> ChatGPT held -> "stood by its answer". One live false alarm: an instruction ("Reply with exactly these sentences: ...") was used as a source, and the AI read "31 March 1889" as conflicting with "1889". Fixed: requests are no longer sources (what follows a request's colon still is), and the AI judge's "contradicted" is downgraded when the claim only adds numbers to the source's.
- **The "Improve prompt" feature is removed** (user: "it looks like a gimmick"): the booster button, prompt warnings, `GROUND_PROMPT` and the grounded-prompt lookup (`groundPrompt`, `rankPassages`, `wikipedia/wikidata.lookupQuestion`, `grounder.assess/boost/withSources`), its setting and its tests. `engine/grounder.js` keeps only `correctionPrompt` and `pushbackPrompt`. Round 2's grounded-prompts section above is history.

## Milestones
1. **Skeleton:** manifest, service worker and offscreen doc (Claude); site adapters that detect finished answers on all 3 sites, plus main.js (Antigravity). *Done when:* loading unpacked logs each finished answer's text and links from the service worker.
2. **Engine ports + tests:** claims (with information weight)/verifier (with the zero-false-accept fixture)/scorer (with `grounded`) (Antigravity); grounder/mitigator (Claude). *Done when:* `node --test "extension/tests/*.test.js"` passes.
3. **Evidence + AI judge + memory:** links, Wikipedia, ai-judge, fact memory, full CHECK_ANSWER pipeline (Claude); web search and page sources (Antigravity).
4. **UI:** overlay, booster button, prompt warnings, popup and options (Antigravity).
5. **Store prep:** PRIVACY.md and README (Claude); icons, STORE_LISTING.md and a manual test pass on all 3 sites (Antigravity). *User:* pays the one-time $5 Chrome Web Store developer fee, publishes the privacy policy somewhere public (e.g. GitHub), and submits.
