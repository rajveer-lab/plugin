/**
 * Prompt grounder (prompt booster).
 *
 * assess(prompt, history): flags prompts likely to make the AI guess
 *   (too short, refers to something not in the chat, depends on today's date).
 * boost(prompt, options): appends anti-hallucination guidelines to the prompt.
 *   Web chats have no system prompt, so the guidelines travel with the message.
 *   Boosting twice replaces the earlier guidelines instead of stacking them.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  const GUIDELINES_HEADER = "Answer guidelines:";
  const SEPARATOR = "\n\n---\n";

  const RELATIVE_TIME = /\b(latest|newest|current(?:ly)?|recent(?:ly)?|today|tonight|now|nowadays|yesterday|tomorrow|this (?:year|month|week)|last (?:year|month|week)|so far|up to date)\b/i;
  const EXPLICIT_DATE = /\b(?:1[5-9]|20)\d{2}\b/;
  const LEADING_REFERENCE = /^\s*(?:and\s+|so\s+|but\s+)?(it|its|this|that|these|those|they|them|their|he|she|him|her|his)\b/i;
  const BACKWARD_REFERENCE = /\b(the above|mentioned (?:earlier|before|above)|as i said|the same one|that one|the previous one)\b|\b(?:about|of|on|with|for|from|to|in)\s+(?:it|this|that|them|these|those|him|her)\s*[?.!]*\s*$/i;

  const RULES = {
    moderate: [
      "If you're not sure about something, say so instead of guessing.",
      "Don't invent names, numbers, dates, quotes, links or sources.",
    ],
    strict: [
      "Only state facts you're confident are true. If you're unsure, say so plainly, or say you don't know.",
      "Don't invent names, numbers, dates, quotes, links or sources. Only link to pages you're sure exist.",
      "Name the source for key facts, with a link only if you know the exact URL.",
      "If my question is ambiguous, ask me to clarify instead of assuming.",
    ],
    zero_tolerance: [
      "Only include statements you can back with a source you can name. Leave out anything you can't.",
      "Don't invent names, numbers, dates, quotes, links or sources. Only link to pages you're sure exist.",
      "If you can't answer reliably, reply only: \"I don't know.\"",
      "If my question is ambiguous, ask me to clarify instead of answering.",
    ],
  };

  function assess(prompt, history) {
    const text = String(prompt || "");
    const flags = [];
    const words = text.match(/\b\w+\b/g) || [];
    const hasHistory = Array.isArray(history) ? history.length > 0 : Boolean(history);

    if (words.length < 3) {
      flags.push({
        type: "underspecified",
        detail: `The prompt has only ${words.length} word(s), so the AI may guess what you mean.`,
        clarifyingQuestion: "Could you add a bit more detail about what you want to know?",
      });
    }

    if (!hasHistory) {
      const reference = text.match(LEADING_REFERENCE) || text.match(BACKWARD_REFERENCE);
      if (reference) {
        flags.push({
          type: "unresolved_reference",
          detail: `"${reference[0].trim()}" refers to something the AI can't see in this chat.`,
          clarifyingQuestion: "What exactly are you referring to?",
        });
      }
    }

    const timeWord = text.match(RELATIVE_TIME);
    if (timeWord && !EXPLICIT_DATE.test(text)) {
      flags.push({
        type: "relative_time",
        detail: `"${timeWord[0]}" depends on today's date, and the AI's knowledge may be out of date.`,
        clarifyingQuestion: "Which date or time period do you mean?",
      });
    }

    const needsClarification = flags.some((f) => f.type === "underspecified" || f.type === "unresolved_reference");
    return { flags, needsClarification };
  }

  /** Removes guidelines added by an earlier boost. */
  function strip(prompt) {
    const text = String(prompt || "");
    const index = text.lastIndexOf(SEPARATOR + GUIDELINES_HEADER);
    return index === -1 ? text : text.slice(0, index);
  }

  function boost(prompt, options) {
    const strictness = (options && options.strictness) || "strict";
    const rules = [...(RULES[strictness] || RULES.strict)];
    const base = strip(prompt).trimEnd();

    if (assess(base).flags.some((f) => f.type === "relative_time")) {
      const today = (options && options.today) || new Date().toISOString().slice(0, 10);
      rules.push(`Today's date is ${today}. If your information may be older than that, say so.`);
    }

    return `${base}${SEPARATOR}${GUIDELINES_HEADER}\n${rules.map((rule) => `- ${rule}`).join("\n")}`;
  }

  AH.grounder = { assess, boost, strip };

  if (typeof module !== "undefined") {
    module.exports = AH.grounder;
  }
})(globalThis);
