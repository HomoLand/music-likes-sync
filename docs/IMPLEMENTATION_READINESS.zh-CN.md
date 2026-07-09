# Implementation Readiness Checklist

Last updated: 2026-07-08

This document turns the product goal into an implementation gate checklist. The five-screen ordinary-user direction is confirmed and now uses the React + Vite + TypeScript shell as the default frontend, while the legacy workbench remains available at `/workbench/` for compatibility diagnostics.

## Current Status

Decision status:

- UI direction: five-screen ordinary-user flow is confirmed in `docs/UX_FLOW_SPEC.zh-CN.md`, first implemented as `web/product-app.js` / `web/product.css`, and now promoted to the default React path.
- Technical stack: React + Vite + TypeScript frontend and Node.js ESM backend are proposed in `docs/TECH_STACK_DECISION.zh-CN.md`; `web-app/` now provides the default `/` frontend, `npm run check:web-app` build gate, `/app/` compatibility alias, `/workbench/` compatibility workbench route, real read-side sync check / preview loading, add-candidate lookup / local decision handling, tombstone deletion-signal review, controlled add/delete execution controls, convergence check, baseline save, local AI profile / similar / recommendation actions, consent-gated AI provider self-test, Agent audit refresh / feedback, advanced-settings diagnostics covered by `npm run smoke:web-app`, and desktop / mobile real-browser replacement-path coverage through `npm run smoke:react-ui`.
- Ordinary-user API contract is drafted in `docs/API_CONTRACT.zh-CN.md`; the Apple-canonical compatibility foundation is implemented, and policy ready-add plus managed tombstone-gated delete execution have first controlled paths with dedicated policy run logs. Live validation now has a guarded HTTP/UI trigger for disposable-playlist add/remove checks, while fresh real QQ / NetEase reports remain a release gate.
- Product roadmap: policy-driven sync and AI / Agent layering are drafted in `docs/PRODUCT_ROADMAP.md`.
- PRD: full product requirements are drafted in `docs/AI_MUSIC_AGENT_PRD.zh-CN.md`.
- Policy core draft audit is documented in `docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md`.

Implementation status:

- Apple canonical mirror is the current reliable execution path.
- `/api/mirror/*` and existing CLI mirror commands are the current write-safe compatibility surface.
- `/api/app/state`, `/api/sync/modes`, `/api/sync/check`, `/api/sync/preview`, `/api/sync/confirm-deletions`, `/api/sync/execute-additions`, `/api/sync/execute-deletions`, and `/api/sync/convergence` are wired for the ordinary-user Apple-canonical compatibility path. Product execution accepts selected QQ / NetEase targets, fans out sequentially through mirror plans, and returns aggregate plus per-target results. `execute-additions` also supports the first policy-plan path for union / managed ready additions without mixing in deletions; `execute-deletions` supports managed policy removes only after confirmed tombstones.
- `GET /api/sync/baseline`, `POST /api/sync/baseline/save`, and `POST /api/sync/tombstones` are wired for local baseline and deletion-intent state. They do not mutate provider libraries.
- `data/mirror-plan.json`, `data/mirror-runs.json`, `data/mirror-decisions.json`, and the policy-driven v1 state files in `docs/STATE.md` have validators and migration checks.
- `src/sync-policy.js` exists as a unit-tested domain implementation candidate and is now covered by state validation / migration gates, ordinary-user product API smoke, policy ready-add execution smoke, managed tombstone-gated delete smoke, policy run-log smoke, post-write convergence contract smoke, ordinary-user convergence UI smoke, and first-slice UI smoke. The ordinary UI can now reach managed confirmed-delete execution, current-page batch handling for non-destructive deletion-intent decisions, convergence status review, and live validation evidence display, while broader live-driven policy rollout remains future work.
- `src/music-intelligence.js`, `src/ai-provider.js`, `src/agent-tools.js`, and `src/agent-mcp.js` implement deterministic local profile / similar / recommendation capabilities, consent-gated model-assisted profile summaries and recommendation reranking, non-secret AI provider preferences, shared DeepSeek-compatible JSON chat calls, consent-gated provider JSON tests with ordinary-user UI wiring, deterministic sync-item explanations, a read-only plus local-draft Agent tool registry, sanitized per-track evidence lookup without provider ids, sanitized Agent tool traces, local shortlist draft saving, and a stdio MCP adapter for Hermes / external Agent runtimes. These are covered by unit tests, HTTP smoke, UI smoke, and AI eval fixtures including tombstone risk outputs; Hermes setup examples are documented in `docs/AGENT_MCP_SETUP.zh-CN.md`.

## Non-Negotiable Product Invariants

- Ordinary users must not need to understand cookies, raw snapshots, mirror plans, dry-runs, thresholds, tombstones, or JSON.
- Additions and deletions must remain separate execution paths.
- Deletions must require a dedicated confirmation flow.
- A missing track on one platform is not enough evidence for global deletion.
- AI can suggest and explain; it cannot bypass preview, dry-run, or confirmation.
- Agent tools can read evidence and draft actions; they cannot directly mutate provider libraries or credentials.
- The product must still work without Hermes, MCP, or any external Agent runtime.
- Local credentials, snapshots, reports, AI raw payloads, and browser profiles must stay out of public artifacts.

## Requirement Matrix

| Area | Required end state | Current evidence | Implementation gate |
|---|---|---|---|
| Ordinary-user UI | Main screens: overview, connect platforms, sync mode, sync preview, AI assistant, plus an advanced settings boundary for diagnostics. | `docs/UX_FLOW_SPEC.zh-CN.md`; `web-app/`; React default `/` entry; `/app/` compatibility alias; `/workbench/` compatibility workbench link; React sync check / preview loading, add-candidate decisions, tombstone deletion-signal review, controlled write panel, AI assistant actions, provider consent self-test, Agent audit, advanced-settings diagnostics; `npm run smoke:web-app`; `npm run smoke:react-ui`; legacy `/workbench/` smoke through `npm run smoke:ui`. | Complete live provider evidence and tune real-volume UX before removing compatibility workbench. |
| Technical stack | React + Vite + TypeScript app surface, existing Node ESM backend, Playwright smoke. | `docs/TECH_STACK_DECISION.zh-CN.md`; `web-app/`; `npm run check:web-app`; `npm run smoke:web-app`; `npm run smoke:react-ui`; default route now serves React while legacy `web/` remains at `/workbench/`. | Keep React as default and retire legacy workbench only after live validation and parity evidence are sufficient. |
| Policy sync | `canonical_mirror`, `union_convergence`, `managed_bidirectional`, and `read_only_analysis` produce deterministic preview plans. | Current mirror modules; unit-tested `src/sync-policy.js` candidate; v1 state validators; ordinary-user preview APIs; product add-resolution API and UI; controlled policy ready-add execution path; managed confirmed-delete execution path; dedicated `sync-runs` audit log; sanitized latest-run app state; recent execution audit panel; post-write preview refresh path; ordinary-user convergence status card. | Live provider validation proves exposed behavior. |
| Baseline | A saved three-platform baseline records the last confirmed converged state and exposes readable platform diffs with sanitized change examples. | `src/sync-policy.js`, `src/state-schema.js`, `src/state-migrations.js`, product baseline APIs, ordinary-user baseline diff panel, HTTP smoke, and UI smoke. | Add searchable/detail drill-down for larger baseline histories before broad managed execution. |
| Tombstones | Platform deletion signals become user-confirmed deletion decisions, not automatic global deletes. | `src/sync-policy.js`, `src/state-schema.js`, `src/state-migrations.js`, product tombstone API, per-item controls, default unhandled filtering, source-platform / handled-state filters, current-filter batch product UI controls, deterministic item explanations, AI-assisted risk grouping, tombstone risk model-output eval, HTTP smoke, and UI smoke. | Add real tombstone provider-output samples and user feedback labels before broad managed execution. |
| Built-in AI | AI review, deletion explanation, profile, similar tracks, recommendations, and provider self-test are product features with consent gates. | Existing mirror/sync AI review through shared provider resolver; deterministic local profile, consent-gated model-assisted profile summary, similar, recommendation, consent-gated model-assisted recommendation summary / reranking, provider preference, provider test API and UI, explanation APIs, UI/HTTP smoke coverage, and no-model AI evaluation fixtures for track identity plus profile, recommendation, explanation, and tombstone risk model outputs; consent gate for model-backed provider calls. | Larger golden sets, real provider-output comparison, and feedback labels added before broad auto-apply. |
| Agent tools | Domain tools expose per-track evidence, baseline diff, review queue, preview, profile, similar tracks, recommendations, local shortlist drafts, draft operations, natural-language local tool chat, sanitized local trace audit, and short user feedback labels. | `src/agent-tools.js`; `src/agent-mcp.js`; `GET /api/agent/tools`; `GET /api/agent/sessions`; `POST /api/agent/chat`; `POST /api/agent/trace-feedback`; ordinary-user Agent chat / audit UI; permission tests; UI / HTTP / MCP stdio smoke; `docs/AGENT_MCP_SETUP.zh-CN.md`. | Exercise the MCP adapter in real Hermes workflows and tune the feedback taxonomy from real usage. |
| Controlled writes | Real provider writes go through the sync executor after preview, confirmation, and target live-validation evidence. | `src/mirror-apply.js` already separates add/remove for mirror mode; product Apple-canonical execution fans out over selected QQ / NetEase targets; real writes are blocked when fresh live-validation evidence is missing unless `force = true`; preview UI shows write-readiness and disables real execution when selected targets are not verified; React preview now exposes add dry-run / execute, exact delete confirmation / execute, convergence check, and baseline save controls; advanced settings exposes a confirmation-gated disposable-playlist live validation run form backed by `/api/validation/live/run`; ordinary-user overview shows the latest sanitized execution result. | Live provider validation proves exposed React and bridge behavior against disposable playlists. |
| Privacy | Public source and package artifacts exclude secrets and runtime data. | `npm run check:privacy` exists and passes. | New state/debug/AI/Agent paths are added to privacy smoke before use. |
| Validation | Release gates include policy, AI, Agent permission, UI, package, Docker, and live provider validation. | Current validation covers mirror mode, release packaging, saved live evidence summaries, and product display of QQ / NetEase validation status. | Docker build/run smoke completed on a Docker-capable machine and live reports kept fresh. |

## Execution Slices After Confirmation

### Slice 1: Frontend Shell Contract

Goal:

- Add the React + Vite + TypeScript app shell behind a non-breaking route or build output.
- Keep the current workbench available during migration.

Deliverables:

- `web-app/` app scaffold.
- API client types for current state and future sync preview.
- Five empty-but-wired screens matching `docs/UX_FLOW_SPEC.zh-CN.md`.
- Playwright smoke for navigation, mobile layout, and no horizontal overflow.

Do not yet:

- Remove current `web/app.js`.
- Move provider writes to new APIs.
- Expose raw credentials in the new UI.

### Slice 2: Policy Core Acceptance

Goal:

- Turn the policy-sync draft into tested domain code or replace it with a cleaner implementation.

Deliverables:

- Unit tests for policy validation.
- Unit tests for Apple canonical policy matching current mirror summaries.
- Unit tests for union convergence additions.
- Unit tests for read-only mode blocking writes.
- Decision on `src/sync-policy.js`: accept, rewrite, or delete.
- Resolve remaining `docs/POLICY_CORE_DRAFT_AUDIT.zh-CN.md` product exposure gates before exposing the module through ordinary-user HTTP APIs.

Acceptance:

- Existing mirror tests still pass.
- Apple canonical mirror behavior does not regress.

### Slice 3: Baseline And Tombstone State

Goal:

- Make deletion propagation safe and explicit.

Deliverables:

- `data/sync-baseline.json` schema.
- `data/sync-tombstones.json` schema.
- `data/sync-runs.json` schema.
- State validation in `src/state-schema.js`.
- Migration policy updates in `docs/STATE.md`.
- Tests for baseline diff and tombstone lifecycle.

Acceptance:

- Single-platform absence creates a review item, not a delete operation.
- Confirmed tombstones are required before cross-platform delete operations become executable.

### Slice 4: Product Sync APIs

Goal:

- Add ordinary-user APIs without breaking current mirror APIs.
- Use `docs/API_CONTRACT.zh-CN.md` as the route, response-shape, and safety contract.

Deliverables:

- `GET /api/app/state`
- `GET /api/sync/modes`
- `POST /api/platforms/read`
- `POST /api/sync/check`
- `GET /api/sync/preview`
- `POST /api/sync/execute-additions`
- `POST /api/sync/confirm-deletions`
- `POST /api/sync/execute-deletions`

Acceptance:

- New APIs can call existing mirror internals for Apple canonical mode.
- Deletion execution remains impossible without a prior confirmation.
- HTTP smoke covers new preview and execution separation.

### Slice 5: Built-In AI Productization

Goal:

- Move from raw AI calls to product-owned AI capability.

Deliverables:

- `src/ai/providers/` provider abstraction.
- Strict AI response schema and safety downgrade tests.
- AI consent and data-minimization checks.
- Evidence cards in the UI.
- Expanded AI evaluation fixtures with human labels, tombstone risk outputs, and provider-output comparison.

Acceptance:

- AI failure cannot corrupt plans or decisions.
- High-risk `keep` suggestions are downgraded.
- AI raw payloads are not persisted unless debug mode is explicitly enabled.

### Slice 6: Agent Tool Layer

Goal:

- Expose the same domain capabilities to Hermes / MCP / future agents as controlled tools.

Deliverables:

- Internal tool registry.
- Read-only tools for library summary, track evidence, sync policy, sync preview, baseline diff, review queue, catalog search, MusicBrainz lookup, taste profile, and similar tracks.
- Controlled draft tools for suggestions, shortlists, and sync operation drafts.
- Optional Hermes adapter.

Acceptance:

- Agent permission tests prove no direct add/delete provider mutation.
- Agent cannot read or write cookies.
- Agent-generated writes remain drafts until the normal executor and user confirmation path runs.

### Slice 7: Music Intelligence

Goal:

- Add music profile, similar-track search, recommendations, and local shortlists.

Deliverables:

- Deterministic profile generation without AI key.
- AI-enhanced profile summary when a provider is configured and the user grants consent.
- Similar-track and recommendation endpoints.
- Local shortlist state.
- UI tabs under AI assistant.

Acceptance:

- Recommendations never auto-write to provider platforms.
- Already-liked songs can be excluded.
- Every recommendation has a source and explanation.

## Verification Plan

Minimum gates after each implementation slice:

```powershell
npm run check:syntax
npm test
npm run check:privacy
```

Required gates before claiming the full goal is complete:

```powershell
npm run verify
npm run smoke:http
npm run smoke:agent-mcp
npm run smoke:ui
npm run smoke:package
npm run smoke:fresh-install
npm run smoke:docker
npm run validate:live
npm run check:release:strict
```

Live-gated completion additionally requires:

- QQ disposable playlist add/remove report.
- NetEase disposable playlist add/remove report.
- Docker build/run report from `npm run smoke:docker -- --require-docker --write-report`, or `npm run fetch:docker-report -- --repo owner/name` against the CI `docker-smoke-report-node-24` artifact, when strict validation is performed on a machine without Docker.
- Post-run convergence evidence.
- No raw credentials or private snapshots in saved evidence.

## Completed Confirmation Record

These original gate phrases are retained for release-readiness traceability:

1. Confirm the five-screen ordinary-user UI structure in `docs/UX_FLOW_SPEC.zh-CN.md`.
2. Confirm React + Vite + TypeScript for the redesigned frontend.
3. Confirm the current vanilla workbench should stay available under advanced settings or a compatibility route during migration.

The first item is now reflected in `web/product-app.js` and `npm run smoke:ui`. The second and third items remain relevant to the frontend replacement slice.

Historical guard: until these are confirmed, frontend architecture should stay at documentation, audit, and test-planning level. Isolated domain, state validation, and compatibility HTTP wrappers may be added to make implementation candidates safer before they are exposed through the redesigned UI.

## Remaining Confirmation Before Frontend Replacement

1. Confirm the timing for React + Vite + TypeScript migration.
2. Confirm whether the current vanilla workbench stays under advanced settings or moves to a compatibility route during migration.
3. Confirm whether multi-target execution should fan out automatically or remain a per-target guided action until live validation is complete.

Until these are confirmed, the bridge UI may continue to expose ordinary-user flow and smoke coverage, but large frontend architecture changes should wait for the migration slice.
