"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});

  function build(turns) {
    if (!Array.isArray(turns)) return [];
    const clean = turns
      .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant"))
      .map((turn) => ({ role: turn.role, text: typeof turn.text === "string" ? turn.text.trim() : "" }))
      .filter((turn) => turn.text)
      .filter((turn, index, list) => index === 0 || turn.role !== list[index - 1].role || turn.text !== list[index - 1].text)
      .slice(-20)
      .map((turn) => ({ ...turn, text: turn.text.slice(0, 20000) }));

    let total = clean.reduce((sum, turn) => sum + turn.text.length, 0);
    while (total > 60000 && clean.length > 1) {
      total -= clean.shift().text.length;
    }
    if (total > 60000 && clean.length === 1) {
      clean[0].text = clean[0].text.slice(-60000);
    }
    return clean;
  }

  AH.siteHistory = { build };
  if (typeof module !== "undefined") module.exports = AH.siteHistory;
})(globalThis);
