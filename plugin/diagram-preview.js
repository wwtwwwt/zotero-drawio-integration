"use strict";

function mountDiagramPreviews(window) {
  const { document } = window;
  const url = editorAssets.origin + "/web/preview.html";
  const previews = new Map();
  let active = true;
  let restore = () => {};
  const pendingRefresh = new window.IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      const state = previews.get(target);
      if (isIntersecting && state) show(target, state.item, true);
    }
  });

  function clear(preview) {
    const state = previews.get(preview);
    if (!state) return;
    pendingRefresh.unobserve(preview);
    window.clearInterval(state.timer);
    state.browser.remove();
    state.fallback?.remove();
    preview.removeAttribute("data-drawio-diagram");
    previews.delete(preview);
  }

  function show(preview, item, force = false) {
    if (!preview.closest("attachment-box") || !isDiagram(item)) {
      clear(preview);
      return;
    }
    const previous = previews.get(preview);
    if (!force && previous?.item.id === item.id) return;
    clear(preview);

    const browser = document.createXULElement("browser");
    browser.className = "drawio-diagram-preview";
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("aria-label", strings.preview);
    browser.setAttribute("src", url);
    const state = { item, browser };
    previews.set(preview, state);
    preview.setAttribute("data-drawio-diagram", "");
    preview.append(browser);

    const current = () => previews.get(preview) === state;
    const deadline = Date.now() + 15000;
    state.timer = window.setInterval(() => {
      const content = browser.contentDocument;
      if (content?.documentURI === url && content.documentElement.dataset.drawioViewerReady === "true" &&
          !browser.contentPrincipal.isSystemPrincipal) {
        window.clearInterval(state.timer);
        void load(content).catch(Zotero.logError);
      } else if (Date.now() >= deadline) {
        window.clearInterval(state.timer);
        browser.remove();
        const fallback = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
        fallback.className = "drawio-diagram-preview-fallback";
        fallback.textContent = strings.previewFailed;
        state.fallback = fallback;
        preview.append(fallback);
      }
    }, 50);

    async function load(content) {
      let xml;
      let error;
      try {
        const path = await item.getFilePathAsync();
        if (!path) {
          error = strings.previewMissing;
        } else {
          xml = await IOUtils.readUTF8(path);
          if (!isDiagramXML(xml)) {
            xml = null;
            error = strings.previewFailed;
          }
        }
      } catch (exception) {
        error = exception.name === "NotFoundError" ? strings.previewMissing : strings.previewFailed;
      }
      if (!current() || browser.contentDocument !== content) return;
      const event = content.createEvent("CustomEvent");
      event.initCustomEvent(EVENT_PREFIX + "preview", false, false, JSON.stringify({
        xml, error, title: item.getField("title"), failed: strings.previewFailed,
        blank: strings.previewBlank, previous: strings.previewPrevious, next: strings.previewNext,
      }));
      content.dispatchEvent(event);
    }
  }

  void window.customElements.whenDefined("attachment-preview").then(() => {
    if (!active) return;
    const prototype = window.customElements.get("attachment-preview").prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "item");
    if (!descriptor?.set) return;
    const set = function (item) {
      descriptor.set.call(this, item);
      show(this, this.item);
    };
    Object.defineProperty(prototype, "item", { ...descriptor, set });
    for (const preview of document.querySelectorAll("attachment-box attachment-preview")) {
      show(preview, preview.item);
    }
    restore = () => {
      if (Object.getOwnPropertyDescriptor(prototype, "item")?.set === set) {
        Object.defineProperty(prototype, "item", descriptor);
      }
    };
  }).catch(Zotero.logError);

  const observerID = Zotero.Notifier.registerObserver({
    notify(event, _type, ids) {
      if (!["refresh", "modify"].includes(event)) return;
      for (const [preview, { item }] of Array.from(previews)) {
        if (!preview.isConnected) clear(preview);
        else if (ids.includes(item.id)) {
          if (preview.checkVisibility()) show(preview, item, true);
          else pendingRefresh.observe(preview);
        }
      }
    },
  }, ["item"], "drawio-preview");
  return () => {
    active = false;
    restore();
    Zotero.Notifier.unregisterObserver(observerID);
    pendingRefresh.disconnect();
    for (const preview of previews.keys()) clear(preview);
  };
}
