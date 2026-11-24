// Runs inside the bundled editor and exchanges item summaries with the host.
(() => {
  const origin = window.location.origin;
  const zh = new URLSearchParams(window.location.search).get("lang") === "zh";
  const text = zh ? {
    shapes: "图形", paper: "论文块", note: "笔记块", library: "文献库",
    search: "搜索文献或笔记", searchPaper: "按标题、作者或年份搜索论文",
    searchNote: "按正文搜索笔记", loading: "正在加载…",
    empty: "没有可导入的条目", failed: "无法读取条目，请重试", more: "加载更多",
    refine: "缩小搜索范围以查看其他结果", untitled: "无标题", expand: "展开或折叠",
    open: "定位到 Zotero", openPaper: "打开原论文", changePaper: "换一篇论文",
    changeNote: "替换笔记", cancel: "取消", content: "显示内容", noteMode: "导入笔记选项",
    noteModeHint: "导入论文时选择是否附带子笔记。直接导入笔记时，“不导入”按可编辑副本处理。",
    none: "不导入", copy: "仅导入内容（可编辑）", linked: "链接原笔记（只读）", readOnly: "链接笔记 · 只读",
  } : {
    shapes: "Shapes", paper: "Paper block", note: "Note block", library: "Library",
    search: "Search papers or notes", searchPaper: "Search papers by title, author, or year",
    searchNote: "Search note text", loading: "Loading…",
    empty: "No items to import", failed: "Could not read the item. Try again.", more: "Load more",
    refine: "Refine your search for more results", untitled: "Untitled", expand: "Expand or collapse",
    open: "Show in Zotero", openPaper: "Open original paper", changePaper: "Replace paper",
    changeNote: "Replace note", cancel: "Cancel", content: "Display text", noteMode: "Import notes",
    noteModeHint: "Controls which child notes come with a paper. Importing a note directly still creates an editable copy in Do not import mode.",
    none: "Do not import", copy: "Copy text (editable)", linked: "Link to original (read-only)", readOnly: "Linked note · read-only",
  };
  const referenceLink = /^zotero:\/\/select\/(?:library|groups\/\d+)\/items\/[A-Z0-9]{8}$/;
  const styles = {
    paper: "rounded=1;arcSize=9;fillColor=#eef4ff;strokeColor=#7092c3;fontColor=#192d4d;",
    note: "shape=note;size=14;fillColor=#fff5d9;strokeColor=#c6a04f;fontColor=#413117;",
  };
  const requests = new Map();
  let requestID = 0;

  function send(message) {
    window.parent.postMessage(JSON.stringify(message), origin);
  }

  function request(operation, data) {
    const id = ++requestID;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error("Library request timed out"));
      }, 15000);
      requests.set(id, message => {
        clearTimeout(timer);
        if (message.error) reject(new Error("Library request failed"));
        else resolve(message);
      });
      send({ event: "library-request", operation, id, ...data });
    });
  }

  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== origin || typeof event.data !== "string") return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message?.action !== "library-results") return;
    const finish = requests.get(message.id);
    requests.delete(message.id);
    finish?.(message);
  });

  function element(tag, className, label = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = label;
    if (tag === "button") node.type = "button";
    return node;
  }

  function searchInput(placeholder) {
    const input = element("input", "da-input");
    input.type = "search";
    input.maxLength = 200;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    return input;
  }

  function kindOf(cell) {
    return cell?.value?.getAttribute?.("zoteroKind");
  }

  function linkedNote(graph, cell) {
    return kindOf(cell) === "note" && (cell.value.getAttribute("zoteroNoteMode") === "linked" ||
      referenceLink.test(graph.getLinkForCell(cell)));
  }

  function openReference(graph, cell, openPaper) {
    const link = graph.getLinkForCell(cell);
    if (referenceLink.test(link)) send({ event: "library-open", link, openPaper });
  }

  function encodeLines(content) {
    return mxUtils.htmlEntities(content).replace(/\r?\n/g, "<br>");
  }

  function withPublisher(label, publisher) {
    if (!publisher) return label;
    return label + '<div class="da-publisher-label" style="margin-top:4px">' +
      '<span style="font-size:10px;padding:1px 4px;border:1px solid #7092c3;border-radius:3px">' +
      encodeLines(publisher) + "</span></div>";
  }

  function itemLabel(item) {
    if (item.kind === "note" && item.content != null) return encodeLines(item.content);
    const label = encodeLines(item.title || text.untitled) +
      (item.subtitle ? '<br><span style="font-size: 11px">' + encodeLines(item.subtitle) + "</span>" : "");
    return withPublisher(label, item.publisher);
  }

  function titleOfLabel(label) {
    const template = element("template", "");
    template.innerHTML = label;
    template.content.querySelector(".da-publisher-label")?.remove();
    for (const line of template.content.querySelectorAll("br")) line.replaceWith("\n");
    for (const block of template.content.querySelectorAll("p, div")) block.after("\n");
    return template.content.textContent;
  }

  function makeCell(item, noteMode, x = 0, y = 0) {
    const value = mxUtils.createXmlDocument().createElement("object");
    value.setAttribute("zoteroKind", item.kind);
    value.setAttribute("label", itemLabel(item));
    const note = item.kind === "note";
    const locked = note && noteMode === "linked" && referenceLink.test(item.link);
    if ((!note || locked) && referenceLink.test(item.link)) value.setAttribute("link", item.link);
    if (locked) value.setAttribute("zoteroNoteMode", "linked");
    if (item.publisher) value.setAttribute("zoteroPublisher", item.publisher);
    const height = note ? Math.max(82, Math.min(380,
      26 + 18 * (item.content || "").split("\n").reduce((lines, line) =>
        lines + Math.max(1, Math.ceil(line.length / 30)), 0))) : item.publisher ? 118 : 98;
    const font = Editor.config?.zoteroDefaultFont;
    const style = styles[item.kind] + "whiteSpace=wrap;html=1;overflow=hidden;align=left;" +
      "verticalAlign=top;spacing=10;fontSize=13;" + (locked ? "editable=0;" : "") +
      (font ? "fontFamily=" + font + ";" : "");
    const cell = new mxCell(value, new mxGeometry(x, y, 250, height), style);
    cell.vertex = true;
    return cell;
  }

  function makeImportCell(graph, { item, notes }, noteMode) {
    const paper = makeCell(item, noteMode);
    if (!notes.length) return paper;

    const value = mxUtils.createXmlDocument().createElement("object");
    value.setAttribute("zoteroKind", "paperGroup");
    const group = graph.createGroupCell();
    group.setValue(value);
    group.setStyle("group;editable=0;");
    group.insert(paper);

    let bottom = paper.geometry.height;
    for (const note of notes) {
      const cell = makeCell(note, noteMode, 0, bottom + 12);
      group.insert(cell);
      bottom = cell.geometry.y + cell.geometry.height;
    }
    group.setGeometry(new mxGeometry(0, 0, paper.geometry.width, bottom));
    return group;
  }

  function itemRow(item) {
    const row = element("button", "da-block da-" + item.kind);
    row.title = item.title || text.untitled;
    row.append(element("span", "da-block-title", row.title));
    if (item.subtitle) row.append(element("span", "da-block-detail", item.subtitle));
    if (item.publisher) row.append(element("span", "da-block-publisher", item.publisher));
    return row;
  }

  function importRow(sidebar, item, mode, status) {
    const row = itemRow(item);
    const ui = sidebar.editorUi;
    const graph = ui.editor.graph;
    const preview = makeCell(item);
    const width = preview.geometry.width;
    const height = preview.geometry.height;
    const bounds = new mxRectangle(0, 0, width, height);

    const insert = async (event, x, y) => {
      if (!graph.isEnabled() || ui.isLocked() || graph.isCellLocked(graph.getDefaultParent())) return;
      const page = ui.currentPage;
      const noteMode = mode.value;
      graph.stopEditing(false);
      try {
        const data = await request("import", { key: item.key, includeNotes: noteMode !== "none" });
        if (page !== ui.currentPage || !graph.isEnabled() || ui.isLocked()) return;
        const cell = makeImportCell(graph, data, noteMode);
        const drop = sidebar.createDropHandler([cell], false, true,
          new mxRectangle(0, 0, cell.geometry.width, cell.geometry.height));
        drop(graph, event, null, x, y, true);
      } catch (error) {
        console.error(error);
        status.textContent = text.failed;
      }
    };

    sidebar.createDragSource(row, (_graph, event, _target, x, y) => {
      void insert(event, x, y);
    }, sidebar.createDragPreview(width, height), [preview], bounds);
    row.addEventListener("click", event => {
      const point = graph.getCenterInsertPoint(bounds);
      void insert(event, point.x, point.y);
    });
    return row;
  }

  function mountLibrary(sidebar) {
    const container = sidebar.container;
    container.classList.add("da-sidebar");
    sidebar.wrapper.id = "da-shapes-panel";
    const tabs = element("nav", "da-tabs");
    const shapes = element("button", "", text.shapes);
    const zotero = element("button", "", "Zotero");
    const panel = element("section", "da-panel");
    tabs.title = panel.title = "";
    panel.id = "da-zotero-panel";
    tabs.setAttribute("role", "tablist");
    for (const [tab, target] of [[shapes, sidebar.wrapper], [zotero, panel]]) {
      tab.id = target.id + "-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", target.id);
      target.setAttribute("role", "tabpanel");
      target.setAttribute("aria-labelledby", tab.id);
      tabs.append(tab);
    }
    const active = useZotero => {
      container.classList.toggle("da-show-zotero", useZotero);
      sidebar.wrapper.hidden = useZotero;
      panel.hidden = !useZotero;
      shapes.setAttribute("aria-selected", String(!useZotero));
      zotero.setAttribute("aria-selected", String(useZotero));
      shapes.tabIndex = useZotero ? -1 : 0;
      zotero.tabIndex = useZotero ? 0 : -1;
      if (useZotero) sidebar.hideTooltip();
    };
    shapes.addEventListener("click", () => active(false));
    zotero.addEventListener("click", () => active(true));
    tabs.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const useZotero = event.target === shapes;
      active(useZotero);
      (useZotero ? zotero : shapes).focus();
    });

    const search = searchInput(text.search);
    const folders = element("div", "da-folders");
    const results = element("div", "da-results");
    const status = element("p", "da-status", text.loading);
    status.setAttribute("role", "status");
    const more = element("button", "da-action", text.more);
    more.hidden = true;
    const modeLabel = element("label", "da-mode");
    modeLabel.title = text.noteModeHint;
    const modeCaption = element("span", "", text.noteMode);
    const mode = element("select", "da-input");
    for (const choice of ["none", "copy", "linked"]) mode.append(new Option(text[choice], choice));
    mode.value = Editor.config?.zoteroNoteMode ?? "copy";
    modeLabel.append(modeCaption, mode);
    const scroll = element("div", "da-library-scroll");
    scroll.append(search, folders, results, status, more);
    panel.append(scroll, modeLabel);
    container.append(tabs, panel);
    active(Editor.config?.zoteroPalette !== "shapes");

    let collectionID = null;
    let libraryName = text.library;
    let collections = [];
    let offset = 0;
    let generation = 0;
    let timer;
    const expanded = new Set([0]);

    const renderFolders = () => {
      const childrenByParent = new Map();
      for (const collection of collections) {
        if (!childrenByParent.has(collection.parentID)) childrenByParent.set(collection.parentID, []);
        childrenByParent.get(collection.parentID).push(collection);
      }
      const renderFolder = (folder, depth) => {
        const row = element("div", "da-folder");
        row.style.paddingInlineStart = Math.min(depth, 7) * 12 + "px";
        const children = childrenByParent.get(folder.id) ?? [];
        const toggle = element("button", "da-folder-toggle", expanded.has(folder.id) ? "▾" : "▸");
        toggle.setAttribute("aria-label", text.expand + " " + folder.name);
        toggle.setAttribute("aria-expanded", String(expanded.has(folder.id)));
        toggle.disabled = !children.length;
        toggle.addEventListener("click", () => {
          if (expanded.has(folder.id)) expanded.delete(folder.id);
          else expanded.add(folder.id);
          renderFolders();
          folders.querySelector('[data-toggle="' + folder.id + '"]')?.focus();
        });
        toggle.dataset.toggle = folder.id;
        const name = element("button", "da-folder-name", folder.name);
        name.title = folder.name;
        name.dataset.collection = folder.id;
        if (folder.id === collectionID) name.setAttribute("aria-current", "true");
        name.addEventListener("click", () => {
          collectionID = folder.id;
          expanded.add(folder.id);
          search.value = "";
          renderFolders();
          folders.querySelector('[data-collection="' + folder.id + '"]')?.focus();
          void load();
        });
        row.append(toggle, name);
        folders.append(row);
        if (expanded.has(folder.id)) {
          for (const child of children) renderFolder(child, depth + 1);
        }
      };
      folders.replaceChildren();
      renderFolder({ id: 0, name: libraryName }, 0);
    };

    const load = async (append = false) => {
      const version = ++generation;
      const query = search.value.trim();
      if (!append) {
        offset = 0;
        results.replaceChildren();
      }
      more.hidden = true;
      folders.hidden = !!query;
      status.textContent = text.loading;
      try {
        const data = query
          ? await request("search", { query })
          : await request("browse", { collectionID, offset });
        if (version !== generation) return;
        if (data.collections) {
          libraryName = data.libraryName;
          collections = data.collections;
          collectionID = data.collectionID;
          for (let id = collectionID; id; id = collections.find(col => col.id === id)?.parentID) expanded.add(id);
          renderFolders();
          folders.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
        }
        for (const item of data.items) results.append(importRow(sidebar, item, mode, status));
        offset += data.items.length;
        more.hidden = !!query || !data.more;
        status.textContent = data.items.length ? (query && data.more ? text.refine : "") : text.empty;
      } catch {
        if (version === generation) status.textContent = text.failed;
      }
    };

    search.addEventListener("input", () => {
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 180);
    });
    more.addEventListener("click", () => void load(true));
    void load();
  }

  function chooseReplacement(kind, apply) {
    const dialog = element("dialog", "da-replace-picker");
    const title = element("h2", "", kind === "paper" ? text.changePaper : text.changeNote);
    dialog.setAttribute("aria-label", title.textContent);
    const search = searchInput(kind === "paper" ? text.searchPaper : text.searchNote);
    const matches = element("div", "da-matches");
    const status = element("p", "da-status");
    status.setAttribute("role", "status");
    const footer = element("footer", "");
    const cancel = element("button", "da-action", text.cancel);
    cancel.addEventListener("click", () => dialog.close());
    footer.append(cancel);
    dialog.append(title, search, matches, status, footer);

    let generation = 0;
    let timer;
    let applying = false;
    search.addEventListener("input", () => {
      const version = ++generation;
      clearTimeout(timer);
      matches.replaceChildren();
      const query = search.value.trim();
      status.textContent = query ? text.loading : "";
      if (!query) return;
      timer = setTimeout(async () => {
        try {
          const data = await request("search", { query, kind });
          if (version !== generation || !dialog.open) return;
          status.textContent = data.items.length ? (data.more ? text.refine : "") : text.empty;
          for (const item of data.items) {
            const candidate = itemRow(item);
            candidate.addEventListener("click", async () => {
              if (applying || !dialog.open) return;
              applying = true;
              const stillOpen = () => dialog.open && version === generation;
              try {
                if (await apply(item, stillOpen) && stillOpen()) dialog.close();
              } catch (error) {
                console.error(error);
                if (stillOpen()) status.textContent = text.failed;
              } finally {
                applying = false;
              }
            });
            matches.append(candidate);
          }
        } catch {
          if (version === generation && dialog.open) status.textContent = text.failed;
        }
      }, 180);
    });
    dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.addEventListener("close", () => {
      clearTimeout(timer);
      dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    search.focus();
    return dialog;
  }

  function mountInspector(ui) {
    const graph = ui.editor.graph;
    const format = ui.format;
    if (!format) return;
    let boundCell;
    let boundValue;
    let boundLocked;
    let section;
    let replacement;

    const selectedBlock = () => {
      const cell = graph.getSelectionCount() === 1 ? graph.getSelectionCell() : null;
      return kindOf(cell) === "paperGroup"
        ? graph.model.getChildren(cell)?.find(child => kindOf(child) === "paper")
        : cell;
    };

    const createInspector = (cell, locked) => {
      const kind = kindOf(cell);
      const panel = element("section", "da-inspector");
      const link = graph.getLinkForCell(cell);
      const linked = linkedNote(graph, cell);
      const readonly = linked || locked;
      panel.append(element("h3", "", linked ? text.readOnly : text[kind]));
      const canUpdate = () => graph.model.contains(cell) && graph.isEnabled() &&
        !ui.isLocked() && !graph.isCellLocked(cell);

      const contentLabel = element("label", "da-content", text.content);
      const content = element("textarea", "da-input");
      content.rows = 4;
      content.value = titleOfLabel(cell.value.getAttribute("label") || "");
      content.defaultValue = content.value;
      content.readOnly = readonly;
      content.addEventListener("change", () => {
        if (readonly || !canUpdate() || content.value === content.defaultValue) return;
        const value = cell.value.cloneNode(true);
        value.setAttribute("label", withPublisher(encodeLines(content.value), value.getAttribute("zoteroPublisher")));
        if (!value.isEqualNode(cell.value)) graph.model.setValue(cell, value);
        content.defaultValue = content.value;
      });
      contentLabel.append(content);
      panel.append(contentLabel);

      if (referenceLink.test(link)) {
        const open = element("button", "da-action da-open", kind === "paper" ? text.openPaper : text.open);
        open.addEventListener("click", () => openReference(graph, cell, kind === "paper"));
        panel.append(open);
      }

      if (!locked) {
        const change = element("button", "da-action da-replace", kind === "paper" ? text.changePaper : text.changeNote);
        change.addEventListener("click", () => {
          if (replacement?.open) return;
          replacement = chooseReplacement(kind, async (candidate, stillOpen) => {
            const item = kind === "note" ? (await request("import", { key: candidate.key })).item : candidate;
            if (!stillOpen() || !canUpdate() || selectedBlock() !== cell) return false;
            if (item.kind !== kind || !referenceLink.test(item.link)) throw new Error("Replacement is unavailable");
            const value = cell.value.cloneNode(true);
            value.setAttribute("label", itemLabel(item));
            if (kind === "paper" || linked) value.setAttribute("link", item.link);
            if (item.publisher) value.setAttribute("zoteroPublisher", item.publisher);
            else value.removeAttribute("zoteroPublisher");
            graph.model.setValue(cell, value);
            return true;
          });
        });
        panel.append(change);
      }
      return panel;
    };

    const refresh = format.immediateRefresh;
    format.immediateRefresh = function () {
      refresh.apply(this, arguments);
      const cell = selectedBlock();
      if (cell !== boundCell && replacement?.open) replacement.close();
      const kind = kindOf(cell);
      if (kind !== "paper" && kind !== "note") {
        section?.remove();
        boundCell = boundValue = section = null;
        return;
      }
      const locked = !graph.isEnabled() || ui.isLocked() || graph.isCellLocked(cell);
      if (cell !== boundCell || cell.value !== boundValue || locked !== boundLocked) {
        section?.remove();
        boundCell = cell;
        boundValue = cell.value;
        boundLocked = locked;
        section = createInspector(cell, locked);
      }
      if (!section.isConnected) this.container.append(section);
    };
    document.addEventListener("diagram-attachments:flush", () => {
      section?.querySelector("textarea")?.dispatchEvent(new Event("change"));
    }, true);
    format.refresh();
  }

  const initialize = EditorUi.prototype.initializeEmbedMode;
  EditorUi.prototype.initializeEmbedMode = function () {
    const graph = this.editor.graph;
    const editable = graph.isCellEditable;
    graph.isCellEditable = function (cell) {
      return !linkedNote(this, cell) && editable.call(this, cell);
    };
    const labelChanged = graph.cellLabelChanged;
    graph.cellLabelChanged = function (cell, ...args) {
      if (!linkedNote(this, cell)) return labelChanged.call(this, cell, ...args);
    };
    const setLink = graph.setLinkForCell;
    graph.setLinkForCell = function (cell, ...args) {
      if (!linkedNote(this, cell)) return setLink.call(this, cell, ...args);
    };
    const doubleClick = graph.dblClick;
    graph.dblClick = function (event, cell) {
      if ((kindOf(cell) === "paper" || linkedNote(this, cell)) && referenceLink.test(this.getLinkForCell(cell))) {
        openReference(this, cell, kindOf(cell) === "paper");
        if (event) mxEvent.consume(event);
        return;
      }
      return doubleClick.apply(this, arguments);
    };
    graph.openLink = link => {
      if (referenceLink.test(link)) send({ event: "library-open", link });
    };
    this.addListener("embedLoaded", () => {
      if (this.sidebar && !this.sidebar.container.classList.contains("da-sidebar")) {
        mountLibrary(this.sidebar);
        mountInspector(this);
      }
    });
    return initialize.apply(this, arguments);
  };

  const configure = Editor.configure;
  Editor.configure = function (config) {
    configure.apply(this, arguments);
    const font = config?.zoteroDefaultFont;
    if (font) {
      Graph.prototype.defaultVertexStyle.fontFamily = font;
      Graph.prototype.defaultEdgeStyle.fontFamily = font;
      Menus.prototype.defaultFont = font;
      Editor.defaultTextStyle = mxUtils.setStyle(Editor.defaultTextStyle, "fontFamily", font);
    }
  };

  const hint = mxVertexHandler.prototype.updateLinkHint;
  mxVertexHandler.prototype.updateLinkHint = function (link, links) {
    if (["paper", "note"].includes(kindOf(this.state?.cell))) return hint.call(this, null, null);
    return hint.call(this, link, links);
  };
})();
