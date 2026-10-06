/**
 * Hallucination Guard icons: one small drawn set (24px grid, 2px round strokes, currentColor),
 * shared by the on-page overlay and the extension pages. Built with DOM calls, never innerHTML,
 * so they're safe to add next to text that came from web pages.
 */
"use strict";

(function (root) {
  const AH = (root.AH = root.AH || {});
  const SVG = "http://www.w3.org/2000/svg";

  // Each icon is a list of [element, attributes]
  const PATHS = {
    check: [["path", { d: "M5 12.5l4.2 4.2L19 7" }]],
    cross: [["path", { d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }]],
    question: [
      ["path", { d: "M9.2 9.1a2.9 2.9 0 1 1 4 2.7c-.8.4-1.2 1-1.2 1.8v.6" }],
      ["circle", { cx: "12", cy: "17.6", r: "0.4", fill: "currentColor" }],
    ],
    alert: [
      ["path", { d: "M12 4.5l8.5 14.7H3.5z" }],
      ["path", { d: "M12 10v4" }],
      ["circle", { cx: "12", cy: "16.9", r: "0.4", fill: "currentColor" }],
    ],
    shield: [
      ["path", { d: "M12 3.5l7 2.6v5.2c0 4.3-2.9 7.6-7 9.2-4.1-1.6-7-4.9-7-9.2V6.1z" }],
      ["path", { d: "M8.9 12.2l2.2 2.2 4-4.2" }],
    ],
    chevron: [["path", { d: "M7 10l5 5 5-5" }]],
    external: [
      ["path", { d: "M14 5h5v5" }],
      ["path", { d: "M19 5l-8 8" }],
      ["path", { d: "M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" }],
    ],
    link: [
      ["path", { d: "M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1 1" }],
      ["path", { d: "M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1-1" }],
    ],
    sparkle: [["path", { d: "M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" }], ["path", { d: "M18.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" }]],
    dot: [["circle", { cx: "12", cy: "12", r: "3.5", fill: "currentColor", stroke: "none" }]],
  };

  // Verdict -> icon name, used everywhere a verdict is shown
  const FOR_STATUS = { supported: "check", contradicted: "cross", unsupported: "question" };

  /** An <svg> element for this icon, sized by the surrounding font (1em) unless size is given. */
  function icon(name, { size, className, title } = {}) {
    const doc = root.document;
    const svg = doc.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size || "1em");
    svg.setAttribute("height", size || "1em");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", `hg-icon${className ? ` ${className}` : ""}`);
    if (title) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", title);
    } else {
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
    }
    for (const [tag, attrs] of PATHS[name] || PATHS.dot) {
      const part = doc.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, value);
      svg.appendChild(part);
    }
    return svg;
  }

  AH.icons = { icon, FOR_STATUS, names: Object.keys(PATHS) };

  if (typeof module !== "undefined") {
    module.exports = AH.icons;
  }
})(globalThis);
