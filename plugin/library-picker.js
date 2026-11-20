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
    link: libraryItemLinkPrefix(item.library) + item.key,
  };
}

async function resolveDiagramItem(libraryID, key) {
  if (typeof key !== "string" || !/^[A-Z0-9]{8}$/.test(key)) return null;
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  return canImportItem(item) ? item : null;
}

async function browseDiagramLibrary(session, collectionID, offset) {
  const attachment = session.file.item;
  const libraryID = attachment.libraryID;
  let collections;
  if (collectionID === null) {
    collections = Zotero.Collections.getByLibrary(libraryID, true);
    const owner = attachment.parentItem || attachment;
    await Zotero.Items.loadDataTypes([owner], ["collections"]);
    const membership = new Set(owner.getCollections());
    const selected = session.window.ZoteroPane.getSelectedCollections().find(col => membership.has(col.id));
    collectionID = selected?.id ?? collections.find(col => membership.has(col.id))?.id ?? 0;
  }
  const collection = collectionID ? Zotero.Collections.get(collectionID) : null;
  if (collectionID && (!collection || collection.deleted || collection.libraryID !== libraryID)) {
    throw new Error("Collection is unavailable");
  }
  if (collection) await Zotero.Collections.loadDataTypes([collection], ["childItems"]);
  const entries = collection ? collection.getChildItems() : await Zotero.Items.getAll(libraryID, true);
  const items = entries.filter(canImportItem);
  const pageSize = 40;
  const page = items.slice(offset, offset + pageSize);
  await Zotero.Items.loadDataTypes(page, ["itemData"]);
  const result = { collectionID, items: page.map(itemSummary), more: items.length > offset + pageSize };
  if (collections) {
    result.libraryName = attachment.library.name;
    result.collections = collections.map(col => ({ id: col.id, parentID: col.parentID || 0, name: col.name }));
  }
  return result;
}

async function searchDiagramLibrary(libraryID, query, papersOnly) {
  if (!query) return { items: [], more: false };
  const search = new Zotero.Search();
  search.libraryID = libraryID;
  search.addCondition("quicksearch-titleCreatorYear", "contains", query);
  search.addCondition("itemType", "isNot", "attachment");
  search.addCondition("itemType", "isNot", "note");
  const ids = await search.search();
  if (!papersOnly) {
    const notes = new Zotero.Search();
    notes.libraryID = libraryID;
    notes.addCondition("quicksearch-titleCreatorYearNote", "contains", query);
    ids.push(...await notes.search());
  }
  const items = (await Zotero.Items.getAsync([...new Set(ids)].slice(0, 40))).filter(canImportItem);
  await Zotero.Items.loadDataTypes(items, ["itemData"]);
  return { items: items.map(itemSummary), more: ids.length > 40 };
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

async function getDiagramImport(libraryID, key) {
  const item = await resolveDiagramItem(libraryID, key);
  if (!item) throw new Error("Item is unavailable");
  await Zotero.Items.loadDataTypes([item], ["itemData"]);
  const summary = itemSummary(item);
  if (item.isNote()) {
    await Zotero.Items.loadDataTypes([item], ["note"]);
    return { item: { ...summary, content: diagramNoteText(item.getNote()) }, notes: [] };
  }

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
