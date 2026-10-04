# 北欧奇谭规则文档

将 `raw-docs/` 中的中文规则 PDF 整理为可检索、可引用的 Markdown。正文、范例、译注和随机表按原文保留。

- [规则书目录](docs/rulebook/README.md)：原书 11 章，以及序言、可打印表单、索引与致谢。
- [玩家建卡手册](docs/player-guide/README.md)：玩家角色、技能、天赋、大本营升级与背景故事表。

原始资料保留在 `raw-docs/`。自动角色卡 Excel 可继续作为填卡工具使用：[vaesen 自动卡 v2.0](<raw-docs/vaesen自动卡by拂晓鵺啼 v2.0.xlsx>)。

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
