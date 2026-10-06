/**
 * Conversation checks (round 4): the AI against the chat itself.
 *
 * - Text the user pasted into the chat is a source (Evidence kind "conversation").
 * - A claim that conflicts with an earlier answer, or with what the user said, is reported.
 * - After a pushback ("Are you sure?"), it reports whether the AI held or changed the questioned claim,
 *   and external sources (Wikipedia, Wikidata...) decide who was right when they can.
 *
 * Conflicts are found by typed values: a date, time, amount, quantity, year or name that differs from
 * what the conversation says about the same thing. When in doubt it stays quiet. Nothing here leaves the
 * browser.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  // What the user states (questions removed) is a source once it says something: "My budget is $500."
  const SOURCE_MIN_CHARS = 25;
  // Longer than this, a message has pasted text in it, which is never used as the question
  const PASTED_MIN_CHARS = 200;
  const ASK_MAX_CHARS = 200;
  const MAX_EARLIER_TURNS = 10;
  // Words this far either side of a value say what the value is about ("budget", "launch")
  const FRAME_WINDOW = 6;
  const MAX_HELD_TARGETS = 3;
  // On-device AI questions per answer for the conversation checks (each takes a second or two)
  const AI_LIMIT = 6;
  const QUOTE_CHARS = 160;

  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "nor", "of", "in", "on", "at", "to", "for", "with", "by", "from", "as",
    "into", "onto", "up", "out", "off", "via", "per", "than", "then", "so", "if", "because", "while", "until",
    "since", "before", "after", "during", "about", "around", "over", "under", "again", "also", "just", "only",
    "very", "really", "still", "yet", "already", "even", "ever", "never", "always", "often", "usually",
    "generally", "typically", "roughly", "approximately", "nearly", "almost", "some", "any", "all", "each",
    "every", "both", "few", "more", "most", "less", "least", "other", "another", "same", "such", "no", "not",
    "too", "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "doing", "have",
    "has", "had", "having", "will", "would", "can", "could", "should", "may", "might", "must", "shall", "it",
    "its", "this", "that", "these", "those", "there", "here", "they", "them", "their", "theirs", "we", "us",
    "our", "you", "your", "yours", "i", "me", "my", "mine", "he", "him", "his", "she", "her", "hers", "who",
    "whom", "whose", "what", "which", "when", "where", "why", "how", "yes", "sure", "ok", "okay", "please",
    "thanks", "thank", "let", "lets", "like", "well", "now", "s", "t", "don", "isn", "wasn", "aren", "weren",
    "won", "get", "got", "make", "made", "one", "ll", "re", "ve", "d", "m",
  ]);

  const MONTH_NUMBER = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9,
    October: 10, November: 11, December: 12, Jan: 1, Feb: 2, Mar: 3, Apr: 4, Jun: 6, Jul: 7, Aug: 8,
    Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12,
  };
  // Case-sensitive on purpose: "May" is a month, "may" is not
  // (an abbreviation may end with a dot, "Sept."; a sentence's final dot isn't part of "May.")
  const MONTH = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)(?:(?<=Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.)?";
  const WEEKDAY_NUMBER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
  const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
    ninety: 90, hundred: 100, dozen: 12,
  };
  const NUMBER_WORD = `(?:${Object.keys(NUMBER_WORDS).join("|")})`;
  const NUM = "\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?"; // "5,000", but not the comma after "$500,"
  const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
  // Units that keep a year-like number ("1500 people") a quantity rather than a year
  const COUNT_UNITS = /^(?:people|persons?|guests?|attendees?|participants?|members?|employees?|staff|users?|students?|customers?|visitors?|copies|units?|items?|words?|pages?|calories|meters?|metres?|feet|miles?|km|kilometers?|kilometres?|kg|tons?|tonnes?|seats?|rooms?|steps?)$/i;
  const UNIT_ALIASES = {
    people: "person", persons: "person", person: "person", mins: "minute", min: "minute", minutes: "minute",
    hrs: "hour", hr: "hour", hours: "hour", secs: "second", sec: "second", seconds: "second", yrs: "year",
    yr: "year", years: "year", tbsp: "tablespoon", tablespoons: "tablespoon", tsp: "teaspoon",
    teaspoons: "teaspoon", kgs: "kg", kilograms: "kg", kilogram: "kg", grams: "g", gram: "g", lbs: "lb",
    metres: "meter", meters: "meter", metre: "meter", kilometres: "km", kilometers: "km", kilometre: "km",
    kilometer: "km", litres: "liter", liters: "liter", litre: "liter",
  };
  const APPROX_BEFORE = /(?:\b(?:about|around|roughly|approximately|approx\.?|nearly|almost|over|under|above|below|more than|less than|fewer than|at least|at most|up to|some|circa|close to|upwards of)|~)\s*$/i;
  const APPROX_AFTER = /^(?:\s?\+|-ish\b|\s?or so\b|\s?or more\b|\s?or less\b)/i;
  const NEGATED_BEFORE = /(?:\b(?:not|never|no longer|instead of|rather than)|n't)\s+(?:[\p{L}'’]+\s+){0,2}$/iu;

  const PUSHBACK = [
    /\bare you (?:sure|certain|positive)\b/i,
    /\b(?:that'?s|that is|this is|you'?re|you are|it'?s|it is) (?:not (?:right|correct|true|accurate)|wrong|incorrect|inaccurate|false|mistaken)\b/i,
    /\b(?:double[- ]check|check (?:that |this |it )?again|re-?check|reconsider)\b/i,
    /\bi (?:don'?t|do not) think (?:so|that'?s (?:right|correct|true)|that is (?:right|correct|true))\b/i,
    /^\s*(?:no|nope|wrong)\s*[,.!]/i,
    /\bi (?:read|heard|thought|believe|was told) (?:that )?(?:it|that|they|he|she) (?:was|were|is|are|had|has)\b/i,
  ];
  // The user wanting a change is new information, not a pushback ("make it $600 instead")
  const SECOND_PERSON = /\b(?:you|your|you're|you've|yours)\b/i;
  const HYPOTHETICAL = /^\s*(?:if|suppose|supposing|imagine|let's say|lets say|say|for example|for instance|e\.g\.)\b/i;
  const REQUEST_WORDS = /\b(?:summari[sz]e|summary|explain|what|how|why|when|where|who|which|can you|could you|would you|please|tell me|list|rewrite|translate|check|compare|draft|write|help|give me|turn this|make this|tl;?dr)\b/i;
  const NON_NAMES = new Set([
    "The", "This", "That", "These", "Those", "It", "Its", "They", "We", "You", "He", "She", "In", "On", "At",
    "However", "Also", "Yes", "No", "Sure", "Please", "Here", "There", "If", "When", "While", "After",
    "Before", "For", "With", "And", "But", "Or", "So", "As", "A", "An", "I", "Your", "My", "Our", "Their",
    "His", "Her", "Note", "Summary", "Overview", "Key", "Next", "Then", "Finally", "First", "Second",
    "Third", "Great", "Good", "Okay", "OK", "Thanks", "Hi", "Hello", "Dear", "Best", "Regards", "To",
    "From", "Subject", "Re", "Fwd", "Each", "Every", "All", "Some", "Both", "Most", "Many", "One", "Two",
    "Actually", "According", "Based", "Overall", "Today", "Tomorrow", "Yesterday", "Earlier", "Later",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ...Object.keys(MONTH_NUMBER),
  ]);

  // ---- small helpers ----

  function splitSentences(text) {
    if (AH.claims && typeof AH.claims.splitSentences === "function") return AH.claims.splitSentences(String(text || ""));
    return String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  }

  function stem(word) {
    let w = String(word || "").toLowerCase().replace(/['’]s$/, "");
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && /(?:ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
    if (w.length > 3 && /([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function wordsOf(text) {
    const words = [];
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
    let match;
    while ((match = re.exec(text))) words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    return words;
  }

  function isContentWord(word) {
    const lower = word.toLowerCase();
    return !STOPWORDS.has(lower) && !/^\d/.test(word) && !(lower in NUMBER_WORDS) && !(lower in WEEKDAY_NUMBER) && !(word in MONTH_NUMBER);
  }

  function shorten(text, limit = QUOTE_CHARS) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > limit ? clean.slice(0, limit - 1).trimEnd() + "…" : clean;
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim())
      .map((turn) => ({ role: turn.role, text: turn.text }));
  }

  function lastIndexOf(turns, role, before = turns.length) {
    for (let i = Math.min(before, turns.length) - 1; i >= 0; i--) if (turns[i].role === role) return i;
    return -1;
  }

  // ---- typed values ----

  function parseNumber(text) {
    const word = String(text || "").toLowerCase();
    if (word in NUMBER_WORDS) return NUMBER_WORDS[word];
    const n = parseFloat(word.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }

  function scaled(numberText, scaleText) {
    const scale = scaleText ? SCALE[scaleText.toLowerCase()] || 1 : 1;
    return parseNumber(numberText) * scale;
  }

  function unitOf(word) {
    const lower = String(word || "").toLowerCase();
    return UNIT_ALIASES[lower] || stem(lower);
  }

  /**
   * The checkable values in a text: { type, lo, hi, raw, start, end, approx, negated }.
   * Types: money, percent, time, date, year, weekday, month, qty:<unit>, after:<word>.
   */
  function valuesOf(text) {
    const source = String(text || "");
    const values = [];
    const taken = [];
    const free = (start, end) => !taken.some(([s, e]) => start < e && end > s);

    function add(type, lo, hi, start, end) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !free(start, end)) return;
      taken.push([start, end]);
      const before = source.slice(Math.max(0, start - 40), start);
      const after = source.slice(end, end + 10);
      values.push({
        type,
        lo: Math.min(lo, hi),
        hi: Math.max(lo, hi),
        raw: source.slice(start, end).trim(),
        start,
        end,
        approx: APPROX_BEFORE.test(before) || APPROX_AFTER.test(after),
        negated: NEGATED_BEFORE.test(before),
      });
    }

    function scan(regex, handle) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(source))) {
        handle(match);
        if (match[0].length === 0) regex.lastIndex++;
      }
    }

    const RANGE = "\\s?(?:-|–|—|to)\\s?";
    // Money: "$5,000", "$5k", "€1.2 million", "500 dollars", "$500-$700"
    scan(new RegExp(`[$€£₹¥]\\s?(${NUM})(?:\\s?(k|m|mn|bn|thousand|million|billion)\\b)?(?:${RANGE}[$€£₹¥]?\\s?(${NUM})(?:\\s?(k|m|mn|bn|thousand|million|billion)\\b)?)?`, "gi"), (m) => {
      const lo = scaled(m[1], m[2]);
      add("money", lo, m[3] ? scaled(m[3], m[4] || m[2]) : lo, m.index, m.index + m[0].length);
    });
    scan(new RegExp(`\\b(${NUM})(?:\\s?(k|thousand|million|billion))?\\s?(?:dollars?|usd|euros?|eur|pounds sterling|gbp|rupees?|inr|yen)\\b`, "gi"), (m) => {
      const lo = scaled(m[1], m[2]);
      add("money", lo, lo, m.index, m.index + m[0].length);
    });
    // Percent: "20%", "20 percent", "10-15%"
    scan(new RegExp(`(${NUM})(?:${RANGE}(${NUM}))?\\s?(?:%|percent\\b|per cent\\b)`, "gi"), (m) => {
      add("percent", parseNumber(m[1]), parseNumber(m[2] || m[1]), m.index, m.index + m[0].length);
    });
    // Time: "3 pm", "3:30pm", "15:00", "noon"
    scan(/\b(\d{1,2})(?::([0-5]\d))?\s?([ap])\.?m\.?(?![\p{L}])/giu, (m) => {
      let hour = parseInt(m[1], 10) % 12;
      if (m[3].toLowerCase() === "p") hour += 12;
      const minutes = hour * 60 + (m[2] ? parseInt(m[2], 10) : 0);
      add("time", minutes, minutes, m.index, m.index + m[0].length);
    });
    scan(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m) => {
      const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      add("time", minutes, minutes, m.index, m.index + m[0].length);
    });
    scan(/\b(noon|midday|midnight)\b/gi, (m) => {
      const minutes = /midnight/i.test(m[1]) ? 0 : 720;
      add("time", minutes, minutes, m.index, m.index + m[0].length);
    });
    // Date: "14 May", "14th of May", "May 14", "May 14th"
    scan(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?![\\p{L}])`, "gu"), (m) => {
      const day = parseInt(m[1], 10);
      if (day >= 1 && day <= 31) add("date", MONTH_NUMBER[m[2]] * 100 + day, MONTH_NUMBER[m[2]] * 100 + day, m.index, m.index + m[0].length);
    });
    scan(new RegExp(`${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d\\p{L}])`, "gu"), (m) => {
      const day = parseInt(m[2], 10);
      if (day >= 1 && day <= 31) add("date", MONTH_NUMBER[m[1]] * 100 + day, MONTH_NUMBER[m[1]] * 100 + day, m.index, m.index + m[0].length);
    });
    // Quantity with a count unit, before years so "1500 people" isn't a year
    scan(new RegExp(`\\b(${NUM}|${NUMBER_WORD})(?:${RANGE}(${NUM}|${NUMBER_WORD}))?\\s+(?:more\\s+|extra\\s+|additional\\s+)?([\\p{L}]+)`, "giu"), (m) => {
      const unit = m[3];
      const yearLike = /^(?:1\d{3}|20\d{2})$/.test(m[1]);
      if (!isContentWord(unit) || /^[\p{Lu}]/u.test(unit) || (yearLike && !COUNT_UNITS.test(unit))) return;
      const start = m.index;
      const end = m.index + m[0].length;
      add(`qty:${unitOf(unit)}`, parseNumber(m[1]), parseNumber(m[2] || m[1]), start, end);
    });
    // Year: "1889", "2024" ("1990s" is a decade, left alone)
    scan(/\b(1\d{3}|20\d{2})\b(?!s\b)/g, (m) => {
      const year = parseInt(m[1], 10);
      add("year", year, year, m.index, m.index + m[0].length);
    });
    scan(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, (m) => {
      const day = WEEKDAY_NUMBER[m[1].toLowerCase()];
      add("weekday", day, day, m.index, m.index + m[0].length);
    });
    scan(new RegExp(`${MONTH}(?![\\p{L}])(?!\\s+(?:I|we|you|be|have|not)\\b)`, "gu"), (m) => {
      const month = MONTH_NUMBER[m[1]];
      add("month", month, month, m.index, m.index + m[0].length);
    });
    // A number named by the word before it: "room 204", "gate 12", "version 3"
    scan(/\b([\p{L}]{3,})\s+#?(\d+)\b(?![.,]\d)/gu, (m) => {
      if (!isContentWord(m[1]) || /^(?:1\d{3}|20\d{2})$/.test(m[2])) return;
      const n = parseInt(m[2], 10);
      const start = m.index + m[0].length - m[2].length - (m[0].includes("#") ? 1 : 0);
      add(`after:${stem(m[1])}`, n, n, start, m.index + m[0].length);
    });

    return values.sort((a, b) => a.start - b.start);
  }

  function significantDigits(n) {
    const digits = String(Math.round(Math.abs(n))).replace(/0+$/, "");
    return digits.length || 1;
  }

  /** Same value, allowing rounding ("$5,000" for "$4,950") and loose words ("about 500"). */
  function sameValue(a, b) {
    if (a.type !== b.type) return false;
    if (["date", "weekday", "month", "year", "time"].includes(a.type) || a.type.startsWith("after:")) {
      return a.lo <= b.hi && b.lo <= a.hi;
    }
    // Rounding ("$5,000" for "$4,800") stays small: 300 vs 330 metres is a different answer
    let tolerance = 0.02;
    if (a.approx || b.approx) tolerance = 0.25;
    else if ((a.lo === a.hi && significantDigits(a.lo) <= 2) || (b.lo === b.hi && significantDigits(b.lo) <= 2)) tolerance = 0.05;
    const slack = Math.max(Math.abs(a.hi), Math.abs(b.hi)) * tolerance;
    return a.lo <= b.hi + slack && b.lo <= a.hi + slack;
  }

  // Durations and measurements say little about what they measure ("3 days" of what?); counted things do
  const MEASURE_UNITS = new Set([
    "second", "minute", "hour", "day", "week", "month", "year", "g", "kg", "lb", "ounce", "oz", "ml", "liter",
    "cup", "tablespoon", "teaspoon", "meter", "km", "mile", "feet", "foot", "inch", "cm", "mm", "degree", "time",
  ]);

  /** "Room 204" and "18 members" say what they're about; a date, an amount or "3 days" needs words around it. */
  function namesItsThing(type) {
    if (type.startsWith("after:")) return true;
    return type.startsWith("qty:") && !MEASURE_UNITS.has(type.slice(4));
  }

  /** Content words near a value: what the value is about. */
  function frameNear(text, value, values) {
    const words = wordsOf(text);
    const inside = (w) => (values || []).some((v) => w.start < v.end && w.end > v.start);
    const first = words.findIndex((w) => w.end > value.start);
    let last = -1;
    words.forEach((w, i) => {
      if (w.start < value.end) last = i;
    });
    if (first < 0) return new Set();
    const frame = new Set();
    for (let i = Math.max(0, first - FRAME_WINDOW); i <= Math.min(words.length - 1, last + FRAME_WINDOW); i++) {
      const w = words[i];
      if (inside(w) || !isContentWord(w.word)) continue;
      if (value.type.startsWith("qty:") && unitOf(w.word) === value.type.slice(4)) continue;
      frame.add(stem(w.word));
    }
    return frame;
  }

  function contentStems(text, values) {
    const stems = new Set();
    for (const w of wordsOf(text)) {
      if ((values || []).some((v) => w.start < v.end && w.end > v.start)) continue;
      if (isContentWord(w.word)) stems.add(stem(w.word));
    }
    return stems;
  }

  /** The claim restates the passage almost word for word, apart from its values or names. */
  function strongOverlap(claimText, passageText) {
    const claimStems = contentStems(claimText, valuesOf(claimText));
    const passageStems = contentStems(passageText, valuesOf(passageText));
    let shared = 0;
    for (const s of claimStems) if (passageStems.has(s)) shared++;
    return shared >= 3 && shared >= 0.6 * claimStems.size;
  }

  const NAME = /(?<![\p{L}\p{N}])[\p{Lu}][\p{L}'’-]+(?:\s+(?:de|da|van|von|la|le|del|di|bin|al)?\s*[\p{Lu}][\p{L}'’-]+)*/gu;
  const SENTENCE_START = /(?:^|[.!?:;]\s+|\n\s*(?:[-*•]\s*)?|["“(]\s*)$/;

  /**
   * Names in a text. A capitalized word that opens a sentence ("Repairs are...", "Work is...") only
   * counts when the context also writes it capitalized mid-sentence, and never when the context also
   * uses it in lowercase; that's how claims.js tells names from ordinary words too.
   */
  function namesOf(text, context) {
    const all = String(context || text);
    const names = [];
    let match;
    NAME.lastIndex = 0;
    while ((match = NAME.exec(text))) {
      const words = match[0].split(/\s+/).filter((w) => !NON_NAMES.has(w));
      if (!words.length) continue;
      const name = words.join(" ");
      if (new RegExp(`(?<![\\p{L}])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(all)) continue;
      const opensSentence = SENTENCE_START.test(text.slice(0, match.index)) && match[0] === words[0];
      if (opensSentence && !usedMidSentence(words[0], all)) continue;
      names.push(name);
    }
    return names;
  }

  function usedMidSentence(word, text) {
    const re = new RegExp(`(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu");
    let match;
    while ((match = re.exec(text))) {
      if (!SENTENCE_START.test(text.slice(0, match.index))) return true;
    }
    return false;
  }

  /**
   * "Marco will send the deck" vs "Priya will send the deck": same statement, different person.
   * Not a conflict when another sentence of the source says the claim's version too.
   */
  function nameConflict(claimText, passageText, sourceText) {
    const claimLower = claimText.toLowerCase();
    const passageLower = passageText.toLowerCase();
    const context = [claimText, passageText, sourceText || ""].join("\n");
    const claimOnly = namesOf(claimText, context).filter((n) => !passageLower.includes(n.toLowerCase()));
    const passageOnly = namesOf(passageText, context).filter((n) => !claimLower.includes(n.toLowerCase()));
    if (!claimOnly.length || !passageOnly.length) return null;
    const nameWords = new Set([...claimOnly, ...passageOnly].flatMap((n) => n.split(/\s+/).map(stem)));
    const claimStems = [...contentStems(claimText)].filter((s) => !nameWords.has(s));
    const sharedWith = (text) => {
      const stems = contentStems(text);
      return claimStems.filter((s) => stems.has(s));
    };
    const shared = sharedWith(passageText);
    if (shared.length < 2 || shared.length < 0.6 * claimStems.length) return null;
    const saidElsewhere = splitSentences(sourceText || "").some(
      (sentence) => claimOnly.every((n) => sentence.toLowerCase().includes(n.toLowerCase())) && sharedWith(sentence).length >= 2,
    );
    if (saidElsewhere) return null;
    return { type: "name", claimValue: claimOnly[0], passageValue: passageOnly[0], shared };
  }

  /**
   * How a claim conflicts with a passage, or null. sourceText is everything the passage came from:
   * a value the claim states that appears anywhere in it is not a conflict, unless the claim
   * restates this passage almost word for word.
   */
  function conflictBetween(claimText, passageText, sourceText) {
    const claim = String(claimText || "");
    const passage = String(passageText || "");
    if (!claim.trim() || !passage.trim()) return null;
    const claimValues = valuesOf(claim);
    const stated = claimValues.filter((v) => !v.negated);
    if (!stated.length) return nameConflict(claim, passage, sourceText);
    const passageValues = valuesOf(passage).filter((v) => !v.negated);
    const sourceValues = sourceText ? valuesOf(sourceText).filter((v) => !v.negated) : passageValues;

    for (const a of stated) {
      const sameType = passageValues.filter((b) => b.type === a.type);
      if (!sameType.length || sameType.some((b) => sameValue(a, b))) continue;
      const elsewhere = sourceValues.some((b) => sameValue(a, b));
      if (elsewhere && !strongOverlap(claim, passage)) continue;
      const frameA = frameNear(claim, a, claimValues);
      let unframed = null;
      for (const b of sameType) {
        // A claim that names both values is comparing them ("Friday, not Thursday"), not contradicting
        if (claimValues.some((c) => sameValue(c, b))) continue;
        const frameB = frameNear(passage, b, passageValues);
        const shared = [...frameA].filter((s) => frameB.has(s));
        if (shared.length) return { type: a.type, claimValue: a.raw, passageValue: b.raw, shared };
        if (!unframed && namesItsThing(a.type)) unframed = { type: a.type, claimValue: a.raw, passageValue: b.raw, shared: [] };
      }
      if (unframed) return unframed;
    }
    // Values agree (or don't apply); the person can still differ ("Marco ... by Friday" vs "Priya ... by Friday")
    return nameConflict(claim, passage, sourceText);
  }

  const NEGATION = /\b(?:not|no|never|none|without)\b|n['’]t\b/i;

  /**
   * The passage says what the claim says, in other words: every value and name of the claim is in it,
   * a "not" on one side is on the other, and the words around them mostly match, including the claim's
   * subject unless two or more words match ("Tickets cost $20" is not "Parking costs $20").
   */
  function statesSame(claimText, passageText, context) {
    const claimValues = valuesOf(claimText).filter((v) => !v.negated);
    const names = namesOf(claimText, context);
    if (!claimValues.length && !names.length) return false;
    const passageValues = valuesOf(passageText).filter((v) => !v.negated);
    if (!claimValues.every((a) => passageValues.some((b) => sameValue(a, b)))) return false;
    const passageLower = passageText.toLowerCase();
    if (!names.every((n) => passageLower.includes(n.toLowerCase()))) return false;
    if (NEGATION.test(claimText) !== NEGATION.test(passageText)) return false;
    const nameWords = new Set(names.flatMap((n) => n.split(/\s+/).map(stem)));
    const stems = [...contentStems(claimText, claimValues)].filter((s) => !nameWords.has(s));
    if (!stems.length) return true;
    const passageStems = contentStems(passageText, passageValues);
    const shared = stems.filter((s) => passageStems.has(s)).length;
    return shared / stems.length >= 0.5 && (shared >= 2 || passageStems.has(stems[0]));
  }

  /** The candidate repeats the target's values (or, without values, its statement). */
  function repeats(targetClaim, candidateClaim, verify) {
    const target = targetClaim.text;
    const candidate = candidateClaim.text;
    const targetValues = valuesOf(target).filter((v) => !v.negated);
    if (targetValues.length) {
      const candidateValues = valuesOf(candidate).filter((v) => !v.negated);
      if (!targetValues.every((a) => candidateValues.some((b) => sameValue(a, b)))) return false;
      const targetStems = contentStems(target, targetValues);
      const candidateStems = contentStems(candidate, candidateValues);
      let shared = 0;
      for (const s of targetStems) if (candidateStems.has(s)) shared++;
      return shared >= Math.min(2, targetStems.size) && !conflictBetween(candidate, target);
    }
    if (!verify) return false;
    const verdict = verify(targetClaim, [{ id: "repeat", text: candidateClaim.sentence || candidate, kind: "page" }]);
    return verdict && verdict.status === "supported";
  }

  // ---- the user's messages ----

  // A request or instruction asks for something; it states nothing ("Reply with exactly these sentences:
  // ...", "Summarize this", "Can you..."). Found in a live test: an instruction was checked against as if
  // the user had said it.
  const REQUEST = /^\s*(?:please|kindly|can you|could you|would you|will you|i (?:want|need|would like|'d like) you to|reply|respond|answer|write|tell|give|list|summari[sz]e|explain|describe|translate|rewrite|repeat|say|make|create|draft|generate|show|help|check|compare|find|turn|convert|format|act as|pretend|imagine|let'?s|use|add|remove|change|fix|keep)\b/i;

  /**
   * What a message states: its sentences minus questions and requests, one per line. What follows a
   * request's colon is the user's material ("Please summarize: Mira prefers a window seat") and stays.
   */
  function statementText(text) {
    return splitSentences(text)
      .map((s) => (REQUEST.test(s) ? s.slice(s.indexOf(":") + 1).trim() : s))
      .filter((s) => s && !/\?["'”’)\]]*$/.test(s) && !REQUEST.test(s))
      .join("\n");
  }

  /** A user message that states something (notes, a document, "my budget is $500"), not just a question. */
  function isSource(text) {
    return statementText(text).length >= SOURCE_MIN_CHARS;
  }

  /** A message with pasted text in it (a document, notes, an email). */
  function isPasted(text) {
    return statementText(text).length >= PASTED_MIN_CHARS && splitSentences(text).length >= 2;
  }

  /** The user's actual request, without pasted text. Used as the question for claims and lookups. */
  function askOf(text) {
    const value = String(text || "").trim();
    if (!isPasted(value)) return value;
    const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const candidates = [...lines.slice(0, 2), ...lines.slice(-2)];
    const ask = candidates.find((line) => line.length <= ASK_MAX_CHARS && (/[?:]$/.test(line) || REQUEST_WORDS.test(line)));
    return ask || "";
  }

  function isPushback(text) {
    const value = String(text || "");
    return PUSHBACK.some((pattern) => pattern.test(value));
  }

  /** The question to check an answer against: the last request, skipping pushbacks ("Are you sure?"). */
  function questionFor(history, fallback) {
    const turns = normalizeHistory(history);
    let index = lastIndexOf(turns, "user");
    if (index < 0) return askOf(fallback);
    while (index >= 0 && isPushback(turns[index].text)) {
      const earlier = lastIndexOf(turns, "user", index);
      if (earlier < 0) break;
      index = earlier;
    }
    return askOf(turns[index].text);
  }

  /**
   * Pasted user text as evidence. The checker window passes { all: true }: everything the user gave it
   * there is a source, however short.
   */
  function pastedSources(history, options) {
    const all = Boolean(options && options.all);
    const sources = [];
    normalizeHistory(history).forEach((turn) => {
      // A pushback quotes the AI ("Are you sure about this? '...'"): those are its words, not the user's
      if (turn.role !== "user" || (!all && (!isSource(turn.text) || isPushback(turn.text)))) return;
      sources.push({
        id: `conversation:${sources.length + 1}`,
        kind: "conversation",
        source: "Your message",
        url: "",
        // In the checker window everything the user gave is the source; in a chat, only what they stated
        text: all ? turn.text : statementText(turn.text),
      });
    });
    return sources;
  }

  function isConversationEvidence(id) {
    return /^conversation:/.test(String(id || ""));
  }

  /**
   * A verdict for a claim that external sources left unverified, from the user's pasted text
   * (passages already split into sentences). Returns null when the pasted text doesn't settle it.
   */
  function checkPasted(claim, passages, verify) {
    const list = (passages || []).filter((p) => p && p.text);
    if (!claim || !list.length) return null;
    const sourceText = list.map((p) => p.text).join("\n");
    let conflict = null;
    let conflictPassage = null;
    for (const passage of list) {
      conflict = conflictBetween(claim.text, passage.text, sourceText);
      if (conflict) {
        conflictPassage = passage;
        break;
      }
    }
    let verdict = verify ? verify(claim, list) : null;
    if (!conflict && (!verdict || verdict.status !== "supported")) {
      const same = list.find((passage) => statesSame(claim.text, passage.text, sourceText));
      if (same) {
        verdict = {
          claimId: claim.id,
          claimText: claim.text,
          status: "supported",
          confidence: 0.7,
          weight: typeof claim.weight === "number" ? claim.weight : 1,
          evidenceId: same.id,
          evidenceText: same.text,
          evidenceUrl: null,
          reasoning: "Every detail of the claim is in the text you gave it.",
          judge: "heuristic",
          checkedAt: new Date().toISOString(),
        };
      }
    }
    const status = verdict && verdict.status;
    if (status === "contradicted" && !conflict) return verdict;
    if (conflict && status !== "supported") {
      return {
        claimId: claim.id,
        claimText: claim.text,
        status: "contradicted",
        confidence: 0.7,
        weight: typeof claim.weight === "number" ? claim.weight : 1,
        evidenceId: conflictPassage.id,
        evidenceText: conflictPassage.text,
        evidenceUrl: null,
        reasoning: `Says ${conflict.claimValue}; the text you gave it says ${conflict.passageValue}.`,
        judge: "heuristic",
        checkedAt: new Date().toISOString(),
      };
    }
    if (status === "supported" && !conflict) return verdict;
    return null;
  }

  // ---- comparing the answer with the conversation ----

  const TONES = {
    changed_unknown: "warn",
    changed_fixed: "ok",
    changed_wrong: "bad",
    held_correct: "ok",
    held_wrong: "bad",
    held_unknown: "warn",
    misquote: "bad",
  };

  function noteFor(type, earlier, afterPushback, truth) {
    const said = shorten(earlier);
    // A quote that ends a sentence of the note keeps its own full stop; one inside a sentence drops it
    const quoted = /[.!?…]$/.test(said) ? `"${said}"` : `"${said}".`;
    const inline = `"${said.replace(/\.$/, "")}"`;
    switch (type) {
      case "changed_unknown":
        return afterPushback
          ? `Changed its answer when you pushed back. Before, it said: ${quoted} No source found to tell which is right.`
          : `Contradicts what it said earlier in this chat: ${quoted} No source found to tell which is right.`;
      case "changed_fixed":
        if (afterPushback) return `Corrected itself when you pushed back. Before, it said ${inline}, which ${truth.oldWrong ? "sources contradict" : "was wrong"}.`;
        return truth.newRight
          ? `Changes its earlier answer (${inline}), and sources agree with the new one.`
          : `Changes its earlier answer (${inline}), which sources contradict.`;
      case "changed_wrong":
        return afterPushback
          ? `Gave in when you pushed back. Its first answer was right: ${quoted}`
          : `Changes a correct earlier answer (${inline}) to a wrong one.`;
      case "held_correct":
        return "Stood by its answer when you pushed back, and sources agree.";
      case "held_wrong":
        return "Stood by its answer when you pushed back, but sources say it's wrong.";
      case "held_unknown":
        return "Stood by its answer when you pushed back. No source found to confirm it.";
      case "misquote":
        return `That's not what you said. You wrote: ${quoted}`;
      default:
        return "";
    }
  }

  function makeItem(type, claim, earlier, earlierRole, afterPushback, truth) {
    return {
      type,
      sentence: claim.sentence || claim.text,
      sentenceIndex: claim.sentenceIndex,
      earlier,
      earlierRole,
      afterPushback: Boolean(afterPushback),
      tone: TONES[type],
      note: noteFor(type, earlier, afterPushback, truth || {}),
    };
  }

  /** Status from external sources only: a verdict from the user's own text or no source says nothing about truth. */
  function externalStatus(verdict) {
    if (!verdict || isConversationEvidence(verdict.evidenceId)) return "unsupported";
    return verdict.status === "supported" || verdict.status === "contradicted" ? verdict.status : "unsupported";
  }

  /** A user message after `fromIndex` says the claim's value: the answer is following the user. */
  function userGaveValue(turns, fromIndex, claimText) {
    const claimValues = valuesOf(claimText).filter((v) => !v.negated);
    const claimNames = claimValues.length ? [] : namesOf(claimText).map((n) => n.toLowerCase());
    for (let i = fromIndex + 1; i < turns.length; i++) {
      if (turns[i].role !== "user") continue;
      const text = turns[i].text;
      if (claimValues.length) {
        const userValues = valuesOf(text);
        if (claimValues.some((a) => userValues.some((b) => sameValue(a, b)))) return true;
      } else if (claimNames.some((n) => text.toLowerCase().includes(n))) {
        return true;
      }
    }
    return false;
  }

  function misquoteOf(claim, turns) {
    if (!SECOND_PERSON.test(claim.sentence || claim.text)) return null;
    const userTurns = turns.filter((turn) => turn.role === "user" && !isPushback(turn.text));
    if (!userTurns.length) return null;
    const everything = userTurns.map((turn) => turn.text).join("\n");
    for (let i = userTurns.length - 1; i >= 0; i--) {
      for (const sentence of splitSentences(userTurns[i].text)) {
        if (conflictBetween(claim.text, sentence, everything)) return sentence;
      }
    }
    return null;
  }

  /** Which of the questioned answer's claims a pushback is about. */
  function pushbackTargets(pushbackText, questioned) {
    if (!questioned.length) return [];
    // grounder.pushbackPrompt swaps the sentence's own double quotes for single ones and may cut it with " …"
    const normalize = (s) => String(s || "").replace(/["“”‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
    const quoted = /["“]([^"”]{8,})["”]/.exec(pushbackText);
    if (quoted) {
      const q = normalize(quoted[1]).replace(/\s*…$/, "");
      const hits = questioned.filter(({ claim }) => {
        const s = normalize(claim.sentence || claim.text);
        return s === q || s.includes(q) || q.includes(s);
      });
      if (hits.length) return hits.slice(0, MAX_HELD_TARGETS);
    }
    const asked = contentStems(pushbackText.replace(/["“][^"”]*["”]/g, " "));
    const about = questioned.filter(({ claim }) => [...contentStems(claim.text)].some((s) => asked.has(s)));
    if (about.length) return about.slice(0, MAX_HELD_TARGETS);
    return questioned
      .filter(({ claim }) => claim.weight >= 0.7)
      .sort((a, b) => b.claim.weight - a.claim.weight)
      .slice(0, MAX_HELD_TARGETS);
  }

  /** The earlier statements most worth comparing a claim with: shared words, and values of the same kind. */
  function relevant(claim, statements, max) {
    const claimStems = contentStems(claim.text);
    const claimTypes = new Set(valuesOf(claim.text).map((v) => v.type));
    return statements
      .map((statement) => {
        let score = 0;
        for (const s of contentStems(statement.text)) if (claimStems.has(s)) score++;
        for (const v of valuesOf(statement.text)) if (claimTypes.has(v.type)) score += 2;
        return { statement, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map(({ statement }) => statement);
  }

  /** What a finding was based on, for the learner: the kind of value that differed and how many words matched. */
  function basisOf(conflict, byAI) {
    const valueType = conflict && conflict.type ? conflict.type : "statement";
    return {
      valueType,
      measure: valueType.startsWith("qty:") && MEASURE_UNITS.has(valueType.slice(4)),
      shared: conflict && Array.isArray(conflict.shared) ? conflict.shared.length : 0,
      byAI: Boolean(byAI),
    };
  }

  /**
   * Compares an answer with the conversation before it.
   * { claims, verdicts (same order as claims), history, evidence (external passages), verify, extract,
   *   judge, aiLimit }
   * judge (optional): the on-device AI, async judge(claim, passages) -> Verdict | null. When given, it
   * decides whether a sentence conflicts with, repeats or doesn't address the few most relevant earlier
   * statements (at most aiLimit questions per answer); the rules pick those statements, and decide
   * everything the AI doesn't. Resolves to ConsistencyItem[] sorted by sentence; each item has a
   * `basis` ({ valueType, measure, shared, byAI }) describing what it was based on.
   */
  async function compare(input) {
    const { claims, verdicts, history, evidence, judge } = input || {};
    const verify = (input && input.verify) || (AH.verifier && AH.verifier.verifyClaim);
    const extract = (input && input.extract) || (AH.claims && AH.claims.extract);
    const turns = normalizeHistory(history);
    if (!verify || !extract || !turns.length || !Array.isArray(claims) || !claims.length) return [];
    let aiLeft = typeof judge === "function" ? Math.max(0, input.aiLimit === undefined ? AI_LIMIT : input.aiLimit) : 0;

    const external = (Array.isArray(evidence) ? evidence : []).filter((e) => e && e.kind !== "conversation" && !isConversationEvidence(e.id));
    const verdictList = Array.isArray(verdicts) ? verdicts : [];
    const verdictById = new Map(verdictList.filter(Boolean).map((v) => [v.claimId, v]));
    const lastUser = lastIndexOf(turns, "user");
    const pushback = lastUser >= 0 && isPushback(turns[lastUser].text);
    const questionedTurn = pushback ? lastIndexOf(turns, "assistant", lastUser) : -1;

    // Earlier answers as claims, newest first
    const earlier = [];
    const assistantTurns = turns.map((turn, index) => index).filter((index) => turns[index].role === "assistant").slice(-MAX_EARLIER_TURNS);
    for (const index of assistantTurns.reverse()) {
      const userIndex = lastIndexOf(turns, "user", index);
      const ask = userIndex >= 0 ? questionFor(turns.slice(0, userIndex + 1)) : "";
      const found = extract(turns[index].text, { question: ask });
      for (const claim of found) {
        if (claim.weight > 0) earlier.push({ claim, turnIndex: index, turnText: turns[index].text });
      }
      // Short replies like "Room 204, noted." aren't claims to the extractor, but their values count here
      splitSentences(turns[index].text).forEach((sentence, i) => {
        if (found.some((claim) => claim.sentence === sentence) || !valuesOf(sentence).length) return;
        earlier.push({ claim: { id: `earlier_${index}_${i}`, text: sentence, sentence, sentenceIndex: i, entities: [], weight: 0.5 }, turnIndex: index, turnText: turns[index].text });
      });
    }
    // What the user said, as statements (a pushback quotes the AI, so it isn't one)
    const userSaid = [];
    turns.forEach((turn, index) => {
      if (turn.role !== "user" || isPushback(turn.text)) return;
      for (const sentence of splitSentences(turn.text)) userSaid.push({ text: sentence, role: "user", turnIndex: index });
    });

    const truthCache = new Map();
    const truthOf = (claim) => {
      if (!truthCache.has(claim.text)) truthCache.set(claim.text, external.length ? verify(claim, external) : null);
      return truthCache.get(claim.text);
    };

    /** The AI's view of a claim against statements: { relation: "conflict" | "same" | "none", statement }, or null. */
    async function askAI(claim, statements) {
      if (aiLeft <= 0 || !statements.length) return null;
      aiLeft--;
      try {
        const passages = statements.map((statement, i) => ({ id: `statement:${i}`, text: statement.text, kind: "conversation" }));
        const verdict = await judge(claim, passages);
        if (!verdict) return null;
        const statement = statements[Number(String(verdict.evidenceId || "").split(":")[1])];
        if (verdict.status === "contradicted" && statement) return { relation: "conflict", statement };
        if (verdict.status === "supported" && statement) return { relation: "same", statement };
        return { relation: "none" };
      } catch (error) {
        return null;
      }
    }

    /** A finding for a claim that conflicts with an earlier answer, typed by what sources say; or null. */
    function changedItem(claim, verdict, prior, basis) {
      const afterPushback = pushback && prior.turnIndex === questionedTurn;
      const newStatus = externalStatus(verdict);
      const old = truthOf(prior.claim);
      const oldStatus = old ? old.status : "unsupported";
      let type = "changed_unknown";
      if (newStatus !== oldStatus || newStatus === "unsupported") {
        if (newStatus === "supported" || oldStatus === "contradicted") type = "changed_fixed";
        else if (newStatus === "contradicted" || oldStatus === "supported") type = "changed_wrong";
      }
      // Both sides backed by sources: the two statements aren't really about the same thing
      if (newStatus === "supported" && oldStatus === "supported") return null;
      // The user gave the new value ("make it $600"): it's following the user. Only facts sources
      // can settle are still reported, since giving in to pressure on a fact is the point.
      if (type === "changed_unknown" && userGaveValue(turns, prior.turnIndex, claim.text)) return null;
      const truth = { newRight: newStatus === "supported", oldWrong: oldStatus === "contradicted" };
      return { ...makeItem(type, claim, prior.claim.sentence || prior.claim.text, "assistant", afterPushback, truth), basis };
    }

    /** The rules' view: a misquote, or the first earlier answer the claim conflicts with. */
    function byRules(claim, verdict) {
      const quoted = misquoteOf(claim, turns);
      if (quoted) return { ...makeItem("misquote", claim, quoted, "user", false), basis: basisOf(conflictBetween(claim.text, quoted)) };
      for (const prior of earlier) {
        let conflict = conflictBetween(claim.text, prior.claim.text, prior.turnText);
        if (!conflict) {
          const check = verify(claim, [{ id: "earlier", text: prior.claim.sentence || prior.claim.text, kind: "page" }]);
          if (check && check.status === "contradicted") conflict = { type: "statement" };
        }
        if (conflict) return changedItem(claim, verdict, prior, basisOf(conflict));
      }
      return null;
    }

    const items = [];
    const reported = new Set();
    // Most informative sentences first, so they get the AI's attention
    const order = claims
      .map((claim, i) => i)
      .filter((i) => claims[i] && claims[i].weight > 0 && !HYPOTHETICAL.test(claims[i].sentence || claims[i].text))
      .sort((a, b) => claims[b].weight - claims[a].weight);
    for (const i of order) {
      const claim = claims[i];
      if (reported.has(claim.sentenceIndex)) continue;
      const verdict = verdictById.get(claim.id) || verdictList[i];
      const statements = [
        ...(SECOND_PERSON.test(claim.sentence || claim.text) ? userSaid : []),
        ...earlier.map((entry) => ({ text: entry.claim.sentence || entry.claim.text, role: "assistant", entry })),
      ];
      const ai = await askAI(claim, relevant(claim, statements, 3));
      let item = null;
      if (ai && ai.relation === "conflict") {
        const basis = basisOf(conflictBetween(claim.text, ai.statement.text), true);
        item = ai.statement.role === "user"
          ? { ...makeItem("misquote", claim, ai.statement.text, "user", false), basis }
          : changedItem(claim, verdict, ai.statement.entry, basis);
      } else if (!ai) {
        item = byRules(claim, verdict);
      }
      if (item) {
        items.push(item);
        reported.add(claim.sentenceIndex);
      }
    }

    if (pushback && questionedTurn >= 0) {
      const questioned = earlier.filter((entry) => entry.turnIndex === questionedTurn);
      const answerSentences = claims.filter((claim) => claim && claim.weight > 0).map((claim) => ({ text: claim.sentence || claim.text, claim }));
      for (const target of pushbackTargets(turns[lastUser].text, questioned)) {
        const targetSentence = target.claim.sentence || target.claim.text;
        if (items.some((item) => item.earlier === targetSentence)) continue;
        const ai = await askAI(target.claim, relevant(target.claim, answerSentences, 3));
        let claim = null;
        if (ai && ai.relation === "same") claim = ai.statement.claim;
        else if (!ai) claim = claims.find((c) => c && c.weight > 0 && !reported.has(c.sentenceIndex) && repeats(target.claim, c, verify)) || null;
        if (!claim || reported.has(claim.sentenceIndex)) continue;
        const index = claims.indexOf(claim);
        let status = externalStatus(verdictById.get(claim.id) || verdictList[index]);
        if (status === "unsupported") {
          const old = truthOf(target.claim);
          status = old ? old.status : "unsupported";
        }
        const type = status === "supported" ? "held_correct" : status === "contradicted" ? "held_wrong" : "held_unknown";
        const value = valuesOf(target.claim.text)[0];
        items.push({ ...makeItem(type, claim, targetSentence, "assistant", true), basis: basisOf(value ? { type: value.type, shared: [] } : null, Boolean(ai)) });
        reported.add(claim.sentenceIndex);
      }
    }

    return items.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
  }

  AH.conversation = {
    pastedSources,
    askOf,
    isSource,
    isPushback,
    questionFor,
    checkPasted,
    compare,
    isConversationEvidence,
    // exported for tests
    valuesOf,
    sameValue,
    conflictBetween,
    SOURCE_MIN_CHARS,
  };

  if (typeof module !== "undefined") {
    module.exports = AH.conversation;
  }
})(globalThis);
