(function (root) {
  "use strict";
  const AH = (root.AH = root.AH || {});

  const SHARES = [
    { key: "confirmed", status: "supported", label: "Confirmed", tone: "ok", one: "is backed by sources", many: "are backed by sources" },
    { key: "hallucinated", status: "contradicted", label: "Hallucinated", tone: "bad", one: "conflicts with sources", many: "conflict with sources" },
    { key: "unverified", status: "unsupported", label: "Unverified", tone: "warn", one: "wasn't found in sources", many: "weren't found in sources" },
  ];
  const STATUS = {
    supported: { icon: "check", tone: "ok", word: "Backed by sources" },
    contradicted: { icon: "cross", tone: "bad", word: "Conflicts with sources" },
    unsupported: { icon: "question", tone: "warn", word: "Not found in sources" },
  };
  // Problems first: what the reader most needs to see
  const ORDER = { contradicted: 0, unsupported: 1, supported: 2 };
  const SOURCE_NAMES = { wikipedia: "Wikipedia", wikidata: "Wikidata", links: "the linked pages", webSearch: "web search", pages: "your saved pages", factMemory: "fact memory", aiJudge: "the on-device AI" };

  function headline(report) {
    const breakdown = report && report.breakdown;
    if (!breakdown || !(Number(breakdown.confirmed) || Number(breakdown.hallucinated) || Number(breakdown.unverified))) {
      return { mark: "·", tone: "mute", text: "Nothing specific to check" };
    }
    if (Number(breakdown.hallucinated) > 0) {
      return { mark: "✕", tone: "bad", text: `${Number(breakdown.hallucinated)}% hallucinated` };
    }
    if (Number(breakdown.confirmed) >= 50) {
      return { mark: "✓", tone: "ok", text: "0% hallucinated" };
    }
    return { mark: "?", tone: "warn", text: "0% hallucinated" };
  }

  function findLinks(text) {
    const found = [];
    const seen = new Set();
    for (const match of String(text || "").matchAll(/https?:\/\/[^\s<>]+/gi)) {
      let url = match[0].replace(/[.,;:!'\"]+$/g, "");
      while (url.endsWith(")") && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) {
        url = url.slice(0, -1);
      }
      if (url && !seen.has(url)) {
        seen.add(url);
        found.push(url);
        if (found.length === 10) break;
      }
    }
    return found;
  }

  function render(container, result, { compact = false, onFeedback } = {}) {
    const doc = container.ownerDocument;
    container.replaceChildren();
    container.classList.add("hg-report");
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const icon = (name, className) => {
      if (AH.icons) return AH.icons.icon(name, { className: `hg-ico ${className || ""}`.trim() });
      return el("span", `hg-ico ${className || ""}`.trim());
    };
    const sourceLink = (url, label) => {
      if (!/^https?:\/\//i.test(url || "")) return null;
      const anchor = el("a", "hg-source");
      let host = "";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch (error) {
        return null;
      }
      anchor.append(el("span", null, label || `View source · ${host}`), icon("external", "hg-ico-small"));
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      return anchor;
    };

    if (result && result.error) {
      const box = el("div", "hg-error");
      box.append(icon("alert"), el("span", null, result.error));
      container.append(box);
      return;
    }
    const report = result && result.report;
    if (!report) {
      const box = el("div", "hg-error");
      box.append(icon("alert"), el("span", null, "The check didn't return a result. Try again in a moment."));
      container.append(box);
      return;
    }

    const counts = report.counts || {};
    const total = (Number(counts.supported) || 0) + (Number(counts.contradicted) || 0) + (Number(counts.unsupported) || 0);
    const heading = headline(report);
    const head = el("div", `hg-head hg-${heading.tone}`);
    head.append(icon(STATUS_ICON[heading.tone] || "dot", "hg-head-icon"), el("h2", "hg-headline", heading.text));
    container.append(head);

    const breakdown = report.breakdown || { confirmed: 0, hallucinated: 0, unverified: 0 };
    const hasInformation = Number(breakdown.confirmed) + Number(breakdown.hallucinated) + Number(breakdown.unverified) > 0;
    if (!hasInformation) {
      container.append(el("p", "hg-summary", "This text has no specific facts (names, dates, numbers, places) that sources could confirm or contradict."));
      container.append(el("p", "hg-footer", "Automatic checks can be wrong. Unverified means no source was found, not that it's false."));
      return;
    }
    const contradicted = Number(counts.contradicted) || 0;
    container.append(el("p", "hg-summary", contradicted
      ? `${contradicted} of ${total} statement${total === 1 ? "" : "s"} conflict${contradicted === 1 ? "s" : ""} with sources.`
      : `No conflicts found in ${total} statement${total === 1 ? "" : "s"}.`));

    const bar = el("div", "hg-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", SHARES.map(({ key, label }) => `${label} ${Number(breakdown[key]) || 0}%`).join(", "));
    for (const { key, tone } of SHARES) {
      const share = Math.max(0, Number(breakdown[key]) || 0);
      if (!share) continue;
      const segment = el("span", `hg-segment hg-fill-${tone}`);
      segment.style.width = `${share}%`;
      bar.append(segment);
    }
    container.append(bar);

    const legend = el("div", "hg-legend");
    for (const { key, status, label, tone, one, many } of SHARES) {
      const count = Number(counts[status]) || 0;
      const row = el("div", `hg-legend-row hg-${tone}`);
      row.append(
        icon(STATUS[status].icon, "hg-legend-icon"),
        el("span", "hg-legend-label", label),
        el("span", "hg-legend-pct", `${Number(breakdown[key]) || 0}%`),
        // Compact (popup): just the count, so rows stay on one line at 320px
        el("span", "hg-legend-note", compact ? `${count} statement${count === 1 ? "" : "s"}` : `${count} statement${count === 1 ? ` ${one}` : `s ${many}`}`),
      );
      legend.append(row);
    }
    container.append(legend);
    if (compact) return;

    const evidence = result.evidence || [];
    const annotations = [...(result.annotations || [])].sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1));
    if (annotations.length) {
      const list = el("ol", "hg-claims");
      list.setAttribute("aria-label", "Checked statements");
      for (const annotation of annotations) {
        const info = STATUS[annotation.status] || STATUS.unsupported;
        const item = el("li", `hg-claim hg-${info.tone}`);
        item.append(icon(info.icon, "hg-claim-icon"));
        const body = el("div", "hg-claim-body");
        const sentence = el("p", "hg-claim-text", annotation.sentence || "");
        const status = el("span", "hg-visually-hidden", `${info.word}: `);
        sentence.prepend(status);
        body.append(sentence);
        if (annotation.note) body.append(el("p", "hg-note", annotation.note));
        const source = evidence.find((entry) => (annotation.evidenceIds || []).includes(entry.id));
        const link = source && sourceLink(source.url);
        if (link) body.append(link);
        if (typeof onFeedback === "function" && annotation.learn && annotation.learn.head && annotation.learn.features) {
          const feedback = el("div", "hg-feedback");
          const thanks = el("span", "hg-feedback-thanks", "Thanks, it will learn from this.");
          thanks.hidden = true;
          for (const choice of [{ label: 1, word: "Right", iconName: "check", aria: "Mark this check as right" }, { label: 0, word: "Wrong", iconName: "cross", aria: "Mark this check as wrong" }]) {
            const button = el("button", "hg-feedback-button");
            button.type = "button";
            button.append(icon(choice.iconName, "hg-feedback-icon"), doc.createTextNode(choice.word));
            button.setAttribute("aria-label", choice.aria);
            button.addEventListener("click", async () => {
              const buttons = feedback.querySelectorAll("button");
              buttons.forEach((entry) => { entry.disabled = true; });
              try {
                await onFeedback({ head: annotation.learn.head, features: annotation.learn.features, label: choice.label });
                thanks.hidden = false;
              } catch (error) {
                buttons.forEach((entry) => { entry.disabled = false; });
              }
            });
            feedback.append(button);
          }
          feedback.append(thanks);
          body.append(feedback);
        }
        item.append(body);
        list.append(item);
      }
      container.append(list);
    }

    const badLinks = (result.linkChecks || []).filter((link) => link.status === "not_found" || link.status === "mismatch");
    if (badLinks.length) {
      const section = el("section", "hg-links");
      section.append(el("h3", "hg-section-title", badLinks.length === 1 ? "Link problem" : "Link problems"));
      for (const link of badLinks) {
        const row = el("p", "hg-link-row");
        row.append(icon("link", "hg-bad-ico"), el("span", null, `${link.status === "not_found" ? "Page doesn't exist" : "Page says something else"}: `));
        if (/^https?:\/\//i.test(link.url || "")) {
          const anchor = el("a", "hg-link-url", link.url);
          anchor.href = link.url;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          row.append(anchor);
        } else {
          row.append(doc.createTextNode(link.url || ""));
        }
        section.append(row);
      }
      container.append(section);
    }
    for (const [source, message] of Object.entries(result.errors || {})) {
      const row = el("p", "hg-muted hg-warning-row");
      row.append(icon("alert", "hg-warn-ico"), el("span", null, `Couldn't use ${SOURCE_NAMES[source] || source}: ${message}`));
      container.append(row);
    }
    container.append(el("p", "hg-footer", "Automatic checks can be wrong. Unverified means no source was found, not that it's false."));
  }

  const STATUS_ICON = { bad: "cross", ok: "check", warn: "question", mute: "dot" };

  AH.reportView = { render, headline, findLinks };
  if (typeof module !== "undefined") module.exports = AH.reportView;
})(globalThis);
