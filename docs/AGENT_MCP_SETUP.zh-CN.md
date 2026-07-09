# Agent / MCP Setup

This project can expose its local music intelligence tools to Hermes or any stdio MCP-compatible local Agent runtime.

The adapter is optional. The ordinary Web UI, sync preview, confirmation gates, and provider writes work without Hermes, MCP, or any external Agent runtime.

## Capabilities

The MCP adapter exposes the same read-only and local-draft tool registry as `GET /api/agent/tools`:

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

These tools can inspect sanitized local state, read per-track sync evidence without provider ids, read baseline diffs, list review-queue items, draft suggestions, and save local shortlist drafts. They cannot read cookies, read AI API keys, create delete confirmations, or directly add / delete provider tracks.

## Run From npm

```powershell
npx music-likes-sync agent-mcp
```

## Run From A Source Checkout

```powershell
node .\src\cli.js agent-mcp
```

Use the source-checkout command while developing this repository. Use the npm command after installing the package.

## Example MCP Client Configuration

Use this shape for Hermes or another stdio MCP client, adjusting the command path for your environment:

```json
{
  "mcpServers": {
    "music-likes-sync": {
      "command": "npx",
      "args": ["music-likes-sync", "agent-mcp"],
      "env": {
        "MUSIC_LIKES_SYNC_HOME": "C:\\\\Users\\\\You\\\\music-likes-sync"
      }
    }
  }
}
```

For a source checkout:

```json
{
  "mcpServers": {
    "music-likes-sync-dev": {
      "command": "node",
      "args": ["C:\\\\path\\\\to\\\\music-likes-sync\\\\src\\\\cli.js", "agent-mcp"],
      "env": {
        "MUSIC_LIKES_SYNC_HOME": "C:\\\\path\\\\to\\\\music-likes-sync"
      }
    }
  }
}
```

Do not put cookies, API keys, or provider credentials in this config. The adapter reads the same local runtime state as the Web app.

## Trace Audit

Every successful `/api/agent/chat` or MCP `tools/call` writes a local sanitized trace to `data/agent-sessions.json`.

The trace records:

- tool name
- source: `http` or `mcp`
- status and duration
- sanitized argument summary
- sanitized result summary
- evidence references
- whether the tool was read-only or a local draft write

The trace does not store raw prompts, raw seed song titles, raw seed artists, cookies, AI API keys, full provider snapshots, or raw provider responses.

You can inspect recent traces through the local Web API:

```powershell
Invoke-RestMethod http://127.0.0.1:4319/api/agent/sessions
```

## Safety Boundary

Agent tools are evidence and drafting tools only.

Provider writes still require the normal product path:

1. Generate or refresh sync preview.
2. Resolve add candidates when needed.
3. Review warnings and tombstone signals.
4. Confirm destructive operations explicitly.
5. Execute through controlled add or delete endpoints.

An Agent can help explain or draft this work, but it cannot bypass these steps.
