"use strict";

// Configure the bundled viewer before its script starts. All drawable resources
// resolve within the package, and the page CSP blocks external fetches.
const assets = new URL("../editor/", document.baseURI).href.replace(/\/$/, "");
Object.assign(window, {
  DRAWIO_BASE_URL: assets,
  STYLE_PATH: assets + "/styles",
  SHAPES_PATH: assets + "/shapes",
  STENCIL_PATH: assets + "/stencils",
  DRAW_MATH_URL: assets + "/math4/es5",
  GRAPH_IMAGE_PATH: assets + "/img",
  mxImageBasePath: assets + "/mxgraph/images",
  mxBasePath: assets + "/mxgraph",
});

const canvas = document.getElementById("diagram");
const status = document.getElementById("status");
const navigation = document.querySelector("nav");
const previous = document.getElementById("previous");
const next = document.getElementById("next");
const page = document.getElementById("page");
let viewer;
let messages;

function showStatus(message) {
  canvas.hidden = !!message;
  status.hidden = !message;
  status.textContent = message;
}

function updatePage() {
  const current = viewer.getShownPage();
  const count = viewer.diagrams.length;
  const name = viewer.diagrams[current]?.getAttribute("name");
  navigation.hidden = count < 2;
  previous.disabled = current <= 0;
  next.disabled = current >= count - 1;
  const position = (current + 1) + " / " + count;
  page.textContent = page.title = name ? position + " · " + name : position;
  const { width, height } = viewer.graph.getGraphBounds();
  showStatus(width || height ? "" : messages.blank);
  document.documentElement.dataset.drawioPreview = width || height ? "rendered" : "blank";
}

function selectPage(delta) {
  try {
    canvas.hidden = false;
    viewer.selectPage(viewer.currentPage + delta);
    updatePage();
  } catch (error) {
    console.error(error);
    showStatus(messages.failed);
    document.documentElement.dataset.drawioPreview = "error";
  }
}

previous.addEventListener("click", () => selectPage(-1));
next.addEventListener("click", () => selectPage(1));
window.onDrawioViewerLoad = () => {
  document.addEventListener("diagram-attachments:preview", ({ detail }) => {
    messages = JSON.parse(detail);
    previous.setAttribute("aria-label", messages.previous);
    next.setAttribute("aria-label", messages.next);
    if (messages.error) {
      showStatus(messages.error);
      document.documentElement.dataset.drawioPreview = "error";
      return;
    }
    try {
      const xml = mxUtils.parseXml(messages.xml).documentElement;
      viewer = new GraphViewer(canvas, xml, {
        title: messages.title,
        responsive: true,
        lightbox: false,
        "dark-mode": "auto",
        "show-note-icons": false,
        "check-visible-state": false,
      });
      const svg = canvas.querySelector("svg");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      // Keyboard navigation stays on the page controls.
      canvas.inert = true;
      updatePage();
    } catch (error) {
      console.error(error);
      showStatus(messages.failed);
      document.documentElement.dataset.drawioPreview = "error";
    }
  }, { once: true });
  document.documentElement.dataset.drawioViewerReady = "true";
};
