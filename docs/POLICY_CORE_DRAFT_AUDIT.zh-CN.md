# Policy Core Draft Audit

Last updated: 2026-07-08

This document audits the current untracked `src/sync-policy.js` draft before it is exposed through ordinary-user HTTP APIs. It is not an implementation acceptance report for the full product.

## Scope

Reviewed files:

- `src/sync-policy.js`
- `src/mirror-sync.js`
- `src/unified.js`
- `test/sync-policy.test.js`
- `src/state-schema.js`
- `src/state-migrations.js`

Current status:

- `src/sync-policy.js` contains a useful policy-core implementation candidate for policy enumeration, Apple canonical wrapping, union-based operations, baseline diffing, and tombstone decisions.
- `test/sync-policy.test.js` now imports `src/sync-policy.js` and covers the first set of draft acceptance invariants.
- Public state validators now accept `data/sync-policy.json`, `data/sync-baseline.json`, `data/sync-preview.json`, `data/sync-tombstones.json`, and `data/sync-runs.json`.
- Migration checks now include those policy-driven v1 state files and the AI / Agent companion state files.
- Ordinary-user compatibility APIs now depend on this module for sync preview generation, while full union / managed-bidirectional execution remains gated.

Conclusion:

- The module can be treated as a unit-tested domain implementation candidate.
- It must not be treated as complete ordinary-user API behavior until the remaining full-execution, privacy, and UI smoke gates below are implemented.

## Salvageable Parts

The following parts align with the product direction:

- Policy ids: `canonical_mirror`, `union_convergence`, `managed_bidirectional`, and `read_only_analysis`.
- Apple canonical wrapper around the existing mirror engine.
- Baseline builder concept that stores normalized track identities.
- Baseline diff concept that separates platform additions from deletion signals.
- Tombstone actions: `confirm_global_delete`, `ignore`, `restore`, and `current_platform_only`.
- Use of ISRC, provider ids, MusicBrainz recording ids, normalized text, and duration buckets as identity tokens.
- Separation between derived preview-like operations and user-authored tombstone state.

## Draft Blockers Converted To Tests

### 1. Union Mode Can Propagate Unreviewed Clusters

Original risk:

- `buildUnionOperations()` created a `review` operation for `cluster.needsReview`, but still created missing-platform `add` operations for that same cluster.

Protected invariant:

- If a cluster needs review, missing-platform additions for that cluster are blocked or omitted until the review decision is saved.
- cluster.needsReview cannot create executable or resolvable additions.

Test evidence:

- `test/sync-policy.test.js` covers `union_convergence` review clusters.

### 2. Managed Bidirectional Mode Does Not Explicitly Block Missing Baseline

Original risk:

- Without a baseline, `managed_bidirectional` could look active even though deletion intent could not be interpreted safely.

Protected invariant:

- deletion propagation cannot proceed without a valid baseline.
- Missing-baseline managed bidirectional plans cannot contain ready write operations.

Test evidence:

- `test/sync-policy.test.js` covers missing-baseline managed bidirectional behavior.

### 3. Confirmed Global Delete Searches All Platforms, Not Participants

Original risk:

- A confirmed tombstone could generate deletion operations for a platform that had a local snapshot but was not participating in the current policy run.

Protected invariant:

- non-participating platform snapshots are ignored when confirmed global deletes are converted to operations.

Test evidence:

- `test/sync-policy.test.js` covers participant-scoped confirmed delete operations.

### 4. Read-Only Mode Uses A Non-Contract Status

Original risk:

- Read-only additions used `blocked_read_only`, while the API contract defines `blocked`.

Protected invariant:

- Read-only additions use `status: "blocked"` with `blockedReason: "read_only_policy"`.

Test evidence:

- `test/sync-policy.test.js` covers read-only blocked status.

### 5. Summary Fields Are Not Fully Maintained

Original risk:

- `baselineAdded` and `baselineDeleted` could be exposed as misleading zero counters.

Protected invariant:

- Summary counters must match operation lists and baseline diffs.

Test evidence:

- `test/sync-policy.test.js` covers `baselineDeleted` in a managed bidirectional plan.

### 6. Apple Write Capability Is Overstated

Original risk:

- `WRITABLE_SYNC_PLATFORMS` included `apple` before a tested Apple write adapter existed.

Protected invariant:

- Apple should not be listed as writable unless a tested write adapter exists.

Test evidence:

- `test/sync-policy.test.js` covers writable platform metadata.

### 7. Canonical Mirror Generated Time Is Not Fully Controlled

Original risk:

- Child mirror plan timestamps were harder to control in policy wrapper tests.

Protected invariant:

- Canonical policy tests can inject generated time and compare wrapper summaries to the mirror engine.

Test evidence:

- `test/sync-policy.test.js` covers canonical mirror wrapper generated time and summary parity.

## Remaining Tests Before Product Exposure

Add or keep coverage for:

- `listSyncPolicies()` returns all four policies with expected write/destructive metadata.
- `canonical_mirror` wraps current mirror behavior without changing add/remove/review counts.
- `canonical_mirror` rejects non-Apple source until a tested source adapter exists.
- `union_convergence` creates additions for missing participant platforms.
- `union_convergence` blocks missing-platform propagation for review-needed clusters.
- `managed_bidirectional` blocks or warns when baseline is missing.
- `managed_bidirectional` turns baseline deletions into tombstone review items.
- `confirm_global_delete` creates deletion operations only for participating platforms.
- `ignore` and `current_platform_only` suppress global deletion.
- `restore` creates a restore addition for the platform where the track disappeared.
- `read_only_analysis` produces no executable additions or deletions.
- `buildSyncBaseline()` preserves enough identity tokens to diff stable provider ids, ISRC, MusicBrainz ids, and fallback text/duration.
- Summary counters match operation lists and baseline diffs.

## Completed State Work Before Product Exposure

Before product code writes new sync state, the following gate has landed:

- Add validators to `src/state-schema.js`.
- Add migration decisions to `src/state-migrations.js`.
- Update `docs/STATE.md` from planned state to implemented state.
- Keep generated preview state regenerable.
- Treat baseline and tombstones as user-confirmed state.

Remaining state-adjacent work:

- Add privacy-smoke coverage for debug AI payloads, Agent traces, and new local state paths before those paths are persisted by product APIs.

## API Work Before Full Product Exposure

Completed compatibility work:

- Keep `/api/mirror/*` available.
- Add API wrappers according to `docs/API_CONTRACT.zh-CN.md`.
- Make `/api/sync/check` read-only.
- Make `/api/sync/execute-additions` ignore deletion operations.
- Make `/api/sync/execute-deletions` fail without prior deletion confirmation.
- Do not expose raw snapshots or cookies in ordinary API responses.

Remaining full-product work:

- Extend execution beyond Apple-canonical mirror compatibility for union and managed-bidirectional modes.
- Add product UI smoke around the redesigned ordinary-user screens.

## Decision

Recommended Slice 2 approach:

1. Keep `src/sync-policy.js` as a unit-tested domain implementation candidate.
2. Continue adding focused tests for any new policy invariant before wiring the module outward.
3. Only then wire it to state validation or HTTP routes.

Do not treat `src/sync-policy.js` as complete ordinary-user API behavior before the remaining product exposure gates are resolved.
