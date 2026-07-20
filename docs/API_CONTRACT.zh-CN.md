# Ordinary User API Contract

Last updated: 2026-07-12

This document defines the ordinary-user API contract for the policy-driven redesign. The core app-state, sync-mode, sync-check, sync-preview, addition execution, deletion confirmation, and deletion execution endpoints are implemented for the Apple-canonical compatibility path and are consumed by the first ordinary-user UI bridge in `web/product-app.js`. Apple-canonical execution now fans out sequentially across selected QQ / NetEase targets through the existing mirror executor and returns both aggregate counters and per-target results. Union / managed policy execution has controlled ready-add and confirmed-delete paths with dedicated `sync-runs` audit logs. Deterministic local AI profile, consent-gated model-assisted profile summaries, similar-track, recommendation, non-secret AI provider preferences, sync-item explanation, tombstone risk grouping, and read-only Agent tool endpoints are also implemented; richer external Agent adapters remain target contracts.

For target-only sections, this document is not a claim that all endpoints already exist.

The current implementation already has working legacy routes such as `/api/state`, `/api/mirror/*`, `/api/sync/plan`, `/api/sync/decision`, `/api/sync/ai/*`, and `/api/unified/*`. The new ordinary-user surface should be added without breaking those routes.

## Contract Principles

- Product APIs use ordinary-user concepts: app state, connected platforms, sync modes, sync preview, additions, possible deletions, AI assistant, and local drafts.
- Legacy mirror APIs remain available for CLI, tests, migration compatibility, and advanced settings.
- Product APIs may reuse current mirror internals for Apple canonical mode.
- Read endpoints must not trigger provider mutation.
- Addition execution and deletion execution are separate endpoints.
- Deletion execution requires a prior deletion confirmation record.
- Multi-target Apple-canonical deletion confirmation uses `DELETE FROM SELECTED TARGETS`; single-target deletion confirmation keeps `DELETE FROM QQ` or `DELETE FROM NETEASE`.
- AI and Agent endpoints must not receive cookies, raw provider responses, or full snapshots by default.
- Agent endpoints can return drafts and explanations, not direct provider mutations.

## Shared Response Shape

Successful responses:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

Failed responses:

```json
{
  "ok": false,
  "error": {
    "code": "needs_login",
    "message": "QQ 音乐需要重新登录",
    "details": {}
  }
}
```

Rules:

- `message` is safe for user display.
- `details` must not contain cookies, raw provider responses, AI API keys, or full snapshots.
- Validation errors use HTTP `400`.
- Missing credentials use HTTP `401`.
- Unsupported capabilities use HTTP `409`.
- Provider temporary failures use HTTP `502`.
- Unexpected local errors use HTTP `500` with sanitized details.

## Shared Types

Platform ids:

- `apple`
- `qq`
- `netease`

Sync mode ids:

- `canonical_mirror`
- `union_convergence`
- `managed_bidirectional`
- `read_only_analysis`

Platform connection states:

- `not_connected`
- `readable`
- `writable`
- `expired`
- `needs_attention`

Preview bucket ids:

- `will_add`
- `will_keep`
- `needs_confirmation`
- `may_delete`

Operation statuses:

- `ready`
- `needs_resolution`
- `needs_review`
- `blocked`
- `confirmed`
- `executed`
- `failed`

AI suggestion actions:

- `same_track`
- `different_version`
- `different_track`
- `needs_human`

Tombstone actions:

- `confirm_global_delete`
- `ignore`
- `restore`
- `current_platform_only`

## App And Platform APIs

### `GET /api/app/state`

Purpose:

- Return the first screen state for the ordinary-user app.
- This is read-only and must not contact external providers unless a cached local state refresh is explicitly requested by another endpoint.

Response data:

```json
{
  "platforms": [
    {
      "id": "apple",
      "label": "Apple Music",
      "state": "readable",
      "credentialPresent": true,
      "trackCount": 844,
      "lastReadAt": "2026-07-08T08:00:00.000Z",
      "capabilities": {
        "read": true,
        "write": false,
        "playlistList": false
      }
    }
  ],
  "syncMode": {
    "id": "canonical_mirror",
    "label": "以 Apple Music 为准"
  },
  "latestPreview": {
    "generatedAt": "2026-07-08T08:10:00.000Z",
    "counts": {
      "will_add": 85,
      "will_keep": 1817,
      "needs_confirmation": 51,
      "may_delete": 3
    },
    "convergence": {
      "exists": true,
      "status": "open_delta",
      "converged": false,
      "openOperations": 139,
      "refreshedAt": "2026-07-08T08:25:00.000Z",
      "refreshedTargets": ["qq", "netease"]
    }
  },
  "syncRuns": {
    "exists": true,
    "count": 2,
    "updatedAt": "2026-07-08T08:20:00.000Z"
  },
  "lastSyncRun": {
    "policy": "managed_bidirectional",
    "action": "remove",
    "target": "netease",
    "dryRun": true,
    "status": "completed"
  },
  "validation": {
    "live": {
      "ok": true,
      "targets": {
        "qq": {
          "ok": true,
          "status": "verified",
          "validatedAt": "2026-07-08T08:30:00.000Z"
        },
        "netease": {
          "ok": true,
          "status": "verified",
          "validatedAt": "2026-07-08T08:35:00.000Z"
        }
      }
    }
  },
  "nextAction": "review_confirmation"
}
```

Rules:

- `credentialPresent` is a local boolean used to suppress unnecessary login UI. It must never contain or imply any credential value, account id, or token metadata.
- `lastSyncRun` is a summary for ordinary users: policy, action, target, dry-run flag, status, timestamps, and add/remove counters.
- `lastSyncRun` must not expose idempotency keys, operation keys, playlist ids, raw provider payloads, cookies, API keys, or full run logs.

### Browser connection APIs

Implemented connection routes:

- `POST /api/apple/connect/start`: open the persistent Apple browser profile for a one-time official sign-in.
- `POST /api/apple/connect/check`: detect MusicKit authorization, locate the canonical Favorite Songs library playlist, import its tracks, and return only a sanitized status and count.
- `POST /api/qq/qr/start`: start Tencent's official login page in the dedicated browser profile and return transient QQ / WeChat QR PNG data plus a random expiring session key.
- `POST /api/qq/qr/check`: poll the same local browser session; on success the backend saves the write-capable credential without returning it.
- `POST /api/qq/browser/open` and `POST /api/qq/browser/check`: visible official-page fallback for Tencent's local QQ / WeChat quick-login controls.

Connection status fields are `code`, `message`, `done`, and `waiting`; Apple may also return a sanitized imported-song `count`. QR image data and session keys are short lived and must not be persisted. Responses must never include Apple user tokens, QQ cookies, OAuth codes, browser profile paths, account ids, or playlist ids. A later platform refresh may reuse the dedicated profiles in headless mode before calling provider APIs.

### `POST /api/platforms/read`

Purpose:

- Refresh one or more local platform snapshots through existing provider capture / read flows.
- This endpoint reads provider data but does not mutate provider libraries.

Request:

```json
{
  "platforms": ["apple", "qq", "netease"],
  "mode": "cached_or_refresh"
}
```

Response data:

```json
{
  "platforms": [
    {
      "id": "qq",
      "state": "writable",
      "trackCount": 2028,
      "lastReadAt": "2026-07-08T08:11:00.000Z"
    }
  ]
}
```

Rules:

- If credentials are expired, return `needs_login`.
- Do not expose cookie values.
- QQ playlist ids may be returned only as sanitized playlist metadata.

## Sync Mode And Preview APIs

### `GET /api/sync/modes`

Purpose:

- Return available sync strategies and plain-language risk explanations.

Response data:

```json
{
  "modes": [
    {
      "id": "canonical_mirror",
      "label": "以 Apple Music 为准",
      "recommended": true,
      "risk": "medium",
      "deletionRequiresConfirmation": true
    },
    {
      "id": "union_convergence",
      "label": "合并所有平台",
      "recommended": false,
      "risk": "low",
      "deletionRequiresConfirmation": true
    }
  ]
}
```

### `POST /api/sync/check`

Purpose:

- Generate or refresh a sync preview.
- This is read-only and must not mutate provider libraries.

Request:

```json
{
  "mode": "canonical_mirror",
  "platforms": ["apple", "qq", "netease"],
  "source": "apple",
  "targets": ["qq", "netease"],
  "useAiReview": false
}
```

Response data:

```json
{
  "previewId": "preview-20260708-081300",
  "generatedAt": "2026-07-08T08:13:00.000Z",
  "mode": "canonical_mirror",
  "counts": {
    "will_add": 85,
    "will_keep": 1817,
    "needs_confirmation": 51,
    "may_delete": 3
  },
  "blocked": []
}
```

Rules:

- `canonical_mirror` can delegate to the current mirror engine.
- `union_convergence` treats platform gaps as additions by default.
- `managed_bidirectional` requires a valid baseline before deletion propagation can be considered.
- `read_only_analysis` must produce no executable mutations.

### `GET /api/sync/preview`

Purpose:

- Return the current preview grouped for the ordinary-user screen.

Query:

- `previewId`: optional.
- `bucket`: optional, one of `will_add`, `will_keep`, `needs_confirmation`, `may_delete`.
- `limit`: optional.
- `cursor`: optional.

Response data:

```json
{
  "previewId": "preview-20260708-081300",
  "bucket": "needs_confirmation",
  "items": [
    {
      "id": "op-001",
      "bucket": "needs_confirmation",
      "status": "needs_review",
      "title": "Song",
      "artist": "Artist",
      "sourcePlatforms": ["apple"],
      "targetPlatforms": ["qq"],
      "evidence": [
        "duration_close",
        "musicbrainz_match"
      ],
      "aiSuggestion": {
        "action": "same_track",
        "confidence": 0.91,
        "reason": "ISRC and duration support the match."
      }
    }
  ],
  "nextCursor": null
}
```

Rules:

- `will_add` and `may_delete` must not be confirmed together.
- `may_delete` items must include the confirmation state and destructive target metadata only after sanitization.
- Raw provider response fragments are not returned.
- Tracks may include a normalized public `artworkUrl`. Missing artwork stays empty; the API must not substitute unrelated demo covers.
- Items may include sanitized `relatedMatches` for the same source recording so QQ and NetEase versions can be compared without merging their operation ids or decisions.

### `POST /api/sync/media`

Purpose:

- Resolve real artwork and a short-lived playable URL for one source, target, candidate, resolved candidate, or alternative that already belongs to the current preview.
- Support human A/B listening during manual review without exposing provider credentials or treating audio as AI input.

Request:

```json
{
  "previewId": "preview-20260708-081300",
  "operationId": "op-001",
  "role": "alternative",
  "alternativeIndex": 0,
  "alignWithSource": true
}
```

Rules:

- `previewId` must match the current preview and `operationId` must exist in it.
- `role` is limited to `source`, `target`, `candidate`, `resolved`, or `alternative`; alternative indexes are bounds-checked.
- QQ and NetEase playback URLs are resolved on demand, cached only in process memory, and never persisted to state, logs, AI evidence, or Agent traces.
- `alignWithSource = true` locally fingerprints the selected version and the Apple source with FFmpeg Chromaprint. The response may include `media.alignment.status = aligned | not_aligned | unavailable`, `confidence`, `offsetFromSourceSeconds`, source/target start offsets, common overlap, and the bounded preview duration.
- Fingerprints and audio bytes stay in process memory and are never persisted or sent to AI / Agent providers. A score below the reliability threshold must return `not_aligned` with zero offset rather than a guessed alignment.
- The UI never autoplays, preserves the source-relative musical position while switching reliably aligned versions, and stops playback after at most 30 seconds. Only one version may play at a time.
- Copyright, membership, or region failures return `playable = false` with an ordinary-user reason; they are not treated as match evidence or provider failure.
- The endpoint is not an arbitrary URL fetch or audio proxy. It can resolve only tracks already present in the validated preview.

## Review And Execution APIs

### `GET /api/sync/baseline`

Purpose:

- Return the saved product baseline, current baseline diff summary, sanitized change examples, and tombstone decision summary without exposing raw snapshots.

Rules:

- Missing baseline returns `baseline.exists = false`, not an error.
- Response data is summary-oriented: platform counts, timestamps, diff counts, tombstone action counts, and a small `diff.examples[]` list with title, artist, album, duration, platform, action, and compact evidence labels only.
- `diff.examples[]` must not expose raw provider payloads, cookies, API keys, match tokens, tombstone keys, provider track ids, or full snapshots.

### `POST /api/sync/baseline/save`

Purpose:

- Save the current selected platform snapshots as the next confirmed sync baseline.

Request:

```json
{
  "platforms": ["apple", "qq", "netease"],
  "targets": ["qq", "netease"],
  "policy": "managed_bidirectional",
  "source": "product-ui",
  "requireConverged": true,
  "previewId": "preview-20260708-081300",
  "activateManaged": true
}
```

Rules:

- All requested platform snapshots must have been read before saving.
- This endpoint only writes local `sync-baseline` state; it never mutates provider libraries.
- The saved baseline must pass `sync-baseline` state validation.
- Ordinary-user UI calls must set `requireConverged = true`, which requires the current `sync-preview.convergence` to be checked, non-skipped, and `converged`.
- `previewId` is optional for low-level initialization, but when supplied it must match the current preview to prevent saving a stale baseline.
- Low-level tools may omit `requireConverged` only for explicit first-baseline initialization or controlled tests.
- When `activateManaged = true`, the server writes `sync-policy.policy = "managed_bidirectional"`, keeps `deletionPolicy = "ask"`, rebuilds the product preview from the saved baseline, and returns `activatedPolicy`.
- `activateManaged` is the ordinary-user bridge from an Apple-canonical refresh into ongoing automatic additions with tombstone-gated deletions.

### `POST /api/sync/tombstones`

Purpose:

- Record one or more user decisions for baseline deletion signals.

Single-item request:

```json
{
  "operationId": "sync-00042",
  "action": "ignore",
  "note": ""
}
```

Batch request:

```json
{
  "action": "current_platform_only",
  "items": [
    {
      "operationId": "sync-00042",
      "tombstoneKey": "tombstone|qq|qq:id:123",
      "platform": "qq"
    }
  ]
}
```

Rules:

- Supported actions are `confirm_global_delete`, `ignore`, `restore`, `current_platform_only`, and `clear`.
- `confirm_global_delete` requires `confirmText` in the form `CONFIRM GLOBAL DELETE FROM <PLATFORM>`.
- Batch requests support non-destructive decisions only: `ignore`, `restore`, `current_platform_only`, and `clear`.
- `confirm_global_delete` is intentionally single-item only; each global delete must pass the exact confirmation flow independently.
- The endpoint updates local `sync-tombstones` state and refreshes the current policy preview by default.
- It must not execute provider deletions. Actual deletes still require the controlled deletion executor.

### `POST /api/sync/confirm-review`

Purpose:

- Save human decisions for `needs_confirmation` items.

Request:

```json
{
  "previewId": "preview-20260708-081300",
  "decisions": [
    {
      "operationId": "op-001",
      "decision": "same_track",
      "note": ""
    }
  ]
}
```

Rules:

- This writes local decision state only.
- It must not mutate provider libraries.
- Decisions must be reversible or clearable.

### `POST /api/sync/execute-additions`

Purpose:

- Execute confirmed and resolved additions only.

Request:

```json
{
  "previewId": "preview-20260708-081300",
  "operationIds": ["op-010", "op-011"],
  "targets": ["qq", "netease"],
  "dryRun": false,
  "resolve": true,
  "resolveLimit": 50,
  "searchLimit": 12,
  "refreshAfterWrite": true
}
```

Rules:

- This endpoint must ignore deletion operations even if they are supplied.
- Unresolved additions are blocked, not treated as success.
- Real execution must use idempotency keys and run logs.
- In `canonical_mirror`, execution fans out through the Apple-source mirror executor for each selected target.
- In `union_convergence` and `managed_bidirectional`, execution consumes the current `sync-preview` policy plan and only writes ready add operations for writable targets.
- Real execution requires fresh target live-validation evidence for every written QQ / NetEase target unless `force = true`; dry-runs do not require live validation.
- Policy add execution writes sanitized per-target entries to `data/sync-runs.json`; Apple canonical compatibility execution continues to write `data/mirror-runs.json`.
- Policy add execution may resolve pending target catalog matches when target credentials are available. Missing credentials keep additions blocked instead of mutating providers.
- After real policy writes, `refreshAfterWrite` defaults to true: the server refreshes written target snapshots and rebuilds the current `sync-preview`. Dry-runs return `convergence.skippedReason = "dry_run"` without contacting providers.
- `read_only_analysis` must reject addition execution.

### `POST /api/sync/resolve-additions`

Purpose:

- Search target-platform catalogs for pending addition items in the current `sync-preview`.
- Refresh the local preview with resolved target tracks, review candidates, or not-found status before the user runs addition execution.

Request:

```json
{
  "targets": ["qq", "netease"],
  "operationIds": ["op-010"],
  "resolveLimit": 50,
  "searchLimit": 12,
  "bucket": "will_add"
}
```

Rules:

- This endpoint is read-only against provider libraries: it may search catalogs, but it must not add or remove playlist tracks.
- Missing credentials produce skipped per-target resolution results instead of provider mutation.
- Resolved items are persisted back into `data/sync-preview.json` as sanitized target-track summaries.
- The response includes aggregate and per-target counts: processed, resolved, review, notFound, and skipped.
- `read_only_analysis` rejects resolution because it does not prepare write actions.

### `POST /api/sync/addition-decision`

Purpose:

- Let an ordinary user accept, choose, skip, or clear a low-confidence target-platform add candidate in the current `sync-preview`.
- Convert accepted candidates into ready additions that still run through `POST /api/sync/execute-additions`.

Request:

```json
{
  "operationId": "sync-00010",
  "action": "accept_candidate",
  "alternativeIndex": 0
}
```

Actions:

- `accept_candidate`: uses the current `candidateTrack` as `resolvedTargetTrack` and marks the add operation `ready`.
- `select_alternative`: uses `alternatives[alternativeIndex]` as `resolvedTargetTrack` and marks the add operation `ready`.
- `skip`: marks the add operation `blocked` with `blockedReason = "user_skipped_add_candidate"`.
- A skipped add remains write-blocked, but product preview groups it under `not_found` instead of returning it to `needs_confirmation`.
- `clear`: clears the manual add decision and returns the item to review / resolution state.

Rules:

- This endpoint only mutates local `data/sync-preview.json`; it does not contact provider APIs.
- A ready add from this endpoint is still only a preview decision. Provider writes require the separate addition execution endpoint.
- Skipped additions must not be counted as successful writes and must remain blocked during execution.
- The persisted decision stores sanitized operation metadata only, not provider raw payloads.

### `POST /api/sync/addition-decisions`

Purpose:

- Batch-apply a safe add-candidate decision to explicitly selected operations from the current preview list.
- Support ordinary-user bulk review when many low-confidence add candidates share the same visible handling choice.

Request:

```json
{
  "operationIds": ["sync-00010", "sync-00011"],
  "action": "accept_candidate"
}
```

Actions:

- `accept_candidate`: accepts each selected operation's current `candidateTrack`.
- `skip`: marks each selected operation blocked with `blockedReason = "user_skipped_add_candidate"`.
- Skipped operations are final user decisions for the current candidate set, so preview counts place them in `not_found` while keeping provider writes blocked.
- `clear`: clears selected manual add decisions.

Rules:

- The caller must pass explicit `operationIds`; the backend does not support hidden "apply to all matching" selectors.
- The batch size is capped at 200 operation ids.
- `select_alternative` is intentionally not supported in batch mode because alternatives are per-track judgments.
- Items without an acceptable candidate are skipped and reported in `skippedItems`.
- This endpoint only mutates local `data/sync-preview.json`; provider writes still require `POST /api/sync/execute-additions`.
- The response includes `batchId`, `requested`, `changed`, `skipped`, changed `operationIds`, and a small preview of changed operations for audit UI.

### `POST /api/sync/identity-decision`

Purpose:

- Save an ordinary user's judgment after comparing the Apple source recording with an existing QQ / NetEase version.
- Persist the durable judgment, then incrementally replace only operations sharing its stable `decisionKey`; a later explicit full rebuild must derive the same action shape.

Actions:

- `keep`: treat the target version as the same recording and rebuild it as a safe `keep` operation.
- `separate`: treat the versions as different and rebuild the original review into the required Apple-version addition and / or target-version removal drafts.
- `clear`: remove the durable judgment and return the relationship to the review queue.

Rules:

- The endpoint writes only `data/mirror-decisions.json` and incrementally updated local preview state; it never calls a provider write API or reruns full-library matching.
- A `separate` judgment cannot execute deletion. The resulting removal remains behind dry-run, live-validation, recovery-point, and explicit deletion-confirmation gates.
- The stable `decisionKey` is derived from review reason plus source / target identities, so the decision survives preview regeneration and operation-id changes.
- Identity-decision mutations are serialized locally to avoid lost updates from rapid repeated clicks. The response reports `updateMode = "incremental"` and returns the requested preview bucket directly from the updated in-memory plan.
- A `separate` response also returns `resolutionOperationIds`. The web client immediately searches those target-platform additions and shows an explicit per-row retry when no candidate is available; candidate search is read-only and does not execute playlist writes.

### `POST /api/sync/confirm-deletions`

Purpose:

- Create or update deletion confirmation state for possible deletions.

Request:

```json
{
  "previewId": "preview-20260708-081300",
  "decisions": [
    {
      "operationId": "op-090",
      "tombstoneAction": "confirm_global_delete",
      "confirmText": "DELETE FROM QQ"
    }
  ]
}
```

Rules:

- Confirmation text is intentionally separate from addition execution.
- AI suggestions cannot create confirmed global deletions without this endpoint.
- Tombstone state must record the user action and timestamp.

### `POST /api/sync/execute-deletions`

Purpose:

- Execute deletion operations that already have explicit confirmation.

Request:

```json
{
  "previewId": "preview-20260708-081300",
  "operationIds": ["op-090"],
  "targets": ["netease"],
  "dryRun": false,
  "refreshAfterWrite": true
}
```

Rules:

- This endpoint must fail if any requested operation lacks prior deletion confirmation.
- This endpoint must ignore addition operations even if they are supplied.
- Provider mutation requires target provider ids that are safe for deletion.
- QQ `mid` alone is not enough for deletion.
- In `canonical_mirror`, this endpoint uses the mirror delete confirmation records created by `POST /api/sync/confirm-deletions`.
- In `managed_bidirectional`, this endpoint consumes the current policy `sync-preview` and only executes remove operations generated from `confirm_global_delete` tombstones.
- Real execution requires fresh target live-validation evidence for every written QQ / NetEase target unless `force = true`; dry-runs do not require live validation.
- Managed policy delete execution writes sanitized per-target entries to `data/sync-runs.json`; Apple canonical compatibility execution continues to write `data/mirror-runs.json`.
- `union_convergence` and `read_only_analysis` must reject deletion execution.
- Confirmed policy deletes that lack safe provider ids remain blocked and are reported without provider mutation.
- Every real deletion refreshes the selected target snapshots and persists a validated `data/sync-backups.json` recovery point before the first provider delete call. If refresh, playlist-identity discovery, checksum validation, or backup persistence fails, deletion fails closed.
- Multi-target deletion preflights every target and every confirmation before any provider call, preventing one target from being deleted before a later target fails validation.
- After real managed policy deletes, `refreshAfterWrite` defaults to true and rebuilds the current `sync-preview`; refresh failures are returned as `convergence.status = "refresh_failed"` without hiding the already completed provider write result.

### `GET /api/sync/backups`

Purpose:

- Return bounded, sanitized pre-delete recovery points and restore-run summaries.

Rules:

- Responses include counts, timestamps, checksums, and integrity status only.
- Playlist ids, provider track ids, full track metadata, cookies, and raw provider payloads are never returned.

### `POST /api/sync/backups`

Purpose:

- Refresh selected QQ / NetEase liked playlists and create a recovery point without mutating a provider.

Rules:

- A writable playlist identity is required for every target; backup creation fails closed otherwise.
- Raw provider payloads are removed and a SHA-256 checksum covers the complete compact track list.
- The latest five recovery points are retained by default.

### `POST /api/sync/backups/restore`

Purpose:

- Preview or execute an additions-only restore from one recovery point.

Request:

```json
{
  "backupId": "sync-backup-...",
  "dryRun": false,
  "confirmText": "RESTORE BACKUP sync-backup-..."
}
```

Rules:

- Restore defaults to dry-run and reports only per-target counts.
- Real restore requires the exact backup-specific confirmation text and fresh live-validation evidence.
- The checksum and target playlist identity are verified before writes.
- Restore adds only backup tracks missing from the current target; it never removes current tracks.
- Targets are refreshed after writes and verification fails if any restorable track remains missing.

### `POST /api/sync/convergence`

Purpose:

- Recheck whether the ordinary-user sync preview has converged after execution or manual refresh.

Request:

```json
{
  "targets": ["qq", "netease"],
  "refreshTarget": true
}
```

Rules:

- This endpoint does not mutate provider libraries.
- In `canonical_mirror`, one requested target keeps the existing single-target mirror compatibility path; multiple requested targets refresh and rebuild one combined product preview so checking consistency cannot silently drop QQ or NetEase from the result.
- In policy modes, it optionally refreshes selected target snapshots, rebuilds the current `sync-preview`, and stores `sync-preview.convergence`.
- `refreshTarget: false` is allowed for local non-mutating smoke checks that only recompute from existing snapshots.
- Responses use summary-only counts and sanitized snapshot summaries; they must not expose credentials or raw provider payloads.

## Automatic Sync APIs

### `GET /api/auto-sync`

Purpose:

- Return sanitized automatic-sync settings, readiness gates, selected snapshot freshness, live-validation summaries, and bounded run history.
- This endpoint is read-only and never contacts providers.

Rules:

- Responses must not expose cookies, API keys, playlist ids, provider track ids, raw snapshots, or the execution-lock token.
- Readiness must explain a missing required baseline, stale / missing snapshots, read-only policy, and missing target live validation in ordinary-user language. `readiness.baseline` exposes only `exists`, `savedAt`, and policy-scoped `required` fields.

### `POST /api/auto-sync`

Purpose:

- Save automatic-sync settings for QQ Music and / or NetEase Cloud Music.

Request:

```json
{
  "enabled": true,
  "intervalMinutes": 60,
  "targets": ["qq", "netease"],
  "refreshApple": true,
  "refreshTargets": true,
  "autoExecuteAdditions": true,
  "requireBaseline": true,
  "maxSourceAgeMinutes": 1440
}
```

Rules:

- Enabling fails closed unless the policy, snapshot freshness, live-validation, and any policy-required baseline gates all pass. `canonical_mirror` does not require a historical baseline; baseline-dependent policies still do when `requireBaseline` is true.
- Apple is not an accepted target.
- The interval is limited to 15 minutes through 24 hours.
- This endpoint saves local settings only; it does not run a sync or mutate a provider.
- There is no setting that permits scheduled deletion.

### `POST /api/auto-sync/run`

Purpose:

- Run an immediate automatic-sync check or, after explicit user intent, execute ready additions.

Request:

```json
{
  "dryRun": true,
  "executeAdditions": false
}
```

Rules:

- Manual API calls default to dry-run.
- Real additions require automation to be enabled, `autoExecuteAdditions = true`, all readiness gates to pass, and `executeAdditions = true`.
- Scheduled runs may execute ready additions only after the same readiness gates pass.
- Possible deletions and deletion signals are returned as attention items. This route never calls the deletion executor.
- Apple refresh must come from the MusicKit API, match the last trusted playlist identity, and pass the large-count-drop guard. DOM fallback is not authoritative for automatic sync.
- A process-local guard and `data/auto-sync.lock` prevent overlapping runs across server processes. Lock conflicts return HTTP `409`.
- Run history and errors are sanitized before persistence and response.

## Validation APIs

### `GET /api/validation/live`

Purpose:

- Return local live add/remove validation evidence status for QQ Music and NetEase Cloud Music.
- This endpoint is read-only. It never creates playlists, searches catalogs, adds tracks, removes tracks, or contacts providers.

Rules:

- Reads sanitized reports such as `reports/live-validation-qq.json` and `reports/live-validation-netease.json`.
- Uses the same report schema and freshness rules as the strict release evidence gate.
- Response can include status, validation time, age, track title / artist, snapshot count progression, and verified mutation booleans.
- Response must not include cookies, tokens, raw provider responses, user ids, or playlist ids.

Response data:

```json
{
  "ok": true,
  "maxAgeDays": 14,
  "targets": {
    "qq": {
      "target": "qq",
      "ok": true,
      "status": "verified",
      "message": "Live add/remove validation evidence is complete.",
      "validatedAt": "2026-07-08T08:30:00.000Z",
      "createdPlaylist": true,
      "track": {
        "title": "七里香",
        "artist": "周杰伦"
      },
      "mutations": {
        "addVerified": true,
        "removeVerified": true,
        "added": 1,
        "removed": 1
      }
    }
  }
}
```

### `POST /api/validation/live/run`

Purpose:

- Run one local disposable-playlist add/remove validation for QQ Music or NetEase Cloud Music from the product UI or a local HTTP client.
- This endpoint is intentionally not part of the ordinary sync path. It is a guarded release/readiness action used before enabling real writes.

Request:

```json
{
  "target": "qq",
  "query": "artist title",
  "confirm": "DISPOSABLE_PLAYLIST",
  "playlistId": "",
  "playlistName": "music-likes-sync disposable validation"
}
```

Rules:

- `target` must be `qq` or `netease`.
- `query` is required and is sent only to the selected music provider search API.
- `confirm` must exactly equal `DISPOSABLE_PLAYLIST`; otherwise no provider call is made.
- `playlistId` is optional. When omitted, the backend attempts to create a private/disposable validation playlist through the provider adapter.
- On success the backend writes the full local report to `reports/live-validation-<target>.json` for `npm run check:release:strict`.
- The HTTP response returns only the same sanitized target summary as `GET /api/validation/live`; it must not expose cookies, tokens, user ids, playlist ids, target track ids, or raw provider responses.
- If saved credentials are missing or playlist creation is unsupported, the request fails before mutation and returns a normal JSON error.

Response data:

```json
{
  "target": "qq",
  "ok": true,
  "status": "verified",
  "reportWritten": true,
  "validation": {
    "target": "qq",
    "ok": true,
    "status": "verified",
    "track": {
      "title": "七里香",
      "artist": "周杰伦"
    },
    "mutations": {
      "addVerified": true,
      "removeVerified": true
    }
  }
}
```

## AI Product APIs

### `GET /api/ai/provider`

Purpose:

- Return the configured non-secret AI provider preferences.

Rules:

- Response includes provider id, model, base URL, batch size, and whether a local key is available.
- Response must never include API keys or raw provider payloads.

### `POST /api/ai/provider`

Purpose:

- Save non-secret AI provider preferences to `data/ai-provider-state.json`.

Request:

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "baseUrl": "https://api.deepseek.com",
  "batchSize": 12
}
```

Rules:

- API keys are ignored by this endpoint and must stay in `.env`, environment variables, or a future local secret store.
- The saved state must pass `ai-provider-state` validation.

### `POST /api/ai/provider/test`

Purpose:

- Verify that the configured provider can complete a strict JSON health check.

Request:

```json
{
  "consent": true,
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "baseUrl": "https://api.deepseek.com"
}
```

Rules:

- Requires `consent: true` because it sends a small test prompt to the configured provider.
- API keys are not persisted; they must come from `.env`, environment variables, or a one-time request field.
- Response reports provider, model, usage, and JSON capability status, but never echoes API keys or raw provider payloads.
- Missing consent or missing API key fails before any provider request.

### `POST /api/ai/explain`

Purpose:

- Explain one ordinary-user sync preview item with sanitized evidence.

Request:

```json
{
  "operationId": "sync-00042",
  "useModel": false
}
```

Rules:

- Deterministic local explanation is the default and does not require an AI key.
- Model-backed explanation requires `consent: true` before sanitized track evidence is sent to the configured provider.
- Explanations must not execute provider writes, create tombstone confirmations, expose credentials, or expose raw provider payloads.
- A tombstone explanation must describe the item as a deletion signal, not proof of global deletion.

### `POST /api/ai/tombstones/analyze`

Purpose:

- Group ordinary-user deletion signals by risk and handling state.
- Help users decide which tombstones still need review before any deletion execution.

Request:

```json
{
  "limit": 50,
  "useModel": false
}
```

Response data:

```json
{
  "total": 2,
  "summary": {
    "unhandled": 2,
    "confirmedGlobalDeletes": 0,
    "safeDecisions": 0,
    "highestRisk": "high"
  },
  "groups": [
    {
      "id": "needs_review",
      "label": "未处理高风险",
      "risk": "high",
      "count": 2
    }
  ]
}
```

Rules:

- Deterministic local grouping is the default and does not require an AI key.
- Model-backed batch analysis requires `consent: true` before sanitized track evidence is sent to the configured provider.
- The endpoint must not execute provider writes, create tombstone confirmations, expose credentials, or expose raw provider payloads.
- AI suggestions cannot create confirmed global deletions; `confirm_global_delete` still requires the explicit tombstone confirmation flow.

### `POST /api/ai/review`

Purpose:

- Generate suggestions for uncertain sync items.

Rules:

- Requires explicit consent before sending track evidence to an external provider.
- Payloads include minimal track metadata, evidence summaries, risk signals, and support signals.
- Payloads do not include cookies, user ids, playlist ids, or full snapshots by default.
- Suggestions are saved as suggestions only; applying them requires `POST /api/sync/confirm-review`.

### `POST /api/ai/additions/review`

Purpose:

- Batch-review target-platform search candidates for low-confidence addition operations in the current product sync preview.

Rules:

- Requires `consent: true` before sending the selected candidates' minimized evidence to the configured AI provider.
- Inputs are limited to already searched candidates and up to three local alternatives; the model cannot invent or search for a new provider track.
- MusicBrainz cache evidence, ISRC, title / artist aliases, album, duration, deterministic scores, and version-risk signals may be included. Cookies, API keys, playlist ids, user ids, raw snapshots, and raw provider payloads are forbidden.
- Results are persisted as local `aiReview` drafts on the matching preview operations with `add`, `skip`, or `needs_human`, confidence, evidence, reason, and safety-guard status.
- AI review never changes the operation's executable status, accepts a candidate, skips a candidate, or writes a provider playlist. The user must still apply an addition decision and run the controlled addition executor.
- Safety downgrades model suggestions to `needs_human` when duration, version cues, existing-target presence, action consistency, or speculative evidence fails deterministic checks.
- Non-human model actions below the confidence floor are downgraded. An `add` draft also requires same-ISRC evidence or at least three strong deterministic dimensions across title, artist, album, and duration; model-memory alias claims are not sufficient evidence.

### `POST /api/ai/identity/review`

Purpose:

- Batch-review Apple-vs-target identity conflicts that already appear in the human review queue.

Rules:

- Requires `consent: true`; only minimized metadata, deterministic scores, ISRC / MusicBrainz evidence, duration, aliases, and version-risk signals may leave the local process.
- The model can return only `keep`, `separate`, or `needs_human` drafts. Deterministic safety checks can downgrade unsafe or speculative output to `needs_human`.
- Drafts persist in `data/mirror-ai-suggestions.json` and are reattached by stable `decisionKey` whenever the product preview is rebuilt.
- AI output never writes `data/mirror-decisions.json`, changes an operation to executable, or calls provider APIs. Only `POST /api/sync/identity-decision` records the user's final judgment.
- Audio is human-only evidence: preview URLs and audio bytes are never included in AI requests.

### `POST /api/ai/profile`

Purpose:

- Generate or refresh a music taste profile.
- Provide a deterministic local profile without requiring an AI key.
- Optionally add a model-assisted `aiSummary` from sanitized aggregate profile evidence.

Request:

```json
{
  "refresh": true,
  "useModel": false,
  "consent": false
}
```

Rules:

- Deterministic profile generation should work without an AI key.
- AI-enhanced summaries require `consent: true` before aggregate profile evidence is sent to the configured provider.
- AI-enhanced summaries use aggregate or sampled context by default; they must not send cookies, raw snapshots, raw provider responses, full playlist ids, or local file paths.
- Raw AI payloads are not persisted unless debug mode is explicitly enabled.
- The persisted profile may include normalized `aiSummary` and sanitized model metadata, but never the raw provider response.

### `POST /api/ai/similar`

Purpose:

- Find tracks similar to a seed track with explanations.
- Current implementation searches local cleaned library evidence only.

Rules:

- Results are local candidates.
- Results do not write to provider platforms.

### `POST /api/ai/recommend`

Purpose:

- Generate recommendation candidates and optionally save a local shortlist.
- Current implementation creates local candidates from already available platform snapshots / unified library state and can save a local shortlist.
- Optionally add a model-assisted summary and candidate reranking from sanitized profile / recommendation evidence.

Request:

```json
{
  "limit": 8,
  "excludeApple": true,
  "refreshProfile": false,
  "saveShortlist": true,
  "shortlistName": "Product assistant picks",
  "useModel": false,
  "consent": false
}
```

Rules:

- Already-liked songs can be excluded.
- Recommendations must include a reason and source.
- Deterministic local recommendations are the default and do not require an AI key.
- Model-assisted recommendations require `consent: true` before sanitized aggregate profile evidence and local recommendation candidates are sent to the configured provider.
- The model can summarize and rerank only candidates already present in the request evidence; it cannot create new songs, browse, search external catalogs, or execute writes.
- The response may include normalized `aiSummary`, per-candidate `aiReason`, sanitized model metadata, and token usage, but never raw provider payloads or API keys.
- Writing recommendations to a provider playlist is a separate sync operation.

## Agent APIs

### `GET /api/agent/tools`

Purpose:

- Return the optional Agent tool registry.
- Current implementation returns a read-only plus local-draft tool registry and rejects credential or direct mutation-shaped tools.

Allowed tools:

- `get_library_summary`
- `get_sync_policy`
- `get_sync_preview`
- `get_track_evidence`
- `get_baseline_diff`
- `get_review_queue`
- `get_taste_profile`
- `find_similar_tracks`
- `recommend_by_profile`
- `save_local_shortlist`
- `draft_sync_operations`

Forbidden tools:

- direct provider add/delete
- cookie read/write
- deletion confirmation bypass
- raw state dump by default

### `GET /api/agent/sessions`

Purpose:

- Return local Agent session trace summaries for debugging and audit.
- Current implementation returns only sanitized trace metadata, not full tool results.

Rules:

- Trace output may include `tool`, `source`, `status`, `readOnly`, `localDraft`, `durationMs`, `argumentsSummary`, `resultSummary`, and `evidenceRefs`.
- Trace output must not include raw user prompts, raw seed titles/artists, cookies, API keys, full snapshots, raw provider payloads, or direct provider mutation details.
- Trace output is local audit state only; it cannot be used as write confirmation.

### `POST /api/agent/chat`

Purpose:

- Support natural-language interaction backed by the same domain tools.
- Current implementation routes simple natural-language prompts to deterministic local tools and the ordinary-user AI page can call it directly.
- `music-likes-sync agent-mcp` exposes the same registry as a local stdio MCP server for Hermes, local Agent runtimes, or other MCP clients.

Rules:

- Agent writes are drafts.
- Agent cannot execute provider mutations.
- Agent cannot access cookies or AI API keys.
- `get_track_evidence` may return sanitized source / target metadata, match signals, ISRC, and external catalog evidence, but it must not expose provider track ids or mids.
- Tool traces must be sanitized and local.
- Trace feedback accepts only short labels (`useful`, `not_enough_evidence`, `incorrect`), not free-form private text.
- MCP `tools/call` must use the same `src/agent-tools.js` permission gate as `/api/agent/chat`.

## Compatibility Mapping

| Product API | May reuse current route/module | Notes |
|---|---|---|
| `GET /api/app/state` | `GET /api/state`, workflow state readers | Rename and reshape for ordinary UI. |
| `POST /api/platforms/read` | Apple / QQ / NetEase snapshot and browser capture routes | Keep credential values hidden. |
| `POST /api/sync/check` | `/api/mirror/plan`, `buildMirrorSyncPlan`, future policy core | Read-only. |
| `GET /api/sync/preview` | `data/mirror-plan.json`, `data/sync-preview.json` | Group into user buckets. |
| `POST /api/sync/media` | Apple catalog media, QQ vkey, NetEase song URL | Operation-scoped, ephemeral, no autoplay or persistence. |
| `POST /api/sync/confirm-review` | `/api/mirror/decision`, `/api/mirror/decisions` | Local decisions only. |
| `POST /api/sync/execute-additions` | `/api/mirror/apply` with add-only selection; policy `sync-preview` ready-add execution | No deletion operations. |
| `POST /api/sync/confirm-deletions` | mirror deletion confirmation state; policy tombstone state | Local confirmation only. |
| `POST /api/sync/execute-deletions` | `/api/mirror/apply` with remove-only selection; policy `sync-preview` confirmed-tombstone delete execution | Requires prior confirmation. |
| `GET /api/sync/backups` | `data/sync-backups.json` sanitized summaries | Read-only; omits playlist and track ids. |
| `POST /api/sync/backups` | target snapshot refresh plus compact checksummed local recovery state | No provider mutation. |
| `POST /api/sync/backups/restore` | additions-only provider recovery plus post-write verification | Dry-run by default; exact confirmation for writes. |
| `POST /api/sync/convergence` | `/api/mirror/convergence`; policy `sync-preview` refresh/rebuild | Read-only provider refresh plus local derived state. |
| `POST /api/ai/review` | `/api/mirror/ai/review`, `/api/sync/ai/review` | Product consent and evidence schema wrapper. |
| `GET /api/agent/tools` | `src/agent-tools.js`, `src/agent-mcp.js` | Optional HTTP and stdio MCP integration. |
| `GET /api/agent/sessions` | `data/agent-sessions.json` | Sanitized local Agent trace audit summaries. |
| `POST /api/agent/trace-feedback` | `data/agent-sessions.json` | Stores a short user feedback label on one sanitized Agent trace. |

## Implementation Order

1. Add response/type helpers without changing existing routes.
2. Add `GET /api/app/state` and `GET /api/sync/modes`.
3. Add `POST /api/sync/check` and `GET /api/sync/preview` for Apple canonical mode using mirror internals.
4. Add addition/deletion execution wrappers that keep execution separated.
5. Add policy-core support for union, managed bidirectional, read-only analysis, and dedicated policy run logs.
6. Add AI product wrappers and consent checks.
7. Add Agent tool registry and optional HTTP / stdio MCP adapter.

Every step must preserve `/api/mirror/*` compatibility until the ordinary-user UI and smoke tests fully cover the replacement flow. The React UI is now the default Web entry, while the legacy mirror workbench remains available at `/workbench/` as the write-diagnostic compatibility surface until live provider validation and full policy execution are complete.
