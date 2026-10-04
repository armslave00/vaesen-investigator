# PDF 中文字体

`NotoSansSC-Regular.ttf` 来自 [Google Fonts / Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)，遵循同目录的 [SIL Open Font License 1.1](OFL.txt)。供 PDF 导出嵌入，网页首次打开不加载此字体。

2026-10-05 下载上游 `NotoSansSC[wght].ttf`，使用 fontTools 4.66.1 将 `wght` 固定为 400，得到静态 Regular 字体。保留全部字符，运行时使用 pdf-lib/fontkit 只嵌入本次 PDF 实际用到的字形。没有改动字体家族名称、字形或许可。

- 上游变量字体 SHA-256：`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`
- 本地静态字体 SHA-256：`ac5a0d1acccbf1d581ae8dfa72c00ee16a2ce94cbc6d3937209ff223c04ef3d3`
- 上游路径：`https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf`

浏览器仅向本站加载字体，不请求第三方字体服务。字体未收录的字符在 PDF 中写为 `[U+XXXX]`，下载提示同时说明这些字符，避免不可见文字或方框。
