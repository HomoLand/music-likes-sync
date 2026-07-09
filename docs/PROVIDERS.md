# Provider Setup And Troubleshooting

`music-likes-sync` is local-first. Provider credentials are read from local files or environment variables and must never be committed, pasted into issues, or uploaded in logs.

## Privacy Rules

- Store cookies under `data/` or another ignored local path.
- Do not attach raw `data/` snapshots, `reports/` output, browser profiles, or `.env` files to public issues.
- Redact account IDs, playlist IDs, cookies, tokens, and private library data before sharing diagnostics.
- Prefer summarized output from `npm run check:state` and `npm run migrate:state`.

## Apple Music

Apple Music is the source of truth. Import liked songs from CSV / TSV / TXT / JSON, or use the local browser capture flow in the Web UI.

The mirror model does not delete from Apple Music. Apple is the desired state that QQ Music and NetEase Cloud Music should follow.

## QQ Music

QQ Music uses a local Web API adapter.

Recommended credential flow:

1. Open the Web UI.
2. Click QQ QR login. The app opens a dedicated local Edge profile under `data/qq-edge-profile`.
3. Log in on `https://y.qq.com/` with the normal QQ Music page. The page may offer QQ, WeChat, or QQ Music QR login depending on the account and region.
4. Keep the Web UI open. It polls the dedicated browser profile, reads only local `qq.com` cookies through the Chrome DevTools Protocol, saves a normalized write-capable cookie to `data/qq.cookie`, then refreshes the QQ snapshot automatically.

Manual cookie paste and manual re-capture are still supported as fallbacks, but they should not be the primary open-source UX.

Recommended local cookie file:

```powershell
Set-Content -Encoding UTF8 .\data\qq.cookie "uin=...; qm_keyst=...;"
```

Useful cookie fields:

- `uin`: required for identifying the account.
- `wxuin`: used as `uin` when `login_type=2`.
- `qm_keyst`, `qqmusic_key`, or `p_skey`: commonly needed for write operations.

Why not implement raw QQ QR polling as the default:

- QQ Music has official login / authorization products for approved integrations, but the local mirror workflow in this project currently uses QQ Music Web session APIs rather than a public personal-library OpenAPI contract.
- Browser-based login lets QQ Music own the QR / account-risk flow and keeps this project from depending on fragile `ptqrshow` / `ptqrlogin` style internals.
- The project should only add a raw QQ QR mode after live validation proves that the returned cookie contains the same `uin` / `qm_keyst` or equivalent write credentials needed by the add/delete APIs.

Current QQ API surface after a cookie exists:

- User playlists: `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss` with the saved cookie. The local UI exposes the sanitized result through `GET /api/qq/playlists`.
- Playlist detail: `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg`
- Playlist map / fallback ids: `https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg`
- Search, numeric-id add, and numeric-id delete: `https://u.y.qq.com/cgi-bin/musicu.fcg` with `music.musicasset.PlaylistDetailWrite` / `AddSonglist` and `DelSonglist`.
- Mid-only add fallback: `https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg`
- Legacy delete fallback by numeric song id: `https://c.y.qq.com/qzone/fcg-bin/fcg_music_delbatchsong.fcg`

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
- Song details: `song_detail`
- Playlist tracks: `playlist_track_all`
- Search: direct `https://music.163.com/api/search/get`, or dependency `search` / `cloudsearch`
- Playlist creation: `playlist_create`
- Add/delete tracks: `playlist_tracks`

Common playlist identifiers:

- NetEase playlist ids are numeric ids shown in playlist URLs.
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
