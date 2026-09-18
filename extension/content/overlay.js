/**
 * Hallucination Guard overlay.
 *
 * Draws the result on top of ChatGPT, Claude and Gemini:
 * - a small chip above the answer that expands into details on click
 * - underlines on checked sentences, with a hover card naming the source
 * - a badge next to each link that was checked
 * - the prompt booster button and ambiguity warnings near the chat box
 *
 * Wording avoids jargon, every state carries a symbol as well as a colour,
 * and colours come from the host page's theme.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const SENTENCE = {
    supported: { mark: "✓", word: "Backed by sources", cls: "ah-ok" },
    contradicted: { mark: "✕", word: "Conflicts with sources", cls: "ah-bad" },
    unsupported: { mark: "?", word: "Not found in sources", cls: "ah-unknown" },
  };

  const LINK = {
    ok_confirmed: { mark: "✓", word: "Source checks out" },
    ok: { mark: "✓", word: "Link works" },
    not_found: { mark: "✕", word: "Page doesn't exist" },
    mismatch: { mark: "✕", word: "Page says otherwise" },
    unreachable: { mark: "?", word: "Couldn't open" },
    skipped: { mark: "·", word: "Not checked" },
  };

  const JUDGE = {
    memory: "checked earlier",
    "on-device-ai": "checked by on-device AI",
    heuristic: "word match",
  };

  let tooltip = null;
  let hideTimer = null;

  /** Reads the host page's theme so the overlay doesn't sit bright-on-dark. */
  function themeClass(element) {
    let node = element;
    while (node && node !== document.documentElement) {
      const color = getComputedStyle(node).backgroundColor;
      const parts = color && color.match(/[\d.]+/g);
      if (parts && parts.length >= 3 && (parts.length < 4 || Number(parts[3]) > 0.1)) {
        const [r, g, b] = parts.map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "ah-dark" : "ah-light";
      }
      node = node.parentElement;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "ah-dark" : "ah-light";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** One plain-language line for the chip. */
  function summarize(report, linkChecks) {
    const counts = (report && report.counts) || {};
    const supported = counts.supported || 0;
    const contradicted = counts.contradicted || 0;
    const unsupported = counts.unsupported || 0;
    const total = supported + contradicted + unsupported;
    const fake = (linkChecks || []).filter((check) => check.status === "not_found").length;

    let mark = "·";
    let tone = "ah-tone-mute";
    let text = "Nothing to check in this answer";

    if (contradicted > 0) {
      mark = "✕";
      tone = "ah-tone-bad";
      text = `${contradicted} statement${contradicted > 1 ? "s" : ""} conflict${contradicted > 1 ? "" : "s"} with sources`;
    } else if (total === 0) {
      // keep the neutral default
    } else if (supported === total) {
      mark = "✓";
      tone = "ah-tone-ok";
      text = `All ${total} statement${total > 1 ? "s" : ""} backed by sources`;
    } else if (supported > 0) {
      mark = "✓";
      tone = "ah-tone-ok";
      text = `${supported} of ${total} statements backed by sources`;
    } else {
      mark = "?";
      tone = "ah-tone-warn";
      text = `None of the ${total} statements could be checked`;
    }

    if (fake > 0) text += ` · ${fake} fake link${fake > 1 ? "s" : ""}`;
    return { mark, tone, text };
  }

  function buildPanel(report, linkChecks, evidence, theme) {
    const counts = (report && report.counts) || {};
    const panel = el("div", `ah-panel ${theme}`);
    panel.hidden = true;

    const rows = [
      ["supported", counts.supported || 0],
      ["contradicted", counts.contradicted || 0],
      ["unsupported", counts.unsupported || 0],
    ];
    for (const [status, count] of rows) {
      if (!count) continue;
      const row = el("div", "ah-panel-row");
      row.appendChild(el("b", null, `${SENTENCE[status].mark} ${count}`));
      row.appendChild(el("span", null, SENTENCE[status].word.toLowerCase()));
      panel.appendChild(row);
    }

    const problems = (linkChecks || []).filter((check) => check.status === "not_found" || check.status === "mismatch");
    if (problems.length) {
      const row = el("div", "ah-panel-row");
      row.appendChild(el("b", null, `✕ ${problems.length}`));
      row.appendChild(el("span", null, "link" + (problems.length > 1 ? "s" : "") + " that don't support the answer"));
      panel.appendChild(row);
    }

    const sources = [...new Set((evidence || []).map((item) => item.source).filter(Boolean))].slice(0, 4);
    if (sources.length) {
      panel.appendChild(el("div", "ah-panel-sources", `Checked against: ${sources.join(", ")}`));
    }

    if (report && report.grounded) {
      panel.appendChild(el("div", "ah-panel-note", "Enough specific facts were confirmed to call this answer grounded."));
    } else if ((counts.supported || 0) + (counts.unsupported || 0) + (counts.contradicted || 0) > 0) {
      panel.appendChild(el("div", "ah-panel-note", "Not enough specific facts were confirmed, so treat the details as unverified."));
    }

    panel.appendChild(el("div", "ah-panel-foot", "Underlined sentences show what was checked; hover one to see its source. Automatic checks can be wrong."));
    return panel;
  }

  // ---- hover card ----

  function hideTooltip(now) {
    clearTimeout(hideTimer);
    const remove = () => {
      if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      tooltip = null;
    };
    if (now) remove();
    else hideTimer = setTimeout(remove, 220);
  }

  function showTooltip(anchor, data, theme) {
    hideTooltip(true);
    const info = SENTENCE[data.status] || SENTENCE.unsupported;

    tooltip = el("div", `ah-tooltip ${theme}`);
    const head = el("div", "ah-tooltip-head");
    head.appendChild(el("span", null, `${info.mark} ${info.word}`));
    const by = JUDGE[data.judge] || JUDGE.heuristic;
    head.appendChild(el("span", "ah-tooltip-by", data.confidence ? `${by} · ${Math.round(data.confidence * 100)}%` : by));
    tooltip.appendChild(head);

    if (data.note) tooltip.appendChild(el("div", "ah-tooltip-note", data.note));

    if (data.url) {
      try {
        const parsed = new URL(data.url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const link = el("a", "ah-tooltip-source", `Open source: ${parsed.hostname}`);
          link.href = data.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          tooltip.appendChild(link);
        }
      } catch (error) {
        /* not a usable URL */
      }
    }

    tooltip.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    tooltip.addEventListener("mouseleave", () => hideTooltip());
    document.body.appendChild(tooltip);

    const box = anchor.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - size.width - 12, Math.max(12, box.left));
    const below = box.bottom + 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${below + size.height > window.innerHeight - 12 ? Math.max(12, box.top - size.height - 8) : below}px`;
  }

  // ---- sentence marking ----

  function textNodesIn(element) {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.nodeValue ? node.parentElement : null;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".ah-summary, .ah-link-badge, .ah-booster-btn, .ah-prompt-warning, .ah-sentence")) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = parent.tagName.toLowerCase();
        return tag === "script" || tag === "style" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  /** Underlines one sentence, even when it spans bold or linked parts. */
  function markSentence(answerElement, annotation, evidenceById, theme) {
    const sentence = (annotation.sentence || "").trim();
    if (!sentence) return;

    const nodes = textNodesIn(answerElement);
    let combined = "";
    const offsets = nodes.map((node) => {
      const start = combined.length;
      combined += node.nodeValue;
      return { node, start, end: combined.length };
    });

    let start = combined.indexOf(sentence);
    let end = start + sentence.length;
    if (start === -1) {
      const loose = new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
      const match = combined.match(loose);
      if (!match || match.index === undefined) return;
      start = match.index;
      end = start + match[0].length;
    }

    const evidence = (annotation.evidenceIds || []).map((id) => evidenceById.get(id)).find(Boolean);
    const info = SENTENCE[annotation.status] || SENTENCE.unsupported;
    const data = {
      status: annotation.status,
      confidence: annotation.confidence,
      judge: annotation.judge,
      note: annotation.note,
      url: evidence && evidence.url,
    };

    for (let i = offsets.length - 1; i >= 0; i--) {
      const entry = offsets[i];
      if (entry.end <= start || entry.start >= end) continue;

      const from = Math.max(0, start - entry.start);
      const to = Math.min(entry.node.nodeValue.length, end - entry.start);
      const value = entry.node.nodeValue;
      const middle = value.slice(from, to);
      if (!middle.trim()) continue;

      const span = el("span", `ah-sentence ${info.cls}`, middle);
      span.tabIndex = 0;
      span.setAttribute("role", "note");
      span.setAttribute("aria-label", `${info.word}. ${annotation.note || ""}`);
      span.addEventListener("mouseenter", () => showTooltip(span, data, theme));
      span.addEventListener("focus", () => showTooltip(span, data, theme));
      span.addEventListener("mouseleave", () => hideTooltip());
      span.addEventListener("blur", () => hideTooltip(true));

      const parent = entry.node.parentNode;
      if (!parent) continue;
      if (from > 0) parent.insertBefore(document.createTextNode(value.slice(0, from)), entry.node);
      parent.insertBefore(span, entry.node);
      if (to < value.length) entry.node.nodeValue = value.slice(to);
      else parent.removeChild(entry.node);
    }
  }

  // ---- public API ----

  function renderAnswer(answerElement, { report, annotations, linkChecks, evidence } = {}) {
    if (!answerElement || !report) return;
    const theme = themeClass(answerElement);
    const evidenceById = new Map((evidence || []).map((item) => [item.id, item]));

    // One summary per answer, reused when an answer is re-checked
    const container = answerElement.closest("model-response, [data-message-id], .conversation-container, .turn-container") || answerElement;
    container.querySelectorAll(".ah-summary").forEach((old, index) => index > 0 && old.remove());
    let summary = container.querySelector(".ah-summary");
    if (!summary) {
      summary = el("div", "ah-summary");
      answerElement.insertBefore(summary, answerElement.firstChild);
    }
    summary.className = `ah-summary ${theme}`;
    summary.replaceChildren();

    const { mark, tone, text } = summarize(report, linkChecks);
    const chip = el("button", `ah-chip ${tone}`);
    chip.type = "button";
    chip.setAttribute("aria-expanded", "false");
    chip.appendChild(el("span", "ah-chip-mark", mark));
    chip.appendChild(el("span", "ah-chip-text", text));
    chip.appendChild(el("span", "ah-chip-caret", "▾"));

    const panel = buildPanel(report, linkChecks, evidence, theme);
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.hidden = !panel.hidden;
      chip.setAttribute("aria-expanded", String(!panel.hidden));
    });

    summary.appendChild(chip);
    summary.appendChild(panel);

    // Link badges
    for (const anchor of answerElement.querySelectorAll("a[href]")) {
      const check = (linkChecks || []).find((item) => item.url === anchor.href || item.url === anchor.getAttribute("href"));
      if (!check) continue;
      const next = anchor.nextElementSibling;
      if (next && next.classList.contains("ah-link-badge")) next.remove();
      const key = check.status === "ok" && check.confirmed ? "ok_confirmed" : check.status;
      const info = LINK[key] || LINK.skipped;
      const badge = el("span", `ah-link-badge ah-badge-${check.status} ${theme}`, `${info.mark} ${info.word}`);
      badge.title = check.note || info.word;
      anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    }

    // Sentence underlines, once per answer version
    const signature = `${(annotations || []).length}:${report.hallucinationScore}`;
    if (Array.isArray(annotations) && annotations.length && answerElement.dataset.ahMarked !== signature) {
      answerElement.dataset.ahMarked = signature;
      for (const annotation of annotations) markSentence(answerElement, annotation, evidenceById, theme);
    }
  }

  function addBoosterButton(inputElement, onClick) {
    if (!inputElement || !inputElement.parentNode || inputElement.parentNode.querySelector(".ah-booster-btn")) return;
    const theme = themeClass(inputElement);
    const button = el("button", `ah-booster-btn ${theme}`, "🛡 Improve prompt");
    button.type = "button";
    button.title = "Adds instructions asking the AI to cite sources and admit what it doesn't know";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
      button.textContent = "✓ Instructions added";
      setTimeout(() => (button.textContent = "🛡 Improve prompt"), 2000);
    });
    inputElement.parentNode.insertBefore(button, inputElement);
  }

  function showPromptWarnings(inputElement, flags) {
    if (!inputElement || !inputElement.parentNode) return;
    const existing = inputElement.parentNode.querySelector(".ah-prompt-warning");
    if (!Array.isArray(flags) || !flags.length) {
      if (existing) existing.remove();
      return;
    }

    const theme = themeClass(inputElement);
    const box = existing || el("div", "ah-prompt-warning");
    box.className = `ah-prompt-warning ${theme}`;
    box.replaceChildren();

    const dismiss = el("button", "ah-dismiss", "✕");
    dismiss.type = "button";
    dismiss.title = "Hide this tip";
    dismiss.addEventListener("click", () => box.remove());
    box.appendChild(dismiss);

    box.appendChild(el("span", "ah-warn-mark", "⚠ "));
    box.appendChild(el("span", null, flags[0].detail || "This prompt may be unclear."));
    const tip = flags.map((flag) => flag.clarifyingQuestion).find(Boolean);
    if (tip) box.appendChild(el("div", "ah-warn-tip", `Try adding: ${tip}`));

    if (!existing) inputElement.parentNode.insertBefore(box, inputElement);
  }

  AH.overlay = { renderAnswer, addBoosterButton, showPromptWarnings, summarize };

  if (typeof module !== "undefined") {
    module.exports = AH.overlay;
  }
})(globalThis);
