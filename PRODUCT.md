# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyday users of AI chat tools — ChatGPT, Claude, and Gemini — who want to trust the answers they get without needing to understand how fact-checking works. They range from students and researchers to professionals using AI for research, writing, and decision-making. They are not expected to read source code or configure APIs; anything optional (Brave Search key, link checking) is surfaced through the Options page, not the main UI.

## Product Purpose

Hallucination Guard is a Chrome extension that automatically fact-checks AI responses in real time, directly on the page. It highlights each sentence as supported (green), unverified (amber), or contradicted (red), flags fake or broken links, and offers a one-click prompt booster. Everything runs locally — no servers, no accounts, no data leaves the browser except for lookups the user explicitly turns on.

Success means a user never unknowingly acts on a fabricated fact from an AI answer.

## Positioning

The only free, zero-configuration, on-device hallucination checker for the three major AI chat sites. Competitors either require cloud accounts, cost money, or only check links. Hallucination Guard uses Wikipedia by default (no key), Chrome's built-in Gemini Nano for neural verification where available, and a fact memory ledger so repeated false claims are flagged in milliseconds — all without sending chat content anywhere.

## Operating Context

Users interact with the extension invisibly: it activates when an AI response finishes and annotates the page. The popup shows a grounding score. The Options page manages optional permissions and API keys. Users on capable hardware get on-device AI verification automatically; others get word-matching with no visible difference in the UI flow.

## Capabilities and Constraints

- Supported sites: chatgpt.com, claude.ai, gemini.google.com
- Plain JavaScript, no build step, no npm packages — loaded unpacked from the `extension/` folder
- No remotely hosted code (Manifest V3 requirement); no `eval`
- Evidence sources: links in the AI answer, Wikipedia (free, no key), optional Brave Search API (user's own key), pages the user adds as sources
- On-device AI check: Chrome Prompt API (Gemini Nano) where available; falls back to word matching silently
- Fact memory: stores only tool-verified results (never guesses), bounded in size
- Cross-origin fetching is done in the service worker, not content scripts
- Link checking requires optional `<all_urls>` host permission (user grants in Options)
- Final Web Store name: **Hallucination Guard** (confirmed)
- License: not yet chosen
- Pricing: free

## Brand Commitments

- Developer: Rajveer Singh Chopra
- Chrome Web Store title: `Hallucination Guard: AI Fact-Checker`
- Privacy-first positioning is non-negotiable: no chat content, no telemetry, no third-party servers
- The shield/guard metaphor is established (popup icon, "🛡️ Boost Prompt" button)

## Evidence on Hand

- Full working extension in `extension/` (manifest, engine, content scripts, popup, options)
- Python prototype in `src/`, `tests/`, `demo.py` — frozen reference, not deleted
- `STORE_LISTING.md` with approved store copy
- `PRIVACY.md` with the data policy
- `NOTES.md` with the full technical plan and shared data contracts
- No real user testimonials or press coverage yet; none should be fabricated

## Product Principles

1. **Trust is earned by evidence, not by the model.** Every verdict carries its source; the AI never vouches for itself.
2. **Zero friction for everyday users.** Wikipedia works out of the box; optional features stay optional and never block the core flow.
3. **Privacy is the product.** Nothing leaves the browser unless the user explicitly enables it; this is a feature, not a caveat.
4. **Honest about uncertainty.** "Unverified" is a legitimate result; the extension never inflates confidence to look better.
5. **Lightweight and durable.** No build step, no dependencies — the extension must survive AI site redesigns and Chrome updates with minimal maintenance.

## Accessibility & Inclusion

WCAG 2.1 AA required across all extension surfaces: popup, options page, and in-page overlays (highlights, hover tooltips, link badges, prompt booster button).
