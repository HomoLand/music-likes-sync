# Validation Guide

This project has local automated gates, local smoke tests, package checks, Docker checks, and live provider validation.

## Local Automated Gates

These do not contact music platforms and should pass before every PR.

```powershell
npm run check:release
```

`npm run check:release` runs the full local non-destructive release gate. It includes the default live validation skip check and Docker smoke. On machines without Docker, Docker smoke reports a static-check-only skip unless `--require-docker` or `MUSIC_LIKES_SYNC_REQUIRE_DOCKER=1` is used.

For an actual public release, run the strict evidence gate after Docker and live provider validation have been completed:

```powershell
npm run check:release:strict
```

`npm run check:release:strict` is intentionally not part of normal pull-request validation. It fails unless Docker build / run smoke passes, or a fresh Docker smoke evidence report exists, and sanitized live-validation reports exist for both QQ Music and NetEase Cloud Music.

The script's `--skip-docker-check` option is test-only. It is rejected unless `MUSIC_LIKES_SYNC_STRICT_TEST_BYPASS=1` is set by the test suite, and must not be used for release evidence.

Docker evidence must come from a real Docker build/run smoke. Generate it on a Docker-capable machine with:

```powershell
npm run smoke:docker -- --require-docker --write-report
```

This writes `reports/docker-smoke.json`. The strict gate accepts that report only when it matches the current package name/version, was generated within the last 14 days, is not skipped, has passing static checks, has a successful image build, and proves the container answered `/api/state`.

GitHub Actions also runs this command in the Node 24 job and uploads the report as the `docker-smoke-report-node-24` artifact. On a workstation without Docker, fetch that artifact into `reports/docker-smoke.json`, then run the strict gate locally with the live-provider reports:

```powershell
npm run fetch:docker-report -- --repo owner/name
npm run check:release:strict
```

If `remote.origin` points at GitHub, `--repo` can be omitted. Use `--run-id <id>` to pin a specific workflow run, or `--branch <name>` to select the latest successful run on one branch.

The CI workflow also supports manual dispatch. After pushing a branch, trigger it from GitHub Actions or with `gh workflow run ci.yml --ref <branch>`, wait for the Node 24 job to pass, then run `npm run fetch:docker-report`.

If the Docker report is stored outside the default reports directory, pass it explicitly:

```powershell
npm run check:release:strict -- --docker-report C:\path\to\docker-smoke.json
```

The strict gate also rejects live-validation reports that contain credential-shaped keys or values such as cookies, bearer tokens, `MUSIC_U`, or `qm_keyst`.

Saved live-validation evidence must use the current evidence format (`schemaVersion=1`) and current package identity (`tool.name` / `tool.version` must match `package.json`). It must be generated within the last 14 days, and `validatedAt` must not be future-dated. It must prove the full disposable-playlist round trip: each snapshot needs an ISO `fetchedAt`, all snapshots must refer to the validated playlist id, `afterAdd.trackCount` must equal `before.trackCount + 1`, and `afterRemove.trackCount` must return to `before.trackCount`. The validated track presence flags must be `before.containsValidatedTrack=false`, `afterAdd.containsValidatedTrack=true`, and `afterRemove.containsValidatedTrack=false`.

The strict gate validates playlist-id consistency internally, but its console JSON only reports `playlistIdPresent`; it must not print real playlist IDs, user IDs, cookies, provider payloads, or target track IDs.

Both mutation summaries must also be provider-verified: `add.verified=true` and `remove.verified=true`.

Individual gates:

```powershell
npm run check:syntax
npm run check:web-app
npm run check:ai-eval
npm run check:ci
npm run check:privacy
npm run check:state
npm run migrate:state
npm test
npm run audit
npm run smoke:package
npm run smoke:fresh-install
npm run smoke:http
npm run smoke:web-app
npm run smoke:react-ui
npm run smoke:agent-mcp
npm run smoke:ui
npm run smoke:docker
npm run verify
```

`npm run check:ci` validates that the GitHub Actions workflow still runs the expected release gates. It is a source-checkout gate because npm package installs intentionally omit `.github/`. `npm run check:privacy` scans Git public candidates and the npm pack dry-run list for sensitive runtime paths and non-placeholder credential values. `npm run check:state` validates any existing mirror state and policy-driven v1 state files under `data/`, including mirror plans, run logs, manual review decisions, sync policy, sync baseline, sync preview, sync tombstones, policy sync runs, AI provider state, music profile, recommendation shortlists, and Agent sessions. Fresh clones without local state are skipped by default. `npm run check:web-app` type-checks the React + Vite + TypeScript frontend shell and creates a production build under ignored `web-app/dist/`. `npm run check:ai-eval` runs the human-labeled AI evaluation fixtures plus profile, recommendation, explanation, and tombstone risk model-output fixtures without calling an external model. `npm run migrate:state` dry-runs state migration and reports whether any local state would be rewritten; it does not write unless `-- --write` is provided. `npm run verify` runs JavaScript syntax checks, the React frontend shell build gate, state validation, the unit / contract test suite, and the no-model AI evaluation gate. `npm run audit` currently expects zero production vulnerabilities. `npm run smoke:http` starts the Web server against an isolated temporary `MUSIC_LIKES_SYNC_HOME`, seeds Apple / target snapshots, generates a mirror plan, validates ordinary-user app state, sync modes, sync check, sync preview, add-only execution, deletion confirmation, delete-only execution, policy sync run-log creation, batch mirror review decisions, product tombstone batch decisions, add-only / remove-only dry-runs, blocked QQ mid-only remove dry-runs, convergence, metrics, static guards, and JSON body guards without touching local runtime state. `npm run smoke:web-app` builds the React shell, serves it through the real Node server as the default `/` entry with `/app/` kept as a compatibility alias, verifies `/workbench/` still serves the legacy compatibility workbench, verifies SPA fallback and built assets, seeds isolated Apple / QQ / NetEase snapshots, validates `/api/app/state`, runs a read-side `/api/sync/check`, reads `/api/sync/preview`, exercises add-candidate lookup safe-skip behavior, applies local add-candidate accept / skip decisions, applies non-destructive tombstone batch decisions, confirms one global tombstone with exact text, validates controlled add dry-run, validates real add/delete execution remains blocked without live validation, validates exact delete confirmation, validates convergence summaries, validates local AI profile / similar / recommendation contracts, checks model consent guards, checks sanitized Agent session reads, checks live-validation summaries plus guarded `/api/validation/live/run` failure paths stay redacted, checks AI-provider advanced diagnostics stay redacted, and checks missing-asset plus path-traversal guards. `npm run smoke:react-ui` opens the built React default `/` entry in real Chromium on desktop and mobile viewports, verifies navigation, sync preview rendering, controlled write guards, local AI profile / similar search, Agent audit refresh, live-validation confirmation-text gating, advanced diagnostics, and horizontal overflow. `npm run smoke:agent-mcp` starts the real `music-likes-sync agent-mcp` stdio process against an isolated temporary runtime, exercises initialize, tools/list, a safe tools/call, mutation rejection, and sanitized MCP trace persistence. `npm run smoke:package` runs `npm pack --dry-run --json` and fails if the public tarball is missing critical files, includes local state, reports, cookies, browser profiles, non-example env files, or ships a broken npm `bin` target. `npm run smoke:fresh-install` copies the npm pack file list into a temporary package directory, installs the generated tarball into a separate temporary project, runs the installed `music-likes-sync` bin, runs the installed package's `npm test`, starts the installed Web UI through `music-likes-sync web`, verifies runtime state is written under the caller working directory rather than `node_modules/`, verifies source-only gates fail with clear source-checkout guidance, imports `examples/apple.sample.csv`, and verifies QQ / NetEase skip safely when cookies are absent.

## V2 Validation Gates

The policy-driven ordinary-user product extends the current mirror validation gates in slices. Domain and state validation have partial current coverage; HTTP, UI, Agent, and live provider coverage remain release gates before the full product is considered implemented.

Required domain tests:

- `sync-policy` validation for `canonical_mirror`, `union_convergence`, `managed_bidirectional`, and `read_only_analysis`.
- Apple canonical policy summaries must match the existing mirror engine for equivalent snapshots.
- Union convergence must create additions for platforms missing tracks from the unified liked set.
- Read-only analysis must block provider mutations.
- Baseline diff must distinguish platform additions, platform deletion signals, unchanged tracks, and sanitized title / artist / evidence examples without exposing raw diff entries.
- Tombstone lifecycle must cover `confirm_global_delete`, `ignore`, `restore`, `current_platform_only`, and batch non-destructive decisions.
- AI schema validation must reject malformed provider responses and downgrade risky `keep` suggestions.
- AI evaluation fixtures must cover same recording, different version, same-title different song, remix/live/cover, transliteration, missing ISRC, duration conflict, and different ISRC cases with human labels, plus model-output gates for profile summaries, recommendation reranking, ordinary-user explanations, and tombstone risk analysis.
- Agent permission tests must prove Agent tools cannot read cookies, write cookies, call direct add/delete provider adapters, or bypass confirmation.
- Agent per-track evidence tests must prove sync evidence is readable only after a preview exists and does not expose provider track ids, cookies, or API keys.
- Agent baseline diff and review queue tests must prove read-only access does not expose playlist ids, tombstone keys, baseline tokens, cookies, or API keys.
- React UI smoke must exercise natural-language Agent chat and prove the result is displayed as a local tool answer with no provider write path.

Current state validation:

- `data/sync-policy.json`
- `data/sync-baseline.json`
- `data/sync-preview.json`
- `data/sync-tombstones.json`
- `data/sync-runs.json`
- `data/ai-provider-state.json`
- `data/music-profile.json`
- `data/recommendation-shortlists.json`
- `data/agent-sessions.json`

Current HTTP smoke coverage:

- First-run `/api/app/state`.
- `/api/sync/modes` lists the four policies.
- `/api/sync/check` generates a preview without provider mutation.
- `/api/sync/preview` separates additions, keeps, review items, and possible deletions.
- `/api/sync/resolve-additions` searches target catalogs for pending additions without provider mutation and returns sanitized per-target resolution counts.
- `/api/sync/addition-decision` accepts or skips low-confidence add candidates by updating only local `sync-preview`; `/api/sync/addition-decisions` batch accepts / skips explicit operation ids from the visible review set. Accepted candidates still require `/api/sync/execute-additions`.
- `/api/sync/baseline/save` supports convergence-gated baseline saves: HTTP smoke verifies an open preview is rejected when `requireConverged = true`, a converged preview can be saved as the next baseline, and `activateManaged = true` switches app state to `managed_bidirectional`.
- Addition execution and deletion execution are separate endpoints.
- Real addition and deletion execution require fresh live-validation evidence for each written QQ / NetEase target unless an expert explicitly passes `force = true`; dry-runs remain available without live validation.
- Deletion execution fails without prior confirmation.
- Managed ready-add and confirmed-delete dry-runs write sanitized policy entries to `data/sync-runs.json`, expose summary and latest-run fields through `/api/app/state`, report skipped post-write convergence with `skippedReason = "dry_run"`, and allow `/api/sync/convergence` to persist sanitized `sync-preview.convergence`.
- `/api/validation/live` and `/api/app/state.validation.live` summarize saved QQ / NetEase disposable-playlist evidence without exposing playlist ids or credentials.
- `/api/validation/live/run` requires exact `DISPOSABLE_PLAYLIST` confirmation before any provider call, writes local strict-gate evidence only after a successful add/remove round trip, and returns only the sanitized target summary. HTTP smoke covers the no-confirm and missing-credential guard paths without provider mutation.
- `/api/ai/profile`, `/api/ai/similar`, and `/api/ai/recommend` work against isolated local fixture state without provider mutation. `/api/ai/profile` and `/api/ai/recommend` default to deterministic local mode and reject model-assisted summaries / recommendation reranking without consent.
- `/api/ai/provider` stores only non-secret provider preferences, `/api/ai/provider/test` rejects provider calls without consent, `/api/ai/explain` returns deterministic local explanations by default while rejecting model-backed explanations without consent, and `/api/ai/tombstones/analyze` groups deletion signals locally by default while rejecting model-backed batch analysis without consent.
- `/api/agent/tools` lists only read-only credential-free tools, `/api/agent/chat` rejects direct provider mutation-shaped tool requests, `/api/agent/sessions` returns sanitized local trace summaries with read-only / non-mutating / credential-free flags, `/api/agent/trace-feedback` accepts only short feedback labels, and `npm run smoke:agent-mcp` proves `music-likes-sync agent-mcp` works as a real stdio MCP process with sanitized trace persistence.

Remaining HTTP smoke coverage:

- Real Hermes client smoke can exercise the documented stdio MCP config outside the source-checkout test harness.

Required UI smoke coverage:

- Five-screen navigation: overview, connect platforms, sync mode, sync preview, AI assistant.
- Advanced settings hide cookies, thresholds, raw JSON, model keys, debug logs, and provider diagnostics from the ordinary-user path.
- Mobile layout has no horizontal overflow.
- AI consent is required before sending track evidence to an external provider; provider self-test prompts use the same explicit consent rule.
- Profile evidence and recommendation candidates follow the same explicit consent rule before any model-assisted summary or reranking.
- Recommendations and local shortlists do not write to provider platforms automatically; model-assisted recommendation can only summarize and rerank supplied local candidates.
- Agent tool audit UI must show only sanitized tool names, status, summary counts, evidence refs, and short feedback labels; it must not show raw prompts, cookies, API keys, seed titles, free-form private feedback, or provider payloads.

Current UI smoke coverage:

- The ordinary-user bridge mounted from `web/product-app.js` is checked on desktop and mobile.
- The React default `/` replacement path is checked on desktop and mobile with real fixture data, sync preview generation, controlled write guards, local AI actions, Agent audit refresh, advanced diagnostics, and no horizontal overflow.
- Six-screen navigation, mode selection, preview buckets, live validation status display, live-validation run form confirmation gating, preview write-readiness ready / blocked states, baseline diff missing/saved/refresh/example states, recent execution audit empty and completed states, AI capability cards, AI provider consent self-test UI, Agent tool audit display / refresh / feedback, local and model-assisted profile controls, advanced-settings reveal of the legacy workbench, add-resolution controls, low-confidence add candidate single and batch acceptance, preview-item explanations, tombstone review filters, tombstone risk summary, current-filter tombstone batch handling, global-delete confirmation text, managed confirmed-delete execution wiring, convergence status display, convergence-gated baseline save, post-baseline managed-mode activation, and product API wiring for `/api/app/state`, `/api/sync/modes`, `/api/sync/check`, `/api/sync/preview`, `/api/sync/baseline`, `/api/sync/resolve-additions`, `/api/sync/addition-decision`, `/api/sync/addition-decisions`, `/api/sync/baseline/save`, `/api/sync/tombstones`, `/api/sync/convergence`, `/api/sync/execute-deletions`, `/api/validation/live`, `/api/validation/live/run` guard behavior, `/api/agent/sessions`, `/api/agent/trace-feedback`, `/api/ai/provider/test`, `/api/ai/profile`, and `/api/ai/tombstones/analyze` are covered.
- The provider self-test request is stubbed in UI smoke and must include `consent: true`; the browser test never contacts a real AI provider.
- Product preview responses are stubbed in UI smoke so the browser test cannot perform real provider mutations.

Required privacy gates:

- `npm run check:privacy` must reject new `data/debug/`, Agent traces, AI raw payloads, recommendation exports, and any new credential-shaped files in public candidates or package contents.
- AI and Agent traces must use sanitized evidence references rather than raw provider responses by default.
- Live validation reports must remain sanitized and must not contain cookies, API keys, bearer tokens, `MUSIC_U`, or `qm_keyst`.

Required live-gated evidence before release:

- QQ disposable playlist add/remove round trip.
- NetEase disposable playlist add/remove round trip.
- Target-refresh convergence evidence after sync execution.
- Sanitized reports for both targets accepted by `npm run check:release:strict`.

## GitHub Actions CI

`.github/workflows/ci.yml` runs the local release gates on pull requests and pushes to `main`.

The workflow matrix covers Node 20 and Node 24 with `npm ci`, `npm run check:ci`, `npm run check:privacy`, `npm run verify`, `npm run migrate:state`, `npm run smoke:package`, `npm run smoke:fresh-install`, `npm run validate:live`, `npm run audit`, `npm run smoke:http`, `npm run smoke:web-app`, `npm run smoke:react-ui`, and `npm run smoke:agent-mcp`.

The Node 24 job also installs Chromium and runs `npm run smoke:react-ui` plus `npm run smoke:ui`, then requires an actual Docker build / run with:

```powershell
npm run smoke:docker -- --require-docker
```

CI intentionally does not set `MUSIC_LIKES_SYNC_LIVE_VALIDATE=1`; real provider mutations remain a manual release gate against disposable playlists.

## Public Contribution Guardrails

`CONTRIBUTING.md`, `SECURITY.md`, and `.github/ISSUE_TEMPLATE/bug_report.yml` are part of release readiness. They document the same validation matrix and privacy rules enforced by package and CI checks: no cookies, `.env` values, raw `data/` files, generated reports, browser profiles, or full provider responses in public issues or logs.

`npm run check:privacy` is the automated privacy gate. It allows documented placeholders such as `MUSIC_U=...` and `qm_keyst=...`, but fails on non-placeholder credential values and forbidden public paths such as `data/`, `reports/`, `.env`, `*.cookie`, and browser profiles.

To require local mirror state during release diagnostics:

```powershell
npm run check:state -- --require-mirror-plan --require-mirror-runs
```

Add `--require-mirror-decisions` when a diagnostic or release rehearsal depends on saved manual review decisions.

Use JSON output when attaching validation logs to an issue:

```powershell
npm run check:state -- --json
```

## State Migration Dry-Run

This validates that local mirror state is on a supported schema version and reports whether a safe migration is available.

```powershell
npm run migrate:state
```

The command is read-only by default. To migrate legacy unversioned state, write mode creates a timestamped backup under `data/state-migration-backups/` before replacing the original file:

```powershell
npm run migrate:state -- --write
```

Files from a newer schema version fail closed until this tool is upgraded. Corrupt JSON should be handled with `npm run check:state -- --json` first; migration does not repair invalid JSON.

## Local HTTP Smoke

This starts the local web server on an OS-assigned localhost port against an isolated temporary `MUSIC_LIKES_SYNC_HOME`. It seeds Apple and target fixture snapshots, generates an Apple-source-of-truth mirror plan, checks `/api/state`, `/api/app/state`, `/api/sync/modes`, `/api/ai/provider`, `/metrics`, static-file path traversal / bad-encoding guards, invalid / oversized JSON request guards, validates ordinary-user sync check / preview, validates product add resolution through `/api/sync/resolve-additions`, validates product canonical multi-target add-only execution, validates real product execution is blocked when target live-validation evidence is missing, validates managed ready-add dry-run execution from the policy `sync-preview`, validates managed delete execution fails before tombstone confirmation, validates managed confirmed-tombstone delete dry-run execution from the policy `sync-preview`, validates sanitized `sync-runs` entries, `/api/app/state` run summaries plus latest-run redaction, skipped dry-run convergence status, `/api/sync/convergence` persisted summaries, `/api/ai/profile` deterministic / consent-gated model behavior, `/api/ai/recommend` deterministic / consent-gated model behavior, `/api/ai/provider/test` consent gating, `/api/ai/explain` deterministic / consent-gated behavior, and `/api/ai/tombstones/analyze` deterministic / consent-gated behavior, validates product baseline save plus sanitized baseline diff examples, single and batch managed tombstone decisions, validates delete-only execution separation, verifies canonical deletion execution fails before `POST /api/sync/confirm-deletions`, validates batch mirror review decisions through `/api/mirror/decisions`, verifies add-only and remove-only dry-runs stay separated with mirror run idempotency metadata, verifies QQ mid-only remove operations are blocked through `/api/mirror/apply`, and verifies the mirror convergence endpoint can rebuild a non-persisted plan from the fixture snapshots.

```powershell
npm run smoke:http
```

To fail if fixture mirror-plan generation unexpectedly does not produce a readable plan:

```powershell
npm run smoke:http -- --require-mirror-plan
```

The smoke test does not perform real provider mutations and does not write into the checkout's local `data/` or `reports/` directories.

## React App Smoke

This builds the React + Vite + TypeScript app shell, starts the real Node server against an isolated temporary runtime root, and verifies the ordinary-user frontend entry:

- `/` serves the built React index as the default ordinary-user entry.
- `/app/` and `/app` remain React compatibility aliases.
- `/sync-preview` and `/app/sync-preview` fall back to the React index for SPA routing.
- `/workbench/` serves the legacy compatibility workbench instead of the React index.
- Built JavaScript and CSS assets are served from `/app/assets/`.
- Missing built assets return 404 instead of HTML.
- Encoded path traversal under both `/` and `/app/` is blocked.
- Isolated fixture snapshots can drive `/api/app/state`, `/api/sync/check`, and `/api/sync/preview` for the React read-side preview contract.
- Add-candidate lookup safely skips without provider cookies, and local add-candidate accept / skip decisions update only `sync-preview`.
- Tombstone deletion signals can be handled locally with non-destructive batch decisions, while `confirm_global_delete` remains single-item and exact-text-gated.
- Controlled write endpoints remain separated: additions can dry-run without provider mutation, real add/delete execution is blocked when live validation is missing, delete confirmation requires exact selected-target text, and convergence summaries remain sanitized.
- Local AI profile, similar-track search, and recommendation contracts run against isolated fixture snapshots without provider mutation.
- Model-assisted AI profile / recommendation and provider self-test requests are rejected without explicit consent.
- Agent session reads return sanitized summaries and do not expose API-key-shaped values.
- Advanced settings diagnostics consume `/api/validation/live` and `/api/ai/provider` summaries without exposing playlist ids or API keys.

```powershell
npm run smoke:web-app
```

This smoke is local-only and does not perform provider mutations.

## React UI Smoke

This starts the local web server against an isolated temporary runtime, opens the default `/` React entry in Chromium, and checks the replacement path in desktop and mobile viewports. It verifies six-screen navigation, sync preview generation from fixture snapshots, controlled add/delete write guards, exact delete-confirmation behavior without real provider writes, convergence checks, local AI profile and similar-track actions, Agent audit refresh, local-draft shortlist trace display, advanced diagnostics, and horizontal overflow.

```powershell
npm run smoke:react-ui
```

The script uses the same browser auto-detection as the legacy UI smoke and does not perform real provider mutations.

## Local UI Smoke

This starts the local web server, opens the `/workbench/` compatibility workbench in Playwright, checks desktop and mobile viewports, verifies the ordinary-user bridge plus legacy diagnostic controls, stubs product preview routes for safe UI interaction, verifies product add-resolution controls through `/api/sync/resolve-additions`, verifies local and model-assisted profile controls through `/api/ai/profile`, verifies local and model-assisted recommendation controls through `/api/ai/recommend`, verifies product preview explanations through `/api/ai/explain`, verifies tombstone risk summaries through `/api/ai/tombstones/analyze`, verifies product convergence status and `/api/sync/convergence`, verifies Apple cannot be selected as a mirror target, verifies mirror operation filters, manual review controls, add-resolution alternatives, stale snapshot / convergence health, the convergence-check control, and the exact delete-confirmation gate with the executable remove count when a plan exists, and fails on page JavaScript errors or horizontal layout overflow.

```powershell
npm run smoke:ui
```

The script uses a local Chrome or Edge executable when available, so it does not require checked-in browser binaries. If auto-detection fails, set:

```powershell
$env:MUSIC_LIKES_SYNC_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run smoke:ui
```

The UI smoke test does not perform real provider mutations.

## Package Smoke

This validates the npm package contents without creating a tarball. It checks the package whitelist, required source / docs / validation files, and privacy exclusions for local runtime state.

```powershell
npm run smoke:package
```

The command is local-only and does not contact provider APIs.

## Fresh Install Smoke

This validates the first-run path from both the packaged file list and a real tarball install. It creates a temporary package directory from `npm pack --dry-run --json`, runs CLI help and `check` without creating `data/` or `reports/`, validates an empty local state, installs the generated tarball into a separate temporary project, verifies `node_modules/.bin/music-likes-sync` works, runs the installed package's `npm test`, starts the installed Web UI through `music-likes-sync web`, verifies runtime state is written under the caller working directory instead of the installed package directory, imports `examples/apple.sample.csv`, confirms QQ Music and NetEase Cloud Music are skipped without cookies, and verifies `match` fails with a clear missing-platform-snapshot message.

```powershell
npm run smoke:fresh-install
```

The command is local-only and does not read cookies from the current checkout.

## Docker Smoke

This validates source-repo Dockerfile packaging assumptions and, when Docker is available, builds the image and checks the container answers `/api/state`. Docker build files are intentionally not shipped in the npm tarball.

```powershell
npm run smoke:docker
```

On machines without Docker, the command prints a skipped result after static Dockerfile checks. Release machines should require Docker:

```powershell
npm run smoke:docker -- --require-docker
```

Or:

```powershell
$env:MUSIC_LIKES_SYNC_REQUIRE_DOCKER = "1"
npm run smoke:docker
```

To save Docker release evidence after a successful build/run smoke:

```powershell
npm run smoke:docker -- --require-docker --write-report
```

This writes `reports/docker-smoke.json`. The strict release gate can validate this report on a machine without Docker, but skipped Docker smoke output is never accepted as release evidence. CI writes the same report and uploads it as the `docker-smoke-report-node-24` artifact from the Node 24 job. To fetch the CI report locally:

```powershell
npm run fetch:docker-report -- --repo owner/name
```

## Live Provider Validation

Live validation mutates a real QQ Music or NetEase Cloud Music account. Run it only against a disposable playlist. The script snapshots the target playlist, picks the first searched candidate that is not already present, adds it, verifies the post-add snapshot, removes it, and verifies the post-remove snapshot.

Provider-specific cookie and playlist-id guidance is in [docs/PROVIDERS.md](PROVIDERS.md).

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

For QQ Music, `MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID` should be the writable `dirid` used by the add/delete adapter. The validator resolves `dirid` to the playlist `tid` before detail reads, then uses provider playlist snapshot helpers for the before / after checks. The local web UI can list saved-account QQ playlist IDs through the QQ playlist ID panel after login.

Run:

```powershell
npm run validate:live
```

To save sanitized release evidence for the strict gate, add `--write-report` after each successful target validation:

```powershell
npm run validate:live -- --write-report
```

This writes `reports/live-validation-qq.json` or `reports/live-validation-netease.json`. These files are ignored by Git and may still include playlist IDs and target track IDs, so review them before sharing.

After add/delete validation, run a target-refresh convergence check and keep the JSON output with the validation notes:

```powershell
npx music-likes-sync mirror-convergence --refresh-target --json
```

If `MUSIC_LIKES_SYNC_LIVE_PLAYLIST_ID` is omitted, the script creates a new private/disposable playlist where the provider supports creation. It does not delete that playlist afterwards; remove it manually after checking the result.

If every searched candidate is already present in the provided disposable playlist, the script fails before mutation. Use an empty disposable playlist or a more specific query for a track that is not already present.

Release readiness requires passing live validation for both targets:

```powershell
$env:MUSIC_LIKES_SYNC_LIVE_TARGET = "qq"
npm run validate:live -- --write-report

$env:MUSIC_LIKES_SYNC_LIVE_TARGET = "netease"
npm run validate:live -- --write-report

npm run check:release:strict
```
