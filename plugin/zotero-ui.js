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
    .row:has(.item-icon[data-item-type="${DIAGRAM_ICON_TYPE}"]) .icon-attachment-type[data-item-type="attachmentFile"],
    attachment-preview[data-drawio-diagram] .icon {
      background: url("${icon}") no-repeat center / contain !important;
    }
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

  let active = true;
  let restorePreview = () => {};
  // Keep Zotero's file-preview behavior and only change its placeholder art.
  void window.customElements.whenDefined("attachment-preview").then(() => {
    if (!active) return;
    const prototype = window.customElements.get("attachment-preview").prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "item");
    if (!descriptor?.set) return;
    const set = function (item) {
      descriptor.set.call(this, item);
      this.toggleAttribute("data-drawio-diagram", isDiagram(item));
    };
    Object.defineProperty(prototype, "item", { ...descriptor, set });
    for (const preview of document.querySelectorAll("attachment-preview")) {
      preview.toggleAttribute("data-drawio-diagram", isDiagram(preview.item));
    }
    restorePreview = () => {
      if (Object.getOwnPropertyDescriptor(prototype, "item")?.set === set) {
        Object.defineProperty(prototype, "item", descriptor);
      }
      for (const preview of document.querySelectorAll("attachment-preview[data-drawio-diagram]")) {
        preview.removeAttribute("data-drawio-diagram");
      }
    };
  }).catch(Zotero.logError);
  refreshDiagramIcons(window);
  return () => {
    active = false;
    button.remove();
    restorePreview();
    if (!window.closed) {
      utils.removeSheetUsingURIString(sheet, utils.AUTHOR_SHEET);
      refreshDiagramIcons(window);
    }
  };
}

function refreshDiagramIcons(window) {
  const itemTree = window.ZoteroPane?.itemsView?.itemTree;
  itemTree?.invalidateRowCache(true);
  itemTree?.tree?.invalidate();
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
