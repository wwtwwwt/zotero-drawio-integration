<img src="plugin/icons/diagram.png" alt="Zotero Draw.io 插件图标" width="96" height="96">

# Zotero Draw.io Integration

在 Zotero 桌面端离线新建和编辑 `.drawio`。流程图是 Zotero 管理的文件附件，可以独立放在分类里，也可以挂在一篇文献下面。

**适用环境：** Zotero 10.0.x（最低 10.0.9） · **项目许可：** [AGPL-3.0-only](LICENSE)

[安装](#安装) · [使用](#使用) · [设置](#设置) · [构建与测试](#构建与测试) · [许可证](#许可证)

## 安装

1. 获取发布的 `.xpi` 安装包，或按[构建说明](#构建与测试)在本地生成。
2. 在 Zotero 中打开「工具 → 插件」，点击齿轮菜单中的「从文件安装插件」，选择 `.xpi` 文件。更新旧版时也使用这个入口。

## 使用

- **新建或导入：** 点击文献列表上方的「新建 draw.io 流程图」，或选择「工具 → 新建独立流程图」。要将流程图挂到文献下，右键文献并选择「新建流程图附件」。也可以将已有的 `.drawio` 文件直接拖入文献列表。
- **编辑与保存：** 双击流程图，或右键选择「在 Zotero 中编辑流程图」。编辑器在主窗口的标签页打开，修改自动写回原文件。
- **挂载与分离：** 将独立流程图拖到文献上即可挂载，将子附件拖到列表空白处即可分离。右键选择「显示文件」可找到原始 `.drawio` 文件。

> 已在 macOS 上的 Zotero 10.0.9 和个人库中通过测试。

## 构建与测试

需要 Python 3.11 或更新版本。首次构建从 draw.io 的公开发行页获取固定版本的资源并校验 SHA-256。构建缓存齐全后也可离线打包。

```sh
python3 scripts/build.py
```

安装包生成在 `dist/`。测试在临时 Zotero 配置和文献库里运行两次冷启动，可用 `ZOTERO_BINARY` 指定 Zotero 可执行文件。

## 许可证

本项目的原创代码以 [GNU Affero General Public License v3.0（AGPL-3.0-only）](LICENSE) 发布。随包分发的 draw.io 上游资源采用 Apache-2.0。安装包根目录包含项目的 `LICENSE`，`editor/LICENSE` 保留上游许可证，`editor/UPSTREAM.txt` 记录对上游打包资源的改动。
