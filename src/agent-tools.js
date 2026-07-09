const TOOL_REGISTRY = [
  {
    name: 'get_library_summary',
    description: 'Return local library counts and platform coverage.',
    readOnly: true,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_sync_policy',
    description: 'Return the current sync mode and supported policies.',
    readOnly: true,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_sync_preview',
    description: 'Return sanitized sync preview buckets.',
    readOnly: true,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: { bucket: { type: 'string' } } },
  },
  {
    name: 'get_track_evidence',
    description: 'Return sanitized evidence for one sync preview item.',
    readOnly: true,
    localDraft: false,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string' },
        tombstoneKey: { type: 'string' },
        bucket: { type: 'string' },
      },
    },
  },
  {
    name: 'get_baseline_diff',
    description: 'Return sanitized baseline-vs-current platform differences.',
    readOnly: true,
    localDraft: false,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: {
      type: 'object',
      properties: {
        platforms: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'get_review_queue',
    description: 'Return sanitized sync preview items that need review or deletion handling.',
    readOnly: true,
    localDraft: false,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_taste_profile',
    description: 'Generate or return a deterministic music taste profile.',
    readOnly: true,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: { refresh: { type: 'boolean' } } },
  },
  {
    name: 'find_similar_tracks',
    description: 'Find local tracks similar to a seed track.',
    readOnly: true,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: { seed: { type: 'object' }, limit: { type: 'number' } } },
  },
  {
    name: 'recommend_by_profile',
    description: 'Return local recommendation candidates without provider writes.',
    readOnly: true,
    localDraft: false,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, excludeApple: { type: 'boolean' } } },
  },
  {
    name: 'save_local_shortlist',
    description: 'Save deterministic local recommendation candidates as a local shortlist draft without provider writes.',
    readOnly: false,
    localDraft: true,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        limit: { type: 'number' },
        excludeApple: { type: 'boolean' },
      },
    },
  },
  {
    name: 'draft_sync_operations',
    description: 'Summarize draft sync operations from the current preview.',
    readOnly: true,
    localDraft: false,
    mutatesProvider: false,
    exposesCredentials: false,
    inputSchema: { type: 'object', properties: { bucket: { type: 'string' } } },
  },
];

const FORBIDDEN_TOOL_NAMES = [
  'add',
  'delete',
  'remove',
  'cookie',
  'credential',
  'provider_mutation',
];

export function listAgentTools() {
  return TOOL_REGISTRY.map((tool) => ({ ...tool }));
}

export function getAgentTool(name) {
  return TOOL_REGISTRY.find((tool) => tool.name === name) || null;
}

export function assertAgentToolAllowed(name) {
  const normalized = String(name || '').trim();
  if (!normalized) throw permissionError('Missing Agent tool name.');
  if (FORBIDDEN_TOOL_NAMES.some((part) => normalized.toLowerCase().includes(part))) {
    throw permissionError('Agent tools cannot directly mutate providers or access credentials.');
  }
  const tool = getAgentTool(normalized);
  if (!tool) throw permissionError(`Unsupported Agent tool: ${normalized}`);
  if (tool.mutatesProvider || tool.exposesCredentials || (!tool.readOnly && !tool.localDraft)) {
    throw permissionError(`Agent tool is not allowed in this product surface: ${normalized}`);
  }
  return tool;
}

export function selectAgentToolForMessage(message = '') {
  const text = String(message || '').toLowerCase();
  if (/evidence|why|reason|explain|证据|为什么|原因|解释|判断/.test(text)) return 'get_track_evidence';
  if (/baseline|diff|基线|差异|变化|删除信号/.test(text)) return 'get_baseline_diff';
  if (/review|queue|confirmation|confirm|复核|确认|待确认|需要确认|风险项/.test(text)) return 'get_review_queue';
  if (/profile|taste|画像|偏好/.test(text)) return 'get_taste_profile';
  if (/similar|相似|像/.test(text)) return 'find_similar_tracks';
  if (/save|shortlist|保存|候选列表|收藏候选/.test(text)) return 'save_local_shortlist';
  if (/recommend|推荐|shortlist/.test(text)) return 'recommend_by_profile';
  if (/preview|sync|同步|删除|新增/.test(text)) return 'get_sync_preview';
  if (/policy|mode|策略|模式/.test(text)) return 'get_sync_policy';
  return 'get_library_summary';
}

export function sanitizeAgentToolResult(tool, result) {
  return {
    tool: tool.name,
    readOnly: tool.readOnly === true,
    localDraft: tool.localDraft === true,
    mutatesProvider: false,
    exposesCredentials: false,
    result,
  };
}

export function summarizeAgentToolArguments(toolName, args = {}) {
  if (toolName === 'get_sync_preview' || toolName === 'draft_sync_operations') {
    return {
      bucket: cleanAgentText(args.bucket || 'all', 40),
      limit: safePositiveInteger(args.limit, 100),
    };
  }
  if (toolName === 'get_track_evidence') {
    return {
      operationIdProvided: Boolean(args.operationId || args.id),
      tombstoneKeyProvided: Boolean(args.tombstoneKey || args.key),
      bucket: cleanAgentText(args.bucket || 'first_available', 40),
    };
  }
  if (toolName === 'get_baseline_diff') {
    return {
      platformCount: Array.isArray(args.platforms) ? args.platforms.length : 0,
    };
  }
  if (toolName === 'get_review_queue') {
    return {
      bucket: cleanAgentText(args.bucket || 'all_review', 40),
      limit: safePositiveInteger(args.limit, 20),
    };
  }
  if (toolName === 'get_taste_profile') {
    return {
      refresh: Boolean(args.refresh),
    };
  }
  if (toolName === 'find_similar_tracks') {
    return {
      seed: summarizeAgentSeed(args.seed || {}),
      limit: safePositiveInteger(args.limit, 20),
    };
  }
  if (toolName === 'recommend_by_profile' || toolName === 'save_local_shortlist') {
    return {
      limit: safePositiveInteger(args.limit, 20),
      excludeApple: args.excludeApple !== false,
      shortlistNameProvided: Boolean(args.name || args.shortlistName),
    };
  }
  return {};
}

export function summarizeAgentToolResult(toolName, result = {}) {
  if (toolName === 'get_library_summary') {
    const platforms = Array.isArray(result.platforms) ? result.platforms : [];
    return {
      platformCount: platforms.length,
      connectedCount: platforms.filter((platform) => platform.connected || platform.status === 'connected').length,
      nextAction: cleanAgentText(result.nextAction, 80),
      hasLatestPreview: Boolean(result.latestPreview),
    };
  }
  if (toolName === 'get_sync_policy') {
    return {
      currentMode: cleanAgentText(result.current?.id || result.current?.mode, 80),
      modeCount: Array.isArray(result.modes) ? result.modes.length : 0,
    };
  }
  if (toolName === 'get_sync_preview' || toolName === 'draft_sync_operations') {
    return {
      exists: result.exists !== false,
      previewId: cleanAgentText(result.previewId, 100),
      bucket: cleanAgentText(result.bucket, 40),
      total: safeCount(result.total),
      returned: Array.isArray(result.items) ? result.items.length : 0,
    };
  }
  if (toolName === 'get_track_evidence') {
    return {
      exists: result.exists !== false,
      previewId: cleanAgentText(result.previewId, 100),
      bucket: cleanAgentText(result.bucket, 40),
      hasSourceTrack: Boolean(result.evidence?.sourceTrack),
      hasTargetTrack: Boolean(result.evidence?.targetTrack),
      evidenceRefCount: Array.isArray(result.evidenceRefs) ? result.evidenceRefs.length : 0,
      recommendedAction: cleanAgentText(result.explanation?.recommendedAction, 80),
      error: cleanAgentText(result.error, 120),
    };
  }
  if (toolName === 'get_baseline_diff') {
    return {
      exists: result.exists !== false,
      status: cleanAgentText(result.diff?.status || result.status, 80),
      added: safeCount(result.diff?.summary?.added),
      deleted: safeCount(result.diff?.summary?.deleted),
      exampleCount: Array.isArray(result.diff?.examples) ? result.diff.examples.length : 0,
      error: cleanAgentText(result.error, 120),
    };
  }
  if (toolName === 'get_review_queue') {
    return {
      exists: result.exists !== false,
      previewId: cleanAgentText(result.previewId, 100),
      bucket: cleanAgentText(result.bucket, 40),
      total: safeCount(result.total),
      returned: Array.isArray(result.items) ? result.items.length : 0,
      needsConfirmation: safeCount(result.counts?.needs_confirmation),
      mayDelete: safeCount(result.counts?.may_delete),
      error: cleanAgentText(result.error, 120),
    };
  }
  if (toolName === 'get_taste_profile') {
    return {
      trackCount: safeCount(result.summary?.trackCount),
      sourceTrackCount: safeCount(result.summary?.sourceTrackCount),
      topArtistCount: Array.isArray(result.summary?.topArtists) ? result.summary.topArtists.length : 0,
      modelUsed: Boolean(result.model?.used),
    };
  }
  if (toolName === 'find_similar_tracks') {
    return {
      hasSeed: Boolean(result.seed),
      total: safeCount(result.total),
      returned: Array.isArray(result.candidates) ? result.candidates.length : 0,
    };
  }
  if (toolName === 'recommend_by_profile' || toolName === 'save_local_shortlist') {
    return {
      total: safeCount(result.total),
      returned: Array.isArray(result.candidates) ? result.candidates.length : 0,
      modelUsed: Boolean(result.model?.used),
      providerWrites: Boolean(result.excludes?.providerWrites),
      savedShortlist: result.savedShortlist
        ? {
          present: true,
          trackCount: safeCount(result.savedShortlist.trackCount),
        }
        : { present: false, trackCount: 0 },
    };
  }
  return {
    resultType: Array.isArray(result) ? 'array' : typeof result,
  };
}

function permissionError(message) {
  const error = new Error(message);
  error.code = 'agent_tool_forbidden';
  error.httpStatus = 403;
  return error;
}

function summarizeAgentSeed(seed = {}) {
  return {
    hasTitle: Boolean(seed.title),
    hasArtist: Boolean(seed.artist || seed.artists?.length),
    hasProviderId: Boolean(seed.id || seed.mid || seed.key || seed.clusterId),
    platform: cleanAgentText(seed.platform, 40),
    hasDuration: Boolean(seed.durationMs || seed.duration),
  };
}

function safePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.min(100, Math.floor(number)));
}

function safeCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function cleanAgentText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
