import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleMcpMessage, listMcpTools } from '../src/agent-mcp.js';

describe('Agent MCP adapter', () => {
  it('lists only read-only or local-draft credential-free MCP tools', () => {
    const tools = listMcpTools();

    assert.equal(tools.length >= 6, true);
    assert.equal(tools.every((tool) => tool.annotations?.readOnlyHint === true || tool.name === 'save_local_shortlist'), true);
    assert.equal(tools.find((tool) => tool.name === 'get_track_evidence')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'get_baseline_diff')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'get_review_queue')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'save_local_shortlist')?.annotations?.readOnlyHint, false);
    assert.equal(tools.every((tool) => tool.annotations?.destructiveHint === false), true);
    assert.equal(tools.some((tool) => /cookie|delete|remove|add/i.test(tool.name)), false);
  });

  it('handles initialize, tools/list, and read-only tools/call requests', async () => {
    const initialized = await handleMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    assert.equal(initialized.result.serverInfo.name, 'music-likes-sync');

    const listed = await handleMcpMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    assert.equal(listed.result.tools.some((tool) => tool.name === 'get_library_summary'), true);

    let capturedRequest = null;
    const called = await handleMcpMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_library_summary',
        arguments: {},
        _meta: { sessionId: 'mcp-session-1' },
      },
    }, {
      runToolRequest: async (request) => {
        capturedRequest = request;
        return {
          tool: 'get_library_summary',
          result: { platforms: [] },
        };
      },
    });
    assert.equal(called.result.isError, false);
    assert.equal(capturedRequest.sessionId, 'mcp-session-1');
    assert.equal(capturedRequest.source, 'mcp');
    assert.equal(called.result.structuredContent.readOnly, true);
    assert.equal(called.result.structuredContent.mutatesProvider, false);
    assert.equal(JSON.stringify(called).includes('cookie'), false);
  });

  it('rejects mutation-shaped MCP tool calls', async () => {
    const response = await handleMcpMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'delete_provider_track',
        arguments: {},
      },
    });

    assert.equal(response.error.code, -32001);
    assert.match(response.error.message, /cannot directly mutate|credentials/i);
  });
});
