# music-likes-sync

[English README](README.md)

本地运行的音乐收藏同步工具。当前正在从个人用“三端并集对账台”重构为开源可用的 Apple Music 可信源同步器：以 Apple Music Favorite Songs / 我喜欢作为唯一可信源，向 QQ 音乐和网易云音乐生成镜像同步计划。

当前稳定能力包括快照、归一化、匹配、统一曲库、人工/AI 辅助确认，以及受保护的新增/删除镜像执行。新的 mirror sync 领域模型已经支持 `keep` / `add` / `remove` / `review` 计划，并提供 mirror dry-run、目标平台新增候选解析、已解析新增执行、受保护删除执行契约，以及带前后快照校验的一次性歌单 live validation 编排。

## 数据源

- Apple Music：首次在 Apple 官方页面登录后，自动定位 Favorite Songs / 喜爱歌曲；后续复用本机专用 Edge 会话静默刷新，CSV/JSON 仅作为兜底。
- QQ 音乐：页面内展示腾讯官方登录页生成的 QQ / 微信二维码，也可打开官方页面使用本机快捷登录；连接后通过本地 Web API 适配器读写。
- 网易云音乐：通过 `NeteaseCloudMusicApi` + cookie 拉取。

## 安装

```powershell
# 在本地源码 checkout 中：
cd music-likes-sync
npm install
npm run verify

# 校验本地 mirror state 文件
npm run check:state
```

需要 Node.js 20 或更高版本。跨平台试听片段自动对齐还需要带 Chromaprint muxer 的 FFmpeg（可用 `ffmpeg -hide_banner -h muxer=chromaprint` 检查）；Docker 镜像已内置。

## Web UI

```powershell
# npm 安装或 npx 使用时：
npx music-likes-sync web

# 源码 checkout 中也可以：
npm run web
```

默认地址：`http://127.0.0.1:4319`

页面里可以完成：

- 上传或粘贴 Apple Music 导出的 CSV / TSV / TXT / JSON。
- Apple 只需首次官方登录；QQ 可直接扫页面内的 QQ / 微信二维码，或使用腾讯页面的本机快捷登录；网易云继续使用二维码。凭据自动保存在本地忽略目录，手工导入只作为兜底。
- 拉取平台快照。
- 生成 Markdown / JSON 缺口报告和统一曲库。
- 在统一曲库里按条目处理版本冲突、低置信候选。
- 可选调用 DeepSeek 生成“同曲同版本 / 同曲不同版本 / 不是同一首”的辅助判断。
- 为 Apple Music、QQ 音乐或网易云音乐生成旧版缺口写入计划，dry-run 后只写入高置信或已确认的候选曲目。
- 为 QQ 音乐或网易云生成 Apple 可信源 mirror plan，查看应保留、新增、删除和人工复核的目标曲目。
- 在 mirror workbench 中按全部、新增、删除、待判断、阻塞筛选具体计划条目，并对当前页待判断项做批量复核。
- 对 mirror `review` 条目保存本地复核决定：视为同一首、视为不同并按 Apple 镜像重建计划，或清除决定。
- 展示当前 mirror plan 的快照新鲜度和执行后的收敛证明状态。
- 执行后可刷新目标快照并重建 Apple 可信源计划，输出收敛检查结果。
- 按批解析 mirror plan 里的新增候选，并在条目里展示已解析目标、低置信候选和备选匹配；已解析新增可执行，未解析新增会被阻塞。
- 对 mirror plan 执行 dry-run；真实删除会弹出页面内确认层，展示目标平台、计划删除数量，并要求输入精确确认文本。
- 在独立的“自动同步”页面配置刷新周期和目标平台；满足基线、快照新鲜度和真实写入验证后可自动执行新增，删除信号始终留给用户确认，并保留脱敏运行历史。
- 真实删除前自动刷新并保存 QQ / 网易云恢复点；“同步预览”页可先检查恢复差异，再以备份专属确认文本执行仅新增、不删除现有歌曲的恢复。
- 对已搜索出的低置信新增候选执行需明确同意的 AI 草稿复核；AI 只能建议新增、跳过或继续人工确认，不能直接接受候选或写入平台。
- 人工复核时可对比 Apple 源版本、QQ / 网易云候选和备选的真实封面、时长与按需试听；本机 Chromaprint 会对齐同一音乐时刻，切换平台时保留播放位置。单播放器不自动播放，每次最多 30 秒；音频指纹和签名地址只存在于进程内存，不持久化、不上传，也不会发送给 AI。
- 对 Apple 与目标平台的疑似同歌 / 不同版本条目，可在试听后保存“同一版本”或“不同版本”；决定按稳定键持久化并在重建预览后保留。“不同版本”只生成受保护的新增 / 删除草稿，AI 只提供可审计建议且不会自动采纳。

## Apple Music 导入

把 Apple Music 喜欢歌曲导出为 CSV / TSV / TXT，放到 `data/apple.csv`，或者直接在 Web UI 里上传/粘贴。表头支持常见中英文字段：

- 歌名：`title` / `name` / `song` / `歌曲` / `名称`
- 歌手：`artist` / `artists` / `singer` / `歌手` / `艺术家`
- 专辑：`album` / `专辑`
- 时长：`duration` / `time` / `时长`

也可以提供 JSON 数组，每项包含 `title`、`artists`、`album`、`durationMs`。

推荐直接在 Web UI 点击连接 Apple Music：只需在专用 Edge 窗口完成一次 Apple 官方登录，应用会自动找到系统“喜爱歌曲”并读取；以后刷新在后台进行，不再要求手工打开歌单。文件导入仍可用于故障兜底。

## Cookie

为了避免把凭据写进命令历史，cookie 应放在本地忽略文件或通过环境变量传入。不要把完整 cookie 发到聊天窗口、issue 或 PR。

QQ / 网易云的 cookie 字段、playlist id 语义、live validation 和排错说明见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。本地登录后，也可以在 Web UI 的高级设置里输入 `DISPOSABLE_PLAYLIST`，运行同一套临时歌单真实新增/删除验证；页面只显示脱敏结果。

运行时文件默认写入当前工作目录下的 `data/` 和 `reports/`。如果需要固定到其他目录，可以设置 `MUSIC_LIKES_SYNC_HOME`。

## 常用命令

```powershell
# 验证安装版本
npx music-likes-sync --version

# 只检查配置和本地导入文件
npm run check

# 拉取三方快照；没配置 cookie 的平台会跳过
npm run snapshot -- --apple .\data\apple.csv --qq-cookie .\data\qq.cookie --netease-cookie .\data\netease.cookie

# 基于快照生成匹配报告
npm run match

# 运行所有本地测试和语法检查
npm run verify

# 一次性运行本地非破坏性发布检查
npm run check:release

# 校验本地 mirror state 文件
npm run check:state

# 校验 GitHub Actions workflow 是否覆盖发布 gate
npm run check:ci

# 扫描公开文件和 npm 包是否含敏感路径或非占位凭据
npm run check:privacy

# 状态迁移 dry-run；只有加 -- --write 才会备份并写回
npm run migrate:state

# 发布前依赖审计
npm audit --omit=dev

# 本地 HTTP smoke
npm run smoke:http

# 本地 React app HTTP smoke
npm run smoke:web-app

# 本地 React UI smoke（桌面 / 移动真实浏览器）
npm run smoke:react-ui

# 本地 UI smoke（桌面/移动视口）
npm run smoke:ui

# npm 发布包 dry-run smoke，检查白名单和隐私排除
npm run smoke:package

# npm 包首跑 smoke，验证 help、空 state 和样例 Apple 快照
npm run smoke:fresh-install

# Docker 打包 smoke（无 Docker 时默认只做静态检查并跳过 build）
npm run smoke:docker
```

CLI 也支持 Apple -> QQ / 网易云镜像同步：

```powershell
npx music-likes-sync mirror-plan --target qq
npx music-likes-sync mirror-resolve --limit 50 --search-limit 12
npx music-likes-sync mirror-decision --action keep --key "<decision-key>"
npx music-likes-sync mirror-decision --action separate --items decisions.json
npx music-likes-sync mirror-apply
npx music-likes-sync mirror-apply --add-only --execute --playlist-id <target-playlist-id>
npx music-likes-sync mirror-apply --remove-only --execute --confirm "REMOVE QQ" --playlist-id <target-playlist-id>
npx music-likes-sync mirror-convergence --refresh-target --playlist-id <target-playlist-id>
```

如果要接入 Hermes 或其他本地 MCP 客户端，可以启动只读 Agent 工具适配器：

```powershell
npx music-likes-sync agent-mcp
```

这个 MCP 适配器复用 Web API 的同一套权限门禁，只能读取脱敏后的曲库摘要、同步预览、单曲同步证据、baseline 差异、复核队列、音乐画像、相似歌曲、推荐，保存本地 shortlist 草稿，并生成草稿操作；不能读取 cookie、AI API key，单曲证据结果不会暴露平台曲目 id / mid，也不能直接新增或删除平台歌曲。

也可以先用样例验证 Apple 导入。为了避免误读本机 cookie，下面的 smoke 会在临时打包目录中运行，只生成样例 Apple 快照，并确认 QQ / 网易云在无 cookie 时安全跳过：

```powershell
npm run smoke:fresh-install
```

真实源码目录中手动运行样例导入时可以使用：

```powershell
npm run snapshot -- --apple .\examples\apple.sample.csv --qq-cookie .\missing.qq.cookie --netease-cookie .\missing.netease.cookie
```

无平台 cookie 时只会生成本地快照：

- `data/apple.json`
- `data/qq.json`
- `data/netease.json`

`reports/missing.md` 和 `reports/matches.json` 需要至少一个有效 QQ / 网易云平台快照后再运行 `npm run match` 才会生成。

## 产品策略

- Apple Music Favorite Songs / 我喜欢是唯一可信源。
- QQ 音乐和网易云音乐是目标副本；目标里 Apple 没有的曲目应进入删除计划。
- 每次同步先生成不可变计划：`keep`、`add`、`remove`、`review`。
- `review` 覆盖低置信匹配、重复映射、版本疑点和反向疑似匹配。
- mirror 复核决定保存在本地 `data/mirror-decisions.json`。`keep` 会在重建计划时变成保留项；`separate` 会按 Apple 可信源生成新增和 / 或删除计划，但真实删除仍必须 dry-run 并输入 `REMOVE QQ` 或 `REMOVE NETEASE`。
- 删除是破坏性动作：真实执行必须先生成 mirror plan，经过 dry-run，并输入 `REMOVE QQ` 或 `REMOVE NETEASE` 确认；执行后会写入 `data/mirror-runs.json`。
- 删除必须带目标平台主 `id`；QQ 只有 `mid`、没有可删除 `id` 的条目会被阻塞，不会被猜测或提交给 provider。
- 真实 mirror 执行会先写入 `running` checkpoint，并带 `runId` / `idempotencyKey` / operation keys。相同幂等键的重试会续跑中断 checkpoint；已完成的重复请求会跳过 provider mutation。
- mirror 收敛检查会按需刷新目标快照，重新生成 Apple 可信源计划，并把是否仍有新增、删除、待判断项写入计划的 `convergence` 元数据。
- 新增不是简单复制 Apple ID：QQ/网易云需要先解析目标平台 catalog ID。已解析新增可在 mirror apply 中执行；未解析新增会被阻塞，不会被伪装成已执行。
- 历史统一曲库和旧版写入计划仍保留，用于对照和渐进迁移；开源主线会转向 Apple source-of-truth mirror sync。

## 工程化路线

- 领域层：`src/mirror-sync.js` 提供纯函数计划模型，不依赖 HTTP、文件或真实平台。
- API 层：`POST /api/mirror/plan` 基于当前 Apple 和目标快照生成镜像计划，`POST /api/mirror/resolve-adds` 按批解析新增候选，`POST /api/mirror/decision` / `POST /api/mirror/decisions` 保存单条或批量复核决定，`POST /api/mirror/apply` 执行 dry-run、已解析新增或受保护删除，`POST /api/mirror/convergence` 做收敛检查，`GET /api/mirror/plan` 读取最近计划。
- Provider 层：QQ / 网易云已具备删除 helper；QQ mid-only 删除目前会作为不可提交项暴露，避免盲删。
- 前端迁移：`/` 现在是 React + Vite + TypeScript 普通用户版入口，`/app/` 保留为 React 兼容别名，旧 `web/` 工作台保留在 `/workbench/`。React 已接入 app state、同步模式选择、读侧同步检查、同步预览读取、新增候选查找 / 决策、tombstone 删除信号复核、受控新增 / 删除执行控件、收敛检查、保存基线、本地 AI 画像 / 相似 / 推荐、自然语言 Agent 工具对话、AI Provider consent 自检、Agent 审计刷新 / 反馈、本地草稿 trace 标签和高级设置只读诊断，`npm run smoke:react-ui` 已覆盖桌面/移动端真实浏览器主路径。
- 测试：`npm run verify` 覆盖 mirror sync 计划、mirror apply 契约、mirror 复核决策、mirror run 幂等键、React/Vite 前端构建、收敛汇总、state schema、provider 删除 no-op、live validation 编排和观测路由；`npm run check:web-app` 单独执行 React + TypeScript 类型检查和 Vite production build；`npm run check:ci` 固定 GitHub Actions 的 Node 20/24、package、fresh-install、HTTP、React app、React UI、UI、Docker、audit 和默认 live gate；`npm run check:privacy` 扫描公开 Git 候选和 npm 包，拦截敏感路径和非占位凭据；`npm run migrate:state` 覆盖状态迁移 dry-run，`-- --write` 会先备份再写回；`npm run smoke:http` 使用临时 `MUSIC_LIKES_SYNC_HOME` fixture 覆盖 mirror plan 生成、批量复核、add-only/remove-only dry-run 分离、QQ mid-only 删除阻塞、幂等元数据和只读收敛检查，不写入本地运行 state；`npm run smoke:web-app` 覆盖默认 `/` React 入口、`/app/` React 兼容别名、`/workbench/` 兼容工作台、SPA fallback、静态资源、读侧 app-state / sync-check / sync-preview API wiring、新增候选查找 / 决策、tombstone 删除信号决策、受控新增 dry-run、真实写入 live validation 拦截、删除确认、收敛摘要、本地 AI 画像 / 相似 / 推荐、AI consent guard、Agent session 脱敏、live validation / AI provider 高级诊断和路径穿越防护；`npm run smoke:react-ui` 覆盖默认 `/` 桌面/移动端真实浏览器导航、同步预览、受控写入保护、本地 AI 动作、自然语言 Agent 工具对话、Agent 审计、本地草稿 trace、高级诊断和横向溢出检查；`npm run smoke:ui` 覆盖 `/workbench/` 桌面/移动视口的镜像控件、筛选、复核按钮、快照新鲜度 / 收敛状态、收敛检查按钮、备选候选和删除确认 smoke；`npm run smoke:package` 覆盖 npm 发布包白名单、CLI bin 和隐私排除；`npm run smoke:fresh-install` 覆盖 npm 包首跑只读命令无 runtime 目录副作用、真实 tarball 安装后的 CLI bin、已安装包内 `npm test`、`music-likes-sync web`、调用者工作目录 runtime root、空 state、样例 Apple 快照和无 cookie 安全跳过；`npm run smoke:docker` 覆盖 Dockerfile 打包约束。
- 下一步：保持 QQ / 网易云 live validation 报告新鲜，等 schema v2 出现时补具体 v1 -> v2 迁移转换，并在有 Docker 的机器上跑 `npm run smoke:docker -- --require-docker --write-report` 生成 strict gate 可校验的 Docker 证据；如果发布工作站没有 Docker，可先用 `gh workflow run ci.yml --ref <branch>` 手动触发 CI，再用 `npm run fetch:docker-report -- --repo owner/name` 拉取 GitHub Actions Node 24 job 上传的 `docker-smoke-report-node-24` artifact 并写成 `reports/docker-smoke.json`。

## Git / 隐私

仓库可以直接初始化为 git 项目。`.gitignore` 默认排除了 `data/*.cookie`、平台快照、写入计划、报告、浏览器 profile、日志和 `.env*`，避免把个人曲库、cookie、API key 提交出去。

开 PR 前先读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全敏感问题不要开公开 issue，按 [SECURITY.md](SECURITY.md) 的说明私下披露；不要上传原始 `data/`、`reports/`、cookie、`.env` 或浏览器 profile。
