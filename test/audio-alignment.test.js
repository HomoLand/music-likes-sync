import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alignChromaprintFingerprints,
  CHROMAPRINT_SECONDS_PER_HASH,
} from '../src/audio-alignment.js';

describe('audio fingerprint alignment', () => {
  it('locates the same recording inside a longer provider stream', () => {
    const source = deterministicFingerprint(500, 7);
    const target = Uint32Array.from([
      ...deterministicFingerprint(173, 91),
      ...source,
      ...deterministicFingerprint(260, 1337),
    ]);

    const result = alignChromaprintFingerprints(source, target);

    assert.equal(result.status, 'aligned');
    assert.equal(result.confidence, 1);
    assert.ok(Math.abs(result.offsetFromSourceSeconds - 173 * CHROMAPRINT_SECONDS_PER_HASH) < 0.001);
    assert.equal(result.sourceStartSeconds, 0);
    assert.equal(result.targetStartSeconds, result.offsetFromSourceSeconds);
    assert.equal(result.maxPreviewSeconds, 30);
  });

  it('rejects unrelated audio instead of presenting a false aligned segment', () => {
    const result = alignChromaprintFingerprints(
      deterministicFingerprint(400, 11),
      deterministicFingerprint(700, 29),
    );

    assert.equal(result.status, 'not_aligned');
    assert.ok(result.confidence < 0.82);
    assert.equal(result.offsetFromSourceSeconds, 0);
    assert.match(result.reason, /不足以可靠对齐/);
  });

  it('requires enough shared audio to make a stable comparison', () => {
    const result = alignChromaprintFingerprints(
      deterministicFingerprint(60, 1),
      deterministicFingerprint(60, 1),
    );

    assert.equal(result.status, 'unavailable');
    assert.match(result.reason, /太短/);
  });
});

function deterministicFingerprint(length, seed) {
  let state = seed >>> 0;
  return Uint32Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  });
}
