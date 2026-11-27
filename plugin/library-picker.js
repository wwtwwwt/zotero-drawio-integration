"use strict";

function libraryItemLinkPrefix(library) {
  if (library.libraryType === "user") return "zotero://select/library/items/";
  if (library.libraryType === "group") return "zotero://select/groups/" + library.libraryTypeID + "/items/";
  return null;
}

function canImportItem(item) {
  return !!item && !item.deleted && !item.parentItem?.deleted &&
    (item.isRegularItem() || item.isNote());
}

function itemSummary(item) {
  const note = item.isNote();
  return {
    key: item.key,
    kind: note ? "note" : "paper",
    title: note ? item.getNoteTitle() : item.getDisplayTitle(),
    subtitle: note ? "" : [item.firstCreator, item.getField("year")].filter(Boolean).join(", "),
    publisher: note ? "" : item.getField("publisher", false, true) ||
      item.getField("publicationTitle") || item.getField("proceedingsTitle") || item.getField("repository"),
    link: libraryItemLinkPrefix(item.library) + item.key,
  };
}

async function resolveDiagramItem(libraryID, key) {
  if (typeof key !== "string" || !/^[A-Z0-9]{8}$/.test(key)) return null;
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  return canImportItem(item) ? item : null;
}

function observeDiagramLibrary() {
  return Zotero.Notifier.registerObserver({
    notify(event, type, ids, extraData) {
      if (!["add", "modify", "delete", "trash", "remove"].includes(event) || !sessions.size) return;
      const libraries = new Set();
      for (const id of ids) {
        const object = type === "item" ? Zotero.Items.get(id)
          : Zotero.Collections.get(type === "collection-item" ? Number(String(id).split("-")[0]) : id);
        libraries.add(object?.libraryID ?? extraData?.[id]?.libraryID);
      }
      for (const session of sessions.values()) {
        if (session.ready && !session.closed && !session.window.closed &&
            (libraries.has(session.file.item.libraryID) || libraries.has(undefined))) {
          session.dispatch("library-changed", '{"action":"library-changed"}');
        }
      }
    },
  }, ["item", "collection", "collection-item"], "drawio-library");
}

async function getDiagramPapers(libraryID, keys) {
  const items = (await Promise.all([...new Set(keys)].map(key => resolveDiagramItem(libraryID, key))))
    .filter(item => item?.isRegularItem());
  await Zotero.Items.loadDataTypes(items, ["itemData", "collections"]);
  return { items: items.map(item => ({
    ...itemSummary(item),
    collections: item.getCollections().map(id => Zotero.Collections.get(id).name),
  })) };
}

async function getDiagramChildren(libraryID, key) {
  const paper = await resolveDiagramItem(libraryID, key);
  if (!paper?.isRegularItem()) throw new Error("Paper is unavailable");
  await Zotero.Items.loadDataTypes([paper], ["childItems"]);
  const [attachments, notes] = await Promise.all([
    Zotero.Items.getAsync(paper.getAttachments()),
    Zotero.Items.getAsync(paper.getNotes()),
  ]);
  await Zotero.Items.loadDataTypes([...attachments, ...notes], ["itemData"]);
  return {
    attachments: attachments.map(item => item.getDisplayTitle() || item.attachmentFilename),
    notes: notes.filter(canImportItem).map(itemSummary),
  };
}

async function browseDiagramLibrary(session, collectionID, offset, limit) {
  const attachment = session.file.item;
  const libraryID = attachment.libraryID;
  const collections = offset === 0 ? Zotero.Collections.getByLibrary(libraryID, true) : null;
  if (collectionID === null) {
    const owner = attachment.parentItem || attachment;
    await Zotero.Items.loadDataTypes([owner], ["collections"]);
    const membership = new Set(owner.getCollections());
    const selected = selectedDiagramCollections(session.window.ZoteroPane).find(col => membership.has(col.id));
    collectionID = selected?.id ?? collections.find(col => membership.has(col.id))?.id ?? 0;
  }
  let collection = collectionID ? Zotero.Collections.get(collectionID) : null;
  if (collection?.deleted || collection?.libraryID !== libraryID) collection = null;
  collectionID = collection?.id ?? 0;
  if (collection) await Zotero.Collections.loadDataTypes([collection], ["childItems"]);
  const entries = collection ? collection.getChildItems() : await Zotero.Items.getAll(libraryID, true);
  const items = entries.filter(canImportItem);
  const page = items.slice(offset, offset + limit);
  await Zotero.Items.loadDataTypes(page, ["itemData"]);
  const result = { collectionID, items: page.map(itemSummary), more: items.length > offset + limit };
  if (collections) {
    result.libraryName = attachment.library.name;
    result.collections = collections.map(col => ({ id: col.id, parentID: col.parentID || 0, name: col.name }));
  }
  return result;
}

async function searchDiagramLibrary(libraryID, query, kind) {
  if (!query) return { items: [], more: false };
  const ids = [];
  if (kind !== "note") {
    const papers = new Zotero.Search();
    papers.libraryID = libraryID;
    papers.addCondition("quicksearch-titleCreatorYear", "contains", query);
    papers.addCondition("itemType", "isNot", "attachment");
    papers.addCondition("itemType", "isNot", "note");
    ids.push(...await papers.search());
  }
  if (kind !== "paper") {
    const notes = new Zotero.Search();
    notes.libraryID = libraryID;
    notes.addCondition("quicksearch-titleCreatorYearNote", "contains", query);
    notes.addCondition("itemType", "is", "note");
    ids.push(...await notes.search());
  }
  const pageSize = 40;
  const matches = [];
  for (let offset = 0; matches.length <= pageSize && offset < ids.length; offset += pageSize) {
    const batch = await Zotero.Items.getAsync(ids.slice(offset, offset + pageSize));
    matches.push(...batch.filter(canImportItem));
  }
  const items = matches.slice(0, pageSize);
  await Zotero.Items.loadDataTypes(items, ["itemData"]);
  return { items: items.map(itemSummary), more: matches.length > pageSize };
}

function diagramNoteText(html) {
  const document = new DOMParser().parseFromString("", "text/html");
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  for (const node of fragment.querySelectorAll("script, style, template")) node.remove();
  for (const line of fragment.querySelectorAll("br")) line.replaceWith("\n");
  for (const block of fragment.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr, div")) {
    block.after("\n");
  }
  return fragment.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

async function getDiagramImport(libraryID, key, includeNotes) {
  const item = await resolveDiagramItem(libraryID, key);
  if (!item) throw new Error("Item is unavailable");
  await Zotero.Items.loadDataTypes([item], ["itemData"]);
  const summary = itemSummary(item);
  if (item.isNote()) {
    await Zotero.Items.loadDataTypes([item], ["note"]);
    return { item: { ...summary, content: diagramNoteText(item.getNote()) }, notes: [] };
  }
  if (!includeNotes) return { item: summary, notes: [] };

  await Zotero.Items.loadDataTypes([item], ["childItems"]);
  const notes = (await Zotero.Items.getAsync(item.getNotes())).filter(canImportItem);
  await Zotero.Items.loadDataTypes(notes, ["itemData", "note"]);
  return { item: summary, notes: notes.map(note => ({
    ...itemSummary(note),
    content: diagramNoteText(note.getNote()),
  })) };
}

async function openDiagramReference(session, link, openPaper) {
  const library = session.file.item.library;
  const prefix = libraryItemLinkPrefix(library);
  if (!prefix || !link.startsWith(prefix)) return;
  const item = await resolveDiagramItem(library.libraryID, link.slice(prefix.length));
  if (session.closed) return;
  if (!item) {
    report(session.window, strings.referenceMissing);
    return;
  }

  const pane = session.window.ZoteroPane;
  if (openPaper && item.isRegularItem()) {
    await Zotero.Items.loadDataTypes([item], ["itemData", "childItems"]);
    const attachment = (await item.getBestAttachments()).find(file => file.attachmentReaderType);
    if (attachment) return pane.viewAttachment(attachment.id);

    const url = item.getField("url");
    if (/^https?:\/\//i.test(url)) return pane.loadURI(url);
    const doiField = item.getField("DOI");
    const doi = doiField && Zotero.Utilities.cleanDOI(doiField);
    if (doi) return pane.loadURI("https://doi.org/" + encodeURIComponent(doi));
  }
  await pane.selectItem(item.id);
}
