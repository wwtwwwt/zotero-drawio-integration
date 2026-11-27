// Keep clipboard commands in the embedded Gecko document, independent of when
// the user pressed the modifier key or which editor panel last held focus.
(() => {
  EditorUi.prototype.installNativeClipboardHandler = function () {
    const ui = this;
    const graph = this.editor.graph;
    const container = graph.container;
    const clipboard = document.createElement("div");
    clipboard.contentEditable = "true";
    clipboard.tabIndex = -1;
    clipboard.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    ui.clipboardElt = clipboard;
    let previousFocus;
    let cleanup;
    let plainPaste = false;

    function restoreFocus() {
      const restore = document.activeElement === clipboard;
      clipboard.remove();
      if (restore) {
        const target = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : container;
        target.focus({ preventScroll: true });
      }
    }

    function canHandle(event) {
      return graph.isEnabled() && !ui.isLocked() && !graph.isMouseDown && !graph.isEditing() &&
        !event.defaultPrevented && !graph.popupMenuHandler?.isMenuShowing() &&
        !ui.dialogs?.length && !document.querySelector("dialog[open]") &&
        (event.target === ui.typingShim || event.target === clipboard ||
          !event.target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
    }

    function prepareClipboard() {
      if (!clipboard.isConnected) previousFocus = document.activeElement;
      clipboard.textContent = "\u00a0";
      clipboard.style.left = container.scrollLeft + "px";
      clipboard.style.top = container.scrollTop + "px";
      if (!clipboard.isConnected) container.append(clipboard);
      clipboard.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(clipboard);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      clearTimeout(cleanup);
      cleanup = setTimeout(restoreFocus, 0);
    }

    for (const type of ["copy", "cut"]) {
      clipboard.addEventListener(type, event => {
        if (!event.clipboardData || !canHandle(event) || graph.isSelectionEmpty()) return;
        const cut = type === "cut";
        const selected = graph.getSelectionCells();
        const cells = cut ? graph.getCutCells(selected) : selected;
        const exported = mxUtils.sortCells(graph.getExportableCells(graph.model.getTopmostCells(cells)));
        if (!exported.length) return;
        const xml = mxUtils.getXml(graph.encodeCells(exported));
        event.clipboardData.setData("text/plain", xml);
        event.preventDefault();
        mxClipboard.copy(graph, exported);
        graph.lastPasteXml = cut ? null : xml;
        graph.pasteCounter = 0;
        if (cut) graph.removeCells(exported, false);
      });
    }
    document.addEventListener("paste", event => {
      if (!event.clipboardData || !canHandle(event) || graph.isCellLocked(graph.getDefaultParent())) return;
      ui.pasteCells(event, clipboard, true, true, event.target === clipboard && plainPaste);
    }, true);

    document.addEventListener("keydown", event => {
      if (!event.target.closest?.(".da-panel input, .da-panel select, .da-inspector textarea")) return;
      // Keep Zotero/draw.io's document shortcuts away from the plugin's text controls.
      if (event.key === "Backspace" || event.key === "Delete" || event.metaKey || event.ctrlKey) {
        event.stopPropagation();
      }
    });
    document.addEventListener("keydown", event => {
      if (!canHandle(event) || EditorUi.isComposingKeyEvent(event) || EditorUi.isAltGraphKeyEvent(event)) return;
      const accelerator = mxClient.IS_MAC ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      const clipboardKey = accelerator && !event.altKey &&
        (key === "v" || (!event.shiftKey && ["c", "x"].includes(key)));
      const insertKey = !mxClient.IS_MAC && key === "insert" && !event.altKey &&
        !event.metaKey && event.shiftKey !== accelerator;
      if (clipboardKey || insertKey) {
        const paste = key === "v" || (insertKey && event.shiftKey);
        if (paste ? graph.isCellLocked(graph.getDefaultParent()) : graph.isSelectionEmpty()) return;
        plainPaste = key === "v" && event.shiftKey;
        prepareClipboard();
        // The native editing command targets the now-focused element.
        return;
      }

      if ((key !== "delete" && key !== "backspace") ||
          (!container.contains(event.target) && graph.isSelectionEmpty())) return;
      const action = ui.keyHandler.resolveFunction(event);
      if (!action) return;
      action(event);
      mxEvent.consume(event);
    }, true);
    for (const code of [67, 86, 88]) ui.keyHandler.bindControlKey(code, null);
  };
})();
