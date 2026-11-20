"use strict";

const windows = new Map();
const sessions = new Map();
let editorAssets;
let pluginID;
let originalOpen;
let openDiagramAttachment;
let removeIcons;

function install() {}
function uninstall() {}

function startup({ id, rootURI }) {
  pluginID = id;
  editorAssets = registerEditorAssets(rootURI);
  removeIcons = installDiagramIcons();
  originalOpen = Zotero.FileHandlers.open;
  openDiagramAttachment = async function (item, options) {
    if (!isDiagram(item)) return originalOpen.call(this, item, options);
    const window = Zotero.getMainWindow();
    if (!window || !windows.has(window)) return originalOpen.call(this, item, options);
    try {
      return await openDiagram(window, item);
    } catch (error) {
      report(window, strings.openFailed + "\n" + error.message, error);
      return false;
    }
  };
  Zotero.FileHandlers.open = openDiagramAttachment;
  registerMenus();
  void registerDiagramSettings().catch(Zotero.logError);
  for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
}

function onMainWindowLoad({ window }) {
  if (!editorAssets || windows.has(window) || !window.Zotero_Tabs) return;
  const tabs = window.Zotero_Tabs;
  const removeUI = mountDiagramUI(window);
  const originalState = tabs.getState;
  const getState = function () {
    const state = originalState.call(this);
    const kept = state.filter(tab => tab.type !== TAB_TYPE);
    if (kept.length < state.length && !kept.some(tab => tab.selected)) kept[0].selected = true;
    return kept;
  };
  tabs.getState = getState;
  tabs.tabHooks.getTitle[TAB_TYPE] = tab => {
    const item = Zotero.Items.get(tab.data.itemID);
    return item?.getField("title") || item?.attachmentFilename || tab.title;
  };
  tabs.tabHooks.undoClose[TAB_TYPE] = async tab => {
    const item = await Zotero.Items.getAsync(tab.data.itemID);
    if (!isDiagram(item)) return false;
    await window.ZoteroPane.viewAttachment(item.id);
    return sessions.has(item.id);
  };
  const removeHooks = () => {
    removeUI();
    if (tabs.getState === getState) tabs.getState = originalState;
    delete tabs.tabHooks.getTitle[TAB_TYPE];
    delete tabs.tabHooks.undoClose[TAB_TYPE];
  };
  windows.set(window, removeHooks);
}

async function finishWindow(window) {
  for (const [id, session] of sessions) {
    if (session.window !== window) continue;
    if (!session.closed && !window.closed) window.Zotero_Tabs.close(session.id);
    await closeSession(id, session);
  }
  windows.get(window)?.();
  windows.delete(window);
}

function onMainWindowUnload({ window }) {
  return finishWindow(window);
}

async function shutdown() {
  if (Zotero.FileHandlers.open === openDiagramAttachment) Zotero.FileHandlers.open = originalOpen;
  if (!editorAssets) return;
  Zotero.MenuManager.unregisterMenu(pluginID + "-tools");
  Zotero.MenuManager.unregisterMenu(pluginID + "-items");
  removeIcons();
  await Promise.all(Array.from(windows.keys(), finishWindow));
  editorAssets.remove();
  editorAssets = null;
}

async function openDiagram(window, item) {
  const id = item.id;
  let session = sessions.get(id);
  if (session?.closing) {
    await session.closing;
    session = sessions.get(id);
  }
  if (session && !session.closed) {
    session.window.focus();
    session.window.Zotero_Tabs.select(session.id);
    return true;
  }

  const path = await item.getFilePathAsync();
  if (!path) return false;
  const file = new DiagramFile(item, path);
  const original = await file.read();
  if (!isDiagramXML(original.xml)) throw new Error(strings.invalidFile);
  let recovery = session?.pending
    ? { xml: session.pending, baseHash: session.baseHash }
    : await file.getRecovery();
  if (recovery?.xml === original.xml) {
    await file.clearRecovery();
    recovery = null;
  }
  // Another request can finish opening this attachment while the file is being read.
  const existing = sessions.get(id);
  if (existing && !existing.closed) {
    existing.window.Zotero_Tabs.select(existing.id);
    return true;
  }
  session = new DiagramTab(window, file, editorAssets.url, tab => void closeSession(id, tab));
  session.show(original, recovery);
  sessions.set(id, session);
  return true;
}

function closeSession(id, session) {
  session.closing ??= session.close().catch(Zotero.logError).finally(() => {
    if ((!session.pending || session.recoveryWritten) && sessions.get(id) === session) {
      sessions.delete(id);
    }
  });
  return session.closing;
}

function registerMenus() {
  const itemOf = window => {
    const items = window.ZoteroPane.getSelectedItems();
    return items.length === 1 ? items[0] : null;
  };
  const windowOf = event => event.target.ownerGlobal;
  const register = (name, target, menus) => {
    Zotero.MenuManager.registerMenu({ menuID: pluginID + "-" + name, pluginID, target, menus });
  };
  register("tools", "main/menubar/tools", [{
    menuType: "menuitem",
    enableForTabTypes: ["library"],
    onShowing(event, context) {
      context.menuElem.setAttribute("label", strings.newStandalone);
    },
    onCommand(event) {
      const window = windowOf(event);
      void createDiagram(window).catch(error => report(window, strings.createFailed, error));
    },
  }, {
    menuType: "menuitem",
    onShowing(_event, context) {
      context.menuElem.setAttribute("label", strings.settingsMenu);
    },
    onCommand() {
      Zotero.Utilities.Internal.openPreferences(DrawioSettings.paneID);
    },
  }]);
  register("items", "main/library/item", [{
    menuType: "menuitem",
    onShowing(event, context) {
      context.menuElem.setAttribute("label", strings.newChild);
      const item = itemOf(windowOf(event));
      context.setVisible(item?.isRegularItem() && item.libraryID === Zotero.Libraries.userLibraryID && canWrite(item));
    },
    onCommand(event) {
      const window = windowOf(event);
      const parent = itemOf(window);
      if (!parent?.isRegularItem() || !canWrite(parent) || parent.libraryID !== Zotero.Libraries.userLibraryID) return;
      void createDiagram(window, parent).catch(error => report(window, strings.createFailed, error));
    },
  }, {
    menuType: "menuitem",
    onShowing(event, context) {
      context.menuElem.setAttribute("label", strings.open);
      context.setVisible(isDiagram(itemOf(windowOf(event))));
    },
    onCommand(event) {
      const window = windowOf(event);
      const item = itemOf(window);
      if (isDiagram(item)) void window.ZoteroPane.viewAttachment(item.id).catch(error =>
        report(window, strings.openFailed, error));
    },
  }]);
}

async function createDiagram(window, parent = null) {
  const pane = window.ZoteroPane;
  const libraryID = Zotero.Libraries.userLibraryID;
  const options = parent ? { parentItemID: parent.id } : { libraryID };
  if (!parent) {
    const selected = pane.getSelectedCollections();
    if (pane.getSelectedLibraryID() !== libraryID || selected.length > 1) {
      report(window, strings.chooseOne);
      return;
    }
    if (selected.length) options.collections = [selected[0].id];
  }
  const title = promptForDiagramTitle(window);
  if (title === null) return;
  const { grid, pageView } = DrawioSettings.get();
  const xml = BLANK_DIAGRAM.replace('grid="1"', 'grid="' + Number(grid) + '"')
    .replace('page="1"', 'page="' + Number(pageView) + '"');
  const item = await importDiagram(xml, title, options);
  await pane.selectItem(item.id);
  await pane.viewAttachment(item.id);
}

function promptForDiagramTitle(window) {
  const name = { value: strings.untitled };
  if (!Services.prompt.prompt(window, dialogTitle, strings.name, name, null, {})) return null;
  return name.value.trim() || strings.untitled;
}
