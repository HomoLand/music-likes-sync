# Local State Schema And Migration Policy

`music-likes-sync` is local-first. Runtime state is written under `data/` in the current working directory and is intentionally ignored by Git in the source checkout. Set `MUSIC_LIKES_SYNC_HOME` to use a different runtime directory.

This document defines the open-source contract for the Apple-source-of-truth mirror state files and the policy-driven v1 state files.
Policy-driven sync state now has validators and migration checks. Ordinary-user APIs write the policy, preview, baseline, tombstone, and policy run-log files through the same validation gates before persisting them.

## Files

### `data/mirror-plan.json`

Current schema version: `1`

Purpose:

- Stores the latest Apple -> QQ or Apple -> NetEase mirror plan.
- Captures the source snapshot metadata, target snapshot metadata, thresholds, summary counters, and deterministic operations.
- Is regenerated from snapshots; it should be treated as disposable derived state.

Required top-level fields:

- `version`: `1`
- `mode`: `source_of_truth_mirror`
- `generatedAt`: ISO timestamp
- `source.platform`: `apple`
- `target.platform`: `qq` or `netease`
- `summary`: counters derived from `operations`
- `operations`: ordered mirror operations

Optional top-level fields:

- `convergence`: latest post-run convergence check result. This is derived metadata and is replaced whenever convergence is checked again.

Operation actions:

- `keep`: the target already has a confident match.
- `add`: Apple has a track that the target is missing. Execution requires `resolvedTargetTrack` or a ready `targetTrack`.
- `remove`: the target has a track that Apple no longer wants. This must include a target `id` and be marked `destructive: true`; a `mid` alone is not enough for destructive deletion.
- `review`: the matcher found an uncertain, duplicate, version-sensitive, or reverse-only relationship.

`review` operations include a stable `decisionKey`. Older local plans without this field are still readable; regenerate the plan to persist keys into the file.

Operation statuses:

- `ready`
- `needs_resolution`
- `needs_review`
- `not_found`

### `data/mirror-runs.json`

Current schema version: `1`

Purpose:

- Stores the most recent mirror apply previews and executions.
- Keeps only the latest 30 entries.
- Records add and remove paths separately so dry-runs, add-only runs, and delete-only runs are auditable.

Required top-level fields:

- `version`: `1`
- `updatedAt`: ISO timestamp
- `runs`: array

Each run records:

- `runId`
- `idempotencyKey`
- `status`: `preview`, `running`, `completed`, or `failed`
- `ranAt`
- `startedAt`
- `completedAt` / `failedAt`
- `target`
- `dryRun`
- `playlistId`
- `operationKeys`
- `add`
- `remove`
- `review`
- `addResult`
- `removeResult`
- `blocked`

Real mirror execution is written in two phases. Before provider mutation, `music-likes-sync` writes a `running` checkpoint keyed by the deterministic `idempotencyKey`. On success it updates the same run to `completed`; on error it updates the same run to `failed`. If the process is interrupted, the next real execution with the same idempotency key resumes the checkpoint. Completed duplicate executions are skipped instead of calling the provider again.

### `data/mirror-decisions.json`

Current schema version: `1`

Purpose:

- Stores manual decisions for mirror `review` operations.
- Is user-authored local state, not derived state.
- Is applied when generating or rebuilding a mirror plan from snapshots.

Required top-level fields:

- `version`: `1`
- `updatedAt`: ISO timestamp
- `items`: map keyed by the operation `decisionKey`

Decision actions:

- `keep`: treat the reviewed target track as the Apple source match. The rebuilt plan turns that review item into `keep`.
- `separate`: treat the reviewed source and target tracks as different. The rebuilt plan creates the necessary `add` and / or `remove` operations, and deletions still require dry-run plus `REMOVE <TARGET>`.

Batch review actions write the same decision entries as single-item review. A decision may include an optional `batchId` string for auditability; clearing a decision removes the item from `items`.

## Policy-Driven Sync State

The ordinary-user redesign uses the following policy-driven state files. Their schema validators live in `src/state-schema.js`, and migration checks live in `src/state-migrations.js`. Product APIs must validate these files before writing them.

### `data/sync-policy.json`

Current schema version: `1`

Purpose:

- Stores the selected sync policy and participating platforms.
- Supports `canonical_mirror`, `union_convergence`, `managed_bidirectional`, and `read_only_analysis`.
- Stores user-facing defaults such as Apple canonical source, enabled targets, and deletion policy.

Rules:

- A policy file must not contain cookies, provider raw responses, or full snapshots.
- `canonical_mirror` may use Apple as the source and QQ / NetEase as targets through the current mirror executor.
- `union_convergence` treats liked songs from every enabled platform as additions to a unified set by default.
- `managed_bidirectional` may produce deletion candidates only against a saved baseline.
- `read_only_analysis` must never create executable provider mutations.

### `data/sync-baseline.json`

Current schema version: `1`

Purpose:

- Stores the last user-confirmed converged view across enabled platforms.
- Allows later runs to distinguish new additions, possible platform deletions, provider fetch gaps, and matching failures.

Rules:

- Baseline state is user-confirmed state, not disposable derived state.
- Every platform entry must include a normalized track identity set, source metadata, `fetchedAt`, and count.
- Track identities should prefer stable provider ids, ISRC, MusicBrainz recording ids, and normalized text/duration fallbacks.
- Baseline migration must preserve user-confirmed identities or fail closed with a backup.

### `data/sync-preview.json`

Current schema version: `1`

Purpose:

- Stores the latest ordinary-user sync preview.
- Groups operations into user-facing buckets: `will_add`, `will_keep`, `needs_confirmation`, and `may_delete`.
- Stores optional derived `convergence` metadata from execution or `POST /api/sync/convergence`.

Rules:

- Preview state is derived and can be regenerated.
- Add and delete buckets must remain separate.
- Destructive operations in `may_delete` are not executable until explicit confirmation creates or updates tombstone state.
- `convergence` may contain status, open-operation counts, refreshed targets, and sanitized snapshot summaries only. It must not contain cookies, raw provider responses, or raw AI payloads.

### `data/sync-tombstones.json`

Current schema version: `1`

Purpose:

- Stores user decisions about deletion signals detected against baseline.
- Prevents single-platform absence from becoming an automatic global delete.

Decision actions:

- `confirm_global_delete`: propagate the deletion to other participating platforms after the normal delete confirmation flow.
- `ignore`: keep the track globally and ignore this deletion signal.
- `restore`: add the missing track back to the platform where it disappeared.
- `current_platform_only`: treat the deletion as local to one platform and do not propagate it.

Rules:

- Tombstone state is user-authored and must be migrated carefully.
- Confirmed tombstones still require the controlled sync executor before provider mutation.
- AI may explain or suggest a tombstone action, but it cannot create a confirmed global delete without user confirmation.

### `data/sync-runs.json`

Current schema version: `1`

Purpose:

- Stores ordinary-user policy sync execution history separately from Apple mirror diagnostics.
- Records controlled `union_convergence` and `managed_bidirectional` add/delete attempts for each writable target.
- Lets `/api/app/state` and `/api/state` show recent ordinary sync results without exposing provider credentials or raw payloads.

Required top-level fields:

- `version`: `1`
- `updatedAt`: ISO timestamp
- `runs`: array

Each run records:

- `runId`
- `idempotencyKey`
- `status`: `preview`, `running`, `completed`, or `failed`
- `policy`: `canonical_mirror`, `union_convergence`, `managed_bidirectional`, or `read_only_analysis`
- `action`: `add` or `remove`
- `target`: `qq` or `netease`
- `dryRun`
- `previewId`
- `operationKeys`
- `add`
- `remove`
- `review`
- `addResult`
- `removeResult`
- `blocked`

Rules:

- `sync-runs.json` is an audit log; keep it sanitized and local.
- It must not contain cookies, API keys, raw provider responses, raw AI payloads, or full snapshots.
- Apple canonical compatibility execution continues to use `mirror-runs.json`; policy execution uses `sync-runs.json`.

### `data/ai-provider-state.json`

Current schema version: `1`

Purpose:

- Stores non-secret AI provider preferences such as selected provider, model id, batch size, and thresholds.
- Backed by `GET /api/ai/provider` and `POST /api/ai/provider`.

Rules:

- API keys stay in `.env`, environment variables, or an explicit local secret store, not in this file.
- Current implementation supports the built-in DeepSeek-compatible JSON chat provider abstraction; additional providers must preserve the same consent and schema-validation gates.
- Raw prompts and raw responses are not stored by default.
- AI raw payloads are not persisted unless debug mode is explicitly enabled.
- If debug payload persistence is enabled, payloads must be written under ignored `data/debug/` and covered by privacy smoke exclusions.

### `data/music-profile.json`

Current schema version: `1`

Purpose:

- Stores deterministic and AI-assisted music taste profile summaries.
- Supports the AI assistant's profile, similar-track, and recommendation surfaces.

Rules:

- Profile state may contain aggregate genre, language, era, artist, and version-preference summaries.
- Profile state must not contain cookies or raw provider responses.
- Large-library AI analysis should use aggregated or sampled summaries unless the user explicitly consents to a larger payload.

### `data/recommendation-shortlists.json`

Current schema version: `1`

Purpose:

- Stores local recommendation candidates selected or saved by the user.

Rules:

- Shortlists are local drafts and do not mutate provider playlists.
- Writing a shortlist to a music platform must go through the same preview, dry-run, and confirmation path as other additions.

### `data/agent-sessions.json`

Current schema version: `1`

Purpose:

- Stores optional local Music Agent chat sessions and tool traces.

Rules:

- Agent session state must not store cookies, raw provider responses, or secret values.
- Agent tool traces should record tool names, source (`http` / `mcp`), status, duration, sanitized argument summaries, sanitized result summaries, evidence references, and draft outputs.
- Argument summaries should record shape and intent only, for example whether a seed title / artist / provider id was present, not the raw title or artist text.
- Result summaries should record counts, mode ids, booleans, and evidence references, not full snapshots, raw provider responses, or full recommendation lists.
- Optional trace feedback is limited to short labels: `useful`, `not_enough_evidence`, or `incorrect`. Do not store free-form private feedback text in this state file.
- Agent-generated add/delete actions remain drafts until the controlled sync executor runs after user confirmation.

## Validation

Run local state validation:

```powershell
npm run check:state
```

Fresh clones may not have any `data/` files, so missing state files are skipped by default. To require state during release or local diagnostics:

```powershell
npm run check:state -- --require-mirror-plan --require-mirror-runs
```

If manual review decisions are part of the diagnostic bundle, require that state file too:

```powershell
npm run check:state -- --require-mirror-decisions
```

For an ordinary-user policy sync diagnostic bundle, require the product state files:

```powershell
npm run check:state -- --require-sync-policy --require-sync-preview --require-sync-runs
```

Machine-readable output:

```powershell
npm run check:state -- --json
```

The validation implementation lives in `src/state-schema.js`; the CLI wrapper is `scripts/check-state.mjs`.

Validation errors fail the command. Warnings do not fail the command; they flag stale-but-readable state that should be regenerated or re-resolved before real execution.

## Migration Policy

Schema version `1` is the initial public contract.

Migration helpers live in `src/state-migrations.js`; the CLI wrapper is `scripts/migrate-state.mjs`.

Dry-run the current local state:

```powershell
npm run migrate:state
```

Dry-run output never writes files. To migrate writable legacy state, pass `--write`; the script creates a timestamped backup first:

```powershell
npm run migrate:state -- --write
```

Default backups are stored under `data/state-migration-backups/`, which is ignored by Git. Custom paths are available for diagnostics:

```powershell
npm run migrate:state -- --data-dir .\data --backup-dir .\data\state-migration-backups
```

The current helper supports version `1` no-op validation and pre-public legacy files that had the same shape but no `version` field. Files from a newer schema version fail closed until the tool is upgraded.

Rules for future versions:

- Never silently reinterpret an older state file as a newer schema.
- Add a pure migration function before writing a new schema version.
- Keep migration tests with before/after fixtures.
- Treat `mirror-plan.json` as regenerable derived state. If migration is unsafe, prefer asking the user to regenerate the plan from snapshots.
- Treat `mirror-runs.json` as audit history. If migration is unsafe, preserve a timestamped backup and start a new log.
- Treat `mirror-decisions.json` as user-authored state. If migration is unsafe, preserve a timestamped backup and require explicit review before dropping decisions.
- Treat `sync-baseline.json`, `sync-tombstones.json`, `sync-runs.json`, `ai-provider-state.json`, `recommendation-shortlists.json`, and `agent-sessions.json` as user-authored, user-confirmed, or audit state.
- Treat `sync-preview.json` as regenerable derived state.
- Product APIs must validate policy state before every write.
- Keep destructive operations opt-in across migrations. A migrated remove operation must still require explicit `REMOVE <TARGET>` confirmation before execution.

## Corruption Handling

Writes use atomic temp-file replacement through `writeJson()`. If a process is interrupted and a state file still becomes invalid:

1. Run `npm run check:state -- --json` to identify the exact file and path.
2. For `mirror-plan.json`, regenerate the mirror plan.
3. For `mirror-runs.json`, move the broken file aside and let the next dry-run create a new log.
4. For `mirror-decisions.json`, move the broken file aside before saving new review decisions.
5. Use `npm run migrate:state` only after the file is valid JSON; migration intentionally does not repair corrupt JSON.
6. Keep the broken file for debugging if it contains no secrets before filing an issue.

`data/` can contain private library data and cookies. Do not attach raw state files to public issues without redaction.
