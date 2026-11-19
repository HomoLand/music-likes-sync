import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMatchSearchPlan } from '../src/match-query.js';

describe('match search query planner', () => {
  it('prioritizes trusted target-storefront title and artist pairs', () => {
    const plan = buildMatchSearchPlan({
      title: 'Ai Ren Cuo Guo',
      artist: 'Accusefive',
      album: 'Somewhere in Time, I Love You',
      metadata: {
        appleStorefronts: {
          equivalents: [
            {
              storefront: 'jp',
              title: 'アイレンツオグオ',
              artist: 'Accusefive',
              aliasTrusted: true,
              isrcMatch: true,
            },
            {
              storefront: 'cn',
              title: '爱人错过',
              artist: '告五人',
              album: '我肯定在几百年前就说过爱你',
              aliasTrusted: true,
              isrcMatch: true,
            },
          ],
        },
      },
    }, { targetPlatform: 'qq', limit: 8 });

    assert.equal(plan[0].query, '爱人错过 告五人');
    assert.equal(plan[0].strategy, 'apple_storefront_title_artist');
    assert.equal(plan[0].storefront, 'cn');
    assert(plan.some((item) => item.query === 'Ai Ren Cuo Guo Accusefive'));
    assert(!plan.some((item) => item.storefront === 'jp'));
  });

  it('never promotes an untrusted storefront substitute into a search query', () => {
    const plan = buildMatchSearchPlan({
      title: 'Original Song',
      artist: 'Original Artist',
      metadata: {
        appleStorefronts: {
          equivalents: [{
            storefront: 'cn',
            title: 'Wrong Cover',
            artist: 'Cover Artist',
            aliasTrusted: false,
          }],
        },
      },
    }, { targetPlatform: 'netease' });

    assert(!plan.some((item) => item.query.includes('Wrong Cover')));
    assert.equal(plan[0].query, 'Original Song Original Artist');
  });

  it('uses explicit title, artist, and album aliases without duplicate queries', () => {
    const plan = buildMatchSearchPlan({
      title: 'Dream裁魂',
      artist: 'Yinlin',
      album: 'Dream Album',
      aliases: {
        titles: ['裁梦为魂', '裁梦为魂', 'Dream裁魂'],
        artists: ['银临', 'Yinlin'],
        albums: ['裁梦为魂 - Single'],
      },
    }, { targetPlatform: 'qq', limit: 12 });

    assert(plan.some((item) => item.query === '裁梦为魂 Yinlin'));
    assert(plan.some((item) => item.query === 'Dream裁魂 银临'));
    assert(plan.some((item) => item.query === '裁梦为魂 银临'));
    assert(plan.some((item) => item.query === 'Dream裁魂 裁梦为魂 - Single'));
    assert.equal(new Set(plan.map((item) => item.query)).size, plan.length);
  });
});
