# Privacy Policy: Hallucination Guard

*Effective date: 17 September 2026*

Hallucination Guard is a Chrome extension that checks answers from AI chat sites (ChatGPT, Claude and Gemini) against sources, flags links that don't exist, and helps you write prompts that reduce made-up answers.

**In short:** everything runs in your browser. The extension has no servers, no accounts, no analytics and no ads, and it never sells or shares your data. The only information that leaves your computer is the lookups needed to check facts, sent only to the services listed below and only for the features you have turned on.

## What the extension reads

- **AI chats on chatgpt.com, claude.ai and gemini.google.com:** the text of your question, the AI's answer, and the links in the answer, so they can be checked. This happens only on those three sites.
- **Pages you choose to add as sources:** when you click "use this page as a source", the extension reads that tab's text.
- **Your settings**, such as which checks are on and your optional search API key.

## What is stored, and where

All storage is local to your browser, using Chrome's extension storage. Nothing is stored on any server.

| Data | Where | How long |
|---|---|---|
| Settings (including an optional Brave Search API key) | `chrome.storage.local` | Until you change them or remove the extension |
| Fact memory: claims that checks proved true or false, a short quote from the source (up to 300 characters) and its link | `chrome.storage.local` | Up to the 500 most recent facts, until you clear it or remove the extension |
| Pages you added as sources | `chrome.storage.session` | Until you close the browser |

The extension does not store your chat history. Answers are checked and then discarded, apart from the fact memory described above.

## What is sent over the network

These requests happen only when the matching feature is on. They are made directly from your browser, with no server in between.

| Feature | Sent to | What is sent |
|---|---|---|
| Wikipedia check (on by default) | Wikipedia (`wikipedia.org`, run by the Wikimedia Foundation) | Search terms: names and short phrases taken from the AI's answer or your question |
| Fake link detector (only after you grant permission in Options) | The websites linked in the AI's answer | A normal page request for each link, **without your cookies or logins** |
| Web search (off by default; needs your own key) | Brave Search API (`api.search.brave.com`) | Your question, or phrases from the AI's answer, plus your API key |

Each service handles these requests under its own privacy policy:
- Wikimedia: https://foundation.wikimedia.org/wiki/Policy:Privacy_policy
- Brave Search API: https://search.brave.com/help/privacy-policy

**On-device AI check:** if you enable it, claims are judged by the AI model built into Chrome (Gemini Nano), which runs on your computer. The claims and sources are not sent anywhere for this.

**Prompt booster:** adds guidelines to your prompt inside the page. It sends nothing itself; the prompt goes to the AI site only when you send it, as usual.

## What the extension never does

- It never sends your data to the developer or to any server run by the developer.
- It never uses analytics, tracking, advertising or fingerprinting.
- It never sells, rents or transfers your data, and never uses it for creditworthiness or lending purposes.
- It never reads sites other than the three AI chat sites, pages you add as sources, and the links it checks for you.
- It never loads code from the internet. All code ships inside the extension.

The use of information received by this extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Your controls

- Turn each check (Wikipedia, links, web search, page sources, on-device AI) on or off in the extension's Options.
- Revoke link-checking permission at any time in Options or `chrome://extensions`.
- Clear fact memory from Options.
- Removing the extension deletes all of its stored data.

## Children

The extension is not directed at children under 13 and does not knowingly collect their information.

## Changes

If this policy changes, the new version will be published at the same address with a new effective date. Changes that affect what data is sent will also be noted in the extension's release notes.

## Contact

Questions about this policy: **[add a contact email here before publishing]** (Rajveer Singh Chopra)
