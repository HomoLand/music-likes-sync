import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { foldCjk, matchingTextVariants } from '../src/transliterate.js';

describe('cross-script matching variants', () => {
  it('folds Japanese shinjitai names to the same simplified form', () => {
    assert.equal(foldCjk('渡辺雅二'), '渡边雅二');
    assert(matchingTextVariants('渡辺雅二').includes('渡边雅二'));
  });
});
