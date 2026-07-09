import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { removeNeteaseTracksFromPlaylist } from '../src/providers/netease.js';
import { removeQQTracksFromPlaylist } from '../src/providers/qq.js';

describe('provider delete helpers', () => {
  it('returns a stable no-op result for empty QQ removals', async () => {
    const result = await removeQQTracksFromPlaylist('', '201', []);

    assert.equal(result.requested, 0);
    assert.equal(result.submitted, 0);
    assert.equal(result.removed, 0);
    assert.deepEqual(result.stillPresentIds, []);
    assert.deepEqual(result.unsupportedIds, []);
  });

  it('returns a stable no-op result for empty NetEase removals', async () => {
    const result = await removeNeteaseTracksFromPlaylist('', '123', []);

    assert.equal(result.requested, 0);
    assert.equal(result.submitted, 0);
    assert.equal(result.removed, 0);
    assert.deepEqual(result.stillPresentIds, []);
    assert.deepEqual(result.alreadyAbsentIds, []);
  });
});
