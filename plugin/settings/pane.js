"use strict";

(() => {
  const zh = Services.locale.appLocaleAsBCP47.startsWith("zh");
  const copy = zh ? {
    appearance: "编辑器外观", drawing: "字体与新建画布", imports: "文献与笔记",
    color: "配色", layout: "界面布局", language: "编辑器语言", palette: "打开时显示的左侧页签",
    defaultFont: "新形状的默认字体", customFonts: "字体菜单中的自定义字体",
    fontsHint: "填写已安装的字体名称，多个名称用逗号分隔。留空使用 draw.io 默认字体。",
    grid: "新建流程图显示网格", pageView: "新建流程图显示页面边界", noteMode: "笔记默认导入方式",
    saved: "设置自动保存，重新打开流程图后生效。",
    reset: "恢复默认设置",
    choices: {
      color: ["跟随系统", "浅色", "深色"], layout: ["经典", "Atlas"],
      language: ["跟随 Zotero", "简体中文", "English"], palette: ["Zotero", "图形"],
      noteMode: ["复制正文，可直接编辑", "链接原笔记，只读"],
    },
  } : {
    appearance: "Editor appearance", drawing: "Fonts and new diagrams", imports: "Papers and notes",
    color: "Color scheme", layout: "Interface layout", language: "Editor language", palette: "Sidebar on open",
    defaultFont: "Default font for new shapes", customFonts: "Custom fonts in the font picker",
    fontsHint: "Enter installed font names separated by commas. Leave blank to use draw.io defaults.",
    grid: "Show the grid in new diagrams", pageView: "Show page boundaries in new diagrams",
    noteMode: "Default note import mode",
    saved: "Changes are saved automatically and apply when you reopen a diagram.",
    reset: "Restore defaults",
    choices: {
      color: ["System", "Light", "Dark"], layout: ["Classic", "Atlas"],
      language: ["Match Zotero", "简体中文", "English"], palette: ["Zotero", "Shapes"],
      noteMode: ["Copy text, editable", "Link to original, read-only"],
    },
  };

  function mount(event) {
    const pane = event.target;
    if (pane.id !== "drawio-integration-settings") return;
    document.removeEventListener("load", mount, true);

    const fields = new Map();
    const section = (title, keys) => {
      const group = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = title;
      group.append(legend);
      for (const key of keys) {
        const allowed = DrawioSettings.choices[key];
        const field = document.createElement(allowed ? "select" : "input");
        field.id = "drawio-setting-" + key;
        const label = document.createElement("label");
        label.htmlFor = field.id;
        label.textContent = copy[key];
        const row = document.createElement("div");
        row.className = "drawio-pref-row";
        row.append(label, field);
        group.append(row);
        if (allowed) {
          for (const [index, option] of allowed.entries()) {
            const entry = document.createElement("option");
            entry.value = option;
            entry.textContent = copy.choices[key][index];
            field.append(entry);
          }
        } else if (key === "grid" || key === "pageView") {
          field.type = "checkbox";
          row.classList.add("drawio-pref-toggle");
          row.prepend(field);
        } else {
          field.type = "text";
          field.maxLength = key === "defaultFont" ? 96 : 4000;
          field.placeholder = key === "defaultFont" ? "Arial" : "Arial, PingFang SC";
          field.setAttribute("aria-describedby", "drawio-settings-fonts-hint");
        }
        field.addEventListener(field.type === "text" ? "input" : "change", () => {
          DrawioSettings.set(key, field.type === "checkbox" ? field.checked : field.value);
        });
        fields.set(key, field);
      }
      pane.append(group);
    };

    section(copy.appearance, ["color", "layout", "language", "palette"]);
    section(copy.drawing, ["defaultFont", "customFonts", "grid", "pageView"]);
    const hint = document.createElement("p");
    hint.id = "drawio-settings-fonts-hint";
    hint.className = "drawio-pref-hint";
    hint.textContent = copy.fontsHint;
    fields.get("customFonts").parentNode.after(hint);
    section(copy.imports, ["noteMode"]);

    const refresh = () => {
      const settings = DrawioSettings.get();
      for (const [key, field] of fields) {
        if (field.type === "checkbox") field.checked = settings[key];
        else field.value = settings[key];
      }
    };
    const footer = document.createElement("div");
    footer.className = "drawio-pref-footer";
    const saved = document.createElement("p");
    saved.className = "drawio-pref-hint";
    saved.textContent = copy.saved;
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = copy.reset;
    reset.addEventListener("click", () => {
      DrawioSettings.reset();
      refresh();
    });
    footer.append(saved, reset);
    pane.append(footer);
    refresh();
  }

  document.addEventListener("load", mount, true);
})();
