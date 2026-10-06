/**
 * Hallucination Guard overlay.
 *
 * Draws the result on top of ChatGPT, Claude and Gemini:
 * - a small chip above the answer that expands into details on click
 * - underlines on checked sentences, with a hover card naming the source
 * - a badge next to each link that was checked
 * - conversation findings (contradicts itself, gave in, misquotes you) with a symbol after the sentence
 * - "Ask AI to fix this", "Ask “Are you sure?”" and "Is this right?" in the hover card
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
    ok_confirmed: { mark: "✓", icon: "check", word: "Source checks out" },
    ok: { mark: "✓", icon: "check", word: "Link works" },
    not_found: { mark: "✕", icon: "cross", word: "Page doesn't exist" },
    mismatch: { mark: "✕", icon: "cross", word: "Page says otherwise" },
    unreachable: { mark: "?", icon: "question", word: "Couldn't open" },
    skipped: { mark: "·", icon: "dot", word: "Not checked" },
  };

  // How a verdict was reached, in plain words (no confidence numbers: word matching isn't calibrated,
  // and a second percentage next to the hallucination % would only confuse)
  const JUDGE = {
    memory: "Checked earlier",
    "on-device-ai": "Judged by on-device AI",
    heuristic: "Matched against the source's wording",
  };

  const ICON_FOR_MARK = { "✓": "check", "✕": "cross", "?": "question", "·": "dot" };

  // Conversation checks (ConsistencyItem.type): how a sentence relates to earlier messages in the chat
  const CONSISTENCY = {
    changed_unknown: { word: "Contradicts itself", short: "contradicts itself" },
    changed_fixed: { word: "Corrected itself", short: "corrected itself" },
    changed_wrong: { word: "Changed a right answer", short: "changed a right answer", pushbackWord: "Gave in to pushback", pushbackShort: "gave in to pushback" },
    held_correct: { word: "Stood by a right answer", short: "stood by its answer" },
    held_wrong: { word: "Dug in on a wrong answer", short: "dug in on a wrong answer" },
    held_unknown: { word: "Stood by its answer", short: "stood by its answer" },
    misquote: { word: "Misquotes you", short: "misquotes you" },
  };
  const TONE_MARK = { ok: "✓", bad: "✕", warn: "?" };
  const TONE_CLASS = { ok: "ah-ok", bad: "ah-bad", warn: "ah-unknown" };

  function consistencyWord(item, short) {
    const info = CONSISTENCY[item.type] || CONSISTENCY.changed_unknown;
    if (item.afterPushback && info.pushbackWord) return short ? info.pushbackShort : info.pushbackWord;
    return short ? info.short : info.word;
  }

  /** The panel's short detail for a finding: what was said before, or what sources say. */
  function consistencyDetail(item) {
    const said = String(item.earlier || "").replace(/\s+/g, " ").trim();
    const quote = `"${said.length > 120 ? `${said.slice(0, 119).trimEnd()}…` : said}"`;
    if (item.type === "misquote") return `You wrote: ${quote}`;
    if (item.type === "held_correct") return "Sources agree.";
    if (item.type === "held_wrong") return "Sources say it's wrong.";
    if (item.type === "held_unknown") return "No source found to confirm it.";
    if (item.type === "changed_wrong" && item.afterPushback) return `Its first answer was right: ${quote}`;
    return `Before, it said: ${quote}`;
  }

  /** A drawn icon (ui/icons.js), or the text symbol if the icon script isn't loaded. */
  function ico(name, className, fallback) {
    if (AH.icons && typeof document !== "undefined") return AH.icons.icon(name, { className });
    const span = el("span", className, fallback || "");
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  /** Replaces a button's content with an icon and a label. */
  function setLabel(button, iconName, text, fallback) {
    button.replaceChildren(ico(iconName, "ah-btn-icon", fallback), el("span", null, text));
  }

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

  // The three shares of an answer's information (Report.breakdown), in display order
  const SHARES = [
    { key: "confirmed", status: "supported", mark: "✓", label: "Confirmed", cls: "ah-bar-ok", one: "is backed by sources", many: "are backed by sources" },
    { key: "hallucinated", status: "contradicted", mark: "✕", label: "Hallucinated", cls: "ah-bar-bad", one: "conflicts with sources", many: "conflict with sources" },
    { key: "unverified", status: "unsupported", mark: "?", label: "Unverified", cls: "ah-bar-warn", one: "wasn't found in sources", many: "weren't found in sources" },
  ];

  /** Report.breakdown, or a count-based stand-in for reports made before it existed. */
  function sharesOf(report) {
    const breakdown = report && report.breakdown;
    if (breakdown) return { confirmed: breakdown.confirmed || 0, hallucinated: breakdown.hallucinated || 0, unverified: breakdown.unverified || 0 };
    const counts = (report && report.counts) || {};
    const total = (counts.supported || 0) + (counts.contradicted || 0) + (counts.unsupported || 0);
    const pct = (n) => (total ? Math.round((100 * (n || 0)) / total) : 0);
    return { confirmed: pct(counts.supported), hallucinated: pct(counts.contradicted), unverified: pct(counts.unsupported) };
  }

  /**
   * One plain-language line for the chip, led by the hallucination percentage, then what the
   * conversation checks found ("gave in to pushback"). Those can only make the tone worse, never better,
   * except that a good one ("corrected itself") gives an otherwise empty chip a ✓.
   */
  function summarize(report, linkChecks, consistency) {
    const share = sharesOf(report);
    const fake = (linkChecks || []).filter((check) => check.status === "not_found").length;
    const items = Array.isArray(consistency) ? consistency.filter((item) => item && item.tone) : [];

    let mark = "·";
    let tone = "ah-tone-mute";
    let text = "Nothing specific to check";
    const checked = share.confirmed + share.hallucinated + share.unverified > 0;

    if (checked) {
      const parts = [`${share.hallucinated}% hallucinated`];
      if (share.confirmed) parts.push(`${share.confirmed}% confirmed`);
      if (share.unverified) parts.push(`${share.unverified}% unverified`);
      text = parts.join(" · ");
      if (share.hallucinated > 0) {
        mark = "✕";
        tone = "ah-tone-bad";
      } else if (share.confirmed >= 50) {
        mark = "✓";
        tone = "ah-tone-ok";
      } else {
        // Mostly unverified: "0% hallucinated" mustn't look reassuring
        mark = "?";
        tone = "ah-tone-warn";
      }
    }

    if (items.length) {
      const phrases = [...new Set(items.map((item) => consistencyWord(item, true)))].join(" · ");
      text = checked ? `${text} · ${phrases}` : phrases.charAt(0).toUpperCase() + phrases.slice(1);
      if (items.some((item) => item.tone === "bad")) {
        mark = "✕";
        tone = "ah-tone-bad";
      } else if (items.some((item) => item.tone === "warn") && tone !== "ah-tone-bad") {
        mark = "?";
        tone = "ah-tone-warn";
      } else if (tone === "ah-tone-mute") {
        mark = "✓";
        tone = "ah-tone-ok";
      }
    }

    if (fake > 0) text += ` · ${fake} fake link${fake > 1 ? "s" : ""}`;
    return { mark, tone, text };
  }

  function buildPanel(report, linkChecks, evidence, theme, consistency) {
    const counts = (report && report.counts) || {};
    const share = sharesOf(report);
    const panel = el("div", `ah-panel ${theme}`);
    panel.hidden = true;

    if (share.confirmed + share.hallucinated + share.unverified > 0) {
      const bar = el("div", "ah-bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", SHARES.map(({ key, label }) => `${label} ${share[key]}%`).join(", "));
      for (const { key, cls } of SHARES) {
        if (!share[key]) continue;
        const segment = el("span", `ah-bar-seg ${cls}`);
        segment.style.width = `${share[key]}%`;
        bar.appendChild(segment);
      }
      panel.appendChild(bar);

      const legend = el("div", "ah-legend");
      for (const { key, status, mark, label, one, many } of SHARES) {
        const count = counts[status] || 0;
        const row = el("div", `ah-legend-row ah-share-${key}`);
        row.appendChild(ico(ICON_FOR_MARK[mark], "ah-legend-icon", mark));
        row.appendChild(el("span", "ah-legend-label", label));
        row.appendChild(el("span", "ah-legend-pct", `${share[key]}%`));
        row.appendChild(el("span", "ah-legend-note", `${count} statement${count === 1 ? ` ${one}` : `s ${many}`}`));
        legend.appendChild(row);
      }
      panel.appendChild(legend);
    }

    const missing = (linkChecks || []).filter((check) => check.status === "not_found").length;
    const disagree = (linkChecks || []).filter((check) => check.status === "mismatch").length;
    if (missing || disagree) {
      const row = el("div", "ah-panel-links");
      row.appendChild(ico("link", "ah-legend-icon", "✕"));
      const parts = [];
      if (missing) parts.push(`${missing} link${missing === 1 ? " doesn't" : "s don't"} exist`);
      if (disagree) parts.push(`${disagree} link${disagree === 1 ? " says" : "s say"} something else`);
      row.appendChild(el("span", null, parts.join(" · ")));
      panel.appendChild(row);
    }

    // What the conversation checks found, one row each: "Gave in to pushback: <the sentence>"
    for (const item of (consistency || []).filter((entry) => entry && entry.tone).slice(0, 4)) {
      const row = el("div", `ah-panel-convo ah-convo-${item.tone}`);
      const mark = TONE_MARK[item.tone];
      row.appendChild(ico(ICON_FOR_MARK[mark], "ah-legend-icon", mark));
      const words = el("span", "ah-panel-convo-text");
      words.appendChild(el("strong", null, `${consistencyWord(item)}.`));
      words.appendChild(el("span", null, ` ${consistencyDetail(item)}`));
      row.appendChild(words);
      panel.appendChild(row);
    }

    const sources = [
      ...new Set((evidence || []).map((item) => (item.kind === "conversation" ? "the text you gave it" : item.source)).filter(Boolean)),
    ].slice(0, 4);
    if (sources.length) {
      panel.appendChild(el("div", "ah-panel-sources", `Checked against ${sources.join(", ")}`));
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

  /**
   * "Is this right?" with Right / Wrong buttons. The answer teaches the learner (engine/learner.js);
   * data.feedbackGiven remembers it for this sentence, so the card says thanks when it's reopened.
   */
  function feedbackRow(learn, data, key) {
    if (data.feedbackGiven[key]) return el("div", "ah-feedback ah-feedback-done", "Thanks, it will learn from this.");
    const row = el("div", "ah-feedback");
    row.appendChild(el("span", "ah-feedback-ask", "Is this right?"));
    for (const choice of [
      { label: 1, word: "Right", icon: "check", mark: "✓", aria: "Mark this check as right" },
      { label: 0, word: "Wrong", icon: "cross", mark: "✕", aria: "Mark this check as wrong" },
    ]) {
      const button = el("button", "ah-feedback-btn");
      button.type = "button";
      setLabel(button, choice.icon, choice.word, choice.mark);
      button.setAttribute("aria-label", choice.aria);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.querySelectorAll("button").forEach((b) => (b.disabled = true));
        let response = null;
        try {
          response = await data.onFeedback({ head: learn.head, features: learn.features, label: choice.label });
        } catch (error) {
          response = null;
        }
        if (response && !response.error) {
          data.feedbackGiven[key] = true;
          row.replaceChildren(el("span", "ah-feedback-ask", "Thanks, it will learn from this."));
          row.classList.add("ah-feedback-done");
        } else {
          row.querySelectorAll("button").forEach((b) => (b.disabled = false));
        }
      });
      row.appendChild(button);
    }
    return row;
  }

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
    const info = data.status ? SENTENCE[data.status] || SENTENCE.unsupported : null;
    const convo = data.consistency;

    tooltip = el("div", `ah-tooltip ah-tooltip-${info ? info.cls : TONE_CLASS[convo.tone]} ${theme}`);
    tooltip.setAttribute("role", "tooltip");
    if (info) {
      const head = el("div", "ah-tooltip-head");
      head.appendChild(ico(ICON_FOR_MARK[info.mark], "ah-tooltip-icon", info.mark));
      head.appendChild(el("span", null, info.word));
      tooltip.appendChild(head);
      if (data.note) tooltip.appendChild(el("div", "ah-tooltip-note", data.note));
      if (data.learn && typeof data.onFeedback === "function") tooltip.appendChild(feedbackRow(data.learn, data, "verdict"));
    }

    // What the conversation checks found about this sentence (its own block, with its own symbol)
    if (convo) {
      const block = el("div", `ah-tooltip-convo ah-convo-${convo.tone}`);
      const head = el("div", "ah-tooltip-head");
      const mark = TONE_MARK[convo.tone];
      head.appendChild(ico(ICON_FOR_MARK[mark], "ah-tooltip-icon", mark));
      head.appendChild(el("span", null, consistencyWord(convo)));
      block.appendChild(head);
      block.appendChild(el("div", "ah-tooltip-note", convo.note));
      if (convo.learn && typeof data.onFeedback === "function") block.appendChild(feedbackRow(convo.learn, data, "consistency"));
      tooltip.appendChild(block);
    }

    const actions = el("div", "ah-tooltip-actions");
    if (data.url) {
      try {
        const parsed = new URL(data.url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const link = el("a", "ah-tooltip-source");
          link.append(el("span", null, `View source · ${parsed.hostname.replace(/^www\./, "")}`), ico("external", "ah-btn-icon", "↗"));
          link.href = data.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          actions.appendChild(link);
        }
      } catch (error) {
        /* not a usable URL */
      }
    }
    if (data.status === "contradicted" && typeof data.onFix === "function") {
      const fix = el("button", "ah-fix-btn");
      setLabel(fix, "sparkle", "Ask AI to fix this", "");
      fix.type = "button";
      fix.title = "Writes a correction request into the chat box. You review it and press send.";
      fix.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        data.onFix([data.fixItem]);
        hideTooltip(true);
      });
      actions.appendChild(fix);
    }
    // The "Are you sure?" test: a neutral pushback the user sends; the next answer shows whether it held
    if (data.status && data.status !== "contradicted" && typeof data.onPushback === "function") {
      const ask = el("button", "ah-fix-btn ah-pushback-btn");
      setLabel(ask, "question", "Ask “Are you sure?”", "?");
      ask.type = "button";
      ask.title = "Writes a neutral “Are you sure?” about this sentence into the chat box. You press send; the next answer shows whether it stood by it or changed it.";
      ask.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        data.onPushback(data.sentence);
        hideTooltip(true);
      });
      actions.appendChild(ask);
    }
    if (actions.childNodes.length) tooltip.appendChild(actions);
    tooltip.appendChild(el("div", "ah-tooltip-by", info ? JUDGE[data.judge] || JUDGE.heuristic : "Compared with earlier messages in this chat"));

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
        if (parent.closest(".ah-summary, .ah-link-badge, .ah-convo-badge, .ah-sentence")) {
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

  /** What the correction request needs for one conflicting sentence. */
  function fixItem(annotation, evidenceById) {
    const evidence = (annotation.evidenceIds || []).map((id) => evidenceById.get(id)).find(Boolean);
    return {
      sentence: annotation.sentence,
      evidenceText: evidence ? evidence.text : "",
      source: evidence ? evidence.source : "",
      url: evidence ? evidence.url : "",
    };
  }

  /**
   * Underlines one sentence, even when it spans bold or linked parts. `target` has the sentence's
   * annotation (its check against sources), its consistency item (the conversation checks), or both.
   */
  function markSentence(answerElement, target, evidenceById, theme, { onFix, onPushback, onFeedback } = {}) {
    const sentence = (target.sentence || "").trim();
    if (!sentence) return;
    const annotation = target.annotation || {};
    const convo = target.consistency || null;

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
    const info = annotation.status ? SENTENCE[annotation.status] || SENTENCE.unsupported : null;
    // A conversation warning that's worse than the source check decides the underline
    const convoWorse = convo && (!info || (convo.tone === "bad" && annotation.status !== "contradicted"));
    const cls = convoWorse ? TONE_CLASS[convo.tone] : info.cls;
    const label = [info ? `${info.word}. ${annotation.note || ""}` : "", convo ? `${consistencyWord(convo)}. ${convo.note}` : ""]
      .filter(Boolean)
      .join(" ");
    const data = {
      status: annotation.status,
      confidence: annotation.confidence,
      judge: annotation.judge,
      note: annotation.note,
      url: evidence && evidence.url,
      sentence,
      consistency: convo,
      learn: annotation.learn,
      feedbackGiven: {},
      onFix,
      onPushback,
      onFeedback,
      fixItem: fixItem({ sentence, ...annotation }, evidenceById),
    };

    let lastSpan = null;
    for (let i = offsets.length - 1; i >= 0; i--) {
      const entry = offsets[i];
      if (entry.end <= start || entry.start >= end) continue;

      const from = Math.max(0, start - entry.start);
      const to = Math.min(entry.node.nodeValue.length, end - entry.start);
      const value = entry.node.nodeValue;
      const middle = value.slice(from, to);
      if (!middle.trim()) continue;

      const span = el("span", `ah-sentence ${cls} ${theme}`, middle); // the theme class carries the colours
      span.tabIndex = 0;
      span.setAttribute("role", "note");
      span.setAttribute("aria-label", label);
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
      if (!lastSpan) lastSpan = span; // walking backwards, the first span made is the sentence's end
    }

    // A small symbol after the sentence, so a conversation warning is visible without hovering
    if (convo && lastSpan && lastSpan.parentNode) {
      const mark = TONE_MARK[convo.tone];
      const badge = el("span", `ah-convo-badge ah-convo-${convo.tone} ${theme}`);
      badge.appendChild(ico(ICON_FOR_MARK[mark], "ah-btn-icon", mark));
      badge.title = consistencyWord(convo);
      badge.tabIndex = 0;
      badge.setAttribute("role", "note");
      badge.setAttribute("aria-label", `${consistencyWord(convo)}. ${convo.note}`);
      badge.addEventListener("mouseenter", () => showTooltip(badge, data, theme));
      badge.addEventListener("focus", () => showTooltip(badge, data, theme));
      badge.addEventListener("mouseleave", () => hideTooltip());
      badge.addEventListener("blur", () => hideTooltip(true));
      lastSpan.parentNode.insertBefore(badge, lastSpan.nextSibling);
    }
  }

  // ---- public API ----

  /** A "Checking this answer…" chip right away; renderAnswer replaces it with the result. */
  function renderPending(answerElement) {
    if (!answerElement) return;
    const container = answerElement.closest("model-response, [data-message-id], .conversation-container, .turn-container") || answerElement;
    if (container.querySelector(".ah-summary")) return;
    const summary = el("div", `ah-summary ${themeClass(answerElement)}`);
    const chip = el("span", "ah-chip ah-tone-mute ah-chip-pending");
    chip.setAttribute("role", "status");
    chip.appendChild(ico("shield", "ah-chip-mark", "·"));
    chip.appendChild(el("span", "ah-chip-text", "Checking this answer…"));
    summary.appendChild(chip);
    answerElement.insertBefore(summary, answerElement.firstChild);
  }

  function renderAnswer(answerElement, { report, annotations, linkChecks, evidence, consistency } = {}, { onFix, onPushback, onFeedback } = {}) {
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

    const { mark, tone, text } = summarize(report, linkChecks, consistency);
    const chip = el("button", `ah-chip ${tone}`);
    chip.type = "button";
    chip.setAttribute("aria-expanded", "false");
    chip.appendChild(ico(ICON_FOR_MARK[mark] || "shield", "ah-chip-mark", mark));
    // The headline share in bold ("24% hallucinated"), the rest quieter
    const [lead, ...rest] = text.split(" · ");
    const label = el("span", "ah-chip-text");
    label.appendChild(el("strong", null, lead));
    if (rest.length) label.appendChild(el("span", "ah-chip-rest", ` · ${rest.join(" · ")}`));
    chip.appendChild(label);
    chip.appendChild(ico("chevron", "ah-chip-caret", "▾"));
    chip.title = "Hallucination Guard: show what was checked";

    const panel = buildPanel(report, linkChecks, evidence, theme, consistency);
    const conflicts = (annotations || []).filter((annotation) => annotation.status === "contradicted");
    if (conflicts.length && typeof onFix === "function") {
      const fixAll = el("button", "ah-fix-btn", conflicts.length === 1 ? "Ask AI to fix this conflict" : `Ask AI to fix all ${conflicts.length} conflicts`);
      fixAll.type = "button";
      fixAll.title = "Writes a correction request into the chat box. You review it and press send.";
      fixAll.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onFix(conflicts.map((annotation) => fixItem(annotation, evidenceById)));
      });
      panel.insertBefore(fixAll, panel.lastChild);
    }
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
      const badge = el("span", `ah-link-badge ah-badge-${check.status} ${theme}`);
      badge.append(ico(info.icon, "ah-btn-icon", info.mark), el("span", null, info.word));
      badge.title = check.note || info.word;
      anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    }

    // Sentence underlines, once per answer version: each sentence's source check and conversation check
    const targets = new Map();
    for (const annotation of Array.isArray(annotations) ? annotations : []) {
      targets.set(annotation.sentence, { sentence: annotation.sentence, annotation });
    }
    for (const item of Array.isArray(consistency) ? consistency : []) {
      if (!item || !item.sentence || !item.tone) continue;
      const target = targets.get(item.sentence) || { sentence: item.sentence };
      if (!target.consistency) target.consistency = item;
      targets.set(item.sentence, target);
    }
    const signature = `${targets.size}:${report.hallucinationScore}:${(consistency || []).length}`;
    if (targets.size && answerElement.dataset.ahMarked !== signature) {
      answerElement.dataset.ahMarked = signature;
      for (const target of targets.values()) markSentence(answerElement, target, evidenceById, theme, { onFix, onPushback, onFeedback });
    }
  }

  AH.overlay = { renderAnswer, renderPending, summarize };

  if (typeof module !== "undefined") {
    module.exports = AH.overlay;
  }
})(globalThis);
