import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMatchEvidence } from '../src/evidence.js';
import { compareAppleToPlatform } from '../src/match.js';
import { normalizeTrack } from '../src/normalize.js';

describe('cross-platform track matching', () => {
  it('automatically matches traditional and simplified Chinese with an artist alias', () => {
    const apple = track({
      title: '愛人錯過',
      artist: 'Accusefive',
      album: '我肯定在幾百年前就說過愛你',
      durationMs: 292075,
      aliases: { artists: ['告五人'] },
    }, 'apple');
    const qq = track({
      title: '爱人错过',
      artist: '告五人',
      album: '我肯定在几百年前就说过爱你',
      durationMs: 292000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [qq]);

    assert.equal(result.matched, 1);
    assert.equal(result.review, 0);
    assert.deepEqual(result.matches[0].score, {
      total: 1,
      title: 1,
      artist: 1,
      album: 1,
      duration: 1,
      isrc: 0,
      isrcConflict: false,
      recordingFingerprint: true,
      versionCueConflict: false,
    });

    const evidence = buildMatchEvidence(apple, qq, result.matches[0].score);
    assert(evidence.alias_overlap.titles.includes('爱人错过'));
    assert(evidence.alias_overlap.artists.includes('告五人'));
    assert(evidence.alias_overlap.albums.includes('我肯定在几百年前就说过爱你'));
  });

  it('matches Japanese titles and artists through provider or MusicBrainz aliases', () => {
    const apple = track({
      title: 'Yakimochi',
      artist: 'Yu Takahashi',
      album: 'Ima Sokoniaru Meimetsu To Gunjou',
      durationMs: 314633,
      aliases: {
        titles: ['ヤキモチ'],
        artists: ['高橋優'],
      },
    }, 'apple');
    const qq = track({
      title: 'ヤキモチ',
      artist: '高桥优',
      album: '今、そこにある明滅と群生',
      durationMs: 314000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [qq]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.title, 1);
    assert.equal(result.matches[0].score.artist, 1);
  });

  it('accepts an exact recording fingerprint across localized artist credits', () => {
    const apple = track({
      title: '裁夢為魂',
      artist: 'Rachel',
      album: '蚍蜉渡海',
      durationMs: 270832,
      isrc: 'CNM691700029',
      aliases: { artists: ['银临'] },
    }, 'apple');
    const qq = track({
      title: '裁梦为魂',
      artist: '银临',
      album: '蚍蜉渡海',
      durationMs: 270000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [qq]);

    assert.equal(result.matched, 1);
    assert.equal(result.review, 0);
    assert.equal(result.matches[0].score.artist, 1);
    assert.equal(result.matches[0].score.total, 1);
    assert.equal(result.matches[0].score.recordingFingerprint, true);

    const evidence = buildMatchEvidence(apple, qq, result.matches[0].score);
    assert.equal(evidence.recording_fingerprint, true);
    assert(evidence.support_signals.includes('exact_recording_fingerprint'));
  });

  it('keeps duplicate exact recording fingerprints in review', () => {
    const apple = track({
      title: 'Example',
      artist: 'Localized Artist',
      album: 'Example Album',
      durationMs: 240000,
      aliases: {
        artists: ['本地艺人 A', '本地艺人 B'],
      },
    }, 'apple');
    const targets = ['本地艺人 A', '本地艺人 B'].map((artist, index) => track({
      id: `target-${index}`,
      title: 'Example',
      artist,
      album: 'Example Album',
      durationMs: 240000 + index * 500,
    }, 'qq'));

    const result = compareAppleToPlatform([apple], targets);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].score.recordingFingerprint, true);
  });

  it('prefers a same-ISRC candidate over a metadata-only recording fingerprint', () => {
    const apple = track({
      title: 'Example',
      artist: 'Artist',
      album: 'Original Album',
      durationMs: 240000,
      isrc: 'USAAA0000001',
    }, 'apple');
    const fingerprintOnly = track({
      id: 'fingerprint-only',
      title: 'Example',
      artist: 'Localized Artist',
      album: 'Original Album',
      durationMs: 240500,
    }, 'qq');
    const sameIsrc = track({
      id: 'same-isrc',
      title: 'Example',
      artist: 'Artist',
      album: 'Compilation',
      durationMs: 243000,
      isrc: 'USAAA0000001',
    }, 'qq');

    const result = compareAppleToPlatform([apple], [fingerprintOnly, sameIsrc]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].target.id, 'same-isrc');
    assert.equal(result.matches[0].score.isrc, 1);
  });

  it('does not trust an exact metadata fingerprint when ISRC values conflict', () => {
    const apple = track({
      title: 'Example',
      artist: 'Artist A',
      album: 'Example Album',
      durationMs: 240000,
      isrc: 'USAAA0000001',
    }, 'apple');
    const target = track({
      title: 'Example',
      artist: 'Artist B',
      album: 'Example Album',
      durationMs: 240500,
      isrc: 'USAAA0000002',
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].score.isrcConflict, true);
    assert.equal(result.reviewItems[0].score.recordingFingerprint, false);
  });

  it('prefers an exact title alias over a different song by the same artist', () => {
    const apple = track({
      title: 'Yadoribosi',
      artist: 'イトヲカシ',
      album: 'Stardust / Yadoribosi - Single',
      durationMs: 280701,
      aliases: { titles: ['宿り星'] },
    }, 'apple');
    const wrongSameArtist = track({
      title: 'ホシアイ',
      artist: 'イトヲカシ',
      album: '軌唱伝結',
      durationMs: 281000,
    }, 'qq');
    const correctLocalizedArtist = track({
      title: '宿り星',
      artist: '逸动我歌诗',
      album: 'スターダスト / 宿り星',
      durationMs: 280000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [wrongSameArtist, correctLocalizedArtist]);

    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].target.title, '宿り星');
    assert.equal(result.reviewItems[0].score.title, 1);
  });

  it('keeps one-sided version wording out of automatic matches', () => {
    const apple = track({
      title: 'Example Song',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 240000,
    }, 'apple');
    const live = track({
      title: 'Example Song (Live)',
      artist: 'Example Artist',
      album: 'Example Live Album',
      durationMs: 250000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [live]);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].score.versionCueConflict, true);
  });

  it('distinguishes explicit and clean releases with otherwise identical metadata', () => {
    const apple = track({
      title: 'Example Song (Explicit)',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 240000,
    }, 'apple');
    const clean = track({
      title: 'Example Song (Clean)',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 240000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [clean]);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].score.versionCueConflict, true);
  });

  it('does not mistake album branding or translated version labels for a version conflict', () => {
    const apple = track({
      title: 'The Path of the Wind (Instrumental)',
      artist: 'Joe Hisaishi',
      album: 'Complete Piano Collection',
      durationMs: 200000,
      aliases: { titles: ['風のとおり道'] },
    }, 'apple');
    const target = track({
      title: '風のとおり道 (インストゥルメンタル)',
      artist: 'Joe Hisaishi',
      album: 'Original Soundtrack',
      durationMs: 200000,
    }, 'netease');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.versionCueConflict, false);
  });

  it('treats a version cue moved between title and album as equivalent', () => {
    const apple = track({
      title: '好风 (现场)',
      artist: 'Bu Yi',
      album: '乐队的夏天3 第9期',
      durationMs: 370304,
      aliases: { artists: ['布衣乐队'] },
    }, 'apple');
    const target = track({
      title: '好风',
      artist: '布衣乐队',
      album: '乐队的夏天3 第9期 (Live)',
      durationMs: 370000,
    }, 'netease');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.versionCueConflict, false);
  });

  it('never lets localized aliases hide a one-sided instrumental version', () => {
    const apple = track({
      title: 'Horizon Dreamer',
      artist: 'Daichi Miura',
      album: 'Horizon Dreamer / Polytope - EP',
      durationMs: 219000,
      aliases: {
        titles: ['Horizon Dreamer Instrumental'],
        artists: ['三浦大知'],
        albums: ['Horizon Dreamer / Polytope'],
      },
    }, 'apple');
    const target = track({
      title: 'Horizon Dreamer Instrumental',
      artist: '三浦大知',
      album: 'Horizon Dreamer / Polytope',
      durationMs: 219000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 0);
    assert.equal(result.reviewItems[0].score.versionCueConflict, true);
  });

  it('trusts an exact same-ISRC Apple storefront representation', () => {
    const apple = track({
      title: 'Sparkle',
      artist: 'RADWIMPS',
      album: 'Human Bloom',
      durationMs: 410213,
      isrc: 'JPPO01621596',
      metadata: {
        appleStorefronts: {
          sourceStorefront: 'us',
          equivalents: [{
            storefront: 'cn',
            title: 'スパークル (original ver.)',
            artist: 'RADWIMPS',
            album: '人間開花',
            durationMs: 410213,
            isrc: 'JPPO01621596',
            isrcMatch: true,
          }],
        },
      },
      aliases: {
        titles: ['スパークル (original ver.)'],
        albums: ['人間開花'],
      },
    }, 'apple');
    const target = track({
      title: 'スパークル [original ver.]',
      artist: 'RADWIMPS',
      album: '人間開花',
      durationMs: 410000,
    }, 'netease');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.appleEquivalentFingerprint, true);
    assert.equal(result.matches[0].score.versionCueConflict, false);
    assert(buildMatchEvidence(apple, target, result.matches[0].score)
      .support_signals.includes('apple_storefront_equivalent_fingerprint'));
  });

  it('uses an Apple equivalent album track number to identify an omitted self-cover label', () => {
    const apple = track({
      title: 'Mabel (Self Cover)',
      artist: 'Balloon',
      album: 'Corridor',
      durationMs: 196625,
      isrc: 'TCJPF1797610',
      metadata: {
        appleStorefronts: {
          equivalents: [{
            title: 'メーベル (self cover)',
            artist: 'バルーン',
            album: 'Corridor',
            durationMs: 196625,
            isrc: 'TCJPF1797610',
            isrcMatch: true,
            trackNumber: 12,
            discNumber: 1,
          }],
        },
      },
      aliases: { titles: ['メーベル (self cover)'], artists: ['バルーン'] },
    }, 'apple');
    const qq = track({
      title: 'メーベル',
      artist: 'バルーン',
      album: 'Corridor',
      durationMs: 196000,
      raw: { index_album: 12, index_cd: 1, album: { id: 3828176 } },
    }, 'qq');

    const result = compareAppleToPlatform([apple], [qq]);

    assert.equal(qq.metadata.providerCatalog.trackNumber, 12);
    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.catalogTrackFingerprint, true);
    assert.equal(result.matches[0].score.versionCueConflict, false);
  });

  it('uses release date and single-track catalog position for a fully translated title', () => {
    const apple = track({
      title: '好得不能再好了! 泰拉投資大師課',
      artist: 'Monster Siren Records / Adam Gubman / Abdiel González',
      album: '好得不能再好了! 泰拉投資大師課 - Single',
      durationMs: 111308,
      isrc: 'TWU712401227',
      aliases: { artists: ['塞壬唱片-MSR / Adam Gubman / Abdiel Gonzalez'] },
      metadata: {
        appleStorefronts: {
          equivalents: [{
            title: '好得不能再好了! 泰拉投资大师课',
            artist: '塞壬唱片-MSR, Adam Gubman & Abdiel Gonzalez',
            album: '好得不能再好了! 泰拉投资大师课 - Single',
            durationMs: 111308,
            isrc: 'TWU712401227',
            isrcMatch: true,
            trackNumber: 1,
            releaseDate: '2024-04-02',
          }],
        },
      },
    }, 'apple');
    const netease = track({
      title: 'ALL!!!',
      artists: ['塞壬唱片-MSR', 'Adam Gubman', 'Abdiel Gonzalez'],
      album: '好得不能再好了！泰拉投资大师课',
      durationMs: 111308,
      raw: {
        album: {
          id: 190493457,
          size: 1,
          publishTime: 1711987200000,
        },
      },
    }, 'netease');

    const result = compareAppleToPlatform([apple], [netease]);

    assert.equal(netease.metadata.providerCatalog.trackNumber, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.catalogTrackFingerprint, true);
  });

  it('matches Japanese and simplified Chinese artist glyph variants', () => {
    const apple = track({
      title: 'Verdurous Mountains',
      artist: 'Masaji Watanabe',
      album: 'Ancient City',
      durationMs: 235280,
      aliases: { titles: ['青山绿野'], artists: ['渡辺雅二'] },
    }, 'apple');
    const qq = track({
      title: '青山绿野',
      artist: '渡边雅二',
      album: '月Ⅰ、Ⅱ',
      durationMs: 235000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [qq]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.artist, 1);
  });

  it('does not confuse a vocal track with an off-vocal track from the same release', () => {
    const apple = track({
      title: 'Eternal Star (Off Vocal)',
      artist: 'Asaka',
      album: 'Eternal Star - EP',
      durationMs: 263573,
      isrc: 'JPK631804204',
      metadata: {
        appleStorefronts: {
          equivalents: [{
            title: 'Eternal Star (Off Vocal)',
            artist: 'Asaka',
            album: 'Eternal Star - EP',
            durationMs: 263573,
            isrc: 'JPK631804204',
            isrcMatch: true,
            trackNumber: 3,
          }],
        },
      },
    }, 'apple');
    const vocal = track({
      title: 'Eternal Star',
      artist: 'Asaka',
      album: 'Eternal Star - EP',
      durationMs: 263000,
      raw: { index_album: 1, album: { id: 4322527 } },
    }, 'qq');

    const result = compareAppleToPlatform([apple], [vocal]);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].score.catalogTrackFingerprint, undefined);
    assert.equal(result.reviewItems[0].score.versionCueConflict, true);
  });

  it('accepts provider-omitted generic version wording only with exact release evidence', () => {
    const apple = track({
      title: 'Can\'t Take My Eyes Off You (Extended Version)',
      artist: 'Boys Town Gang',
      album: 'Disco Kicks (The Complete Anthology)',
      durationMs: 589800,
      isrc: 'GBAAA2600001',
      aliases: { titles: ['Can\'t Take My Eyes Off You'] },
      metadata: {
        appleStorefronts: {
          equivalents: [{
            title: 'Can\'t Take My Eyes Off You (Extended Version)',
            artist: 'Boys Town Gang',
            album: 'Disco Kicks (The Complete Anthology)',
            durationMs: 589800,
            isrc: 'GBAAA2600001',
            isrcMatch: true,
          }],
        },
      },
    }, 'apple');
    const target = track({
      title: 'Can\'t Take My Eyes Off You',
      artist: 'Boys Town Gang',
      album: 'Disco Kicks (The Complete Anthology)',
      durationMs: 589000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.appleEquivalentFingerprint, true);
  });

  it('matches an explicit piano arrangement even when the ending label is omitted', () => {
    const apple = track({
      title: 'To the Moon - Piano (Ending Version)',
      artist: 'Kan Gao',
      album: 'To the Moon (Original Game Soundtrack)',
      durationMs: 315900,
    }, 'apple');
    const target = track({
      title: 'To the Moon (Piano)',
      artist: 'Kan Gao',
      album: 'To the Moon (Original Soundtrack)',
      durationMs: 315000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.versionCueConflict, false);
  });

  it('matches a localized official title with a provider performance suffix', () => {
    const apple = track({
      title: 'Asu He No Tobira I Wish',
      artist: 'Orgel Sound J-Pop',
      album: 'Orugooru J-Pop Forever 6',
      durationMs: 250947,
      isrc: 'JPF540743008',
      aliases: {
        titles: ['明日への扉 (I WiSH)'],
        albums: ['オルゴール J-POP フォーエバー 6'],
      },
      metadata: {
        appleStorefronts: {
          equivalents: [{
            title: '明日への扉 (I WiSH)',
            artist: 'オルゴールサウンド J-POP',
            album: 'オルゴール J-POP フォーエバー 6',
            durationMs: 250947,
            isrc: 'JPF540743008',
            isrcMatch: true,
          }],
        },
      },
    }, 'apple');
    const target = track({
      title: '明日への扉 Originally Performed By I WiSH (オルゴール)',
      artist: 'Orgel Sound J-Pop',
      album: 'オルゴール J-POP フォーエバー 6',
      durationMs: 250000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 1);
    assert.equal(result.matches[0].score.appleEquivalentFingerprint, true);
  });

  it('does not trust an Apple storefront substitute with a different ISRC', () => {
    const apple = track({
      title: 'Example Song',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 240000,
      isrc: 'USAAA2600001',
      metadata: {
        appleStorefronts: {
          equivalents: [{
            storefront: 'cn',
            title: 'Example Song (Instrumental)',
            artist: 'Example Artist',
            album: 'Example Album',
            durationMs: 240000,
            isrc: 'USAAA2600002',
            isrcMatch: false,
          }],
        },
      },
      aliases: { titles: ['Example Song (Instrumental)'] },
    }, 'apple');
    const target = track({
      title: 'Example Song (Instrumental)',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 240000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 0);
    assert.equal(result.reviewItems[0].score.appleEquivalentFingerprint, undefined);
    assert.equal(result.reviewItems[0].score.versionCueConflict, true);
  });

  it('distinguishes a normal recording from a localized anniversary edition', () => {
    const apple = track({
      title: 'Rainbow',
      artist: 'Shanghai Rainbow Chamber Singers',
      album: 'Rainbow - Single',
      durationMs: 308780,
      aliases: {
        titles: ['彩虹'],
        artists: ['上海彩虹室内合唱团'],
        albums: ['彩虹 - Single'],
      },
    }, 'apple');
    const target = track({
      title: '彩虹 (十周年纪念版)',
      artist: '上海彩虹室内合唱团',
      album: '彩虹 (十周年纪念版)',
      durationMs: 306114,
    }, 'netease');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 0);
    assert.equal(result.reviewItems[0].score.versionCueConflict, true);
  });

  it('does not infer a recording identity from title, album, and duration when artists conflict', () => {
    const apple = track({
      title: 'Shared Title',
      artist: 'Artist One',
      album: 'Shared Album',
      durationMs: 210000,
    }, 'apple');
    const target = track({
      title: 'Shared Title',
      artist: 'Artist Two',
      album: 'Shared Album',
      durationMs: 210000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert.equal(result.reviewItems[0].score.recordingFingerprint, false);
  });

  it('keeps a greater-than-five-second duration difference out of automatic metadata matches', () => {
    const apple = track({
      title: 'Long Intro',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 240000,
    }, 'apple');
    const target = track({
      title: 'Long Intro',
      artist: 'Example Artist',
      album: 'Example Album',
      durationMs: 247000,
    }, 'netease');

    const result = compareAppleToPlatform([apple], [target]);

    assert.equal(result.matched, 0);
    assert.equal(result.review, 1);
    assert(result.reviewItems[0].score.total < 0.82);
  });
});

function track(input, platform) {
  return normalizeTrack(input, platform);
}
