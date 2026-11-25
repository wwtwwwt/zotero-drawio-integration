[![Zotero 中文社区 · 已收录](https://zotero-chinese.com/badges/listed.svg)](https://zotero-chinese.com/plugins/)

<img src="plugin/icons/diagram.png" alt="Zotero Draw.io 插件图标" width="96" height="96">

# Zotero Draw.io Integration

在 Zotero 桌面端离线新建和编辑 `.drawio`。流程图是 Zotero 管理的文件附件，可以独立放在分类里，也可以挂在一篇文献下面。

**适用环境**　Zotero 8.0 至 10.0.x · **项目许可**　[AGPL-3.0-only](LICENSE)

[安装](#安装) · [使用](#使用) · [设置](#设置) · [构建与测试](#构建与测试) · [发布](#发布) · [许可证](#许可证)

## 安装

1. 从 [GitHub Releases](https://github.com/wwtwwwt/zotero-drawio-integration/releases) 下载 `.xpi` 安装包，或按[构建说明](#构建与测试)在本地生成。
2. 在 Zotero 中打开「工具 → 插件」，点击齿轮菜单中的「从文件安装插件」，选择 `.xpi` 文件。

从 v0.4.2 或更早的版本升级时，请手动覆盖安装一次 v0.4.3 或更新的正式版。之后即可通过 Zotero 的插件更新功能获取新版本。

## 使用

- **新建或导入：** 点击文献列表上方的「新建 draw.io 流程图」，或选择「工具 → 新建独立流程图」。要将流程图挂到文献下，右键文献并选择「新建流程图附件」。也可以将已有的 `.drawio` 文件直接拖入文献列表。
- **编辑与保存：** 双击流程图，或右键选择「在 Zotero 中编辑流程图」。编辑器在主窗口的标签页打开，修改自动写回原文件。
- **预览：** 在文献库中选中流程图附件，右侧预览会自动缩放以显示当前页的完整内容。多页图可以在预览下方切换页面。预览读取本地已保存的附件。
- **挂载与分离：** 将独立流程图拖到文献上即可挂载，将子附件拖到列表空白处即可分离。右键选择「显示文件」可找到原始 `.drawio` 文件。
- **导入文献与笔记：** 编辑器的 Zotero 侧栏会显示条目的出版社或期刊等出版来源。侧栏底部的「导入笔记选项」决定导入论文时如何处理其子笔记。选「不导入」时只插入论文块，仍可单独导入笔记作为可编辑副本。选中已有块后，可在右栏搜索并替换论文或笔记。

已在 macOS 上使用临时个人库通过 Zotero 8.0、8.0.4、9.0、10.0.1 和 10.0.9 的测试。

## 设置

从「工具 → draw.io 设置」打开插件设置，可调整配色、布局、编辑器语言、默认侧栏页签、字体、画布和笔记导入方式。设置自动保存，下次打开流程图时生效。

## 构建与测试

需要 Python 3.11 或更新版本。首次构建从 draw.io 的公开发行页获取固定版本的资源并校验 SHA-256。构建缓存齐全后也可离线打包。

```sh
python3 scripts/build.py
```

安装包生成在 `dist/`。测试在临时 Zotero 配置和文献库里运行两次冷启动，可用 `ZOTERO_BINARY` 指定 Zotero 可执行文件。

## 发布

在包含发布工作流的提交上打 `vX.Y.Z` 格式的标签，并把标签推送到 GitHub。例如：

```sh
git tag -a v0.4.3 -m 'Release v0.4.3'
git push origin v0.4.3
```

GitHub Actions 会创建 Release，并同时上传 `.xpi` 和 `updates.json`。包内版本由标签决定。更新清单从已打包的 XPI 读取插件 ID、版本号和兼容范围，并记录对应版本的下载地址及 SHA-256。Zotero 从最新正式 Release 读取更新清单。

本地预检正式包和更新清单可运行以下命令。

```sh
package="$(python3 scripts/build.py --release-tag v0.4.3)"
python3 scripts/build_update_manifest.py "$package" --repo wwtwwwt/zotero-drawio-integration --tag v0.4.3
```

无标签的本地构建使用 `plugin/manifest.json` 中的开发版本号。

## 许可证

本项目的原创代码以 [GNU Affero General Public License v3.0（AGPL-3.0-only）](LICENSE) 发布。随包分发的 draw.io 上游资源采用 Apache-2.0。安装包根目录包含项目的 `LICENSE`，`editor/LICENSE` 保留上游许可证，`editor/UPSTREAM.txt` 记录对上游打包资源的改动。
