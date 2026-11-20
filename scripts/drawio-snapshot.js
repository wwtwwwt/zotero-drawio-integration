// Installed before the pinned draw.io build initializes its embed mode.
(() => {
  const initialize = EditorUi.prototype.initializeEmbedMode;
  EditorUi.prototype.initializeEmbedMode = function () {
    let baseline;
    const snapshot = () => this.getFileData(true);

    this.addListener("embedLoaded", () => {
      baseline = snapshot();
    });
    document.addEventListener("diagram-attachments:flush", () => {
      if (baseline === undefined) return;
      this.editor.graph.stopEditing(false);
      const xml = snapshot();
      document.dispatchEvent(new CustomEvent("diagram-attachments:snapshot", {
        detail: JSON.stringify({ xml, unchanged: xml === baseline }),
      }));
    });

    return initialize.apply(this, arguments);
  };
})();
