# Provider Setup And Troubleshooting

`music-likes-sync` is local-first. Provider credentials are read from local files or environment variables and must never be committed, pasted into issues, or uploaded in logs.

## Privacy Rules

- Store cookies under `data/` or another ignored local path.
- Do not attach raw `data/` snapshots, `reports/` output, browser profiles, or `.env` files to public issues.
- Redact account IDs, playlist IDs, cookies, tokens, and private library data before sharing diagnostics.
- Prefer summarized output from `npm run check:state` and `npm run migrate:state`.

## Apple Music

Apple Music is the source of truth. The preferred Web UI flow opens a dedicated local Edge profile once, waits for the user to complete Apple's official sign-in, discovers the canonical `Favorite Songs` library playlist through the page's MusicKit session, and imports it without asking the user to navigate to a playlist. CSV / TSV / TXT / JSON remains a fallback.

The mirror model does not delete from Apple Music. Apple is the desired state that QQ Music and NetEase Cloud Music should follow.

The dedicated profile lives under `data/apple-edge-profile`. Later refreshes reuse that profile and the saved Favorite Songs source in headless Edge, so a valid Apple session does not open a visible window. Apple browser capture requests catalog `artwork` and public `previews` together with title, artist, album, duration, and ISRC. Older local snapshots can be refreshed from the Apple catalog by song id. Artwork is normalized to a fixed HTTPS image URL; public preview audio is used only for user-initiated comparison and is never sent to AI.

The first browser import also queries Apple's catalog-equivalents filter for localized metadata. Set `APPLE_STOREFRONT` to the account's two-letter source storefront (`us` by default). `APPLE_EQUIVALENT_STOREFRONTS` controls the comma-separated evidence storefronts and defaults to `cn,hk,tw,jp,kr`. Same-ISRC equivalents are authoritative; different-ISRC regional substitutes can provide aliases only when duration and version cues remain compatible. Results are cached under `data/` and never include Apple credentials.

## QQ Music

QQ Music uses a local Web API adapter.

Recommended credential flow:

1. Open the Web UI.
2. Click QQ QR login. The backend opens Tencent's normal `https://y.qq.com/` login page in a headless dedicated Edge profile under `data/qq-edge-profile`.
3. The Web UI displays the QQ and WeChat QR images already loaded by that official page. The image is copied from the browser frame; it is not regenerated and its short-lived session remains only in memory.
4. Scan either QR and confirm on the phone. The Web UI polls the same browser profile, reads local `qq.com` cookies through the Chrome DevTools Protocol, saves a normalized write-capable cookie to `data/qq.cookie`, then refreshes the QQ snapshot automatically.
5. On a local desktop, "Use local quick login" opens the same dedicated profile visibly so Tencent's own QQ / WeChat quick-login options remain available.

When a saved credential exists, the connection screen shows the connected state and playlist action without rendering QR or local quick-login controls. The health-check action validates and reuses that credential first. A fresh QR and the visible Tencent quick-login fallback appear only when no reusable credential is available; the last validated local credential remains available until a replacement login succeeds.

Manual cookie paste and manual re-capture are still supported as fallbacks, but they should not be the primary open-source UX.

Recommended local cookie file:

```powershell
Set-Content -Encoding UTF8 .\data\qq.cookie "uin=...; qm_keyst=...;"
```

Useful cookie fields:

- `uin`: required for identifying the account.
- `wxuin`: used as `uin` when `login_type=2`.
- `qm_keyst`, `qqmusic_key`, or `p_skey`: commonly needed for write operations.

Why the QR flow uses Tencent's page instead of a copied QR protocol:

- QQ Music has official login / authorization products for approved integrations, but the local mirror workflow in this project currently uses QQ Music Web session APIs rather than a public personal-library OpenAPI contract.
- The project does not copy or independently poll Tencent's `ptqrshow` / `ptqrlogin` protocol; it lets the official page own that implementation.
- Browser-based login lets QQ Music own QR expiry, phone confirmation, OAuth redirects, and account-risk checks while still giving the local UI an embedded QR experience.
- The QR image and polling stay in one official-page browser session. The frontend receives only transient PNG data and a random expiring session key, never cookies or tokens.
- Later snapshot refreshes reopen the dedicated profile in headless mode and refresh `data/qq.cookie` before using the provider API. A visible window is used only when the user explicitly chooses quick login.

Current QQ API surface after a cookie exists:

- User playlists: the current primary path is `music.musicasset.PlaylistBaseRead / GetPlaylistByUin` through `musicu.fcg`; `fcg_user_created_diss` remains a compatibility fallback. The local UI exposes only sanitized playlist metadata through `GET /api/qq/playlists`.
- Playlist tracks: the current primary path is paginated `music.srfDissInfo.aiDissInfo / uniform_get_Dissinfo`; the older `fcg_ucc_getcdinfo_byids_cp.fcg` and `fcg_musiclist_getmyfav.fcg` paths remain compatibility fallbacks.
- Playlist detail: `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg`
- Playlist map / fallback ids: `https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg`
- Search, numeric-id add, and numeric-id delete: `https://u.y.qq.com/cgi-bin/musicu.fcg` with `music.musicasset.PlaylistDetailWrite` / `AddSonglist` and `DelSonglist`.
- Mid-only add fallback: `https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg`
- Legacy delete fallback by numeric song id: `https://c.y.qq.com/qzone/fcg-bin/fcg_music_delbatchsong.fcg`
- Review media: album art is derived from the returned album mid. The provider reads song details first when necessary because QQ's public song `mid` can differ from `file.media_mid`, then requests the authenticated `vkey.GetVkeyServer / CgiGetVkey` URL for the real audio file. The signed URL stays in memory and an empty `purl` is shown as a copyright / membership / region limitation.

Common playlist identifiers:

- `201`: QQ Music "liked" playlist / "我喜欢".
- `dirid`: writable playlist id used by add/delete calls. For "我喜欢", use `201`.
- `tid`, `dissid`, or `id`: public playlist identifiers used by detail reads. The provider resolves a supplied `dirid` to `tid` before reading tracks.

When a command asks for `--playlist-id` for QQ Music, prefer the writable `dirid`. The live validation path accepts the same value and resolves the playlist before add/remove checks.

Troubleshooting:

- `QQ Cookie 中没有 uin/wxuin`: refresh the cookie after logging in, and confirm it contains `uin` or `wxuin`.
- `缺少 QQ 音乐目标歌单 dirid`: pass `--playlist-id 201` for the liked playlist or the `dirid` of a disposable playlist.
- If "我喜欢" cannot be found, use the UI's QQ playlist ID panel or `GET /api/qq/playlists` locally to confirm the account returns `dirid=201` and a non-empty `tid`.
- Mid-only tracks can be added by `mid`, but removal requires a numeric QQ song id. Mid-only removal is intentionally blocked instead of guessed.
- If a write response looks ambiguous, rely on the post-write playlist verification result rather than the raw provider response.

## NetEase Cloud Music

NetEase Cloud Music uses `@neteasecloudmusicapienhanced/api`.

Recommended credential flow:

1. Open the Web UI.
2. Click NetEase QR login.
3. The backend calls `login_qr_key`, then `login_qr_create({ qrimg: true })`.
4. The UI displays the returned QR image and polls `login_qr_check`.
5. Status `801` means waiting for scan, `802` means scanned and waiting for confirmation, `803` means confirmed. On `803`, the returned cookie is saved to `data/netease.cookie`.

This is already the preferred flow because the dependency exposes the QR primitives directly and the resulting cookie works with the same read/write API calls used by snapshots and live validation. The Web UI saves the cookie and refreshes the NetEase snapshot after login succeeds.

Recommended local cookie file:

```powershell
Set-Content -Encoding UTF8 .\data\netease.cookie "MUSIC_U=..."
```

Useful cookie fields:

- `MUSIC_U`: normally required for authenticated reads and writes.

Current NetEase API surface after a cookie exists:

- Login state / user id: `login_status`
- Liked-song ids: `likelist`
- User playlists / liked-playlist identity: `user_playlist`
- Song details: `song_detail`
- Playlist tracks: `playlist_track_all`
- Search: direct `https://music.163.com/api/search/get`, or dependency `search` / `cloudsearch`
- Playlist creation: `playlist_create`
- Add/delete tracks: `playlist_tracks`
- Review media: artwork uses `al.picUrl`. Playback prefers `song_url_v1` at `standard` quality and falls back to `song_url` when the installed dependency cannot initialize its `xeapi` key; no unblock source is enabled.

## Human Review Media

- The review screen compares the Apple source, QQ candidate or existing version, NetEase candidate or existing version, and up to two alternatives per target.
- Covers must come from provider metadata. If no cover exists or an image fails, the UI shows a neutral music-note placeholder instead of a demo album.
- Audio is optional evidence for a person. It is never autoplayed, uploaded, transcribed, or included in model / Agent prompts.
- When requested by the user, FFmpeg's Chromaprint muxer creates an in-memory fingerprint for the Apple excerpt and selected target stream. A high-confidence match supplies a source-relative seek offset; low-confidence audio remains explicitly unaligned. Fingerprints, signed URLs, and audio bytes are never persisted.
- The browser uses one player, preserves the logical source position while switching aligned versions, and stops each audition after at most 30 seconds or at the end of the common aligned interval. Provider restrictions degrade to a clear unavailable state without blocking the rest of the review flow.
- `POST /api/sync/media` accepts only an operation and role from the current preview. `alignWithSource = true` is valid only within that operation and runs local fingerprinting on demand. The route is not a generic media proxy and never returns cookies.

Common playlist identifiers:

- NetEase playlist ids are numeric ids shown in playlist URLs.
- Normal liked-song snapshots discover the owned playlist with `specialType = 5` through `user_playlist`, so ordinary users do not need to find or enter the liked-playlist id manually.
- `--playlist-id` should be the disposable target playlist id for add/delete validation.

Troubleshooting:

- If login status cannot determine a user id, refresh the cookie and verify `MUSIC_U` is present.
- If disposable playlist creation fails with a title-length error, retry with a short name such as `MLS NE 20260707`.
- NetEase search and write endpoints may rate-limit. The provider has retry/backoff behavior for search; wait before retrying failed live validation.
- Use a disposable playlist for mutation tests. The validator refuses to mutate when every searched candidate is already present.

## Live Provider Validation

Live validation mutates a real account. Use only disposable playlists.

After logging in through the local Web UI, the advanced settings screen can run the same validation without setting environment variables. Select QQ Music or NetEase Cloud Music, enter a search query for a temporary test track, optionally provide a disposable playlist id, and type `DISPOSABLE_PLAYLIST`. The UI writes the local strict-gate report on success and only displays a sanitized summary.

Required environment:

```powershell
$env:MUSIC_LIKES_SYNC_LIVE_VALIDATE = "1"
$env:MUSIC_LIKES_SYNC_LIVE_CONFIRM = "DISPOSABLE_PLAYLIST"
$env:MUSIC_LIKES_SYNC_LIVE_TARGET = "qq" # or "netease"
$env:MUSIC_LIKES_SYNC_LIVE_QUERY = "artist title"
```

Optional environment:

```powershell
$env:QQ_COOKIE_FILE = "C:\path\to\qq.cookie"
$env:NETEASE_COOKIE_FILE = "C:\path\to\netease.cookie"
$env:MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID = "existing-disposable-playlist-id"
$env:MUSIC_LIKES_SYNC_LIVE_PLAYLIST_NAME = "music-likes-sync disposable validation"
```

If `MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID` is omitted, the validator creates a disposable playlist through the target provider adapter, uses it for the add/remove check, and leaves it in the account for manual inspection and cleanup.

Run:

```powershell
npm run validate:live
```

For release evidence, write the sanitized validation report:

```powershell
npm run validate:live -- --write-report
```

The validator snapshots the target playlist, picks a searched candidate that is not already present, adds it, verifies the post-add snapshot, removes it, and verifies the post-remove snapshot.

## Diagnostics

Use these before sharing a report:

```powershell
npm run check
npm run check:state
npm run migrate:state
npm run smoke:http
```

Use `--json` only after reviewing and redacting the output.
