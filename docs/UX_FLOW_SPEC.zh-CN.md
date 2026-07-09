# Ordinary User UX Flow Spec

Last updated: 2026-07-08

This document defines the ordinary-user product flow for `music-likes-sync`. It is the design contract to confirm before implementation. The goal is to hide implementation concepts such as snapshots, mirror plans, dry-runs, thresholds, cookies, tombstones, and JSON behind clear user-facing workflows.

## Product Shape

The app should feel like a local music library sync assistant, not a developer console.

Primary user promise:

> Connect your music platforms, choose how likes should sync, review risky changes, then confirm execution.

The main flow is:

1. Home overview.
2. Connect platforms.
3. Choose sync mode.
4. Review sync preview.
5. Use AI music assistant.

Advanced settings hold everything technical: cookies, thresholds, model keys, raw JSON, export links, debug logs, and deep provider diagnostics. The ordinary AI assistant may show a simple connection self-test, but it must not expose keys or raw provider payloads.

## Navigation

Use a stable left navigation rail:

- `概览`
- `连接平台`
- `同步方式`
- `同步预览`
- `AI 助手`
- `高级设置`

The first five items are ordinary-user surfaces. `高级设置` is visually separated and lower priority.

## Screen 1: 概览

Purpose:

- Tell the user whether the system is ready.
- Show the selected sync mode.
- Start a sync check from one obvious action.

Primary content:

- Header: `你的音乐库`
- Platform states:
  - `Apple Music 已读取 844 首`
  - `QQ 音乐 已连接 2028 首`
  - `网易云音乐 已连接 1903 首`
- Current sync mode:
  - `当前同步方式：以 Apple Music 为准`
- Primary action:
  - `开始同步检查`
- Latest result:
  - `准备新增 85 首`
  - `需要确认 51 首`
  - `可能删除 3 首，需要单独确认`
- Next step:
  - `先处理需要确认的歌曲`

Empty state:

- If no platforms are connected, show one action: `连接音乐平台`。

Error state:

- If credentials are stale, show: `QQ 音乐需要重新登录`。
- Do not mention cookie in the main surface.

Acceptance criteria:

- A new user can identify the next action within five seconds.
- No technical words appear on this screen.
- Delete risk is visible, but no delete action is available on this screen.

## Screen 2: 连接平台

Purpose:

- Help ordinary users connect Apple Music, QQ Music, and NetEase Cloud Music with the lowest possible effort.

Primary content:

- Apple Music:
  - Status: `已读取 / 未读取 / 需要更新`
  - Actions: `导入喜欢歌曲`, `从浏览器读取`
- QQ 音乐:
  - Status: `已连接 / 需要重新登录 / 只能读取`
  - Actions: `扫码登录`, `查看我的歌单`
- 网易云音乐:
  - Status: `已连接 / 等待扫码 / 需要重新登录`
  - Actions: `扫码登录`, `重新生成二维码`

Secondary content:

- Simple credential health legend:
  - `已连接`: can read and write.
  - `只能读取`: can inspect, cannot sync changes.
  - `需要重新登录`: credentials expired.
- Live validation status for writable targets:
  - `真实写入验证已通过`
  - `真实写入验证需更新`
  - `尚未真实写入验证`

Advanced disclosure:

- `手动凭据与调试`
- Contains cookies, raw login diagnostics, provider response excerpts, and playlist id details.

Acceptance criteria:

- The default QQ and NetEase paths do not require manual cookie copy.
- Cookie values are never visible unless the user opens advanced settings.
- The user can tell whether each platform can be read and written.
- The user can see whether a disposable-playlist add/remove check has recently passed, without seeing playlist ids or raw provider diagnostics.

## Screen 3: 同步方式

Purpose:

- Let users choose how likes should flow between platforms using plain-language strategy names.

Modes:

### 以 Apple Music 为准

User-facing copy:

> Apple Music 是标准。QQ 音乐和网易云音乐会跟随它。

Use when:

- The user wants Apple as the canonical source.
- This is the default personal flow.

Behavior:

- Apple-only tracks become additions for QQ / NetEase.
- Target-only tracks are shown as possible deletions.
- Deletions require separate confirmation.

### 合并所有平台

User-facing copy:

> 在任一平台喜欢过的歌，都会补到其他平台。默认不会自动删除。

Use when:

- The user listens on multiple platforms and wants a union of all liked songs.

Behavior:

- Any platform addition enters the unified liked set.
- Missing tracks become additions for other platforms.
- Platform absence is not treated as global deletion.

### 双向同步

User-facing copy:

> 新增和删除都会尝试同步。删除前必须确认。

Use when:

- Advanced users want additions and removals to propagate.

Behavior:

- Requires a saved baseline.
- Platform deletions become delete confirmations.
- Nothing is deleted automatically.

### 只分析，不修改

User-facing copy:

> 只查看差异、画像和推荐，不修改任何平台。

Use when:

- Users want to inspect the library or try AI features safely.

Acceptance criteria:

- The recommended mode for the current user is visually marked.
- Risk level is visible for each mode.
- Technical policy ids are not shown outside advanced settings.

## Screen 4: 同步预览

Purpose:

- Let users understand and approve what will change before any write.

Top buckets:

- `会新增`
- `会保留`
- `需要确认`
- `可能删除`

Default bucket:

- If there are risky items, open `需要确认`.
- If there are possible deletions, keep `可能删除` visible but separate.
- If everything is safe, show `会新增`.

Row content:

- Song title.
- Artist.
- Album, optional.
- Duration, optional.
- Source platform badges.
- Target platform badges.
- AI suggestion:
  - `AI 建议：同一首`
  - `AI 建议：可能是不同版本`
  - `AI 不确定`
- Evidence summary:
  - `时长接近`
  - `ISRC 相同`
  - `外部数据库匹配`
  - `标题相似但版本不同`

Row actions:

- `确认为同一首`
- `不是同一首`
- `稍后处理`

Footer actions:

- `先同步新增`
- `查看可能删除`
- `暂不执行`

Delete bucket:

- Uses a separate confirmation flow.
- Default action is `保留这些歌`.
- Destructive action requires exact confirmation text.

Acceptance criteria:

- Additions and deletions are never mixed into one confirmation.
- AI can suggest, but the user sees why.
- The user can complete safe additions without approving deletions.

## Screen 5: AI 助手

Purpose:

- Provide AI features without exposing model/tool complexity.

Top tabs:

- `AI 连接`
- `同步判断`
- `音乐画像`
- `找相似歌曲`
- `推荐歌单`

### AI 连接

Show the configured provider and model in plain language, plus a single `测试 AI 连接` action.

Rules:

- The button is disabled until the user checks explicit consent.
- The test sends only a minimal JSON-output health-check prompt.
- The result shows pass/fail, provider, model, and token usage summary.
- API keys, raw prompts, raw responses, and provider credentials stay hidden.

### 同步判断

Use AI to explain or batch-suggest review decisions.

Examples:

- `为什么这些歌需要确认？`
- `哪些可能是不同版本？`
- `帮我先判断高置信的歌曲`

### 音乐画像

Show:

- 常听语言。
- 常听风格。
- 最近变化。
- 代表歌手。
- 版本偏好。

### 找相似歌曲

Flow:

1. Pick a seed track.
2. Show similarity dimensions.
3. Show candidates with reasons.
4. Save to shortlist.

### 推荐歌单

Flow:

1. Choose a scenario or prompt.
2. Generate candidates.
3. Exclude already-liked songs.
4. Save shortlist.

Privacy copy:

> AI 只查看必要的歌曲信息，不会直接执行同步。

Acceptance criteria:

- API key, model name, batch size, and raw payload are hidden in advanced settings.
- The connection self-test requires consent and does not send music-library data.
- Recommendations never write to provider platforms automatically.
- Natural-language prompts call the same controlled tools as the built-in UI.

## Terminology Map

Use these labels in the ordinary-user UI:

| Technical term | User-facing term |
|---|---|
| snapshot | 读取音乐库 |
| mirror plan | 同步预览 |
| resolve add | 查找对应歌曲 |
| dry-run | 预检查 |
| review | 需要确认 |
| tombstone | 删除确认 |
| threshold | 高级匹配设置 |
| cookie | 登录凭据 |
| provider mutation | 执行同步 |
| baseline | 上次同步状态 |

## Implementation Guardrails

- Do not place every section inside a card.
- Use full-width grouped surfaces and row separators for lists.
- Keep destructive actions visually and structurally separate.
- Hide advanced controls by default.
- Use stable dimensions for status badges, action buttons, and bucket counters.
- Keep mobile layouts single-column and avoid horizontal overflow.
- Use icons for common actions where clear, with accessible labels.

## Confirmation Checklist

Before implementation, confirm:

- The five screens are the right product structure.
- The default sync mode is `以 Apple Music 为准`.
- `合并所有平台` defaults to additions only.
- `双向同步` is advanced and deletion-confirmed.
- AI provider settings live in advanced settings.
- Generated mockups are directional only, not final visual design.
