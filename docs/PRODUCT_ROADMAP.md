# Product And Implementation Roadmap

This document tracks the intended open-source product shape for `music-likes-sync`.

Companion specs:

- `docs/AI_MUSIC_AGENT_PRD.zh-CN.md`: product requirements, AI / Agent boundaries, backend and frontend requirements.
- `docs/UX_FLOW_SPEC.zh-CN.md`: ordinary-user five-screen interaction contract.
- `docs/TECH_STACK_DECISION.zh-CN.md`: implementation stack decision before code migration.
- `docs/IMPLEMENTATION_READINESS.zh-CN.md`: implementation gates, requirement matrix, and execution slices.
- `docs/API_CONTRACT.zh-CN.md`: planned ordinary-user API contract and legacy route compatibility mapping.

## Product Goal

Make liked songs portable across Apple Music, QQ Music, and NetEase Cloud Music with an explicit sync policy, reversible review steps, dry-runs, and protected destructive operations.

The current implemented policy is Apple Music canonical mirror: Apple Music Favorite Songs are the trusted desired state, and QQ Music / NetEase Cloud Music are mirror targets.

The open-source product should become a policy-driven sync engine:

- `canonical_mirror`: one trusted source updates one or more targets. The user's current preferred policy is Apple Music -> QQ Music + NetEase Cloud Music.
- `union_convergence`: liked songs from any enabled platform are merged into a unified set, then missing tracks are added to other platforms.
- `managed_bidirectional`: additions and deletions are detected against a saved baseline; additions can flow automatically, while deletion propagation requires tombstones and explicit confirmation.
- `read_only_analysis`: no writes; the system only builds evidence, taste profiles, recommendations, and AI explanations.

The product should not behave like an unbounded three-way overwrite. Multi-source sync requires a saved baseline, platform diffs, reviewable conflicts, and explicit deletion policy.

## Core User Flow

### Current Apple Canonical Flow

1. Sign in to Apple Music once; automatically discover Favorite Songs and reuse the dedicated local browser profile for silent refresh. File import remains a fallback.
2. Connect QQ Music with an in-app QQ / WeChat QR from Tencent's official page, or its visible local quick-login fallback; connect NetEase Cloud Music by QR.
3. Snapshot the selected target playlist or liked-song list.
4. Generate an Apple-source-of-truth mirror plan.
5. Inspect the plan summary:
   - `keep`: already aligned.
   - `add`: Apple-only tracks that need target catalog resolution.
   - `remove`: target-only tracks that Apple no longer wants.
   - `review`: uncertain matches, version conflicts, duplicates, or reverse-only matches.
   - Manual review can compare the Apple source, QQ / NetEase candidates, and alternatives using real covers, duration, metadata, and user-initiated 30-second playback.
6. Resolve `add` operations against the target catalog.
7. Run a full mirror dry-run.
8. Execute resolved additions.
9. Execute deletions only after explicit confirmation.
10. Refresh snapshots and regenerate the plan to prove convergence.
11. Save the converged three-platform state as the next sync baseline.

### Target Multi-Source Flow

1. Select a sync policy and participating platforms.
2. Log in to Apple Music, QQ Music, and / or NetEase Cloud Music locally.
3. Snapshot each participating platform.
4. Load the last successful baseline when available.
5. Build a unified liked-song set from platform snapshots.
6. Compute platform gaps and baseline diffs.
7. Treat additions as candidate union entries.
8. Treat deletions as tombstone candidates, not automatic global deletes.
9. Run deterministic matching and AI-assisted review for uncertain items.
10. Resolve target catalog additions.
11. Run a full dry-run.
12. Execute additions first.
13. Execute deletions only after explicit tombstone confirmation.
14. Refresh snapshots and save the converged state as the new baseline.

## Interaction Design

The first screen should be a consumer sync assistant, not a developer console.

The ordinary-user flow is:

1. Connect platforms.
2. Choose sync mode.
3. Run a sync check.
4. Review changes in plain-language buckets.
5. Confirm additions.
6. Confirm deletions in a separate safety flow.

Technical concepts such as snapshots, mirror plans, resolve, dry-run, thresholds, tombstones, cookies, and JSON should be hidden behind user-facing wording unless the user opens advanced settings.

Primary sections:

- Home overview: platform status, selected sync mode, last result, and one primary "start sync check" action.
- Connect platforms: Apple import / browser read, QQ QR or browser login, NetEase QR login, playlist selection, credential health in plain language.
- Sync mode: Apple canonical, merge all platforms, bidirectional advanced mode, or read-only analysis.
- Sync preview: user buckets for "will add", "will keep", "needs confirmation", and "may delete".
- AI music assistant: sync judgment, taste profile, similar songs, recommendations, and natural-language explanations.
- Advanced settings: cookies, thresholds, model/provider settings, debug logs, raw state, and export links.

Button semantics:

- `Generate Apple mirror plan`: read-only.
- `Generate sync policy plan`: read-only; future generalized replacement for Apple mirror plan.
- `Resolve add candidates`: searches the target catalog and updates local plan state.
- `Mirror dry-run`: read-only.
- `Execute mirror additions`: mutates only resolved `add` operations.
- `Execute mirror deletions`: mutates only `remove` operations and requires `REMOVE <TARGET>`.

Safety rules:

- Apple is disabled as a mirror target only when the selected policy is Apple canonical mirror.
- In union convergence, Apple can participate as a peer source, but deletion propagation still requires tombstones.
- Delete and add execution paths stay separate in both UI and backend options.
- Unresolved additions are reported as blocked, not as successful work.
- `review` items are never mutated automatically.
- Audio playback is human-only evidence: no autoplay, no persistence of signed QQ / NetEase URLs, and no audio content in AI or Agent requests.
- Single-platform absence is never enough evidence for global deletion.

Credential acquisition should prefer guided local flows over manual cookie copying. Apple now uses one-time official sign-in plus automatic Favorite Songs discovery; QQ shows QQ / WeChat QR images from Tencent's own page, preserves its quick-login fallback, and uses background cookie polling only inside the local backend; NetEase uses its QR API. All three stay hidden behind plain connection states in the ordinary-user UI, and later Apple / QQ refreshes reuse persistent local browser profiles without exposing credentials.

## AI Capability Strategy

The product should not choose between built-in AI and Agent tools. It should provide both, with different audiences and safety boundaries.

Built-in AI is the ordinary-user path:

- AI match review: decide same track, different version, or needs human.
- AI deletion explanation: explain why a track may be removed.
- Taste profile: summarize the user's liked music.
- Similar songs: find tracks like a seed track.
- Recommendations: generate explainable candidates.

Agent tools are the advanced integration path:

- Expose read-only domain tools for library summary, track evidence, sync policy, sync plan, baseline diff, review queue, catalog search, MusicBrainz lookup, profile, similar songs, recommendations, and decision explanation.
- Expose controlled draft tools for AI suggestions, local shortlists, and sync operation drafts.
- Do not expose direct add/delete provider mutation tools to an Agent.
- Real writes must go through the controlled sync executor, dry-run, preview, and user confirmation.

Implementation rule:

- Build the internal tools first for built-in AI.
- Then expose the same tools to Hermes / MCP / external Agent adapters.
- Agent support is optional. The product must still work without any Agent runtime.

Product decision:

- Built-in AI is part of the default product because ordinary users should not need to install or understand an Agent runtime.
- Agent integration is an optional adapter surface for power users, Hermes, MCP clients, and future automation.
- Both paths must share the same evidence builder, catalog search, profile, recommendation, and draft-plan services so that the Agent layer does not become a second implementation of music judgment.
- Any Agent-produced write intent remains a draft until the normal preview, dry-run, live-validation gate, and user confirmation flow executes it.

## Delivery Roadmap

## V1 Open-Source Execution Plan

1. Release the ordinary-user default app.
   - `/` stays the React + Vite + TypeScript app.
   - `/workbench/` remains a compatibility diagnostics surface.
   - Acceptance: `npm run smoke:web-app`, `npm run smoke:react-ui`, and `npm run smoke:ui` pass on desktop and mobile fixtures.

2. Finish safe provider write readiness.
   - Keep Apple canonical mirror as the default personal flow.
   - Keep real QQ / NetEase writes disabled unless fresh live-validation evidence exists or the user explicitly forces expert mode.
   - Acceptance: saved QQ and NetEase disposable-playlist reports pass `npm run check:release:strict`, and strict output stays redacted.

3. Productize policy sync.
   - Complete the ordinary-user path for `union_convergence` additions and `managed_bidirectional` tombstone-gated deletions.
   - Keep single-platform absence as a review signal, not a global delete.
   - Acceptance: policy unit tests, state migration checks, HTTP smoke, and UI smoke cover baseline, diff, tombstones, dry-run, controlled write, convergence, and baseline save.

4. Productize built-in AI.
   - Use deterministic evidence first and model calls only after explicit consent.
   - Expand golden sets with real provider-output comparisons and user feedback labels before broad auto-apply.
   - Acceptance: AI eval, schema validation, safety downgrade, HTTP smoke, and UI smoke prove AI can suggest and explain without mutating providers.

5. Harden the optional Agent layer.
   - Expose the same internal domain tools through stdio MCP for Hermes / external agents.
   - Keep tools read-only or draft-only.
   - Acceptance: permission tests and `npm run smoke:agent-mcp` prove no credential access and no direct add/delete provider mutation.

6. Add music-intelligence workflows.
   - Taste profile, similar tracks, recommendation shortlists, and natural-language explanation should sit on top of the same evidence/tool layer.
   - Acceptance: no-key deterministic results work, model-enhanced results require consent, and recommendations never auto-write to provider platforms.

Phase 0: Interaction and product contract.

- Finalize the five-screen ordinary-user flow: overview, connect platforms, sync mode, sync preview, AI assistant.
- Use `docs/UX_FLOW_SPEC.zh-CN.md` as the interaction contract before frontend implementation.
- Replace developer language with user-facing language.
- Define advanced settings boundaries.
- Define deletion confirmation UX separately from additions.
- Decide which current surfaces become hidden, migrated, or removed.

Phase 1: Technical architecture confirmation.

- Confirm frontend stack for the redesigned app surface.
- Use `docs/TECH_STACK_DECISION.zh-CN.md` as the technical decision record before implementation.
- Use `docs/IMPLEMENTATION_READINESS.zh-CN.md` as the gate checklist before changing sync core or frontend architecture.
- Use `docs/API_CONTRACT.zh-CN.md` as the product API contract before adding new ordinary-user routes.
- Confirm backend API shape for policy-driven sync.
- Confirm AI provider abstraction: built-in AI first, Agent tools second.
- Confirm local state schemas: sync policy, baseline, tombstones, AI suggestions, profile, shortlists.
- Confirm privacy and consent model for AI payloads.

Phase 2: Policy-driven sync core.

- Preserve Apple canonical mirror behavior as the default personal flow.
- Add policy model for canonical mirror, union convergence, managed bidirectional, and read-only analysis.
- Add baseline, platform diff, union set, and tombstone state.
- Add generalized sync preview APIs without breaking existing mirror APIs.
- Add state validation and migration policy.

Phase 3: Consumer UI redesign.

- Keep the React + Vite + TypeScript five-screen app shell as the default ordinary-user entry; the vanilla `web/product-app.js` bridge remains only as part of the `/workbench/` compatibility surface.
- Move raw cookies, thresholds, JSON, and debug controls into advanced settings.
- Replace mirror/workbench wording with sync check and sync preview wording.
- Add risk-first review UI for uncertain matches and possible deletions.
- Add UI smoke tests for desktop and mobile.

Phase 4: Built-in AI productization.

- Expand provider abstraction beyond the initial DeepSeek-compatible JSON chat implementation.
- Expand evidence cards and AI explanation copy.
- Expand provider test UX after the consent-gated API foundation.
- Add AI evaluation fixtures.
- Add smoke coverage for AI review and apply flows.

Phase 5: Agent tool layer.

- Expose domain tools for Agent runtimes.
- Add stdio MCP adapter for Hermes / external Agent runtimes.
- Add tool permission tests to prove Agent cannot mutate providers directly.
- Add trace / explanation logs for tool-assisted decisions.

Phase 6: Music intelligence.

- Add taste profile generation.
- Add similar-song search.
- Add recommendation candidates and local shortlists.
- Add natural-language assistant backed by the same tool layer.

## Backend Roadmap

Done:

- Pure mirror-plan model in `src/mirror-sync.js`.
- Add-candidate resolver in `src/mirror-resolve.js`.
- Dry-run and mutation contract in `src/mirror-apply.js`.
- File-backed workflow APIs in `src/workflow.js`.
- HTTP routes for mirror plan generation, add resolution, single and batch review decisions, apply, and convergence checks.
- QQ / NetEase delete adapters with stable empty-input no-op behavior.
- Delete execution guard that requires target track ids and blocks mid-only removals before provider mutation.
- CLI mirror commands.
- CLI mirror review decision command for single-key and JSON batch workflows.
- JSON schema version 1 for `data/mirror-plan.json`, `data/mirror-runs.json`, and `data/mirror-decisions.json`.
- `npm run check:state` state validation for local diagnostics and release checks.
- Documented state migration and corruption-recovery policy in `docs/STATE.md`.
- State migration helper in `src/state-migrations.js` plus `npm run migrate:state` dry-run / write-with-backup CLI for current v1 and pre-public unversioned mirror state.
- GitHub Actions CI in `.github/workflows/ci.yml` plus `npm run check:ci` static coverage checks for the release gate matrix.
- Public contribution, security, and issue-template privacy guardrails.
- Privacy smoke in `scripts/privacy-smoke.mjs` for public Git candidates and npm pack contents.
- Provider setup and troubleshooting guide in `docs/PROVIDERS.md` covering guided credential acquisition, cookie fields, QQ `dirid` / `tid` resolution, NetEase playlist ids, live validation, API surface, and redaction rules.
- npm package whitelist plus `npm run smoke:package` dry-run validation to keep the public tarball limited to source, docs, examples, tests, and validation scripts. The source-repo Dockerfile is validated separately by Docker smoke rather than shipped in the npm tarball.
- Fresh-install smoke in `scripts/fresh-install-smoke.mjs` that verifies the packaged first-run path with CLI help, a real tarball install, installed bin execution, installed package `npm test`, installed `music-likes-sync web`, caller-working-directory runtime state, empty local state, sample Apple import, and safe QQ / NetEase no-cookie skips.
- Docker packaging smoke with static checks and optional build / run verification.
- Live provider validation orchestration in `src/live-validation.js`: disposable-playlist guard, provider playlist snapshot helpers, absent-candidate selection, provider-reported mutation evidence, post-add snapshot verification, and post-remove snapshot verification.
- Strict release evidence checker in `scripts/release-readiness.mjs` for Docker build/run smoke plus saved QQ / NetEase live-validation reports.
- Product-readable live validation evidence: `GET /api/validation/live` and `/api/app/state.validation.live` summarize saved QQ / NetEase add-remove evidence without exposing cookies, raw provider payloads, user ids, or playlist ids. `POST /api/validation/live/run` plus the React advanced-settings form can run a guarded disposable-playlist validation after exact `DISPOSABLE_PLAYLIST` confirmation, write the local strict-gate report, and return only the sanitized target summary.
- Persisted manual review decisions for mirror `review` operations; saved decisions rebuild the plan from snapshots so `keep` and `separate` decisions are reversible and auditable.
- Batch mirror review decisions for the current visible review page, with bulk `keep`, bulk `separate`, and bulk clear actions backed by one plan rebuild.
- Idempotent mirror run identity: dry-runs and real executions now carry `runId`, `idempotencyKey`, operation keys, and run-log status. Real execution writes a `running` checkpoint before provider mutation, updates it to `completed` / `failed`, resumes interrupted checkpoints through provider verification, and skips already completed duplicate requests.
- Mirror convergence check: after add/delete execution, `POST /api/mirror/convergence` or `mirror-convergence --refresh-target` refreshes the target snapshot when requested, regenerates the Apple-source-of-truth plan, and records whether any add/remove/review deltas remain.
- QQ playlist ID diagnostics: `GET /api/qq/playlists` and the local UI list saved-account playlists with sanitized `dirid`, `tid`, and counts so users can pick the writable `dirid` without exposing cookies.
- Unit-tested policy sync core candidate in `src/sync-policy.js` for `canonical_mirror`, `union_convergence`, `managed_bidirectional`, `read_only_analysis`, baseline diffs, and tombstone decisions.
- Policy-driven v1 state validators and migration checks for `sync-policy`, `sync-baseline`, `sync-preview`, `sync-tombstones`, `sync-runs`, AI provider state, music profile, recommendation shortlists, and Agent sessions.
- Ordinary-user API foundation: `GET /api/app/state`, `GET /api/sync/modes`, `POST /api/sync/check`, `GET /api/sync/preview`, `POST /api/sync/confirm-deletions`, `POST /api/sync/execute-additions`, and `POST /api/sync/execute-deletions` are wired while keeping `/api/mirror/*` compatibility.
- Apple canonical product execution now fans out across selected QQ / NetEase targets by regenerating each target's mirror plan and calling the existing safe add/remove executor sequentially. Responses keep aggregate add/remove counters and include per-target results.
- Union and managed-bidirectional write execution now have controlled first slices: `POST /api/sync/execute-additions` can consume the current policy `sync-preview`, optionally resolve target catalog matches when credentials exist, and dry-run or execute only ready add operations for QQ / NetEase; `POST /api/sync/execute-deletions` can dry-run or execute managed-bidirectional remove operations only after `confirm_global_delete` tombstones produce policy ready removes.
- Policy execution now writes sanitized per-target entries to `data/sync-runs.json`, `/api/app/state` exposes the latest ordinary-user sync run separately from mirror diagnostics, and the ordinary-user overview shows a compact recent execution audit panel with status, target, add/delete counters, and dry-run labeling.
- The ordinary-user preview screen now has a write-readiness panel driven by `/api/app/state.validation.live`; real add/delete buttons are disabled when selected QQ / NetEase targets lack fresh live-validation evidence, while dry-run, candidate lookup, and deletion-intent review remain available.
- Policy execution now has a post-write convergence refresh path: dry-runs report a skipped convergence reason, while real policy writes refresh written target snapshots and rebuild the current `sync-preview` by default. `POST /api/sync/convergence` can also recheck ordinary-user convergence and persist sanitized `sync-preview.convergence`.
- Ordinary-user add resolution is now exposed separately through `POST /api/sync/resolve-additions` and the product preview button "查找对应歌曲"; it searches target catalogs, persists sanitized resolved candidates into `sync-preview`, and does not mutate provider playlists. Low-confidence add candidates can now be accepted, switched to an alternative, skipped one by one through `POST /api/sync/addition-decision`, or batch accepted / skipped for explicit visible operation ids through `POST /api/sync/addition-decisions`; accepted candidates become ready additions but still require the separate controlled add execution path.
- Product baseline and tombstone lifecycle APIs are wired: `GET /api/sync/baseline`, `POST /api/sync/baseline/save`, and `POST /api/sync/tombstones` save local baseline state, summarize baseline diff, expose sanitized title / artist / evidence examples for platform additions and deletion signals, and record single-item or batch deletion-intent decisions without provider mutation. The ordinary-user overview now shows a baseline diff panel with missing-baseline guidance, added/deleted/unchanged counts, tombstone decision counts, per-platform rows, sanitized change examples, and refresh. The baseline save path requires a current converged preview so unfinished sync deltas cannot become the next deletion baseline, and it can activate `managed_bidirectional` as the ongoing sync policy after an Apple-canonical refresh.
- The ordinary-user preview list now exposes tombstone review actions for baseline deletion signals: default unhandled-signal filtering, source-platform / handled-state filters, current-filter batch handling for non-destructive decisions, ignore, current-platform-only, restore, and explicit per-item global-delete confirmation.
- Built-in AI provider abstraction now exists for DeepSeek-compatible JSON chat calls. `/api/ai/provider` stores non-secret provider preferences, `/api/ai/provider/test` verifies strict JSON output behind an explicit consent gate, the ordinary-user AI assistant exposes consent-gated provider self-test, model-enhanced profile, and model-enhanced recommendation controls, existing review flows reuse the shared provider resolver, `/api/ai/explain` can explain sync preview items from sanitized evidence with deterministic local fallback and explicit consent for model-backed explanations, and `/api/ai/tombstones/analyze` groups deletion signals by risk / handling state before any managed delete execution.
- AI evaluation fixtures now exist under `test/fixtures/ai-eval/track-match-cases.json`, `profile-model-cases.json`, `recommendation-model-cases.json`, `explanation-model-cases.json`, and `tombstone-model-cases.json`, with `npm run check:ai-eval` providing no-model gates for human-labeled same-recording, version, cover/remix/live, transliteration, missing-ISRC, duration-conflict, different-ISRC cases, normalized profile model-output quality, recommendation reranking safety, ordinary-user explanation action safety, and tombstone risk output safety.
- Deterministic local music intelligence now exists for no-key taste profile, local similar-track search, and local recommendation candidates. Consent-gated model-assisted profile summaries and recommendation summaries / reranking can now enrich local results from sanitized aggregate evidence without creating new songs or provider writes.
- Optional read-only and local-draft Agent tool API now exists for local library summary, sync policy, sync preview, per-track evidence lookup, baseline diff, review queue, taste profile, similar tracks, recommendations, local shortlist saving, and draft sync operations. `music-likes-sync agent-mcp` exposes the same permission-gated registry as a local stdio MCP server for Hermes / external Agent runtimes. It cannot expose credentials, playlist ids in baseline results, provider track ids in track-evidence results, tombstone keys in review-queue results, or direct provider mutations. Agent calls now write sanitized local tool traces with source, status, read-only / local-draft flags, duration, argument summary, result summary, and evidence refs; `GET /api/agent/sessions` exposes the audit summary without raw prompts or provider payloads, and the ordinary-user AI page now supports natural-language Agent tool chat plus the same sanitized tool audit with refresh and short feedback labels.
- HTTP smoke covers product API preview generation, canonical multi-target add-only execution, real-write blocking when live-validation evidence is missing, guarded live-validation run failure paths, managed ready-add dry-run execution, managed tombstone-gated delete dry-run execution, policy dry-run convergence status, ordinary-user convergence recheck, baseline save, managed single and batch tombstone decisions, tombstone risk grouping, app state path redaction, latest sync-run summary redaction, live validation evidence redaction, AI provider consent gating, Agent trace safety flags and feedback labels, per-track evidence lookup redaction, baseline-diff redaction, review-queue redaction, local shortlist draft saving, delete-only execution separation, and deletion execution blocking before confirmation. `npm run smoke:agent-mcp` starts the real stdio MCP process, exercises initialize, tools/list, safe tools/call, read-only track-evidence / baseline-diff / review-queue metadata, local-draft tool metadata, mutation rejection, and sanitized MCP trace persistence. `npm run smoke:react-ui` opens the default React `/` ordinary-user entry in desktop and mobile Chromium with real fixture data, sync preview rendering, controlled write guards, local AI actions, natural-language Agent chat, Agent audit refresh, read-only track-evidence trace display, local-draft shortlist trace display, live-validation run confirmation gating, advanced diagnostics, and overflow checks. UI smoke covers `/workbench/` live validation status display, preview write-readiness gating, recent execution audit display, AI provider consent UI, Agent tool audit display / refresh / feedback, tombstone review filters, tombstone risk summary, current-filter batch handling, ordinary-user convergence status, and global-delete confirmation text.

Next:

- Tune automatic-sync refresh and review behavior from real canonical-mirror runs while keeping unresolved human-review items visible; separately validate baseline-dependent managed mode after a converged baseline is available.
- Extend AI eval with larger golden sets, live provider output capture, and user-feedback labels before broad auto-apply.
- Exercise the MCP adapter in a real Hermes client workflow and tune the Agent feedback taxonomy from real usage.
- Keep live-gated provider tests current against disposable QQ / NetEase playlists and rerun them before public release evidence expires.
- Complete a fresh-profile human scan of both QQ and WeChat variants before the public release, then keep the deterministic official-page QR extraction test and write-capable provider validation current.
- Add concrete v1 -> v2 migration transforms when schema version 2 is introduced.
- Expand provider troubleshooting when real live validation reveals platform-specific failures.

## Frontend Roadmap

Done:

- Operational sync panel with Apple-source-of-truth copy.
- Mirror plan generation, add resolution, dry-run, add-only execution, and delete-only execution buttons.
- Target-aware disabling for Apple as a mirror destination.
- Compact mirror summary and latest-run messaging.
- Playwright UI smoke for desktop and mobile layouts, mirror controls, and Apple-target disabling.
- Mirror operation workbench with filters for all, add, remove, review, and execution-blocked items.
- In-app deletion confirmation modal with target-plan preview and exact `REMOVE <TARGET>` gate.
- Inline add-resolution details with resolved target, low-confidence candidate, and alternative catalog matches.
- Visual states and controls for stale snapshots and post-run convergence checks.
- Manual review controls for mirror `review` operations: mark a review item as the same track, mark it as separate so the next plan adds/removes according to Apple, or clear the saved decision.
- Current-page bulk review controls for mirror `review` operations.
- One-click QQ login flow that opens the official QQ Music browser session, polls for write-capable cookies in the background, saves them locally, and refreshes the QQ snapshot without a second capture click.
- In-app QQ / WeChat QR flow backed by Tencent's official login page: transient QR pixels are copied from the same browser session that handles confirmation, and the visible official page remains available for local quick login.
- One-time Apple browser connection that detects MusicKit authorization, locates the canonical Favorite Songs library playlist, captures catalog metadata without manual navigation, and reuses the dedicated profile in headless mode for scheduled refreshes.
- Ordinary-user five-screen bridge in `web/product-app.js`: overview, connect platforms, sync mode, sync preview, and AI assistant, mounted before the legacy workbench.
- React + Vite + TypeScript is now the default ordinary-user frontend at `/`, with `/app/` kept as a compatibility alias and the legacy workbench moved to `/workbench/`. It provides typed `/api/app/state` normalization, seven-screen navigation, real read-side sync check / preview loading, automatic-sync settings / readiness / history, add-candidate lookup, local add-candidate accept / skip / alternative / clear decisions, tombstone deletion-signal filters plus local ignore / current-platform-only / restore / exact-text global-delete confirmation, controlled add dry-run / execution controls, delete confirmation / execution controls, convergence check, convergence-gated baseline save, local AI profile / similar / recommendation actions, natural-language Agent tool chat, consent-gated AI provider self-test, Agent audit refresh / feedback with local-draft trace labels, advanced-settings diagnostics for live validation and AI provider state, `npm run check:web-app` type-check / build gate, Node-server hosting covered by `npm run smoke:web-app`, and real-browser desktop / mobile replacement-path coverage through `npm run smoke:react-ui`.
- Automatic sync now has versioned settings and run-history state, policy-scoped baseline readiness plus freshness / live-validation gates, a local scheduler, safe automatic additions, manual-only deletion signals, cross-process execution locking with orphan recovery, and a dedicated Apple Music-style screen. Apple-canonical mirror runs derive their plan from the current Apple snapshot and therefore do not require a historical baseline. A real additions-enabled canonical cycle has been validated against fresh Apple / QQ / NetEase snapshots without scheduled deletion.
- Low-confidence searched additions now support consent-gated AI batch review drafts. Suggestions persist on `sync-preview` with deterministic safety downgrades, remain non-executable, and are visible through the ordinary-user preview UI; per-track and current-page actions share the same API.
- Apple-vs-target version conflicts now use the same ordinary-user review queue: real source / target artwork and human-only 30-second audition sit beside durable `同一版本` / `不同版本` decisions. Consent-gated AI identity drafts persist separately by stable decision key, are never auto-applied, and survive full preview regeneration.
- Product UI smoke coverage for desktop and mobile five-screen navigation, mode selection, preview buckets, AI capability cards, AI provider consent UI, Agent audit display / feedback, `/api/app/state`, `/api/sync/modes`, `/api/sync/check`, `/api/sync/preview`, and React replacement-path controlled write / AI / advanced diagnostics.
- Ordinary-user preview actions now switch deletion behavior by policy: Apple canonical opens the exact delete-confirmation dialog, while managed bidirectional executes already confirmed global-delete decisions through `/api/sync/execute-deletions`.
- AI assistant bridge controls for deterministic local profile generation, local recommendations, and similar-track lookup.
- AI assistant now includes a provider status panel and consent-gated "AI 连接自检" button. The UI does not enable provider testing until the user explicitly consents, and the smoke test exercises the request with a stubbed provider response.
- Ordinary-user convergence card and `POST /api/sync/convergence` wiring show skipped dry-runs, refresh failures, open deltas, and converged status without exposing raw plan JSON. The "save baseline" action stays disabled until the preview is proven converged, submits the matching preview id to the backend, and after an Apple-canonical convergence switches the product mode to "automatic additions, deletion requires confirmation".
- Ordinary-user "查找对应歌曲" action resolves pending additions before execution and shows resolved target tracks, review candidates, not-found status, and per-target resolution counts.
- Ordinary-user add candidate decisions let users accept a low-confidence target candidate, choose an alternative, skip the add, or batch accept / skip the current visible candidate set before the controlled add executor can write anything.
- Advanced settings boundary now exists in both the compatibility bridge UI and the default React path: the legacy mirror/developer workbench lives behind `/workbench/#advanced`, and ordinary diagnostics show only sanitized live-validation / AI-provider summaries.

Next:

- Add model-assisted recommendation / explanation eval comparison before exposing managed bidirectional writes broadly.
- Move deeper AI provider diagnostics into advanced settings while keeping the consent-gated connection self-test and deterministic local profile / recommendation / similar-track actions in the main flow.
- Tune bulk-review ergonomics and thresholds after live provider validation reveals the common review volume and mistake patterns.
- Expand the AI add-review golden set with localized-title / artist-alias cases before allowing any automatic acceptance policy; current model output remains suggestion-only.

## Validation Gates

Automated:

- `npm run check:release`
- GitHub Actions CI on pull requests and `main` pushes.
- `npm run check:ci`
- `npm run check:privacy`
- `npm run check:syntax`
- `npm run check:ai-eval`
- `npm run check:state`
- `npm run migrate:state`
- `npm test`
- `npm run verify`
- HTTP smoke test with isolated fixture state for `/api/state`, `/api/mirror/plan`, `/api/mirror/decisions`, `/api/mirror/apply` dry-run, blocked QQ mid-only removals, and `/api/mirror/convergence`.
- HTTP smoke coverage for `/api/auto-sync` enablement guards, settings, due scheduling state, dry-run execution, and sanitized history.
- Versioned, checksummed pre-delete recovery points, an additions-only restore path, ordinary-user deletion-protection UI, and HTTP / unit coverage for fail-closed backup ordering.
- `npm run smoke:http`
- `npm run smoke:web-app`
- `npm run smoke:agent-mcp`
- HTTP smoke covers static-file traversal and bad-encoding guards.
- HTTP smoke covers invalid and oversized JSON request guards.
- Playwright UI smoke for desktop and mobile target-control behavior.
- `npm run smoke:ui`
- npm package privacy and whitelist smoke.
- `npm run smoke:package`
- Fresh package first-run and packaged test smoke.
- `npm run smoke:fresh-install`
- Docker packaging smoke.
- `npm run smoke:docker`
- `npm run validate:live` skip behavior and live-validation orchestration unit tests.
- `npm run check:release:strict` for release-only Docker build/run and live-validation evidence.

Live-gated:

- Create or provide disposable QQ and NetEase playlists.
- Add known fixture tracks.
- Generate Apple -> target mirror plans.
- Resolve additions.
- Execute add-only.
- Execute remove-only with confirmation.
- Run `npm run validate:live` for `qq` and `netease`.
- Save both reports with `npm run validate:live -- --write-report`.
- Run `npm run check:release:strict`.
- Refresh snapshots and verify the next plan has zero unexpected `add` or `remove` operations.
- For Apple-canonical mirror mode, enable automatic sync after fresh snapshots and live-write validation pass; keep any unresolved review queue visible without saving a false baseline. Baseline-dependent modes still require a converged baseline. Prove one scheduled additions-only cycle and confirm deletion signals remain pending for manual review.

Release:

- No cookies, snapshots, reports, run logs, browser profiles, or local `.env` files in Git.
- Privacy smoke verified with `npm run check:privacy`.
- Local non-destructive release gate verified with `npm run check:release`.
- English `README.md` with Chinese linked at the top.
- `README.zh-CN.md` kept in sync for major product behavior.
- `CONTRIBUTING.md`, `SECURITY.md`, and privacy-preserving issue template present.
- Provider setup and troubleshooting guide present.
- License present.
- npm package dry-run verified with `npm run smoke:package`.
- Fresh package first-run and package test behavior verified with `npm run smoke:fresh-install`.
- Docker build verified with `npm run smoke:docker -- --require-docker`, or with a fresh `reports/docker-smoke.json` generated by `npm run smoke:docker -- --require-docker --write-report` on a Docker-capable machine or fetched from the CI `docker-smoke-report-node-24` artifact with `npm run fetch:docker-report`.
- Strict release evidence verified with `npm run check:release:strict`.
- Dependency audit reviewed and documented.

## Current Release Blockers

- `npm audit --omit=dev` now reports 0 vulnerabilities after replacing the `qq-music-api` dependency with a local minimal QQ Music Web API adapter and upgrading OpenTelemetry / NetEase dependencies.
- The remaining release blocker on this workstation is Docker environment validation. QQ and NetEase live-gated add/remove reports can be validated by the strict gate while they remain fresh, but a real Docker run still needs to produce `reports/docker-smoke.json` either from `npm run smoke:docker -- --require-docker --write-report` on a Docker-capable machine or by manually dispatching CI with `gh workflow run ci.yml --ref <branch>` and then running `npm run fetch:docker-report -- --repo owner/name` after the CI `docker-smoke-report-node-24` artifact exists. Future schema version 2 work still needs concrete v1 -> v2 transforms once that schema exists. A real additions-enabled canonical automatic-sync cycle has completed with fresh provider snapshots, no scheduled deletion, and unresolved identity decisions preserved for human review. UI has Playwright smoke coverage for the ordinary-user seven-screen flow, automatic-sync readiness / history, product API wiring, mirror workbench, review controls, add-resolution alternatives, stale snapshot / convergence health, and executable deletion confirmation. npm package privacy is covered by `npm run smoke:package`; packaged first-run and packaged `npm test` behavior are covered by `npm run smoke:fresh-install`.
