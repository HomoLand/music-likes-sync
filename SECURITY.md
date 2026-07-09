# Security Policy

## Reporting A Vulnerability

Do not open a public issue for security-sensitive reports.

If you find a vulnerability, create a private security advisory on GitHub when available, or contact the maintainer privately before publishing details. Include a minimal explanation, affected version or commit, and reproduction steps that do not expose real cookies or account data.

## Sensitive Data

`music-likes-sync` is local-first, but it handles data that can identify a user or mutate music accounts:

- QQ Music and NetEase Cloud Music cookies.
- Apple Music library exports.
- Local `data/` snapshots, mirror plans, review decisions, and run logs.
- Generated reports under `reports/`.
- Browser profiles used for local capture.
- Optional API keys in `.env` files.

Never include these raw files in public issues, pull requests, CI logs, or chat transcripts. Redact account IDs, playlist IDs, cookies, tokens, and private track libraries before sharing diagnostics.

## Mutation Safety

Provider mutations must stay opt-in:

- Normal CI must not set `MUSIC_LIKES_SYNC_LIVE_VALIDATE=1`.
- Live validation must use disposable playlists only.
- Deletions must require the exact `REMOVE QQ` or `REMOVE NETEASE` confirmation string.
- A failed add or remove verification should fail closed and preserve enough local context for debugging.

## Supported Versions

Security fixes target the current `main` branch until the project publishes stable releases.
