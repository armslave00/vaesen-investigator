# 北欧奇谭规则文档

将 `raw-docs/` 中的中文规则 PDF 整理为可检索、可引用的 Markdown。正文、范例、译注和随机表按原文保留。

- [规则书目录](docs/rulebook/README.md)：原书 11 章，以及序言、可打印表单、索引与致谢。
- [玩家建卡手册](docs/player-guide/README.md)：玩家角色、技能、天赋、大本营升级与背景故事表。

原始资料保留在 `raw-docs/`。自动角色卡 Excel 可继续作为填卡工具使用：[vaesen 自动卡 v2.0](<raw-docs/vaesen自动卡by拂晓鵺啼 v2.0.xlsx>)。

## Web 自动角色卡

[既有 Sites 托管版本](https://vaesen-investigator-archive.auseaia01.chatgpt.site)（仅你可访问；本轮 PDF 与 GitHub Pages 更新尚未发布到该地址）。

`web/` 保留 Excel v2.0 的 110 个可编辑字段，采用北欧调查员档案册风格。当前版本按中文规则书修正资料与计算，支持常规建卡校验、成长、技能与恐惧骰池、情境天赋、装备套用、经验及资产账本。角色完成常规建卡后进入成长；输入自动保存于当前浏览器，档案仅支持当前 v2 JSON 格式的导入导出。新增中文 PDF 导出，参照官方横版人物卡布局，长说明与账本完整续排。忠实复刻版本已提交为 `ff4de6f`，原始 Excel 和 PDF 均未修改。

使用 Node.js 24 安装锁定依赖后运行：

```bash
npm ci
npm run dev
```

打开终端显示的本地地址（默认 `http://127.0.0.1:4173/`）。不要直接以 `file://` 打开 HTML，浏览器需要通过 HTTP 读取模块与数据。

```bash
npm test
npm run build
node scripts/check-pages-build.mjs
```

构建产物位于 `web/dist/`，可作为静态网站部署。GitHub Pages 工作流在 `master` 更新时执行测试、构建与发布；首次启用步骤见下方说明。自动保存按浏览器与网址分别存储，更换网址或设备前请先导出 JSON 档案。

- [网页使用与验证说明](docs/web-card.md)
- [完整字段与公式清单](docs/web-card-workbook.md)
- [规则书核验及原卡差异](docs/web-card-rules-audit.md)
- [PDF 人物卡模板及字段映射](docs/pdf-character-sheet-reference.md)
- [GitHub Pages 自动部署与首次启用](docs/github-pages.md)

规则书与原卡差异（如牧师资源上限、“富有”资源奖励）已修正并记录。吸血鬼猎人保留为未核验扩展；译注歧义与实现解释在网页中明示。原 Excel 计算引擎和 72 项回归测试保留作历史对照。

## 文档约定

章节内按内容使用标题、段落、列表和 Markdown 表格，地图、整页插图及可打印表单保留为图片。双栏正文按阅读顺序排列，侧栏与译注移出正文续句。空白页和纯装饰页不单独生成文档。

各页保留来源注释；规则书还提供 `pdf-page-N` 锚点，`N` 为 PDF 文件中的页序。原文提到的“第 N 页”仍指原书印刷页码，正文中通常对应 PDF 第 `N + 4` 页；章前插图和附录不套用这一换算。建卡手册是原书摘编，页码不连续，以其来源注释为准。

原文的术语、内部引用、译文和规则数值不作勘误。整理只修复排版造成的断行、文字顺序、重复字形和特殊符号提取问题。

## 转换资料

- [主规则书转换记录](docs/rulebook/conversion-manifest.json)：原 PDF 校验值、章节范围、表格和图片页。
- [主规则书转换脚本](scripts/convert_rulebook.py)：使用 `pdfplumber`、`pypdf` 和 Poppler；按本仓库提供的 PDF 版本转换。
- `scripts/data/` 保存本版本的表格与版面校正数据，避免再次提取时遗漏复杂表格。

```bash
python3 scripts/convert_rulebook.py
```

原 PDF 的版权和汉化团队说明见[书目信息与序言](docs/rulebook/00-front-matter.md)。
