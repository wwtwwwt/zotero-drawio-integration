// Appended to a test-only copy of bootstrap.js by scripts/smoke.py.
const startPlugin = startup;
startup = params => {
  try {
    startPlugin(params);
    void testDiagramAttachments();
  } catch (error) {
    void IOUtils.writeUTF8(PathUtils.join(Zotero.Profile.dir, "smoke.log"),
      "FAIL " + error + "\n" + error.stack + "\nDONE\n");
  }
};

async function testDiagramAttachments() {
  const resultPath = PathUtils.join(Zotero.Profile.dir, "smoke.log");
  const phasePath = PathUtils.join(Zotero.Profile.dir, "smoke-state.json");
  const log = message => IOUtils.writeUTF8(resultPath, message + "\n", { mode: "appendOrCreate" });
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const until = async (condition, message) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = condition();
      if (result) return result;
      await Zotero.Promise.delay(50);
    }
    throw new Error(message);
  };
  const attempts = [];
  const networkObserver = { observe(subject) {
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const origins = [channel.loadInfo.loadingPrincipal, channel.loadInfo.triggeringPrincipal];
    if (origins.some(principal => principal?.origin === editorAssets?.origin)) {
      attempts.push(channel.URI.spec);
      channel.cancel(Components.results.NS_BINDING_ABORTED);
    }
  } };
  Services.obs.addObserver(networkObserver, "http-on-modify-request");

  try {
    const window = await until(Zotero.getMainWindow, "Zotero did not create a main window");
    const pane = window.ZoteroPane;
    await until(() => pane.itemsView?.collectionTreeRows?.length, "The library did not load");
    const tabs = window.Zotero_Tabs;
    const libraryID = Zotero.Libraries.userLibraryID;
    // Reproduce the blank-tab failure when the host document's event never
    // reaches the editor's original window listener.
    const blockHostEvent = event => {
      if (event.target?.documentURI === editorAssets?.url) event.stopImmediatePropagation();
    };
    window.addEventListener("DOMContentLoaded", blockHostEvent, true);

    const openThroughLibrary = async diagram => {
      // viewItems is the entry point for a double click in the library.
      await pane.viewItems([diagram]);
      const session = await until(() => sessions.get(diagram.id)?.ready && sessions.get(diagram.id),
        "Diagram editor did not load");
      const editor = session.content.querySelector("iframe").contentWindow.wrappedJSObject;
      assert(!session.browser.contentPrincipal.isSystemPrincipal, "Editor has system privileges");
      if (!session.issue) assert(session.toolbar.hidden, "A routine save status row is taking up space");
      return { session, editor, ui: editor.zoteroDiagramTestUI };
    };
    const closeTab = async session => {
      tabs.close(session.id);
      await session.closing;
    };
    const addVertex = (ui, label) => {
      const graph = ui.editor.graph;
      return graph.insertVertex(graph.getDefaultParent(), null, label, 20, 20, 160, 40);
    };
    const values = ui => {
      const graph = ui.editor.graph;
      return Array.from(graph.getChildVertices(graph.getDefaultParent()), cell => cell.value);
    };

    if (await IOUtils.exists(phasePath)) {
      const { diagramID, childID } = await IOUtils.readJSON(phasePath);
      assert(DrawioSettings.get().color === "light" && DrawioSettings.get().defaultFont === "Avenir Next",
        "Editor preferences did not survive restarting Zotero");
      const child = await Zotero.Items.getAsync(childID);
      const { session } = await openThroughLibrary(child);
      const contents = await session.file.read();
      session.failLoading();
      assert(!session.retryOpen.hidden, "A failed start did not offer a retry");
      session.retryOpen.doCommand();
      await until(() => session.ready, "Retry did not start a fresh editor");
      assert((await session.file.read()).hash === contents.hash, "Retry rewrote the attachment");
      const ui = session.content.querySelector("iframe").contentWindow.wrappedJSObject.zoteroDiagramTestUI;
      assert(ui.editor.graph.defaultVertexStyle.fontFamily === "Avenir Next" && ui.editor.graph.pageVisible,
        "Persisted font failed to apply or opening the diagram changed its saved page view");
      assert(ui.pages.length === 2, "Second page was lost on app restart");
      ui.selectPage(ui.pages[1]);
      assert(values(ui).includes("saved on close"), "Immediate close lost the second-page edit");
      await closeTab(session);
      const readOnlyFile = await Zotero.Items.getAsync(diagramID);
      const recovered = await openThroughLibrary(readOnlyFile);
      assert(values(recovered.ui).includes("recover on restart"), "On-disk recovery was not loaded");
      await recovered.session.flush();
      assert(!recovered.session.pending, "Could not retry the recovered save");
      await closeTab(recovered.session);

      const pdf = await Zotero.Attachments.importFromFile({
        file: PathUtils.join(Zotero.Profile.dir, "native-reader-test.pdf"),
        title: "Native reader test",
        libraryID,
        contentType: "application/pdf",
      });
      await pane.viewItems([pdf]);
      const pdfTab = tabs.getTabIDByItemID(pdf.id);
      assert(pdfTab && Zotero.Reader.getByTabID(pdfTab), "The native PDF reader did not open");
      tabs.close(pdfTab);

      const pluginOpen = Zotero.FileHandlers.open;
      const diagramIcon = child.getItemTypeIconName();
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      await (await AddonManager.getAddonByID(pluginID)).disable();
      await until(() => Zotero.FileHandlers.open !== pluginOpen, "Disabling did not restore Zotero's file handler");
      assert(!window.document.getElementById(NEW_DIAGRAM_BUTTON) && child.getItemTypeIconName() !== diagramIcon,
        "Disabling did not remove the toolbar button and custom icon");
      assert(await IOUtils.exists(await child.getFilePathAsync()), "Disabling removed the original file");
      assert(!attempts.length, "Editor requested external resources: " + attempts.join(", "));
      await log("PASS persistent preferences, restart, retry, recovery, native PDF reader, and disable");
      window.removeEventListener("DOMContentLoaded", blockHostEvent, true);
      return;
    }

    const rootCollection = new Zotero.Collection();
    rootCollection.name = "Research parent";
    await rootCollection.saveTx();
    const collection = new Zotero.Collection();
    collection.name = "Smoke collection";
    collection.parentID = rootCollection.id;
    await collection.saveTx();
    await pane.collectionsView.selectCollection(collection.id);
    const article = new Zotero.Item("journalArticle");
    article.setField("title", "Smoke article");
    article.addToCollection(collection.id);
    await article.saveTx();

    const view = pane.itemsView;
    const drop = async (type, data, row) => {
      Zotero.DragDrop.currentOrientation = 0;
      Zotero.DragDrop.currentDropEffect = "copy";
      await view.onDrop({ dataTransfer: {
        types: [type],
        getData: () => data,
        mozItemCount: 1,
        mozGetDataAt: () => data,
      } }, row);
    };
    const tools = window.document.getElementById("menu_ToolsPopup");
    tools.dispatchEvent(new window.Event("popupshowing", { bubbles: true }));
    const newStandalone = Array.from(tools.querySelectorAll("menuitem"))
      .find(item => item.getAttribute("label") === strings.newStandalone);
    assert(newStandalone && !newStandalone.hidden, "Tools menu is missing the new diagram command");
    const toolbarButton = window.document.getElementById(NEW_DIAGRAM_BUTTON);
    assert(toolbarButton?.parentNode.id === "zotero-items-toolbar" &&
      toolbarButton.getAttribute("image").endsWith("/icons/new-diagram.png"),
    "The Zotero toolbar is missing the new diagram button or its icon");

    await until(() => Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === DrawioSettings.paneID),
      "The draw.io settings pane was not registered");
    const preferences = Zotero.Utilities.Internal.openPreferences(DrawioSettings.paneID);
    const field = key => preferences.document.getElementById("drawio-setting-" + key);
    await until(() => field("noteMode"), "The settings controls did not load");
    const setPreference = (key, value) => {
      const input = field(key);
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
      input.dispatchEvent(new preferences.Event(input.type === "text" ? "input" : "change"));
    };
    setPreference("color", "dark");
    setPreference("layout", "atlas");
    setPreference("language", "en");
    setPreference("palette", "shapes");
    setPreference("defaultFont", "Georgia");
    setPreference("customFonts", "Arial, PingFang SC");
    setPreference("grid", false);
    setPreference("pageView", false);
    setPreference("noteMode", "linked");
    assert(DrawioSettings.get().defaultFont === "Georgia" && !DrawioSettings.get().pageView,
      "The settings controls did not save their changes");

    const previousPrompt = promptForDiagramTitle;
    promptForDiagramTitle = () => "Created through the toolbar";
    let standalone;
    try {
      toolbarButton.doCommand();
      standalone = await until(() => [...sessions.values()].find(session => session.ready),
        "The toolbar command did not create an editable diagram");
    } finally {
      promptForDiagramTitle = previousPrompt;
    }
    const diagram = standalone.file.item;
    assert(diagram.isTopLevelItem() && diagram.getCollections().includes(collection.id),
      "The toolbar command created a diagram in the wrong place");
    const configuredEditor = standalone.content.querySelector("iframe").contentWindow.wrappedJSObject;
    const configuredGraph = configuredEditor.zoteroDiagramTestUI.editor.graph;
    assert(configuredEditor.Editor.currentTheme === "atlas" &&
      configuredEditor.document.body.classList.contains("geDarkMode"),
    "The selected layout or dark mode did not apply");
    assert(configuredEditor.document.querySelector("#da-shapes-panel-tab").textContent === "Shapes" &&
      !configuredEditor.document.querySelector("#da-shapes-panel").hidden &&
      configuredEditor.document.querySelector("#da-zotero-panel select").value === "linked",
    "The language, initial sidebar, or note mode did not apply");
    assert(Array.from(configuredEditor.Menus.prototype.defaultFonts).includes("PingFang SC") &&
      configuredGraph.defaultVertexStyle.fontFamily === "Georgia",
    "The custom font menu or new-shape font did not apply");
    assert(!configuredGraph.isGridEnabled() && !configuredGraph.pageVisible, "New diagram ignored its canvas defaults");
    assert(diagram.getItemTypeIconName() === DIAGRAM_ICON_TYPE &&
      tabs._getTab(standalone.id).tab.data.icon === DIAGRAM_ICON_TYPE,
    "The diagram item or tab did not use the diagram icon");
    await closeTab(standalone);
    await pane.selectItem(diagram.id);
    const itemIcon = await until(() => window.document.querySelector(
      '.item-icon[data-item-type="' + DIAGRAM_ICON_TYPE + '"]'), "The diagram item icon was not rendered");
    assert(window.getComputedStyle(itemIcon).backgroundImage.includes("/icons/diagram.png"),
      "The diagram icon stylesheet did not apply");
    const previewIcon = await until(() => window.document.querySelector("attachment-preview[data-drawio-diagram] .icon"),
      "The attachment pane did not render the diagram placeholder");
    assert(window.getComputedStyle(previewIcon).backgroundImage.includes("/icons/diagram.png"),
      "The attachment pane showed the generic file icon");
    preferences.document.querySelector(".drawio-pref-footer button").click();
    assert(DrawioSettings.get().color === "system" && !DrawioSettings.get().defaultFont &&
      field("layout").value === "kennedy", "Restore defaults did not reset saved settings and controls");
    preferences.close();
    await log("PASS toolbar creation, item/tab/preview icons, settings pane, editor appearance, and restore defaults");

    await pane.selectItem(article.id);
    await pane.buildItemContextMenu();
    const itemsMenu = window.document.getElementById("zotero-itemmenu");
    itemsMenu.dispatchEvent(new window.Event("popupshowing", { bubbles: true }));
    const newChild = Array.from(itemsMenu.querySelectorAll("menuitem"))
      .find(item => item.getAttribute("label") === strings.newChild);
    assert(newChild && !newChild.hidden, "Article menu is missing the new attachment command");
    promptForDiagramTitle = () => "Created under article";
    let childSession;
    try {
      newChild.doCommand();
      childSession = await until(() => [...sessions.values()].find(session => session.ready),
        "The context menu did not create an editable diagram");
    } finally {
      promptForDiagramTitle = previousPrompt;
    }
    const child = childSession.file.item;
    assert(child.parentID === article.id, "New child diagram was attached to the wrong item");
    await closeTab(childSession);

    const note = new Zotero.Item("note");
    note.parentID = article.id;
    note.setNote("<p>Related note for smoke test</p><p>Second paragraph has the actual note body.</p>");
    await note.saveTx();
    const secondNote = new Zotero.Item("note");
    secondNote.parentID = article.id;
    secondNote.setNote("<p>Another child paragraph</p>");
    await secondNote.saveTx();
    const standaloneNote = new Zotero.Item("note");
    standaloneNote.addToCollection(collection.id);
    standaloneNote.setNote("<p>Standalone note in this collection</p>");
    await standaloneNote.saveTx();
    const replacement = new Zotero.Item("journalArticle");
    replacement.setField("title", "Replacement paper");
    replacement.addToCollection(collection.id);
    await replacement.saveTx();
    const sourcePDF = await Zotero.Attachments.importFromFile({
      file: PathUtils.join(Zotero.Profile.dir, "native-reader-test.pdf"),
      title: "Paper source PDF",
      parentItemID: article.id,
      contentType: "application/pdf",
    });

    const libraryTab = await openThroughLibrary(diagram);
    const editorDoc = libraryTab.editor.document;
    const graph = libraryTab.ui.editor.graph;
    const panel = editorDoc.querySelector("#da-zotero-panel");
    const shapes = editorDoc.querySelector("#da-shapes-panel");
    const shapesTab = editorDoc.querySelector("#da-shapes-panel-tab");
    assert(panel && !panel.hidden && shapes.hidden, "The Zotero tab is not initially visible");
    shapesTab.click();
    assert(!shapes.hidden && panel.hidden, "The Shapes tab did not switch panels");
    assert(shapes.getBoundingClientRect().top >= shapesTab.getBoundingClientRect().bottom,
      "The tab strip overlaps the shapes palette");
    editorDoc.querySelector("#da-zotero-panel-tab").click();
    const selected = await until(() => panel.querySelector(".da-folder-name[aria-current]"),
      "The collection tree did not load");
    assert(selected.textContent === collection.name, "The diagram's collection was not selected");
    assert(panel.querySelector('[data-toggle="' + rootCollection.id + '"]').getAttribute("aria-expanded") === "true",
      "The diagram's parent collection was not expanded");
    assert(panel.querySelector(".da-results .da-note")?.textContent.includes("Standalone note"),
      "Papers and standalone notes did not appear in the same list");
    assert(!panel.querySelector(".da-templates"), "Blank paper and note templates are still visible");

    const paperLink = "zotero://select/library/items/" + article.key;
    const noteLink = "zotero://select/library/items/" + note.key;
    const secondNoteLink = "zotero://select/library/items/" + secondNote.key;
    const replacementLink = "zotero://select/library/items/" + replacement.key;
    const cells = (g = graph, parent = g.getDefaultParent()) =>
      Array.from(g.getChildVertices(parent)).flatMap(cell => [cell, ...cells(g, cell)]);
    const byLink = (link, g = graph) => cells(g).find(cell => g.getLinkForCell(cell) === link);
    panel.querySelector("select").value = "linked";
    const paperResult = Array.from(panel.querySelectorAll(".da-results .da-paper"))
      .find(row => row.textContent.includes("Smoke article"));
    assert(paperResult, "The article is missing from the selected collection");
    const sourceRect = paperResult.getBoundingClientRect();
    const canvasRect = graph.container.getBoundingClientRect();
    const x = canvasRect.left + canvasRect.width * 0.3;
    const y = canvasRect.top + canvasRect.height * 0.35;
    const inputWindow = Cu.unwaiveXrays(libraryTab.editor);
    inputWindow.windowUtils.sendMouseEvent("mousedown", sourceRect.left + 5, sourceRect.top + 5, 0, 1, 0);
    inputWindow.windowUtils.sendMouseEvent("mousemove", x, y, 0, 0, 0);
    inputWindow.windowUtils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    const paper = await until(() => byLink(paperLink), "Dragging a paper did not insert it");
    const linked = byLink(noteLink);
    const other = byLink(secondNoteLink);
    const group = paper.getParent();
    assert(group !== graph.getDefaultParent() && graph.getSelectionCell() === group &&
      linked?.getParent() === group && other?.getParent() === group,
    "Import did not select a single group containing the paper and both notes");
    const stack = Array.from(graph.getChildVertices(group));
    assert(stack[0] === paper && stack.slice(1).every((cell, index) =>
      cell.geometry.x === paper.geometry.x &&
      cell.geometry.y >= stack[index].geometry.y + stack[index].geometry.height),
    "The paper and notes are not stacked vertically");
    assert(linked.value.getAttribute("label").includes("Second paragraph"), "The child note lost its content");
    const inspector = await until(() => editorDoc.querySelector(".da-inspector"), "Selecting the group hid the paper editor");
    assert(inspector === libraryTab.ui.format.container.lastElementChild &&
      inspector.querySelector("textarea").value.includes("Smoke article"), "The paper editor is not at the bottom");
    const oldGroupX = group.geometry.x;
    const oldNoteY = linked.geometry.y;
    graph.moveCells(graph.getSelectionCells(), 30, 20);
    assert(group.geometry.x === oldGroupX + 30 && linked.geometry.y === oldNoteY,
      "Moving the group did not keep its members together");
    const clickCell = cell => {
      const state = graph.view.getState(cell);
      const rect = graph.container.getBoundingClientRect();
      const x = rect.left + state.getCenterX() - graph.container.scrollLeft;
      const y = rect.top + state.getCenterY() - graph.container.scrollTop;
      inputWindow.windowUtils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
      inputWindow.windowUtils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    };
    clickCell(paper);
    assert(graph.getSelectionCell() === paper, "A paper could not be selected inside its selected group");
    assert(!graph.isCellEditable(linked), "The linked note is editable");
    const linkedText = linked.value.getAttribute("label");
    graph.cellLabelChanged(linked, "modified");
    assert(linked.value.getAttribute("label") === linkedText, "A linked note accepted a text edit");
    graph.setLinkForCell(linked, "");
    assert(graph.getLinkForCell(linked) === noteLink, "The original link of a read-only note could be removed");
    graph.setSelectionCell(linked);
    await until(() => editorDoc.querySelector(".da-inspector textarea")?.readOnly,
      "The linked note is editable in the right sidebar");
    graph.dblClick(null, linked);
    await until(() => tabs.selectedID === "zotero-pane" && pane.getSelectedItems()[0]?.id === note.id,
      "Double-click did not locate the original note");
    tabs.select(libraryTab.session.id);

    graph.setSelectionCell(paper);
    graph.dblClick(null, paper);
    const readerTab = await until(() => tabs.getTabIDByItemID(sourcePDF.id),
      "Double-click did not open the paper's PDF");
    tabs.close(readerTab);
    tabs.select(libraryTab.session.id);
    assert(!graph.selectionCellsHandler.getHandler(paper)?.linkHint,
      "The floating link bar still appears under the paper");

    panel.querySelector("select").value = "copy";
    const search = panel.querySelector("input");
    search.value = "Related note";
    search.dispatchEvent(new libraryTab.editor.Event("input", { bubbles: true }));
    const noteResult = await until(() => Array.from(panel.querySelectorAll(".da-results .da-note"))
      .find(row => row.textContent.includes("Related note")),
      "Unified search could not find the child note");
    noteResult.click();
    const detached = await until(() => cells().find(cell =>
      cell.value?.getAttribute?.("zoteroKind") === "note" && !graph.getLinkForCell(cell)),
    "The copied note was not inserted without a source link");
    assert(detached.value.getAttribute("label").includes("Second paragraph") &&
      !detached.value.outerHTML.includes(note.key) && graph.isCellEditable(detached) &&
      detached.getParent() === graph.getDefaultParent(),
    "The copy lacks content, stores its source, or cannot be edited");
    graph.setSelectionCell(detached);
    const rightText = await until(() => {
      const input = editorDoc.querySelector(".da-inspector textarea");
      return input?.value.includes("Second paragraph") && !input.readOnly && input;
    }, "The right sidebar did not show editable note text");
    rightText.value = "A new draft\nIts second line";
    rightText.dispatchEvent(new libraryTab.editor.Event("change", { bubbles: true }));
    assert(detached.value.getAttribute("label").includes("Its second line") &&
      note.getNote().includes("Second paragraph"), "Editing the copy did not remain local to the diagram");

    const geometry = paper.geometry;
    const edge = graph.insertEdge(graph.getDefaultParent(), null, "", paper, detached);
    graph.setSelectionCell(paper);
    const replace = await until(() => editorDoc.querySelector(".da-replace"), "Replacement is missing from the right sidebar");
    replace.click();
    const rightSearch = editorDoc.querySelector(".da-replace-picker input");
    rightSearch.value = "Replacement";
    rightSearch.dispatchEvent(new libraryTab.editor.Event("input", { bubbles: true }));
    const candidate = await until(() => editorDoc.querySelector(".da-matches .da-paper"), "Replacement search did not return a paper");
    candidate.click();
    assert(graph.getLinkForCell(paper) === replacementLink && paper.geometry === geometry && edge.source === paper &&
      byLink(noteLink) === linked, "Replacement changed the node geometry, connection, or existing note");
    graph.setSelectionCell(detached);
    const pendingText = await until(() => {
      const input = editorDoc.querySelector(".da-inspector textarea");
      return input?.value.includes("A new draft") && input;
    }, "The copied note could not be selected again");
    pendingText.value += "\nSaved without leaving the text field";
    await closeTab(libraryTab.session);
    const libraryReopen = await openThroughLibrary(diagram);
    const reopenedGraph = libraryReopen.ui.editor.graph;
    const reopenedPaper = byLink(replacementLink, reopenedGraph);
    assert(reopenedPaper && byLink(noteLink, reopenedGraph)?.getParent() === reopenedPaper.getParent() &&
      byLink(secondNoteLink, reopenedGraph)?.getParent() === reopenedPaper.getParent() &&
      cells(reopenedGraph).some(cell => cell.value?.getAttribute?.("label")?.includes("Saved without leaving the text field")),
      "The group, replacement, or note edits did not survive reopening");
    await closeTab(libraryReopen.session);
    await log("PASS vertical paper group, group move, bottom editor, both note modes, double-click, and save/reopen");

    const source = PathUtils.join(Zotero.Profile.dir, "existing.drawio");
    await IOUtils.writeUTF8(source, BLANK_DIAGRAM);
    await drop("application/x-moz-file", Zotero.File.pathToFile(source), view.getRowIndexByID(article.id));
    const imported = Zotero.Items.get(article.getAttachments()).find(item => item.attachmentFilename === "existing.drawio");
    assert(imported?.isStoredFileAttachment(), "Native drag import did not produce a stored child");
    const importedPath = imported.getFilePath();
    await drop("zotero/item", String(imported.id), -1);
    assert(imported.isTopLevelItem() && imported.getCollections().includes(collection.id),
      "Native drag did not make the diagram independent");
    await drop("zotero/item", String(imported.id), view.getRowIndexByID(article.id));
    assert(imported.parentID === article.id && imported.getFilePath() === importedPath,
      "Moving the diagram changed its attachment identity or path");
    await drop("application/x-moz-file", Zotero.File.pathToFile(source), -1);
    assert((await Zotero.Items.getAll(libraryID, true)).some(item =>
      isDiagram(item) && item.attachmentFilename === "existing.drawio" && item.isTopLevelItem()),
    "Native drag import did not produce a standalone attachment");
    await log("PASS creation, native drag import, attach, and detach");

    const firstOpen = await openThroughLibrary(child);
    await pane.viewItems([child]);
    assert(sessions.get(child.id) === firstOpen.session, "Double opening created a second editing session");
    addVertex(firstOpen.ui, "temporary vertex");
    await until(() => firstOpen.session.savedXML, "Temporary drawing was not autosaved");
    firstOpen.ui.editor.undoManager.undo();
    await closeTab(firstOpen.session);

    const { session, ui } = await openThroughLibrary(child);
    assert(!values(ui).includes("temporary vertex"), "Undo back to the original drawing was lost on close");
    addVertex(ui, "autosaved vertex");
    await until(() => session.savedXML, "Drawing was not autosaved");
    const second = ui.insertPage();
    ui.selectPage(second);
    addVertex(ui, "saved on close");
    await closeTab(session);
    const reopen = await openThroughLibrary(child);
    assert(reopen.ui.pages.length === 2, "Multi-page edit was not saved");
    assert(values(reopen.ui).includes("autosaved vertex"), "First-page vertex was not saved");
    reopen.ui.selectPage(reopen.ui.pages[1]);
    assert(values(reopen.ui).includes("saved on close"), "Immediate tab close lost an edit");
    await closeTab(reopen.session);
    await log("PASS double click, reuse, autosave, and immediate close");

    const diskEdit = BLANK_DIAGRAM.replace('name="Page-1"', 'name="External change"');
    const conflicted = await openThroughLibrary(diagram);
    await IOUtils.writeUTF8(conflicted.session.file.path, diskEdit);
    const conflictGraph = conflicted.ui.editor.graph;
    const vertex = addVertex(conflicted.ui, "keep my edit");
    conflictGraph.setSelectionCell(vertex);
    conflictGraph.setCellStyles("shape", "image");
    conflictGraph.setCellStyles("image", "https://example.invalid/diagram-test-image.png");
    await until(() => conflicted.session.issue === "conflict", "External edit was not detected");
    assert(!conflicted.session.toolbar.hidden, "Save conflict status was hidden");
    assert(await IOUtils.readUTF8(conflicted.session.file.path) === diskEdit, "Saving overwrote an external edit");
    const copy = await conflicted.session.saveCopy();
    assert(copy?.isTopLevelItem() && copy.getCollections().includes(collection.id), "Edit copy lost its placement");
    const copyTab = await openThroughLibrary(copy);
    assert(values(copyTab.ui).includes("keep my edit"), "Edit copy lost its contents");
    await closeTab(copyTab.session);
    const failed = await openThroughLibrary(diagram);
    const path = failed.session.file.path;
    const directory = PathUtils.parent(path);
    await IOUtils.setPermissions(directory, 0o555);
    try {
      addVertex(failed.ui, "recover on restart");
      await until(() => failed.session.issue === "failed", "The save failure was not reported");
      assert(!failed.session.toolbar.hidden, "Save failure status was hidden");
      await closeTab(failed.session);
      assert(await IOUtils.readUTF8(path) === diskEdit, "Failed write modified the original");
      assert((await failed.session.file.getRecovery())?.xml, "Failed write did not leave a recovery file");
    } finally {
      await IOUtils.setPermissions(directory, 0o755);
    }
    assert(!attempts.length, "Editor requested external resources: " + attempts.join(", "));
    DrawioSettings.set("color", "light");
    DrawioSettings.set("defaultFont", "Avenir Next");
    Services.prefs.savePrefFile(null);
    await IOUtils.writeJSON(phasePath, { diagramID: diagram.id, childID: child.id });
    await log("PASS conflict, save as copy, failed write, and external request blocking");
  } catch (error) {
    await log("FAIL " + error + "\n" + error.stack);
  } finally {
    Services.obs.removeObserver(networkObserver, "http-on-modify-request");
    await log("DONE");
  }
}
