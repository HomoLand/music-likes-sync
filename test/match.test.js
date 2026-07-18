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
    assert.equal(result.matches[0].score.artist, 0);
    assert.equal(result.matches[0].score.total, 0.9);
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
      durationMs: 261000,
    }, 'qq');

    const result = compareAppleToPlatform([apple], [live]);

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
});

function track(input, platform) {
  return normalizeTrack(input, platform);
}
