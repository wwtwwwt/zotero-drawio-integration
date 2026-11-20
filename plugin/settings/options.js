"use strict";

var DrawioSettings = (() => {
  const preference = "drawioIntegration.settings";
  const defaults = Object.freeze({
    color: "system",
    layout: "kennedy",
    language: "zotero",
    palette: "zotero",
    defaultFont: "",
    customFonts: "",
    grid: true,
    pageView: true,
    noteMode: "copy",
  });
  const choices = {
    color: ["system", "light", "dark"],
    layout: ["kennedy", "atlas"],
    language: ["zotero", "zh", "en"],
    palette: ["zotero", "shapes"],
    noteMode: ["copy", "linked"],
  };

  // draw.io stores font family names inside semicolon-separated shape styles.
  const fontName = value => typeof value === "string" && /^[\p{L}\p{N} ._()+-]{1,96}$/u.test(value.trim())
    ? value.trim() : "";
  const fontList = value => typeof value === "string"
    ? [...new Set(value.split(/[,，\n]/).map(fontName).filter(Boolean))].slice(0, 50)
    : [];

  function get() {
    let stored;
    try {
      stored = JSON.parse(Zotero.Prefs.get(preference) || "{}");
    } catch {
      stored = {};
    }
    const values = { ...defaults };
    for (const [key, allowed] of Object.entries(choices)) {
      if (allowed.includes(stored?.[key])) values[key] = stored[key];
    }
    for (const key of ["grid", "pageView"]) {
      if (typeof stored?.[key] === "boolean") values[key] = stored[key];
    }
    values.defaultFont = fontName(stored?.defaultFont);
    values.customFonts = fontList(stored?.customFonts).join(", ");
    return values;
  }

  return {
    name: "zotero-drawio-integration",
    paneID: "zotero-drawio-integration-pane",
    choices,
    get,
    set: (key, value) => Zotero.Prefs.set(preference, JSON.stringify({ ...get(), [key]: value })),
    reset: () => Zotero.Prefs.clear(preference),
    fonts: values => [...new Set([values.defaultFont, ...fontList(values.customFonts)].filter(Boolean))],
  };
})();
