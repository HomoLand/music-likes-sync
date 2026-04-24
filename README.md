# music-likes-sync

个人用音乐收藏对账工具。当前版本只做读取、归一化、匹配、统一曲库和人工确认建议，不会写入 Apple Music、QQ 音乐或网易云音乐。

## 数据源

- Apple Music：CSV/JSON 导入，或通过本地 Edge 登录窗口抓取页面。
- QQ 音乐：通过 `qq-music-api` + cookie 拉取。
- 网易云音乐：通过 `NeteaseCloudMusicApi` + cookie 拉取。

## 安装

```powershell
cd C:\Users\SajoL\Documents\Code\music-likes-sync
npm install
```

## Web UI

```powershell
npm run web
```

默认地址：`http://127.0.0.1:4319`

页面里可以完成：

- 上传或粘贴 Apple Music 导出的 CSV / TSV / TXT / JSON。
- 保存 QQ 音乐和网易云音乐 cookie 到本地 `data/`。
- 拉取平台快照。
- 生成 Markdown / JSON 缺口报告和统一曲库。
- 在统一曲库里按条目处理版本冲突、低置信候选。
- 可选调用 DeepSeek 生成“同曲同版本 / 同曲不同版本 / 不是同一首”的辅助判断。

## Apple Music 导入

把 Apple Music 喜欢歌曲导出为 CSV / TSV / TXT，放到 `data/apple.csv`，或者直接在 Web UI 里上传/粘贴。表头支持常见中英文字段：

- 歌名：`title` / `name` / `song` / `歌曲` / `名称`
- 歌手：`artist` / `artists` / `singer` / `歌手` / `艺术家`
- 专辑：`album` / `专辑`
- 时长：`duration` / `time` / `时长`

也可以提供 JSON 数组，每项包含 `title`、`artists`、`album`、`durationMs`。

如果 Apple Music Windows 导出不方便，也可以在 Web UI 里打开本地 Edge 登录窗口，进入喜欢歌曲页面后抓取当前页面列表。

可选导出路径：

- Apple Music Windows 里，“喜欢”的歌曲会出现在 `Favorite Songs` 歌单。可先选中这个歌单。
- 如果你的 Windows 版 Apple Music 有导出菜单，选 `File > Library > Export Playlist`，保存为文本文件。
- 如果新版 Apple Music Windows 没有导出菜单，用 iTunes for Windows 同步资料库后导出：Apple 官方 iTunes 文档支持 `File > Library > Export Playlist`，并可导出 `Text files`。
- 如果你在 Mac 上，Music app 也有类似的 `File > Library > Export Playlist`；导出的文本通常是制表符分隔，Web UI 已支持。

## Cookie

为了避免把凭据写进命令历史，推荐放到本地忽略文件：

```powershell
Set-Content -Encoding UTF8 .\data\qq.cookie "uin=...; qm_keyst=...;"
Set-Content -Encoding UTF8 .\data\netease.cookie "MUSIC_U=...;"
```

这两个文件已经被 `.gitignore` 忽略。不要把完整 cookie 发到聊天窗口。

## 常用命令

```powershell
# 只检查配置和本地导入文件
npm run check

# 拉取三方快照；没配置 cookie 的平台会跳过
npm run snapshot -- --apple .\data\apple.csv --qq-cookie .\data\qq.cookie --netease-cookie .\data\netease.cookie

# 基于快照生成匹配报告
npm run match
```

也可以先用样例验证：

```powershell
npm run snapshot -- --apple .\examples\apple.sample.csv
```

输出：

- `data/apple.json`
- `data/qq.json`
- `data/netease.json`
- `reports/missing.md`
- `reports/matches.json`

## 当前策略

- 三个平台的收藏取并集，作为目标统一曲库。
- 某首歌只在一个或两个平台存在时，默认认为应该补到缺失平台，不再逐平台确认“补/不补”。
- 人工判断重点放在两类问题：低置信候选是否应该合并、已合并条目是否其实是不同版本。
- 版本疑点会关注 `Live`、`Cover`、`Acoustic`、`Piano`、`Instrumental`、`Remix`、`Remaster`、`Movie Edit`、`TV Size`、`Album Version`、`Single Version`、`Off Vocal` 等标记和时长差。
- DeepSeek 建议只作为辅助，不会自动替你确认；最终选择保存在本地 `data/unified-decisions.json`。
- 第一版不处理删除，不自动改收藏状态。

## Git / 隐私

仓库可以直接初始化为 git 项目。`.gitignore` 默认排除了 `data/*.cookie`、平台快照、报告、浏览器 profile、日志和 `.env*`，避免把个人曲库、cookie、API key 提交出去。
