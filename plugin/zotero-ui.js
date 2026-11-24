"use strict";

const DIAGRAM_ICON_TYPE = "attachmentDrawio";
const NEW_DIAGRAM_BUTTON = "zotero-tb-drawio-new";

function installDiagramIcons() {
  const prototype = Zotero.Item.prototype;
  const originalIconName = prototype.getItemTypeIconName;
  const originalImage = prototype.getImageSrc;
  const icon = editorAssets.origin + "/icons/diagram.png";
  const iconName = function (...args) {
    return isDiagram(this) ? DIAGRAM_ICON_TYPE : originalIconName.apply(this, args);
  };
  const imageSrc = function (...args) {
    return isDiagram(this) ? icon : originalImage.apply(this, args);
  };
  prototype.getItemTypeIconName = iconName;
  prototype.getImageSrc = imageSrc;
  return () => {
    if (prototype.getItemTypeIconName === iconName) prototype.getItemTypeIconName = originalIconName;
    if (prototype.getImageSrc === imageSrc) prototype.getImageSrc = originalImage;
  };
}

function mountDiagramUI(window) {
  const { document } = window;
  const icon = editorAssets.origin + "/icons/diagram.png";
  const css = `
    .icon-item-type[data-item-type="${DIAGRAM_ICON_TYPE}"],
    .row:has(.item-icon[data-item-type="${DIAGRAM_ICON_TYPE}"]) .icon-attachment-type[data-item-type="attachmentFile"] {
      background: url("${icon}") no-repeat center / contain !important;
    }
    attachment-preview[data-drawio-diagram] {
      height: auto !important;
      opacity: 1 !important;
    }
    attachment-preview[data-drawio-diagram] > :not(.drawio-diagram-preview, .drawio-diagram-preview-fallback, .drag-container) {
      visibility: collapse !important;
      position: absolute !important;
      pointer-events: none;
    }
    .drawio-diagram-preview {
      display: block;
      width: 100%;
      height: clamp(190px, 38vh, 400px);
      border: 1px solid color-mix(in srgb, currentColor 17%, transparent);
      border-radius: 5px;
      box-sizing: border-box;
    }
    .drawio-diagram-preview-fallback { padding: 8px; }
    #${NEW_DIAGRAM_BUTTON} > .toolbarbutton-icon {
      width: 20px;
      height: 20px;
    }
  `;
  const sheet = "data:text/css;charset=utf-8," + encodeURIComponent(css);
  const utils = window.windowUtils;
  utils.loadSheetUsingURIString(sheet, utils.AUTHOR_SHEET);
  const toolbar = document.getElementById("zotero-items-toolbar");
  const button = document.createXULElement("toolbarbutton");
  button.id = NEW_DIAGRAM_BUTTON;
  button.className = "zotero-tb-button";
  button.setAttribute("aria-label", strings.newToolbar);
  button.setAttribute("tooltiptext", strings.newToolbar);
  button.setAttribute("image", editorAssets.origin + "/icons/new-diagram.png");
  button.addEventListener("command", () => {
    void createDiagram(window).catch(error => report(window, strings.createFailed, error));
  });
  const search = document.getElementById("zotero-tb-search-spinner");
  const spacer = search?.previousElementSibling;
  toolbar?.insertBefore(button, spacer?.localName === "spacer" ? spacer : search);

  const removePreviews = mountDiagramPreviews(window);
  refreshDiagramIcons(window);
  return () => {
    button.remove();
    removePreviews();
    if (!window.closed) {
      utils.removeSheetUsingURIString(sheet, utils.AUTHOR_SHEET);
      refreshDiagramIcons(window);
    }
  };
}

function refreshDiagramIcons(window) {
  const view = window.ZoteroPane?.itemsView;
  if (!view) return;
  const itemTree = view.itemTree ?? view;
  if (itemTree.invalidateRowCache) itemTree.invalidateRowCache(true);
  else if (itemTree._rowCache) itemTree._rowCache = {};
  itemTree?.tree?.invalidate();
}

function selectedDiagramCollections(pane) {
  if (pane.getSelectedCollections) return pane.getSelectedCollections();
  const collection = pane.getSelectedCollection();
  return collection ? [collection] : [];
}

function registerDiagramSettings() {
  return Zotero.PreferencePanes.register({
    pluginID,
    id: DrawioSettings.paneID,
    label: DrawioSettings.name,
    image: "icons/diagram.png",
    src: "settings/pane.xhtml",
    scripts: ["settings/options.js", "settings/pane.js"],
    stylesheets: ["settings/pane.css"],
  });
}
