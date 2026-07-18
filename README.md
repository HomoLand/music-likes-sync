# music-likes-sync

[中文说明](README.zh-CN.md)

`music-likes-sync` is a local-first playlist reconciliation tool for people who want one canonical liked-song list across Apple Music, QQ Music, and NetEase Cloud Music.

The open-source direction is simple: Apple Music Favorite Songs / Liked Songs is the source of truth. QQ Music and NetEase Cloud Music are mirrors. The tool snapshots each platform, builds a deterministic mirror plan, resolves target-platform catalog IDs for missing Apple tracks, dry-runs the result, and only then applies additions or confirmed deletions.

## Current Status

Stable today:

- Connect Apple Music once through its official page, automatically discover Favorite Songs, and silently refresh it from a persistent local Edge profile; file import remains a fallback.
- Connect QQ Music with embedded QQ / WeChat QR images from Tencent's official login page, or use the page's local quick-login options; NetEase Cloud Music uses its QR flow.
- Fetch QQ Music and NetEase Cloud Music snapshots with locally stored credentials that are never returned to the frontend.
- Normalize and match tracks across Apple Music, QQ Music, and NetEase Cloud Music.
- Build the legacy unified-library review surface for low-confidence matches and version conflicts.
- Build a new Apple-source-of-truth mirror plan with `keep`, `add`, `remove`, and `review` operations.
- Resolve mirror `add` operations against the target platform catalog before execution.
- Persist manual mirror `review` decisions and rebuild plans from snapshots so decisions remain reversible.
- Dry-run mirror plans, execute resolved additions, and execute deletions only after explicit confirmation.
- Track mirror executions with deterministic run IDs and idempotency keys so duplicate or interrupted runs are auditable.
- Refresh target snapshots and regenerate the mirror plan to produce post-run convergence checks.
- Run live provider validation with disposable-playlist safeguards that choose a candidate absent from the target playlist and verify snapshots after add and remove.
- Surface stale snapshots and post-run convergence status in the Web UI.
- Configure guarded automatic sync from a dedicated screen: Apple-canonical mirrors can start without a historical baseline, while baseline-dependent policies remain gated; ready additions can execute automatically, deletion signals stay pending for manual confirmation, and run history is bounded and sanitized.
- Validate local mirror state with `npm run check:state`.
- Keep GitHub Actions release gates aligned with `npm run check:ci`.
- Run local tests and syntax checks with `npm run verify`.

Not release-complete yet:

- Real-platform add/delete verification is still gated to local test playlists.
- Docker build / run smoke still needs to pass on a Docker-capable release machine.
- Version 2 state migrations need concrete migration helpers when the next schema is introduced.

## Product Model

- Apple Music Favorite Songs is the only trusted desired state.
- QQ Music and NetEase Cloud Music are target mirrors.
- A sync cycle starts by generating an immutable mirror plan.
- `keep` means the target already has a confident match.
- `add` means Apple has a track that the target does not have; the target catalog ID must be resolved first.
- `remove` means the target has a track that Apple does not have.
- `review` means the matcher found a low-confidence, duplicate, version-sensitive, or reverse-only relationship that should not be mutated automatically.
- Deterministic matching builds target-localized search queries from trusted Apple storefront equivalents and explicit aliases, ranks the full candidate set, and combines artist identity, recording fingerprints, provider album positions, release dates, full Chinese/Japanese character folding, and score margins. One-to-two-second duration drift is treated as provider rounding, while conflicting version cues or ISRCs still block automatic merging.
- AI reviews only the remaining ambiguous relationships from minimized evidence. Its output is an auditable suggestion and cannot bypass ISRC, version, duplicate, write, or deletion gates.
- Manual `review` decisions are stored locally. `keep` treats the reviewed target as the Apple match; `separate` rebuilds the plan into add and / or remove operations while preserving the destructive confirmation gate.
- Deletion is destructive and requires both a dry-run and an explicit confirmation string: `REMOVE QQ` or `REMOVE NETEASE`.
- Delete operations require a target track `id`; QQ mid-only tracks are blocked instead of being guessed or submitted.
- Real mirror execution writes a `running` checkpoint before provider mutation. A later retry with the same idempotency key resumes the checkpoint; a completed duplicate is skipped.

## Install

```powershell
# From a source checkout:
cd music-likes-sync
npm install
npm run verify
```

Node.js 20 or newer is required. Aligned cross-platform audition also requires an FFmpeg build with the Chromaprint muxer (`ffmpeg -hide_banner -h muxer=chromaprint`). The Docker image includes both. The Dockerfile currently uses Node 24.

## Web UI

```powershell
# From an npm install / npx workflow:
npx music-likes-sync web

# From a source checkout:
npm run web
```

Open `http://127.0.0.1:4319`.

The Web UI port must be an integer from `1` to `65535`; invalid `PORT` or `--port` values fail before runtime state directories are created.

The UI supports:

- One-time Apple Music official login with automatic Favorite Songs discovery and background refresh; file import remains available.
- Embedded QQ / WeChat QR login from Tencent's official page, local QQ / WeChat quick-login fallback, and NetEase QR login, with credentials stored only under ignored local state.
- Platform snapshot refresh.
- Legacy unified-library review and AI-assisted review.
- Apple -> QQ / NetEase mirror plan generation.
- Mirror add-candidate resolution.
- Mirror operation workbench with add / remove / review / blocked filters and current-page bulk review actions.
- Manual mirror review controls for same-track, separate-track, and clear-decision workflows.
- Snapshot freshness and convergence health for the active mirror plan.
- Inline add-resolution alternatives for catalog-review cases.
- Mirror dry-run.
- Separate mirror-add and mirror-delete execution paths.
- In-app deletion confirmation with plan target, delete count, and exact confirmation text.
- Post-run convergence check that can refresh the target snapshot and rebuild the Apple-source-of-truth plan.
- Automatic-sync readiness, schedule, target selection, immediate dry-run check, additions-only execution, and sanitized run history.
- Consent-gated AI draft review for already searched low-confidence addition candidates; AI suggestions never become platform writes without a separate user decision and controlled executor.
- Human source / target version audition with real artwork, local Chromaprint alignment, position-preserving A/B switching, and durable same-version / different-version decisions; optional identity AI drafts remain advisory and survive preview regeneration.

## CLI

```powershell
# Verify the installed package.
npx music-likes-sync --version

# Inspect local state and credential files.
npm run check

# Import Apple liked songs and optionally fetch QQ / NetEase snapshots.
npm run snapshot -- --apple .\examples\apple.sample.csv

# Build the legacy comparison report.
npm run match

# Build an Apple-source-of-truth mirror plan.
npx music-likes-sync mirror-plan --target qq
npx music-likes-sync mirror-plan --target netease

# Resolve target catalog IDs for pending additions.
npx music-likes-sync mirror-resolve --limit 50 --search-limit 12

# Save manual review decisions. Use --items for a JSON batch.
npx music-likes-sync mirror-decision --action keep --key "<decision-key>"
npx music-likes-sync mirror-decision --action separate --items decisions.json

# Dry-run the latest mirror plan. This never mutates the target platform.
npx music-likes-sync mirror-apply

# Execute only resolved additions.
npx music-likes-sync mirror-apply --add-only --execute --playlist-id <target-playlist-id>

# Execute only deletions. The confirmation string is intentionally explicit.
npx music-likes-sync mirror-apply --remove-only --execute --confirm "REMOVE QQ" --playlist-id <target-playlist-id>

# Refresh the target snapshot and regenerate the mirror plan to prove convergence.
npx music-likes-sync mirror-convergence --refresh-target --playlist-id <target-playlist-id>
```

Use `--json` with the mirror commands for machine-readable output.

### Optional Agent / MCP

For Hermes or another local MCP client, expose the read-only Agent tools over stdio:

```powershell
npx music-likes-sync agent-mcp
```

The MCP adapter reuses the same permission gate as the Web API. It can read sanitized library summaries, sync previews, per-track sync evidence, baseline diffs, review queues, profiles, similar tracks, recommendations, save local shortlist drafts, and draft operations, but it cannot read cookies, access AI API keys, expose provider track ids in track-evidence results, or directly add/delete provider tracks.

See [docs/AGENT_MCP_SETUP.zh-CN.md](docs/AGENT_MCP_SETUP.zh-CN.md) for Hermes / MCP client configuration and sanitized trace audit details.

## Data And Secrets

Runtime files live under `data/` and `reports/` in the current working directory. Set `MUSIC_LIKES_SYNC_HOME` to use a different runtime directory. These folders are intentionally ignored by Git in the source checkout because they can contain private libraries, cookies, generated plans, and run logs.

Do not paste full cookies into issues, PRs, or chat logs.

Provider-specific cookie fields, playlist id semantics, live validation setup, and troubleshooting notes are in [docs/PROVIDERS.md](docs/PROVIDERS.md). After logging in locally, the Web UI's advanced settings screen can also run the same disposable-playlist live validation with an explicit `DISPOSABLE_PLAYLIST` confirmation; the page only shows the sanitized result.

## Environment

Copy `.env.example` to `.env` if you need optional integrations:

```powershell
Copy-Item .\.env.example .\.env
```

DeepSeek is optional and only used for AI-assisted review when explicitly invoked.

## Architecture

- `src/mirror-sync.js`: pure mirror-plan domain model.
- `src/mirror-resolve.js`: target catalog resolution for mirror additions.
- `src/mirror-apply.js`: dry-run and mutation contract for additions and deletions.
- `src/state-schema.js`: versioned local mirror plan, run-log, and review-decision state validation.
- `src/auto-sync.js`: automatic-sync settings, schedule, and sanitized history domain helpers.
- `src/run-lock.js`: heartbeat-backed cross-process execution lock for scheduled writes.
- `src/sync-backup.js`: compact checksummed pre-delete recovery points and additions-only restore planning.
- `src/workflow.js`: file-backed application workflow and run logs.
- `src/server.js`: local HTTP API and static Web UI server, reachable through `music-likes-sync web`.
- `src/agent-mcp.js`: optional stdio MCP adapter for Hermes or other local Agent runtimes.
- `src/providers/qq.js`: QQ Music snapshot, search, add, and delete adapters.
- `src/providers/netease.js`: NetEase Cloud Music snapshot, search, add, and delete adapters.
- `web/`: local browser UI.
- `web-app/`: React + Vite + TypeScript ordinary-user UI served as the default Web entry, currently covering app state, sync mode selection, read-side sync check, sync preview loading, add-candidate lookup / decisions, tombstone deletion-signal review, local AI profile / similar / recommendation actions, natural-language Agent tool chat, consent-gated provider self-test, Agent audit refresh / feedback with local-draft trace labels, advanced settings diagnostics, and controlled write execution controls.
- `test/`: unit and contract tests.

More detail is in [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md). State schema details are in [docs/STATE.md](docs/STATE.md). Provider setup details are in [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Contributing And Security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It defines the validation matrix, mutation-safety rules, and privacy requirements for issues and logs.

Do not report security-sensitive problems in public issues. Use [SECURITY.md](SECURITY.md) for the disclosure policy, and never share raw cookies, `.env` files, `data/` snapshots, generated reports, or browser profiles.

## Validation

```powershell
npm run check:release
```

Or run individual gates:

```powershell
npm run check:syntax
npm run check:web-app
npm run check:ci
npm run check:privacy
npm run check:state
npm run migrate:state
npm test
npm audit --omit=dev
npm run smoke:http
npm run smoke:web-app
npm run smoke:react-ui
npm run smoke:agent-mcp
npm run smoke:ui
npm run smoke:package
npm run smoke:fresh-install
npm run smoke:docker
npm run verify
```

Current automated coverage includes:

- Mirror plan construction.
- Low-confidence and duplicate-match safety behavior.
- Mirror add resolution.
- Human-labeled deterministic match evaluation with zero unsafe auto-accepts.
- Read-only live match shadow runs and cross-recording target-collision audits.
- Dry-run and destructive-confirmation contracts.
- Add-only execution separation from delete execution.
- Mirror run idempotency keys and operation-key propagation.
- Isolated HTTP smoke coverage for mirror plan generation, batch review decisions, add-only / remove-only dry-runs, blocked QQ mid-only remove dry-runs, and convergence checks.
- Mirror state schema validation.
- State migration dry-run and write-with-backup helper for legacy unversioned mirror state.
- Live validation orchestration tests for disposable-playlist creation, candidate selection, and post-add / post-remove snapshot verification.
- GitHub Actions workflow checks for Node 20 / 24, package smoke, fresh-install smoke, HTTP smoke, React UI smoke, legacy UI smoke, Docker smoke, audit, and live-validation skip behavior.
- React + Vite + TypeScript frontend shell type-check and production build through `npm run check:web-app`.
- React app HTTP smoke for the default `/` React entry, `/app/` compatibility alias, `/workbench/` compatibility workbench, SPA fallback, built assets, read-side app-state / sync-check / sync-preview API wiring, add-candidate lookup / decisions, tombstone deletion-signal decisions, controlled add dry-run / real-write live-validation blocking, delete confirmation / real-delete live-validation blocking, convergence summary checks, local AI profile / similar / recommendation contracts, AI consent guards, Agent session redaction, live-validation / AI-provider advanced diagnostics, missing assets, and path traversal through `npm run smoke:web-app`.
- React browser UI smoke for the default `/` desktop and mobile ordinary-user entry, sync preview, controlled write guards, local AI profile / similar search, natural-language Agent chat, Agent audit refresh, local-draft shortlist trace display, advanced diagnostics, and horizontal overflow checks through `npm run smoke:react-ui`.
- Manual review compares real Apple / QQ / NetEase artwork and user-initiated clips of at most 30 seconds. Audio fingerprints and signed media URLs stay in process memory, are never persisted or uploaded, and are never sent to AI.
- Privacy smoke for public Git candidates and npm package contents, including cookie/API-key placeholders and forbidden runtime paths.
- Desktop and mobile UI smoke coverage for mirror controls, operation filters, manual review controls, stale snapshot / convergence health, convergence control, add alternatives, and executable delete confirmation.
- npm pack dry-run smoke that enforces the public package whitelist, checks the CLI `bin` target, and excludes local state, reports, cookies, browser profiles, and env files.
- Fresh-install smoke that copies the npm pack file list into a temporary package directory, installs the generated tarball into a separate temporary project, verifies the installed `music-likes-sync` bin and Web UI entrypoint use the caller working directory for runtime state, runs the installed package's `npm test`, validates empty local state, imports `examples/apple.sample.csv`, and confirms QQ / NetEase skip safely when cookies are absent.
- Dockerfile packaging smoke with optional build / run validation.
- Provider delete no-op behavior.
- Low-cardinality observability route labels.

Before a public release, also run the live-gated provider validation on disposable QQ Music and NetEase Cloud Music test playlists. See [docs/VALIDATION.md](docs/VALIDATION.md).

For an actual release, save Docker and live-provider evidence, then run the strict evidence gate:

```powershell
npm run smoke:docker -- --require-docker --write-report
npm run validate:live -- --write-report
npm run check:release:strict
```

If the release workstation does not have Docker, fetch the `docker-smoke-report-node-24` GitHub Actions artifact from the Node 24 CI job, then run the strict gate locally with the live-provider reports:

```powershell
gh workflow run ci.yml --ref <branch>
npm run fetch:docker-report -- --repo owner/name
npm run check:release:strict
```

## License

MIT
