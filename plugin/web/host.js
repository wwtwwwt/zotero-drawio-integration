"use strict";

const prefix = "diagram-attachments:";
const origin = window.location.origin;
let frame;
let loadOptions;

function sendToPlugin(event, detail) {
  document.dispatchEvent(new CustomEvent(prefix + event, { detail }));
}

document.addEventListener(prefix + "start", ({ detail }) => {
  document.documentElement.dataset.diagramEditorPhase = "editor";
  loadOptions = JSON.parse(detail);
  if (frame) {
    frame.remove();
  }

  const params = new URLSearchParams({
    embed: 1,
    proto: "json",
    offline: 1,
    stealth: 1,
    plugins: 0,
    libraries: 1,
    noExitBtn: 1,
    spin: 1,
    lang: loadOptions.lang,
    dark: loadOptions.dark,
    ui: loadOptions.layout,
    configure: 1,
  });
  frame = document.createElement("iframe");
  frame.title = loadOptions.title;
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.src = "../editor/index.html?" + params;
  document.body.append(frame);
});

window.addEventListener("message", (event) => {
  if (event.origin !== origin || event.source !== frame?.contentWindow) return;
  if (typeof event.data !== "string") return;

  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }

  if (message.event === "configure") {
    frame.contentWindow.postMessage(JSON.stringify({
      action: "configure",
      config: {
        customFonts: loadOptions.customFonts,
        zoteroDefaultFont: loadOptions.defaultFont,
        zoteroPalette: loadOptions.palette,
        zoteroNoteMode: loadOptions.noteMode,
      },
    }), origin);
  } else if (message.event === "init") {
    document.documentElement.dataset.diagramEditorPhase = "diagram";
    frame.contentWindow.postMessage(JSON.stringify({
      action: "load",
      xml: loadOptions.xml,
      title: loadOptions.title,
      autosave: loadOptions.readonly ? 0 : 1,
      readOnly: loadOptions.readonly,
      noExitBtn: 1,
    }), origin);
  } else if (message.event === "load") {
    document.documentElement.dataset.diagramEditorPhase = "ready";
    sendToPlugin("ready");
  } else if (message.event === "autosave" || message.event === "save") {
    if (typeof message.xml === "string") sendToPlugin(message.event, message.xml);
  } else if (message.event === "library-request") {
    sendToPlugin("library-request", JSON.stringify(message));
  } else if (message.event === "library-open" && typeof message.link === "string") {
    sendToPlugin("library-open", JSON.stringify(message));
  }
});

document.documentElement.dataset.diagramHostReady = "true";

for (const event of ["library-results", "library-changed"]) {
  document.addEventListener(prefix + event, ({ detail }) => {
    frame?.contentWindow.postMessage(detail, origin);
  });
}

document.addEventListener(prefix + "focus-canvas", () => {
  const canvas = frame?.contentDocument?.querySelector(".geDiagramContainer");
  canvas?.focus({ preventScroll: true });
});

document.addEventListener(prefix + "flush", () => {
  const editor = frame?.contentDocument;
  if (!editor) return;
  const relay = ({ detail }) => sendToPlugin("snapshot", detail);
  editor.addEventListener(prefix + "snapshot", relay);
  try {
    editor.dispatchEvent(new CustomEvent(prefix + "flush"));
  } finally {
    editor.removeEventListener(prefix + "snapshot", relay);
  }
});
