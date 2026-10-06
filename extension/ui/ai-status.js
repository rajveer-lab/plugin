(function (root) {
  "use strict";
  const AH = (root.AH = root.AH || {});

  function describe(status) {
    const values = {
      available: { mark: "✓", tone: "ok", text: "Ready" },
      downloadable: { mark: "?", tone: "warn", text: "not set up" },
      downloading: { mark: "…", tone: "warn", text: "setting up" },
      unavailable: { mark: "?", tone: "mute", text: "not available on this computer" },
      unsupported: { mark: "?", tone: "mute", text: "not available on this computer" },
    };
    return { ...(values[status] || values.unsupported) };
  }

  AH.aiStatus = { describe };
  if (typeof module !== "undefined") module.exports = AH.aiStatus;
})(globalThis);
