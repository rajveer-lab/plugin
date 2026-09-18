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
Evidence   { id, text, source, url, kind: "link" | "wikipedia" | "web" | "page" | "memory" }
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
- `extension/evidence/links.js`, `extension/evidence/wikipedia.js`
- `extension/tests/grounder.test.js`, `mitigator.test.js`, `ai-judge.test.js`, `fact-memory.test.js`, `links.test.js`, `wikipedia.test.js`, `pipeline.test.js`
- `README.md`, `PRIVACY.md`

### Shared
- `NOTES.md`: change only with the user's OK. Report progress with UPDATE messages, not by editing this file.
- `agent-bridge/`: mailbox.

---

## Milestones
1. **Skeleton:** manifest, service worker and offscreen doc (Claude); site adapters that detect finished answers on all 3 sites, plus main.js (Antigravity). *Done when:* loading unpacked logs each finished answer's text and links from the service worker.
2. **Engine ports + tests:** claims (with information weight)/verifier (with the zero-false-accept fixture)/scorer (with `grounded`) (Antigravity); grounder/mitigator (Claude). *Done when:* `node --test "extension/tests/*.test.js"` passes.
3. **Evidence + AI judge + memory:** links, Wikipedia, ai-judge, fact memory, full CHECK_ANSWER pipeline (Claude); web search and page sources (Antigravity).
4. **UI:** overlay, booster button, prompt warnings, popup and options (Antigravity).
5. **Store prep:** PRIVACY.md and README (Claude); icons, STORE_LISTING.md and a manual test pass on all 3 sites (Antigravity). *User:* pays the one-time $5 Chrome Web Store developer fee, publishes the privacy policy somewhere public (e.g. GitHub), and submits.
