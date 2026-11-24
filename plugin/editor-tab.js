"use strict";

const TAB_TYPE = "diagramAttachments";
const EVENT_PREFIX = "diagram-attachments:";
const STRINGS = {
  en: {
    newStandalone: "New standalone diagram…",
    newToolbar: "New draw.io diagram…",
    settingsMenu: "draw.io settings…",
    newChild: "New diagram attachment…",
    open: "Edit diagram in Zotero",
    name: "Diagram name",
    untitled: "Untitled Diagram",
    loading: "Opening diagram…",
    loadFailed: "The offline editor could not load this diagram.",
    retryOpen: "Retry opening",
    invalidFile: "This file is not a valid draw.io diagram.",
    readonly: "Read-only attachment",
    failed: "Could not save the diagram.",
    conflict: "The attachment changed on disk while you were editing.",
    recovered: "Recovered unsaved changes.",
    retry: "Retry save",
    keepCopy: "Save as a copy",
    reload: "Reload from disk",
    discard: "Discard recovered or unsaved changes and reload the attachment from disk?",
    copySuffix: " (edit copy)",
    recoveryFailed: "The diagram could not be saved or recovered. Reopen it before quitting Zotero to retry or save a copy.",
    chooseOne: "Select one collection or the root of your library before creating a diagram.",
    createFailed: "Could not create the diagram.",
    openFailed: "Could not open the diagram.",
    referenceMissing: "This Zotero item is no longer available.",
    preview: "Diagram preview",
    previewFailed: "Could not preview this diagram.",
    previewMissing: "Download the attachment to preview it.",
    previewBlank: "This page is empty.",
    previewPrevious: "Previous page",
    previewNext: "Next page",
  },
  zh: {
    newStandalone: "新建独立流程图…",
    newToolbar: "新建 draw.io 流程图…",
    settingsMenu: "draw.io 设置…",
    newChild: "新建流程图附件…",
    open: "在 Zotero 中编辑流程图",
    name: "流程图名称",
    untitled: "未命名流程图",
    loading: "正在打开流程图…",
    loadFailed: "离线编辑器未能加载该流程图。",
    retryOpen: "重试打开",
    invalidFile: "该文件不是有效的 draw.io 流程图。",
    readonly: "只读附件",
    failed: "无法保存流程图。",
    conflict: "编辑期间，磁盘上的附件已发生变化。",
    recovered: "已恢复未保存的更改。",
    retry: "重试保存",
    keepCopy: "另存编辑副本",
    reload: "重新载入",
    discard: "丢弃恢复内容或未保存的更改，并重新载入磁盘上的附件？",
    copySuffix: "（编辑副本）",
    recoveryFailed: "写入原文件和恢复文件均失败。请在退出 Zotero 前重开该图，重试保存或另存副本。",
    chooseOne: "请先选择一个分类或个人文献库根目录。",
    createFailed: "无法新建流程图。",
    openFailed: "无法打开流程图。",
    referenceMissing: "无法找到对应的 Zotero 条目。",
    preview: "流程图预览",
    previewFailed: "无法预览此流程图。",
    previewMissing: "下载附件后即可预览。",
    previewBlank: "此页为空白。",
    previewPrevious: "上一页",
    previewNext: "下一页",
  },
};
const isChinese = Services.locale.appLocaleAsBCP47.startsWith("zh");
const strings = isChinese ? STRINGS.zh : STRINGS.en;
const dialogTitle = DrawioSettings.name;

function report(window, message, error) {
  if (error) Zotero.logError(error);
  Services.prompt.alert(window?.closed ? null : window, dialogTitle, message);
}

class DiagramTab {
  constructor(window, file, url, onClose) {
    this.window = window;
    this.file = file;
    this.url = url;
    this.onClose = onClose;
    this.searchGeneration = 0;
  }

  show(original, recovery) {
    this.baseHash = recovery?.baseHash ?? original.hash;
    this.pending = recovery?.xml;
    this.issue = recovery ? (original.hash === this.baseHash ? "recovered" : "conflict") : null;
    const { Zotero_Tabs: tabs, document: doc } = this.window;
    const { id, container } = tabs.add({
      type: TAB_TYPE,
      title: this.file.item.getField("title") || this.file.item.attachmentFilename,
      data: { itemID: this.file.item.id },
      select: true,
      onClose: () => this.onClose(this),
    });
    this.id = id;
    this.container = container;
    container.setAttribute("orient", "vertical");

    const toolbar = doc.createXULElement("hbox");
    this.toolbar = toolbar;
    toolbar.setAttribute("align", "center");
    toolbar.style.padding = "4px 12px";
    toolbar.style.gap = "8px";
    this.label = doc.createXULElement("label");
    this.label.setAttribute("role", "status");
    toolbar.append(this.label);
    this.retry = this.addButton(toolbar, strings.retry, () => this.flush());
    this.retryOpen = this.addButton(toolbar, strings.retryOpen, async () => this.openBrowser());
    this.copy = this.addButton(toolbar, strings.keepCopy, () => this.saveCopy());
    this.reload = this.addButton(toolbar, strings.reload, () => this.reloadFile());

    container.appendChild(toolbar);
    this.editorXML = this.pending ?? original.xml;
    this.openBrowser();
  }

  openBrowser() {
    this.stopLoading();
    this.ready = false;
    this.content = null;
    this.browser?.remove();
    const browser = this.window.document.createXULElement("browser");
    browser.setAttribute("type", "content");
    browser.setAttribute("flex", "1");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("src", this.url);
    this.browser = browser;
    this.container.appendChild(browser);
    this.render("loading");
    this.startLoadTimeout();
    // DOMContentLoaded in a content browser does not reliably reach the Zotero
    // window. Wait for the host script to confirm it can receive bridge events.
    this.hostCheck = setInterval(() => {
      const content = browser.contentDocument;
      if (content?.documentURI !== this.url ||
          content.documentElement?.dataset.diagramHostReady !== "true") return;
      clearInterval(this.hostCheck);
      if (browser.contentPrincipal.isSystemPrincipal) {
        this.failLoading();
        return;
      }
      this.content = content;
      this.connect(content);
      this.loadEditor(this.editorXML);
    }, 50);
  }

  addButton(toolbar, label, command) {
    const button = toolbar.ownerDocument.createXULElement("button");
    button.setAttribute("label", label);
    button.hidden = true;
    button.addEventListener("command", () => {
      void command().catch(error => report(this.window, strings.failed, error));
    });
    toolbar.append(button);
    return button;
  }

  render(status) {
    if (this.closed) return;
    this.toolbar.hidden = !status;
    this.label.setAttribute("value", strings[status] ?? "");
    this.retry.hidden = status !== "failed" && status !== "recovered";
    this.retryOpen.hidden = status !== "loadFailed";
    this.copy.hidden = !this.pending || !["conflict", "failed", "recovered"].includes(status);
    this.reload.hidden = this.copy.hidden;
  }

  connect(content) {
    const listen = (name, handler) => {
      content.addEventListener(EVENT_PREFIX + name, event => {
        if (this.content === content && !this.closed) handler(event);
      }, false, true);
    };
    listen("ready", () => {
      this.ready = true;
      this.stopLoading();
      this.render(this.issue ?? (canWrite(this.file.item) ? null : "readonly"));
    });
    listen("autosave", event => this.change(event.detail));
    listen("save", event => {
      this.change(event.detail);
      void this.flush();
    });
    listen("snapshot", event => {
      const { xml, unchanged } = JSON.parse(event.detail);
      if (!unchanged || this.pending || this.savedXML) this.change(xml);
    });
    listen("library-request", event => void this.requestLibrary(event.detail));
    listen("library-open", event => {
      if (this.ready && !this.closed && typeof event.detail === "string") {
        const { link, openPaper } = JSON.parse(event.detail) ?? {};
        if (typeof link === "string") {
          void openDiagramReference(this, link, openPaper === true)
            .catch(error => report(this.window, strings.openFailed, error));
        }
      }
    });
  }

  async requestLibrary(detail) {
    if (!this.ready || this.closed) return;
    let request;
    try {
      request = JSON.parse(detail);
    } catch {
      return;
    }
    const { id, operation, query, kind, collectionID, offset, key, includeNotes } = request ?? {};
    if (!Number.isSafeInteger(id)) return;
    const generation = this.searchGeneration;
    const libraryID = this.file.item.libraryID;
    let result;
    try {
      if (operation === "browse" && (collectionID === null || Number.isSafeInteger(collectionID)) &&
          Number.isSafeInteger(offset) && offset >= 0) {
        result = await browseDiagramLibrary(this, collectionID, offset);
      } else if (operation === "search" && typeof query === "string") {
        result = await searchDiagramLibrary(libraryID, query.trim().slice(0, 200), kind);
      } else if (operation === "import") {
        result = await getDiagramImport(libraryID, key, includeNotes === true);
      } else {
        return;
      }
    } catch (error) {
      Zotero.logError(error);
      result = { error: true };
    }
    if (this.ready && !this.closed && generation === this.searchGeneration) {
      this.dispatch("library-results", JSON.stringify({ action: "library-results", id, ...result }));
    }
  }

  startLoadTimeout() {
    clearTimeout(this.loadTimeout);
    this.loadTimeout = setTimeout(() => this.failLoading(), 15000);
  }

  stopLoading() {
    clearInterval(this.hostCheck);
    clearTimeout(this.loadTimeout);
  }

  failLoading() {
    this.stopLoading();
    const phase = this.content?.documentElement.dataset.diagramEditorPhase ?? "host";
    Zotero.logError(new Error(DrawioSettings.name + ": editor startup failed during " + phase));
    this.render("loadFailed");
  }

  dispatch(name, detail = null) {
    const event = this.content.createEvent("CustomEvent");
    event.initCustomEvent(EVENT_PREFIX + name, false, false, detail);
    this.content.dispatchEvent(event);
  }

  loadEditor(xml) {
    this.editorXML = xml;
    this.ready = false;
    this.searchGeneration++;
    const settings = DrawioSettings.get();
    this.dispatch("start", JSON.stringify({
      xml,
      title: this.file.item.getField("title"),
      lang: settings.language === "zotero" ? (isChinese ? "zh" : "en") : settings.language,
      dark: { system: "auto", light: "0", dark: "1" }[settings.color],
      layout: settings.layout,
      palette: settings.palette,
      noteMode: settings.noteMode,
      defaultFont: settings.defaultFont,
      customFonts: DrawioSettings.fonts(settings),
      readonly: !canWrite(this.file.item),
    }));
  }

  change(xml) {
    if (!this.ready || !canWrite(this.file.item) || this.pending === xml ||
        (!this.pending && this.savedXML === xml)) return;
    if (!isDiagramXML(xml)) {
      this.render("failed");
      return;
    }
    this.pending = xml;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 250);
  }

  async flush() {
    clearTimeout(this.timer);
    if (!this.pending && !this.inflight) return;
    this.inflight ??= this.savePending().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  async savePending() {
    let attempted;
    do {
      attempted = this.pending;
      await this.saveVersion(attempted);
    } while (this.pending && this.pending !== attempted);
  }

  async saveVersion(xml) {
    let recoveryWritten = false;
    let result;
    try {
      await this.file.keepRecovery(xml, this.baseHash);
      recoveryWritten = true;
    } catch (error) {
      Zotero.logError(error);
    }
    try {
      result = await this.file.save(xml, this.baseHash);
    } catch (error) {
      Zotero.logError(error);
      result = { status: "failed" };
    }
    this.recoveryWritten = recoveryWritten;
    if (result.status !== "saved") {
      this.issue = result.status;
      this.render(this.issue);
      return;
    }
    this.baseHash = result.hash;
    this.savedXML = xml;
    this.issue = null;
    if (this.pending === xml) this.pending = null;
    await this.file.clearRecovery();
    this.render();
    void Zotero.Notifier.trigger("refresh", "item", [this.file.item.id]).catch(Zotero.logError);
  }

  snapshot() {
    if (this.ready && this.browser.contentDocument === this.content) this.dispatch("flush");
  }

  async close() {
    this.snapshot();
    this.closed = true;
    this.ready = false;
    this.stopLoading();
    await this.flush();
    if (this.pending && !this.recoveryWritten && !this.window.closed) {
      report(this.window, strings.recoveryFailed);
    }
  }

  async saveCopy() {
    this.snapshot();
    await this.flush();
    if (!this.pending) return;
    const item = this.file.item;
    const title = (item.getField("title") || strings.untitled) + strings.copySuffix;
    const placement = item.parentID
      ? { parentItemID: item.parentID }
      : { libraryID: item.libraryID, collections: item.getCollections() };
    const xml = this.pending;
    const copy = await importDiagram(xml, title, placement);
    if (this.pending === xml && !this.closed) {
      this.ready = false;
      this.pending = null;
      await this.file.clearRecovery();
      if (!this.closed) {
        this.window.Zotero_Tabs.close(this.id);
        await this.window.ZoteroPane.viewAttachment(copy.id);
      }
    }
    return copy;
  }

  async reloadFile() {
    if (!Services.prompt.confirm(this.window, dialogTitle, strings.discard)) return;
    await this.loadDiskVersion();
  }

  async loadDiskVersion() {
    clearTimeout(this.timer);
    if (this.inflight) await this.inflight;
    const original = await this.file.read();
    if (!isDiagramXML(original.xml)) throw new Error(strings.invalidFile);
    this.baseHash = original.hash;
    this.pending = null;
    this.savedXML = null;
    this.issue = null;
    await this.file.clearRecovery();
    this.render("loading");
    this.loadEditor(original.xml);
    this.startLoadTimeout();
  }
}
