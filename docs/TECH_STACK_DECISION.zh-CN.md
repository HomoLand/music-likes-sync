# Technical Stack Decision

Last updated: 2026-07-08

This document proposes the technical stack for the ordinary-user redesign of `music-likes-sync`. It should be confirmed before implementation.

## Decision Summary

Recommended stack:

- Backend: keep local-first Node.js 20+ ESM service.
- Domain core: pure JavaScript modules for now, with TypeScript-ready contracts.
- Frontend: move redesigned app surface to React + Vite + TypeScript.
- Styling: plain CSS with design tokens first; no heavy component library initially.
- Tests: keep `node:test` for backend/domain, keep Playwright for UI smoke.
- AI: built-in AI provider abstraction first, Agent tool layer second.
- Agent integration: internal tool registry first, optional stdio MCP adapter for Hermes / external Agent runtimes.

The current vanilla HTML/CSS/JS UI can remain as a compatibility surface during migration, but the ordinary-user five-screen UI should not be built as another large imperative `web/app.js` file.

## Why Change The Frontend Stack

The current UI has grown into several overlapping workflows:

- platform login
- Apple canonical mirror
- old unified library
- write plan
- manual decisions
- AI review
- deletion confirmation
- convergence checks

The ordinary-user redesign adds more application state:

- five main screens
- sync mode selection
- platform connection state
- sync preview buckets
- risk-first review
- AI assistant tabs
- advanced settings
- future recommendation shortlists

This is now a stateful product app, not a simple static control page. React + TypeScript gives clearer component boundaries, typed UI state, and safer refactoring than continuing to expand the existing imperative DOM code.

## Frontend Recommendation

Use:

- `React`
- `TypeScript`
- `Vite`
- plain CSS modules or scoped plain CSS
- Playwright smoke tests

Avoid initially:

- Next.js: unnecessary for a local-only app served by the Node process.
- Electron: unnecessary until the product needs native packaging.
- Large UI frameworks: they increase dependency surface and can make the app feel generic.
- Tailwind-first migration: useful later if desired, but not required for the first redesign.

Suggested frontend structure:

```text
web-app/
  src/
    app/
      App.tsx
      routes.ts
    screens/
      OverviewScreen.tsx
      ConnectPlatformsScreen.tsx
      SyncModeScreen.tsx
      SyncPreviewScreen.tsx
      AiAssistantScreen.tsx
      AdvancedSettingsScreen.tsx
    components/
      PlatformStatusRow.tsx
      SyncModeOption.tsx
      PreviewBucketTabs.tsx
      TrackReviewRow.tsx
      DeleteConfirmationPanel.tsx
    api/
      client.ts
      types.ts
    styles/
      tokens.css
      app.css
```

Build output can be copied or emitted to `web/` or `web-dist/`, then served by the existing Node server.

## Backend Recommendation

Keep:

- Node.js 20+.
- ESM modules.
- Local HTTP server.
- File-backed local state under `data/`.
- Existing provider adapters.
- Existing `node:test` test runner.

Do not introduce a server framework yet. The backend is local-only and already has explicit routing, static guards, JSON body limits, smoke tests, and privacy checks. A framework migration would add churn before the product model is settled.

Add backend layers:

```text
src/
  sync-policy.js        # policy model and validation
  sync-baseline.js      # baseline and platform diff
  sync-preview.js       # ordinary-user preview buckets
  ai/
    providers/
      deepseek.js
      mock.js
    reviewer.js
    schema.js
  agent/
    tools.js
    registry.js
    hermes-adapter.js   # optional
```

The existing `mirror-*` modules should remain the Apple canonical execution path until the generalized sync executor is proven.

## API Shape

Add ordinary-user API endpoints without breaking current endpoints:

Detailed request / response contracts live in `docs/API_CONTRACT.zh-CN.md`.

```text
GET  /api/app/state
POST /api/platforms/read
GET  /api/sync/modes
POST /api/sync/check
GET  /api/sync/preview
POST /api/sync/confirm-review
POST /api/sync/execute-additions
POST /api/sync/confirm-deletions
POST /api/sync/execute-deletions
POST /api/ai/review
POST /api/ai/profile
POST /api/ai/similar
POST /api/ai/recommend
```

Keep legacy APIs during migration:

```text
/api/mirror/*
/api/sync/plan
/api/unified/*
```

Mapping rule:

- The ordinary UI calls new product APIs.
- New product APIs may internally call legacy mirror/write modules.
- Legacy APIs stay available for CLI, tests, and migration compatibility.

## AI Architecture

Use two layers.

### Built-In AI

This is the ordinary-user path.

Responsibilities:

- match review
- deletion explanation
- taste profile
- similar songs
- recommendation candidates

Requirements:

- provider abstraction
- schema validation
- JSON repair / strict fallback
- safety downgrade
- evidence references
- consent gate
- no raw cookies or user ids in payload

### Agent Tool Layer

This is optional and advanced.

Expose domain tools:

- `get_library_summary`
- `get_track_evidence`
- `get_sync_policy`
- `get_sync_preview`
- `get_baseline_diff`
- `get_review_queue`
- `search_target_catalog`
- `lookup_musicbrainz`
- `get_taste_profile`
- `find_similar_tracks`
- `draft_sync_operations`
- `save_local_shortlist`

Do not expose:

- direct provider add/delete
- cookie read/write
- delete confirmation bypass
- raw state dumps by default

Agent adapters:

- Internal tool registry first.
- stdio MCP adapter second, exposed through `music-likes-sync agent-mcp`.
- Hermes-specific setup examples later if users need deeper integration.

## State Model

New schema-versioned state files:

```text
data/sync-policy.json
data/sync-baseline.json
data/sync-preview.json
data/sync-tombstones.json
data/sync-runs.json
data/ai-provider-state.json
data/music-profile.json
data/recommendation-shortlists.json
```

Rules:

- Every file has `version`.
- Generated preview state can be regenerated.
- Baseline, tombstones, and sync run logs are user-confirmed or audit state and must be migrated carefully.
- AI raw payloads are not saved unless debug mode is explicitly enabled.
- Debug payloads stay under ignored `data/debug/`.

## Testing Strategy

Backend/domain:

- `node:test`
- pure fixtures for policy plans, baseline diffs, tombstone lifecycle
- provider adapter contract tests with mocked responses

Frontend:

- component-level tests can be added after React migration if needed
- Playwright remains the required user-flow smoke gate

Required smoke flows:

- first-run empty state
- platform connected state
- choose Apple canonical mode
- generate sync preview
- AI review consent required
- execute additions separate from deletions
- deletion confirmation gate
- mobile layout has no horizontal overflow

Privacy:

- `npm run check:privacy` remains mandatory.
- The package smoke must reject `data/`, `.env`, cookies, reports, debug payloads, and browser profiles.

## Migration Strategy

1. Keep current UI running.
2. Build the new React app behind a route or feature flag.
3. Add new product APIs while reusing current mirror execution internally.
4. Move user-facing flows to the new UI.
5. Keep the legacy workbench at `/workbench/` behind advanced settings links.
6. Remove legacy UI only after smoke tests, live validation, and parity evidence cover the new flows.

## Open Decisions

Need confirmation before implementation:

- Use React + Vite + TypeScript for the redesigned UI.
- Keep backend on native Node HTTP for now.
- Keep plain CSS/design tokens instead of a component library.
- Keep Agent integration optional and tool-based.
- Keep legacy developer workflows under `/workbench/` and link to them only from advanced settings.

## Recommended Decision

Proceed with:

- React + Vite + TypeScript frontend.
- Existing Node ESM backend.
- Built-in AI first.
- Agent tools second.
- No direct Agent write access.
- Current mirror executor retained as the Apple canonical write path.
