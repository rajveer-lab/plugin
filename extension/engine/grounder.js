/**
 * Messages the extension writes into the chat box for the user to send (never sent automatically):
 *
 * correctionPrompt(items): "Ask AI to fix this", quoting the sentence and the source it conflicts with.
 * pushbackPrompt(sentence): "Are you sure?", a neutral question about one sentence.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  function oneLine(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function cut(text, max) {
    if (text.length <= max) return text;
    const clipped = text.slice(0, max);
    const sentenceEnd = clipped.lastIndexOf(". ");
    return (sentenceEnd > max * 0.5 ? clipped.slice(0, sentenceEnd + 1) : clipped.trimEnd()) + " …";
  }

  /**
   * A follow-up message asking the AI to fix statements that conflict with sources.
   * items: [{ sentence, evidenceText, source, url }]
   */
  function correctionPrompt(items) {
    const list = (Array.isArray(items) ? items : []).filter((item) => item && oneLine(item.sentence));
    if (!list.length) return "";

    const entries = list.map((item, i) => {
      const lines = [`${i + 1}. You wrote: "${oneLine(item.sentence)}"`];
      const evidence = oneLine(item.evidenceText);
      if (evidence) {
        const where = [oneLine(item.source), item.url ? `(${item.url})` : ""].filter(Boolean).join(" ") || "A source";
        lines.push(`   ${where} says: "${cut(evidence, 300)}"`);
      }
      return lines.join("\n");
    });

    const intro = list.length === 1
      ? "Please double-check part of your last answer. This statement conflicts with a source:"
      : "Please double-check part of your last answer. These statements conflict with sources:";

    return [
      intro,
      "",
      entries.join("\n\n"),
      "",
      "Correct anything that's wrong and show the corrected sentence. If you still think your original statement is right, explain why and name a source I can check.",
    ].join("\n");
  }

  /**
   * A neutral "Are you sure?" about one sentence. It asserts nothing, so whether the AI holds or
   * changes its answer shows how stable it is; engine/conversation.js reads the quoted sentence back.
   */
  function pushbackPrompt(sentence) {
    const text = cut(oneLine(sentence).replace(/["“”]/g, "'"), 400);
    if (!text) return "";
    return `Are you sure about this? "${text}" Please double-check it and tell me plainly whether it's right.`;
  }

  AH.grounder = { correctionPrompt, pushbackPrompt };

  if (typeof module !== "undefined") {
    module.exports = AH.grounder;
  }
})(globalThis);
