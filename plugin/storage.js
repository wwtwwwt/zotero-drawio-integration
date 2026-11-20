"use strict";

const BLANK_DIAGRAM = `<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel grid="1" gridSize="10" page="1" pageScale="1" pageWidth="827" pageHeight="1169"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function isDiagram(item) {
  return !!item?.isFileAttachment() && /\.drawio$/i.test(item.attachmentFilename);
}

function canWrite(item) {
  return !!item && !item.deleted && item.isEditable() && item.library.filesEditable;
}

function isDiagramXML(xml) {
  if (typeof xml !== "string" || /<!DOCTYPE/i.test(xml)) return false;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return ["mxfile", "mxGraphModel"].includes(doc.documentElement?.localName) &&
    !doc.getElementsByTagName("parsererror").length;
}

async function hashXML(xml) {
  const bytes = new TextEncoder().encode(xml);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function writeAtomic(path, text) {
  const temporary = PathUtils.join(PathUtils.parent(path),
    ".diagram-attachments-" + Services.uuid.generateUUID().toString().slice(1, -1));
  try {
    await IOUtils.writeUTF8(path, text, { tmpPath: temporary });
  } finally {
    await IOUtils.remove(temporary, { ignoreAbsent: true }).catch(Zotero.logError);
  }
}

async function importDiagram(xml, title, options) {
  const directory = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "zotero-diagram");
  const stem = Zotero.File.getValidFileName(title).slice(0, 100).replace(/[. ]+$/, "") || "Diagram";
  try {
    const path = PathUtils.join(directory, stem + ".drawio");
    await IOUtils.writeUTF8(path, xml);
    return await Zotero.Attachments.importFromFile({
      ...options,
      file: path,
      title,
      contentType: "application/octet-stream",
      charset: "utf-8",
    });
  } finally {
    await IOUtils.remove(directory, { recursive: true, ignoreAbsent: true }).catch(Zotero.logError);
  }
}

class DiagramFile {
  constructor(item, path) {
    this.item = item;
    this.path = path;
    this.recoveryDir = PathUtils.join(Zotero.Profile.dir, "diagram-attachments-recovery");
    this.recoveryPath = PathUtils.join(this.recoveryDir, item.libraryID + "-" + item.key + ".json");
  }

  async read() {
    const xml = await IOUtils.readUTF8(this.path);
    return { xml, hash: await hashXML(xml) };
  }

  async getRecovery() {
    try {
      const data = await IOUtils.readJSON(this.recoveryPath);
      if (!isDiagramXML(data.xml) || !/^[0-9a-f]{64}$/.test(data.baseHash)) {
        throw new Error("Invalid diagram recovery file");
      }
      return data;
    } catch (error) {
      if (error.name === "NotFoundError") return null;
      throw error;
    }
  }

  async keepRecovery(xml, baseHash) {
    await IOUtils.makeDirectory(this.recoveryDir, { ignoreExisting: true });
    await writeAtomic(this.recoveryPath, JSON.stringify({ xml, baseHash }));
  }

  async clearRecovery() {
    await IOUtils.remove(this.recoveryPath, { ignoreAbsent: true }).catch(Zotero.logError);
  }

  async save(xml, baseHash) {
    if (!Zotero.Items.get(this.item.id) || !canWrite(this.item) ||
        this.item.getFilePath() !== this.path) {
      return { status: "conflict" };
    }
    let current;
    try {
      current = await this.read();
    } catch (error) {
      if (error.name === "NotFoundError") return { status: "conflict" };
      throw error;
    }
    if (current.xml === xml) return { status: "saved", hash: current.hash };
    if (current.hash !== baseHash) return { status: "conflict" };

    const hash = await hashXML(xml);
    await writeAtomic(this.path, xml);
    return { status: "saved", hash };
  }
}
