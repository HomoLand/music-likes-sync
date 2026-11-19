#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(readArg('--port') || process.env.PORT || 0) || await pickFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'music-likes-sync-web-app-smoke-'));

await seedReactAppFixtures(tempRoot);

execSync('npm run check:web-app', {
  cwd: ROOT,
  stdio: 'pipe',
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  },
  windowsHide: true,
});

const child = spawn(process.execPath, ['src/server.js', String(port)], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    MUSIC_LIKES_SYNC_HOME: tempRoot,
    MUSIC_LIKES_SYNC_OTEL_ENABLED: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  await waitForServer();

  const app = await fetchText('/');
  assert(app.status === 200, `/ should serve React index, got ${app.status}`);
  assert(app.contentType.includes('text/html'), '/ should return HTML');
  assert(app.body.includes('<div id="root"></div>'), '/ should include the React root');
  assert(app.body.includes('/app/assets/'), '/ should reference assets below /app/');
  assert(!/[="']\/assets\//u.test(app.body), '/ should not reference root-relative Vite assets');

  const appAlias = await fetchText('/app/');
  assert(appAlias.status === 200, `/app/ should remain a React alias, got ${appAlias.status}`);
  assert(appAlias.body.includes('<div id="root"></div>'), '/app/ should include the React root');

  const appNoSlash = await fetchText('/app');
  assert(appNoSlash.status === 200, `/app should serve React index, got ${appNoSlash.status}`);
  assert(appNoSlash.body.includes('<div id="root"></div>'), '/app should include the React root');

  const routeFallback = await fetchText('/sync-preview');
  assert(routeFallback.status === 200, `/sync-preview should use root SPA fallback, got ${routeFallback.status}`);
  assert(routeFallback.body.includes('<div id="root"></div>'), 'SPA fallback should return the React index');
  const appRouteFallback = await fetchText('/app/sync-preview');
  assert(appRouteFallback.status === 200, `/app/sync-preview should use SPA fallback, got ${appRouteFallback.status}`);
  assert(appRouteFallback.body.includes('<div id="root"></div>'), '/app SPA fallback should return the React index');

  const assets = [...new Set([...app.body.matchAll(/["'](\/app\/assets\/[^"']+)["']/gu)].map((match) => match[1]))];
  assert(assets.length >= 2, `React index should reference CSS and JS assets, got ${assets.length}`);
  const fetchedAssets = [];
  for (const assetPath of assets) {
    const asset = await fetchText(assetPath);
    assert(asset.status === 200, `${assetPath} should be served, got ${asset.status}`);
    assert(!asset.contentType.includes('text/html'), `${assetPath} should not be served as HTML`);
    fetchedAssets.push({ path: assetPath, contentType: asset.contentType, bytes: asset.body.length });
  }

  const missingAsset = await fetchText('/app/assets/missing-web-app-smoke.js');
  assert(missingAsset.status === 404, `missing React asset should 404, got ${missingAsset.status}`);
  const traversal = await fetchText('/app/%2e%2e%2fpackage.json');
  assert(traversal.status === 403, `React app route should block path traversal, got ${traversal.status}`);
  const rootTraversal = await fetchText('/%2e%2e%2fpackage.json');
  assert(rootTraversal.status === 403, `root React app route should block path traversal, got ${rootTraversal.status}`);

  const workbench = await fetchText('/workbench/');
  assert(workbench.status === 200, `/workbench/ should serve the compatibility workbench, got ${workbench.status}`);
  assert(workbench.body.includes('/app.js'), '/workbench/ should retain legacy app assets');
  assert(workbench.body.includes('/product-app.js'), '/workbench/ should retain product bridge assets');
  assert(!workbench.body.includes('<div id="root"></div>'), '/workbench/ should not serve the React index');
  const workbenchNoSlash = await fetchText('/workbench');
  assert(workbenchNoSlash.status === 200, `/workbench should serve the compatibility workbench, got ${workbenchNoSlash.status}`);
  const legacyAppAsset = await fetchText('/app.js');
  assert(legacyAppAsset.status === 200, `/app.js should remain available for the compatibility workbench, got ${legacyAppAsset.status}`);
  assert(legacyAppAsset.contentType.includes('text/javascript'), '/app.js should be served as JavaScript');

  const appState = await fetchJson('/api/app/state');
  assert(appState.ok, '/api/app/state should return ok for the React app');
  assert(Array.isArray(appState.data?.platforms), '/api/app/state should return platform rows');
  assert(appState.data.platforms.some((platform) => platform.id === 'apple' && platform.trackCount === 3), 'React app state should expose Apple track counts');
  const liveValidation = await fetchJson('/api/validation/live');
  assert(liveValidation.ok, '/api/validation/live should return ok for the React app advanced settings');
  assert(liveValidation.data?.targets?.qq, 'React advanced settings should receive QQ live-validation summary');
  assert(liveValidation.data?.targets?.netease, 'React advanced settings should receive NetEase live-validation summary');
  assert(!JSON.stringify(liveValidation.data).includes('fixture-playlist'), 'React live-validation summary must not expose playlist ids');
  const liveValidationNoConfirm = await postJson('/api/validation/live/run', {
    target: 'qq',
    query: 'fixture song',
    confirm: 'wrong',
  });
  assert(liveValidationNoConfirm.ok === false, 'React live-validation run should require disposable-playlist confirmation');
  const liveValidationMissingCookie = await postJson('/api/validation/live/run', {
    target: 'qq',
    query: 'fixture song',
    confirm: 'DISPOSABLE_PLAYLIST',
  });
  assert(liveValidationMissingCookie.ok === false, 'React live-validation run should stop before provider mutation when credentials are missing');
  assert(!JSON.stringify(liveValidationMissingCookie).includes('qm_keyst'), 'React live-validation run errors must not expose credential-shaped values');
  const aiProvider = await fetchJson('/api/ai/provider');
  assert(aiProvider.ok, '/api/ai/provider should return ok for the React app advanced settings');
  assert(!JSON.stringify(aiProvider.data).includes('sk-'), 'React AI provider summary must not expose API keys');

  const syncCheck = await postJson('/api/sync/check', {
    mode: 'canonical_mirror',
    platforms: ['apple', 'qq', 'netease'],
    targets: ['qq', 'netease'],
    deletionPolicy: 'ask',
    threshold: 0.82,
    reviewThreshold: 0.68,
  });
  assert(syncCheck.ok, '/api/sync/check should return ok for the React app');
  assert(syncCheck.data?.previewId, '/api/sync/check should return a preview id');
  assert(Number(syncCheck.data?.counts?.needs_confirmation || 0) > 0, '/api/sync/check should keep unresolved additions in manual review');

  const preview = await fetchJson('/api/sync/preview?bucket=needs_confirmation&limit=30');
  assert(preview.ok, '/api/sync/preview should return ok for the React app');
  assert(Array.isArray(preview.data?.items), '/api/sync/preview should return preview items');
  assert(preview.data.items.some((item) => item.title === 'New Day'), 'React preview should include the seeded missing Apple track');
  assert(preview.data.items.every((item) => Array.isArray(item.targetPlatforms)), 'React preview items should include target platform arrays');

  const resolution = await postJson('/api/sync/resolve-additions', {
    targets: ['qq', 'netease'],
    bucket: 'needs_confirmation',
    resolveLimit: 10,
    searchLimit: 3,
  });
  assert(resolution.ok, '/api/sync/resolve-additions should return ok for the React app');
  assert(Array.isArray(resolution.data?.addResolution?.targets), 'React add resolution should report per-target results');
  assert(resolution.data.addResolution.targets.every((target) => target.skipped === true), 'fixture add resolution should skip safely without provider cookies');

  const candidateIds = await markReactAddCandidates(tempRoot);
  const candidatePreview = await fetchJson('/api/sync/preview?bucket=needs_confirmation&limit=30');
  assert(candidatePreview.ok, 'candidate preview should return ok after local fixture marking');
  assert(candidatePreview.data.items.some((item) => item.candidateTarget?.title === 'New Day Candidate'), 'React preview should expose add candidate targets');
  assert(candidatePreview.data.items.some((item) => item.alternatives?.length > 0), 'React preview should expose add candidate alternatives');

  const acceptedCandidate = await postJson('/api/sync/addition-decision', {
    operationId: candidateIds[0],
    action: 'accept_candidate',
  });
  assert(acceptedCandidate.ok, '/api/sync/addition-decision should accept a local add candidate');
  assert(acceptedCandidate.data?.operation?.addDecision?.action === 'accept_candidate', 'accepted candidate should return local decision metadata');
  assert(acceptedCandidate.data?.operation?.status === 'ready', 'accepted candidate should become a ready preview addition');

  const skippedBatch = await postJson('/api/sync/addition-decisions', {
    operationIds: [candidateIds[1]],
    action: 'skip',
  });
  assert(skippedBatch.ok, '/api/sync/addition-decisions should batch update local add candidates');
  assert(skippedBatch.data?.changed === 1, 'batch candidate decision should change the selected local operation');
  assert(skippedBatch.data?.operations?.[0]?.addDecision?.action === 'skip', 'batch candidate decision should return skip metadata');

  const tombstoneIds = await markReactTombstones(tempRoot);
  const tombstonePreview = await fetchJson('/api/sync/preview?bucket=may_delete&limit=30');
  assert(tombstonePreview.ok, 'tombstone preview should return ok after local fixture marking');
  assert(
    tombstonePreview.data.items.filter((item) => item.tombstoneKey).length >= 2,
    `React preview should expose tombstone keys: ${JSON.stringify(tombstonePreview.data.items.map((item) => ({
      id: item.id,
      bucket: item.bucket,
      tombstoneKey: item.tombstoneKey,
    })))}`,
  );

  const batchTombstone = await postJson('/api/sync/tombstones', {
    action: 'current_platform_only',
    refreshPreview: false,
    items: [{
      tombstoneKey: tombstoneIds[1].tombstoneKey,
      operationId: tombstoneIds[1].operationId,
      platform: tombstoneIds[1].platform,
    }],
  });
  assert(batchTombstone.ok, '/api/sync/tombstones should batch update non-destructive tombstone decisions');
  assert(batchTombstone.data?.batch === true, 'tombstone batch should report batch mode');
  assert(batchTombstone.data?.changed === 1, 'tombstone batch should change the selected local signal');

  const confirmedTombstone = await postJson('/api/sync/tombstones', {
    tombstoneKey: tombstoneIds[0].tombstoneKey,
    operationId: tombstoneIds[0].operationId,
    platform: tombstoneIds[0].platform,
    action: 'confirm_global_delete',
    confirmText: `CONFIRM GLOBAL DELETE FROM ${tombstoneIds[0].platform.toUpperCase()}`,
    refreshPreview: false,
  });
  assert(
    confirmedTombstone.ok,
    `/api/sync/tombstones should confirm one global delete with exact text: ${JSON.stringify(confirmedTombstone)}`,
  );
  assert(confirmedTombstone.data?.decision?.action === 'confirm_global_delete', 'global tombstone confirmation should return decision metadata');
  const decidedTombstonePreview = await fetchJson('/api/sync/preview?bucket=may_delete&limit=30');
  assert(decidedTombstonePreview.data.items.some((item) => item.tombstoneAction === 'confirm_global_delete'), 'React preview should expose confirmed global tombstone decisions');
  assert(decidedTombstonePreview.data.items.some((item) => item.tombstoneAction === 'current_platform_only'), 'React preview should expose batch non-destructive tombstone decisions');

  const additionDryRun = await postJson('/api/sync/execute-additions', {
    dryRun: true,
    targets: ['qq', 'netease'],
  });
  assert(additionDryRun.ok, '/api/sync/execute-additions dry-run should return ok for the React app');
  assert(Number(additionDryRun.data?.remove?.requested || 0) === 0, 'React add execution must stay add-only');

  const realAdditionBlocked = await postJson('/api/sync/execute-additions', {
    dryRun: false,
    targets: ['qq'],
  });
  assert(realAdditionBlocked.ok === false, 'React real additions should remain blocked without live validation');

  const deleteConfirmation = await postJson('/api/sync/confirm-deletions', {
    targets: ['qq', 'netease'],
    confirmText: 'DELETE FROM SELECTED TARGETS',
  });
  assert(deleteConfirmation.ok, '/api/sync/confirm-deletions should accept exact selected-target confirmation');
  assert(Number(deleteConfirmation.data?.confirmed || 0) > 0, 'React delete confirmation should confirm fixture delete operations');

  const realDeletionBlocked = await postJson('/api/sync/execute-deletions', {
    dryRun: false,
    targets: ['qq', 'netease'],
  });
  assert(realDeletionBlocked.ok === false, 'React real deletions should remain blocked without live validation');

  const convergence = await postJson('/api/sync/convergence', {
    targets: ['qq', 'netease'],
    refreshTarget: false,
  });
  assert(convergence.ok, '/api/sync/convergence should return ok for the React app');
  assert(convergence.data?.convergence, 'React convergence check should return a convergence summary');

  const aiProfile = await postJson('/api/ai/profile', { refresh: true });
  assert(aiProfile.ok, '/api/ai/profile should return ok for the React app');
  assert(Number(aiProfile.data?.summary?.trackCount || 0) > 0, 'React AI profile should summarize local tracks');
  assert(aiProfile.data?.model?.used === false, 'React AI profile should default to deterministic local mode');
  assert(!JSON.stringify(aiProfile.data).includes('raw'), 'React AI profile must not expose raw provider payloads');

  const aiProfileNoConsent = await postJson('/api/ai/profile', {
    refresh: true,
    useModel: true,
  });
  assert(aiProfileNoConsent.ok === false, 'React AI model profile should require consent');

  const aiProviderNoConsent = await postJson('/api/ai/provider/test', {});
  assert(aiProviderNoConsent.ok === false, 'React AI provider test should require consent');

  const similar = await postJson('/api/ai/similar', {
    seed: { title: 'Night Drive', artist: 'Carol' },
    limit: 5,
  });
  assert(similar.ok, '/api/ai/similar should return ok for the React app');
  assert(similar.data?.seed?.track?.title === 'Night Drive', 'React AI similar should echo a sanitized seed track');
  assert(Array.isArray(similar.data?.candidates), 'React AI similar should return candidate rows');

  const recommendations = await postJson('/api/ai/recommend', {
    limit: 5,
    saveShortlist: false,
  });
  assert(recommendations.ok, '/api/ai/recommend should return ok for the React app');
  assert(recommendations.data?.excludes?.providerWrites === true, 'React AI recommendations must not imply provider writes');
  assert(recommendations.data?.model?.used === false, 'React AI recommendations should default to deterministic local mode');
  assert(!JSON.stringify(recommendations.data).includes('sk-'), 'React AI recommendations must not expose API keys');

  const recommendationNoConsent = await postJson('/api/ai/recommend', {
    limit: 5,
    useModel: true,
  });
  assert(recommendationNoConsent.ok === false, 'React AI model recommendations should require consent');

  const agentSessions = await fetchJson('/api/agent/sessions?limit=3&traceLimit=5');
  assert(agentSessions.ok, '/api/agent/sessions should return ok for the React app');
  assert(Array.isArray(agentSessions.data?.sessions), 'React Agent audit should return sanitized sessions');
  assert(!JSON.stringify(agentSessions.data).includes('sk-'), 'React Agent audit must not expose API keys');

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    route: '/',
    assets: fetchedAssets,
    fallback: '/sync-preview',
    api: {
      previewId: syncCheck.data.previewId,
      needsConfirmation: syncCheck.data.counts.needs_confirmation,
      previewItems: preview.data.items.length,
      candidateDecision: acceptedCandidate.data.operation.addDecision.action,
      batchDecision: skippedBatch.data.operations[0].addDecision.action,
      tombstoneDecision: confirmedTombstone.data.decision.action,
      tombstoneBatchChanged: batchTombstone.data.changed,
      additionDryRun: additionDryRun.data.add?.requested || 0,
      deleteConfirmed: deleteConfirmation.data.confirmed,
      realAdditionBlocked: realAdditionBlocked.ok,
      realDeletionBlocked: realDeletionBlocked.ok,
      convergence: convergence.data.convergence.status,
      aiProfileTracks: aiProfile.data.summary.trackCount,
      aiSimilar: similar.data.total,
      aiRecommendations: recommendations.data.total,
      agentSessions: agentSessions.data.sessions.length,
      liveValidationOk: liveValidation.data.ok,
      liveValidationRunGuarded: liveValidationNoConfirm.ok === false && liveValidationMissingCookie.ok === false,
      aiProvider: aiProvider.data.provider,
    },
    guards: {
      missingAsset: missingAsset.status,
      traversal: traversal.status,
      rootTraversal: rootTraversal.status,
      workbench: workbench.status,
      aiConsent: aiProfileNoConsent.ok,
    },
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    stdout: tail(stdout),
    stderr: tail(stderr),
  }, null, 2));
  process.exitCode = 1;
} finally {
  child.kill();
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/state`, { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok && payload.ok) return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`server did not answer ${baseUrl}/api/state`);
}

async function fetchText(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: 'no-store' });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body: await response.text(),
  };
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: 'no-store' });
  return response.json();
}

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function seedReactAppFixtures(root) {
  const dataDir = path.join(root, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'apple.json'), JSON.stringify(snapshot('apple', [
    track('a-1', 'Already There', 'Alice', 180000),
    track('a-2', 'New Day', 'Bob', 210000),
    track('a-3', 'Night Drive', 'Carol', 180000),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'netease.json'), JSON.stringify(snapshot('netease', [
    track('n-1', 'Already There', 'Alice', 181000),
    track('n-2', 'Old Target Only', 'Dora', 200000),
    track('n-3', 'Night Drive Acoustic', 'Carol', 240000),
  ])), 'utf8');
  await fs.writeFile(path.join(dataDir, 'qq.json'), JSON.stringify(snapshot('qq', [
    track('q-1', 'Already There', 'Alice', 181000),
    qqMidOnlyTrack('qq-mid-old-target-only', 'Old Target Only', 'Dora', 200000),
    track('q-3', 'Night Drive Acoustic', 'Carol', 240000),
  ])), 'utf8');
}

async function markReactAddCandidates(root) {
  const previewPath = path.join(root, 'data', 'sync-preview.json');
  const preview = JSON.parse(await fs.readFile(previewPath, 'utf8'));
  const additions = preview.operations.filter((operation) => operation.action === 'add').slice(0, 2);
  assert(additions.length >= 2, 'React app smoke fixture should produce at least two add operations');
  additions.forEach((operation, index) => {
    operation.status = 'needs_review';
    operation.resolvedTargetTrack = null;
    operation.targetTrack = null;
    operation.resolvedScore = index === 0 ? 0.72 : 0.7;
    operation.candidateTrack = {
      platform: operation.targetPlatform || (index === 0 ? 'qq' : 'netease'),
      id: `candidate-${operation.id}`,
      mid: operation.targetPlatform === 'qq' ? `mid-${operation.id}` : null,
      title: `${operation.sourceTrack?.title || 'New Day'} Candidate`,
      artist: operation.sourceTrack?.artist || firstArtist(operation.sourceTrack) || 'Fixture Artist',
      artists: operation.sourceTrack?.artists || [],
      album: 'Web App Smoke Candidate',
      durationMs: operation.sourceTrack?.durationMs || 210000,
      isrc: operation.sourceTrack?.isrc || null,
    };
    operation.alternatives = [{
      ...operation.candidateTrack,
      id: `alternative-${operation.id}`,
      mid: operation.targetPlatform === 'qq' ? `mid-alt-${operation.id}` : null,
      title: `${operation.candidateTrack.title} Alternate`,
    }];
    operation.resolution = {
      reason: 'low_confidence_target_match',
      message: 'Web app smoke marks this addition as a local review candidate.',
    };
  });
  preview.summary = policySummary(preview.operations, preview.summary);
  await fs.writeFile(previewPath, JSON.stringify(preview), 'utf8');
  return additions.map((operation) => operation.id);
}

function policySummary(operations, previous = {}) {
  const summary = {
    total: operations.length,
    keep: 0,
    add: 0,
    remove: 0,
    review: 0,
    destructive: 0,
    ready: 0,
    blocked: 0,
    baselineAdded: previous.baselineAdded || 0,
    baselineDeleted: previous.baselineDeleted || 0,
    tombstoneCandidates: 0,
  };
  for (const operation of operations) {
    const action = operation.action || 'review';
    if (Object.prototype.hasOwnProperty.call(summary, action)) summary[action] += 1;
    if (operation.destructive) summary.destructive += 1;
    if (operation.status === 'ready') summary.ready += 1;
    else summary.blocked += 1;
    if (operation.reason === 'tombstone_candidate') summary.tombstoneCandidates += 1;
  }
  return summary;
}

async function markReactTombstones(root) {
  const previewPath = path.join(root, 'data', 'sync-preview.json');
  const preview = JSON.parse(await fs.readFile(previewPath, 'utf8'));
  const removals = ['qq', 'netease'].map((platform, index) => {
    const targetTrack = {
      platform,
      id: `deleted-${index + 1}`,
      title: `Deleted Fixture ${index + 1}`,
      artist: 'Web App Smoke',
      artists: ['Web App Smoke'],
      album: 'Web App Smoke Fixture',
      durationMs: 200000,
    };
    return {
      id: `web-app-smoke-remove-${platform}`,
      action: 'remove',
      status: 'ready',
      destructive: true,
      sourcePlatform: platform,
      targetPlatform: platform,
      sourceTrack: targetTrack,
      targetTrack,
      reason: 'tombstone_candidate',
      message: 'Web app smoke creates an independent deletion signal.',
      blockedReason: '',
      tombstoneKey: `web-app-smoke:tombstone:${platform}:${index + 1}`,
    };
  });
  preview.operations.push(...removals);
  preview.summary = policySummary(preview.operations, preview.summary);
  await fs.writeFile(previewPath, JSON.stringify(preview), 'utf8');
  return removals.map((operation) => ({
    operationId: operation.id,
    tombstoneKey: operation.tombstoneKey,
    platform: operation.sourcePlatform,
  }));
}

function firstArtist(track) {
  return Array.isArray(track?.artists) ? track.artists[0] || '' : '';
}

function snapshot(platform, tracks) {
  return {
    platform,
    source: `${platform}:web-app-smoke`,
    fetchedAt: '2026-07-07T00:00:00.000Z',
    skipped: false,
    tracks,
  };
}

function track(id, title, artist, durationMs) {
  return {
    id,
    title,
    artists: [artist],
    album: 'Web App Smoke Fixture',
    durationMs,
  };
}

function qqMidOnlyTrack(mid, title, artist, durationMs) {
  return {
    mid,
    title,
    artists: [artist],
    album: 'Web App Smoke Fixture',
    durationMs,
  };
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Unable to reserve a local port for React app smoke.'));
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tail(value) {
  return String(value || '').split(/\r?\n/u).filter(Boolean).slice(-20).join('\n');
}
