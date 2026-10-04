# GitHub Pages 自动部署

本项目通过 [GitHub Pages 工作流](../.github/workflows/github-pages.yml) 部署静态网页。目标仓库为 [armslave00/vaesen-investigator](https://github.com/armslave00/vaesen-investigator)，默认分支是 `master`；启用成功后的项目地址是 `https://armslave00.github.io/vaesen-investigator/`。

2026-10-05 只读核验时，GitHub 仓库 API 与远程 `HEAD` 均返回默认分支 `master`，仓库公开，`has_pages=false`，Pages API 返回 404，Actions API 返回 0 个现有工作流。本地未安装 `gh`，匿名 API 不提供当前账号的管理权限，因此这次核验没有确认谁拥有启用 Pages 的权限，也没有改变远程设置。

## 首次启用

1. 将本工作流、`package.json`、`package-lock.json` 和网页源码合入 `master`。
2. 由仓库管理员或维护者打开 [Settings → Pages](https://github.com/armslave00/vaesen-investigator/settings/pages)，在 **Build and deployment → Source** 选择 **GitHub Actions**。这是 GitHub 官方规定的自定义工作流发布源配置步骤。[发布源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. 如果仓库或组织限制 Actions，需要允许本工作流使用的 `actions/checkout`、`actions/setup-node`、`actions/configure-pages`、`actions/upload-pages-artifact`、`actions/deploy-pages`。它们在工作流中固定到核验过的提交 SHA。
4. 在 `github-pages` 环境的部署分支规则中允许 `master`。如果该环境设置了审核者，部署会等审核通过；无需为本项目另建 `gh-pages` 分支。[GitHub 部署环境](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
5. 打开 [Actions](https://github.com/armslave00/vaesen-investigator/actions)，选择 **GitHub Pages → Run workflow → master** 执行首轮部署；之后每次推送到 `master` 自动更新。

工作流的 `configure-pages` 明确设置 `enablement: false`，检查已有配置；它不会代替上述首次启用步骤。[该动作的官方输入定义](https://github.com/actions/configure-pages/blob/v5/action.yml)

## 构建与发布边界

每次运行先使用 Node.js 24 执行 `npm ci`、`npm test`、`npm run build`。依赖版本取自提交的锁文件。构建产物必须位于 `web/dist`，且该目录根部有 `index.html`。网页不需要服务器端 Node.js；Node.js 只参与构建。[Node.js 动作官方说明](https://github.com/actions/setup-node)，[Pages 工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

`pull_request` 事件只执行构建与测试。上传和部署都要求事件不是 PR 且 `github.ref` 为 `refs/heads/master`，所以手动选择其他分支也只验证构建。没有使用 `pull_request_target`，没有从其他运行下载待发布产物。上传范围固定为 `web/dist`，不会上传仓库根目录、`raw-docs`、`node_modules` 或本地角色存档。

构建令牌只有 `contents: read`。只有部署作业获得 `pages: write` 与 `id-token: write`，并使用 `github-pages` 环境；无需保存个人访问令牌。`deploy` 依赖本次运行的 `build`，构建或测试失败时不会部署。[官方所需权限与作业依赖](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

生产部署共享一个并发组，不中断已经进行中的部署；同一个 PR 的后续提交可以取消旧的验证运行。[GitHub 并发控制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

## 项目子路径与本地验证

GitHub 项目站点位于 `/vaesen-investigator/`。HTML、模块导入、JSON、字体、PDF 等站内资源应使用 `./…` 或相对于当前模块的 `new URL(…, import.meta.url)`，不能把站内资源写成 `/data/…` 或 `/assets/…`，否则会指向域名根目录。`href="#…"` 是当前页锚点，可以保留。默认地址或自定义域名不需要改写构建文件。[项目站点地址规则](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

发布前可执行：

```sh
npm ci
npm test
npm run build
node scripts/check-pages-build.mjs
```

最后一条命令读取真实构建产物，让 esbuild 解析浏览器模块依赖，并确认 HTML、CSS 与脚本中字面量资源链接在 `/vaesen-investigator/` 下能找到文件。它会检查打包后的 PDF 入口与中文字体引用；它不能代替浏览器交互验证。工作流在上传前也执行该检查。

将 `web/dist` 挂载在本地测试服务器的 `/vaesen-investigator/` 路径后，检查首次载入、刷新、存档导入与导出、PDF 下载以及字体加载。构建器若新增资源，需要同时确保资源进入 `web/dist` 并保留相对链接；工作流不需要扩大上传范围。

## 故障定位

- **依赖安装失败**：检查 `package-lock.json` 已提交且与 `package.json` 一致。锁文件变化需要一起合入。
- **Pages 配置检查出现 404 / Get Pages site failed**：确认 Settings → Pages 的 Source 已设置为 GitHub Actions；未启用 Pages 时这是预期失败，不应补上 PAT 绕过首次设置。
- **部署等待或权限失败**：检查 `github-pages` 环境允许 `master`、所需审核已经通过，以及组织允许 Pages 和 Actions。环境保护可阻止发布，即使构建成功。
- **站点打开但资源 404**：在浏览器 Network 检查请求是否保留 `/vaesen-investigator/` 前缀，再检查该文件确实在 `web/dist` 中。
- **默认分支重命名**：同步修改工作流中的 `push.branches`、`pull_request.branches`、两处发布条件及环境允许分支。当前 `master` 来自实际远程核验，不是模板假设。

实际发布结果以 Actions 部署作业输出的 `page_url` 为准；提交工作流与本地构建通过不表示 Pages 已启用或远程部署已成功。[查看工作流运行](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history)
