import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('mirror review decision batches', () => {
  it('applies and clears visible review decisions in one plan rebuild', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-mirror-batch-'));
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', batchFixtureScript()], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSIC_LIKES_SYNC_HOME: homeDir,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.beforeReview, 2);
    assert.equal(payload.keepChanged, 2);
    assert.equal(payload.afterKeepReview, 0);
    assert.equal(payload.afterKeepKeep, 2);
    assert.equal(payload.decisionCount, 2);
    assert.equal(payload.uniqueBatchIds, 1);
    assert.equal(payload.clearChanged, 2);
    assert.equal(payload.afterClearReview, 2);
    assert.equal(payload.afterClearDecisionCount, 0);
  });

  it('applies high-confidence mirror AI suggestions through the existing decision state', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-likes-sync-mirror-ai-'));
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', mirrorAiFixtureScript()], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSIC_LIKES_SYNC_HOME: homeDir,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.beforeReview, 1);
    assert.equal(payload.applied, 1);
    assert.equal(payload.kept, 1);
    assert.equal(payload.afterReview, 0);
    assert.equal(payload.afterKeep, 1);
    assert.equal(payload.decisionAction, 'keep');
    assert.equal(payload.aiApplied, true);
  });
});

function batchFixtureScript() {
  return String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FILES,
  generateMirrorSyncPlan,
  saveMirrorDecisionBatch,
} from './src/workflow.js';

const now = '2026-07-07T00:00:00.000Z';
const album = 'Fixture Album';
const apple = {
  platform: 'apple',
  source: 'fixture',
  fetchedAt: now,
  skipped: false,
  tracks: [
    { id: 'a-1', title: 'Shared Song', artists: ['Alice'], album, durationMs: 180000 },
    { id: 'a-2', title: 'Shared Song', artists: ['Alice'], album, durationMs: 180500 },
  ],
};
const netease = {
  platform: 'netease',
  source: 'fixture',
  fetchedAt: now,
  skipped: false,
  tracks: [
    { id: 'n-1', title: 'Shared Song', artists: ['Alice'], album, durationMs: 180000 },
  ],
};

await fs.mkdir(path.dirname(FILES.appleJson), { recursive: true });
await fs.writeFile(FILES.appleJson, JSON.stringify(apple), 'utf8');
await fs.writeFile(FILES.neteaseJson, JSON.stringify(netease), 'utf8');

const before = await generateMirrorSyncPlan({ target: 'netease' });
const reviewItems = before.operations
  .filter((operation) => operation.action === 'review')
  .map((operation) => ({
    key: operation.decisionKey,
    target: 'netease',
    operationId: operation.id,
    reason: operation.reason,
  }));
if (reviewItems.length !== 2) {
  throw new Error('Expected exactly two review items, got ' + reviewItems.length);
}

const keep = await saveMirrorDecisionBatch({
  action: 'keep',
  target: 'netease',
  items: reviewItems,
});
const afterKeepDecisions = JSON.parse(await fs.readFile(FILES.mirrorDecisions, 'utf8'));
const batchIds = new Set(Object.values(afterKeepDecisions.items).map((item) => item.batchId).filter(Boolean));
const clear = await saveMirrorDecisionBatch({
  action: 'clear',
  target: 'netease',
  items: reviewItems,
});
const afterClearDecisions = JSON.parse(await fs.readFile(FILES.mirrorDecisions, 'utf8'));

console.log(JSON.stringify({
  beforeReview: before.summary.review,
  keepChanged: keep.changed,
  afterKeepReview: keep.plan.summary.review,
  afterKeepKeep: keep.plan.summary.keep,
  decisionCount: Object.keys(afterKeepDecisions.items).length,
  uniqueBatchIds: batchIds.size,
  clearChanged: clear.changed,
  afterClearReview: clear.plan.summary.review,
  afterClearDecisionCount: Object.keys(afterClearDecisions.items).length,
}));
`;
}

function mirrorAiFixtureScript() {
  return String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FILES,
  applyMirrorAiSuggestions,
  generateMirrorSyncPlan,
} from './src/workflow.js';

const now = '2026-07-07T00:00:00.000Z';
const apple = {
  platform: 'apple',
  source: 'fixture',
  fetchedAt: now,
  skipped: false,
  tracks: [{
    id: 'a-1',
    title: 'Love',
    artists: ['Keyshia Cole'],
    album: 'Fixture Album',
    durationMs: 180000,
    isrc: 'USAM10500210',
    aliases: { artists: ['Keyshia Myeshia Cole'] },
    metadata: {
      musicbrainz: {
        isrc: 'USAM10500210',
        fetchedAt: now,
        status: 'ok',
        recordingIds: ['mbid-1'],
      },
    },
  }],
};
const netease = {
  platform: 'netease',
  source: 'fixture',
  fetchedAt: now,
  skipped: false,
  tracks: [{
    id: 'n-1',
    title: 'Love',
    artists: ['Keyshia Myeshia Cole'],
    album: 'Fixture Album',
    durationMs: 192000,
  }],
};

await fs.mkdir(path.dirname(FILES.appleJson), { recursive: true });
await fs.writeFile(FILES.appleJson, JSON.stringify(apple), 'utf8');
await fs.writeFile(FILES.neteaseJson, JSON.stringify(netease), 'utf8');

const before = await generateMirrorSyncPlan({
  target: 'netease',
  threshold: 0.99,
  reviewThreshold: 0.5,
});
const review = before.operations.find((operation) => operation.action === 'review');
if (!review) throw new Error('Expected a mirror review operation.');

await fs.writeFile(FILES.mirrorAiSuggestions, JSON.stringify({
  version: 1,
  updatedAt: now,
  items: {
    [review.decisionKey]: {
      itemId: review.decisionKey,
      decisionKey: review.decisionKey,
      operationId: review.id,
      target: 'netease',
      reasonCode: review.reason,
      decision: 'same',
      relation: 'same_recording',
      recommendedAction: 'keep',
      confidence: 0.96,
      reason: 'Title, artist alias, and duration support the same recording.',
      batchId: 'mirror-ai-fixture',
      updatedAt: now,
    },
  },
  batches: [],
}), 'utf8');

const applied = await applyMirrorAiSuggestions({ threshold: 0.9 });
const decisions = JSON.parse(await fs.readFile(FILES.mirrorDecisions, 'utf8'));
const decision = decisions.items[review.decisionKey];

console.log(JSON.stringify({
  beforeReview: before.summary.review,
  applied: applied.applied,
  kept: applied.kept,
  afterReview: applied.plan.summary.review,
  afterKeep: applied.plan.summary.keep,
  decisionAction: decision.action,
  aiApplied: Boolean(decision.aiAppliedAt),
}));
`;
}
