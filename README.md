# Hallucination Guard

A Chrome extension that reduces AI hallucinations on **ChatGPT**, **Claude** and **Gemini**. It runs entirely in your browser: no servers, no accounts, no paid services.

Developer: **Rajveer Singh Chopra**

> Working name. The final Web Store name isn't decided yet.

## What it does

- **Answer checker:** highlights each sentence of an AI answer as supported, unverified or contradicted, and shows the source on hover.
- **Fake link detector:** checks that links in the answer exist and actually back up the sentence they're attached to.
- **Prompt booster:** a button in the chat box that asks the AI to cite sources and admit uncertainty, and warns about vague prompts like "what's the latest on it?".
- **Free Wikipedia check:** claims are checked against Wikipedia by default, with no API key.
- **On-device AI check:** on computers that support Chrome's built-in AI (Gemini Nano), a local model judges each claim against the sources. Otherwise, word matching is used.
- **Fact memory:** remembers claims already proven true or false, so repeats are flagged instantly.

Optional sources: web search with your own Brave Search API key, and any page you add with "use this page as a source".

## Install (developer mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder.
4. Open ChatGPT, Claude or Gemini and ask something factual.

To grant link checking or enable on-device AI, open the extension's **Options**.

## How it works

```
AI chat page (content scripts)        Service worker                         Offscreen document
- finds the prompt box and      --->  1. split the answer into claims  --->  - turns web pages into text
  finished answers                    2. answer known claims from memory     - runs the on-device AI judge
- prompt booster (local)              3. gather evidence (links, Wikipedia,
- highlights and link badges   <---      web search, your pages), split into sentences
                                      4. judge each claim (word matching, then on-device AI)
                                      5. score the answer and write the hover notes
```

Ideas borrowed from [reverify](https://github.com/2akouwu/reverify) (MIT):
- **Tools judge, the model doesn't vouch for itself.** Every verdict carries its evidence.
- **Information weight.** Filler, repeats and restatements of your question count for ~0, so an answer can't look trustworthy by verifying only easy claims. An answer is **grounded** only if nothing is contradicted and enough informative claims are verified.
- **Zero false accepts.** The tests include known-false claims that must never come back "supported".
- **Fact memory.** Only verified results are stored, never guesses.

## Permissions

| Permission | Why |
|---|---|
| `chatgpt.com`, `claude.ai`, `gemini.google.com` | Read answers and add highlights and the booster button |
| `wikipedia.org` | Free fact lookups |
| `storage` | Settings and fact memory, kept locally |
| `activeTab`, `scripting` | Read a page only when you click "use this page as a source" |
| `offscreen` | Parse web pages and run the on-device AI outside the page |
| Optional: all websites | Only if you allow link checking; fetches linked pages without your cookies |

See [PRIVACY.md](PRIVACY.md) for exactly what is stored and sent.

## Limitations

- Word matching is conservative. When unsure it says "unverified", so true facts phrased differently from the source may not turn green. The on-device AI check helps where available.
- Wikipedia doesn't cover everything, and it rate-limits bursts of requests.
- The chat sites change their pages often, so a site update can break highlighting until the site adapter is updated.
- Some sites block automated page requests; those links show as "couldn't check", not as fake.

## Development

- Plain JavaScript, no build step and no npm packages. The plan, file ownership and shared data contracts are in [NOTES.md](NOTES.md).
- Run tests (Node 20+): `node --test "extension/tests/*.test.js"`
- `src/`, `tests/` and `demo.py` are the earlier Python prototype, kept as reference only.

```
extension/
  manifest.json
  background/   service-worker.js (check pipeline), offscreen.html/js
  engine/       claims, verifier, scorer, grounder, mitigator, fact-memory, ai-judge
  evidence/     links, wikipedia, web-search, page-sources
  content/      sites/ (ChatGPT, Claude, Gemini adapters), overlay, main.js
  popup/  options/  icons/
  tests/
```

## Credits

Built by **Rajveer Singh Chopra**, with the checking approach inspired by [reverify](https://github.com/2akouwu/reverify) (MIT).

## License

Not chosen yet.
