# Privacy Policy: Hallucination Guard

*Effective date: 6 October 2026*

Hallucination Guard is a Chrome extension that checks answers from AI chat sites (ChatGPT, Claude and Gemini), and any text you choose to fact-check, against sources, flags links that don't exist, and helps you write prompts that reduce made-up answers.

**In short:** everything runs in your browser. The extension has no servers, no accounts, no analytics and no ads, and it never sells or shares your data. The only information that leaves your computer is the lookups needed to check facts, sent only to the services listed below and only for the features you have turned on.

## What the extension reads

- **AI chats on chatgpt.com, claude.ai and gemini.google.com:** the text of your question, the AI's answer, and the links in the answer, so they can be checked. To compare an answer with the rest of the conversation, it also reads the earlier messages of that chat that are on the page (yours and the AI's): text you pasted in, what the AI said before, and what you told it. This happens only on those three sites.
- **Text you choose to fact-check:** text you paste into the fact checker, or text you select on a website and right-click "Fact-check with Hallucination Guard". The extension reads the selection only when you click that menu item, and only that selection.
- **Pages you choose to add as sources:** when you click "use this page as a source", the extension reads that tab's text.
- **Your settings**, such as which checks are on and your optional search API key.

## What is stored, and where

All storage is local to your browser, using Chrome's extension storage. Nothing is stored on any server.

| Data | Where | How long |
|---|---|---|
| Settings (including an optional Brave Search API key) | `chrome.storage.local` | Until you change them or remove the extension |
| Fact memory: claims that checks proved true or false, a short quote from the source (up to 300 characters) and its link | `chrome.storage.local` | Up to the 500 most recent facts, until you clear it or remove the extension |
| Pages you added as sources | `chrome.storage.session` | Until you close the browser |
| Text you right-clicked to fact-check, while the checker window opens | `chrome.storage.session` | Removed as soon as the checker window reads it |
| What it has learned: for each check you marked right or wrong, and each exact fact it learned from, a short list of numbers describing that check (such as which kind of source it used and whether the sentence had a name or a date), and whether it was right. Never the text of the answer, your messages or the source | `chrome.storage.local` | Up to 300 examples per kind of check, until you click "Forget what it learned" in Options or remove the extension |

The extension does not store your chat history. Answers, earlier messages and text you fact-check are checked and then discarded, apart from the fact memory described above. Fact memory never stores anything that was settled only by text from your own conversation.

## What is sent over the network

These requests happen only when the matching feature is on. They are made directly from your browser, with no server in between.

| Feature | Sent to | What is sent |
|---|---|---|
| Wikipedia check (on by default) | Wikipedia (`wikipedia.org`) and Wikidata (`wikidata.org`, including its query service `query.wikidata.org`), both run by the Wikimedia Foundation | Search terms: names and short phrases taken from the AI's answer or the text you fact-check |
| Fake link detector (only after you grant permission in Options) | The websites linked in the AI's answer or the text you fact-check | A normal page request for each link, **without your cookies or logins** |
| Web search (off by default; needs your own key) | Brave Search API (`api.search.brave.com`) | Your question, or phrases from the AI's answer, plus your API key |

Each service handles these requests under its own privacy policy:
- Wikimedia: https://foundation.wikimedia.org/wiki/Policy:Privacy_policy
- Brave Search API: https://search.brave.com/help/privacy-policy

**Conversation checks:** comparing an answer with text you pasted into the chat, with the AI's earlier answers and with what you told it all happens inside your browser. Earlier messages and pasted text are never sent anywhere, and pasted text is never used as a search term.

**On-device AI check:** if you enable it, claims are judged by the AI model built into Chrome (Gemini Nano), which runs on your computer. It also judges the conversation checks: whether a sentence matches or conflicts with text you pasted or an earlier message. The claims, sources and messages are not sent anywhere for this.

**Learning from your feedback:** when you mark a check right or wrong, or when an exact fact from Wikidata settles a claim, the extension stores the numbers described in the table above, on your computer only. It uses them to stop showing checks that look like ones you marked wrong. It never sends them anywhere.

**Ask AI to fix this:** writes a correction request into the chat box, quoting the sentence and the source it conflicts with. It never sends anything on its own; you review it and press send.

**Ask "Are you sure?":** writes a neutral question about one sentence into the chat box. It never sends anything on its own; you press send.

## What the extension never does

- It never sends your data to the developer or to any server run by the developer.
- It never uses analytics, tracking, advertising or fingerprinting.
- It never sells, rents or transfers your data, and never uses it for creditworthiness or lending purposes.
- It never reads sites other than the three AI chat sites, pages you add as sources, text you select and right-click to fact-check, and the links it checks for you.
- It never loads code from the internet. All code ships inside the extension.

The use of information received by this extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Your controls

- Turn each check (Wikipedia, links, web search, page sources, on-device AI) on or off in the extension's Options.
- Revoke link-checking permission at any time in Options or `chrome://extensions`.
- Clear fact memory from Options.
- Clear what it has learned with "Forget what it learned" in Options.
- Removing the extension deletes all of its stored data.

## Children

The extension is not directed at children under 13 and does not knowingly collect their information.

## Changes

If this policy changes, the new version will be published at the same address with a new effective date. Changes that affect what data is sent will also be noted in the extension's release notes.

## Contact

Questions about this policy: **[add a contact email here before publishing]** (Rajveer Singh Chopra)
