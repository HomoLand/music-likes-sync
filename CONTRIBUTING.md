# Contributing

Thanks for helping make `music-likes-sync` safer and more useful.

This project is local-first and can touch real music accounts. Keep changes conservative, testable, and explicit about whether they are read-only or mutating.

## Development Setup

```powershell
npm install
npm run verify
```

Node.js 20 or newer is required. The Dockerfile and CI also exercise Node.js 24.

## Local Validation

Run these before opening a pull request:

```powershell
npm run check:release
```

Or run the individual gates:

```powershell
npm run check:ci
npm run check:privacy
npm run verify
npm run migrate:state
npm run smoke:package
npm run smoke:fresh-install
npm run validate:live
npm run audit
npm run smoke:http
npm run smoke:agent-mcp
npm run smoke:ui
npm run smoke:docker
```

`npm run validate:live` is safe by default because it skips unless explicitly enabled. Do not enable live mutation against a personal playlist. Use only disposable QQ Music and NetEase Cloud Music playlists.

Docker may be unavailable on some local machines. In that case `npm run smoke:docker` performs static checks and reports a skip. A release machine or CI runner must pass:

```powershell
npm run smoke:docker -- --require-docker
```

Before publishing a release, also run `npm run validate:live -- --write-report` for both QQ Music and NetEase Cloud Music disposable playlists, then run:

```powershell
npm run check:release:strict
```

## Product Rules

- Apple Music Favorite Songs is the only desired state.
- QQ Music and NetEase Cloud Music are mirrors, not peer sources.
- Add execution and delete execution must stay separate in CLI, HTTP, UI, tests, and docs.
- Unresolved additions must be blocked, not counted as successful work.
- `review` operations must not mutate providers automatically.
- Deletions must keep the explicit `REMOVE QQ` or `REMOVE NETEASE` confirmation gate.
- Live provider validation must use disposable playlists and verify before / after snapshots.

## Privacy Rules

Never commit, paste, or attach:

- Cookies, API keys, auth headers, session tokens, or `.env` files.
- Raw `data/` state files from a real library.
- `reports/` output from a real account.
- Browser profiles or cache folders.
- Full logs that include provider responses with private account data.

When filing an issue, redact identifiers and prefer the summarized output from:

```powershell
npm run check:state
npm run migrate:state
```

Use `--json` only when the output has been reviewed and redacted.

## Pull Request Shape

Good pull requests include:

- A short summary of the product behavior changed.
- The exact validation commands run.
- Notes on whether the change is read-only, dry-run only, or mutating.
- Screenshots only when UI behavior changed and they contain no private data.

Keep unrelated refactors out of functional changes. If provider behavior is uncertain, put it behind an explicit dry-run or live-gated validation path.
