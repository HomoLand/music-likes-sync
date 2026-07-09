#!/usr/bin/env node
import './env.js';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { assertAgentToolAllowed, listAgentTools } from './agent-tools.js';
import { runAgentToolRequest } from './workflow.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';

export function listMcpTools() {
  return listAgentTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    annotations: {
      readOnlyHint: tool.readOnly === true,
      destructiveHint: false,
      idempotentHint: tool.readOnly === true,
      openWorldHint: false,
    },
  }));
}

export async function handleMcpMessage(message = {}, options = {}) {
  const id = message.id;
  try {
    if (message.method === 'initialize') {
      return mcpResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'music-likes-sync',
          version: '0.1.0',
        },
      });
    }
    if (message.method === 'notifications/initialized') return null;
    if (message.method === 'ping') return mcpResult(id, {});
    if (message.method === 'tools/list') {
      return mcpResult(id, {
        tools: listMcpTools(),
      });
    }
    if (message.method === 'tools/call') {
      const name = String(message.params?.name || '').trim();
      const tool = assertAgentToolAllowed(name);
      const runToolRequest = options.runToolRequest || runAgentToolRequest;
      const result = await runToolRequest({
        tool: tool.name,
        arguments: message.params?.arguments || {},
        sessionId: message.params?._meta?.sessionId || options.sessionId,
        source: 'mcp',
      });
      const sanitized = {
        tool: tool.name,
        readOnly: tool.readOnly === true,
        localDraft: tool.localDraft === true,
        mutatesProvider: false,
        exposesCredentials: false,
        result,
      };
      return mcpResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(sanitized, null, 2),
          },
        ],
        structuredContent: sanitized,
        isError: false,
      });
    }
    return mcpError(id, -32601, `Unsupported MCP method: ${message.method || ''}`);
  } catch (error) {
    return mcpError(id, error.code === 'agent_tool_forbidden' ? -32001 : -32000, error.message || 'MCP request failed.');
  }
}

export async function startAgentMcpStdio(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    let message = null;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      writeMcpLine(output, mcpError(null, -32700, `Invalid JSON: ${error.message}`));
      continue;
    }
    const response = await handleMcpMessage(message, options);
    if (response) writeMcpLine(output, response);
  }
}

function mcpResult(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function mcpError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}

function writeMcpLine(output, payload) {
  output.write(`${JSON.stringify(payload)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startAgentMcpStdio().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
