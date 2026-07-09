import { buildMatchEvidence, compactTrackForAi } from './evidence.js';
import { requestAiJson, resolveAiProviderConfig } from './ai-provider.js';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_PROVIDER = 'deepseek';

export async function requestDeepSeekSyncReview({ apiKey, model, items, thinking = true, baseUrl = DEFAULT_BASE_URL }) {
  const batch = buildSyncReviewBatch(items);
  const response = await requestAiJson({
    providerConfig: resolveAiProviderConfig({
      provider: DEFAULT_PROVIDER,
      apiKey,
      model: model || DEFAULT_MODEL,
      baseUrl,
    }),
    messages: [
      { role: 'system', content: SYNC_REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(batch, null, 2) },
    ],
    maxTokens: 12000,
    thinking,
  });

  return normalizeSyncReviewResult(response.json, batch, {
    model: response.model,
    usage: response.usage,
  });
}

export function buildSyncReviewBatch(items, options = {}) {
  const batchId = options.batchId || `sync-ai-${new Date().toISOString()}`;
  return {
    batch_id: batchId,
    instruction: 'Return strict JSON only. Do not use markdown. Judge whether each target candidate is safe to add to the target playlist.',
    items: items.map(compactSyncItem),
  };
}

export function normalizeSyncReviewResult(result, batch, meta = {}) {
  const byId = new Map(batch.items.map((item) => [item.item_id, item]));
  const decisions = [];
  for (const raw of result?.decisions || []) {
    const itemId = clean(raw.item_id);
    if (!byId.has(itemId)) continue;
    const decision = normalizeEnum(raw.decision, ['accept', 'reject', 'uncertain'], 'uncertain');
    const relation = normalizeEnum(
      raw.relation,
      ['same_recording', 'same_song_different_version', 'different_song', 'uncertain'],
      decision === 'accept' ? 'same_recording' : decision === 'reject' ? 'different_song' : 'uncertain',
    );
    const recommendedAction = normalizeEnum(
      raw.recommended_action,
      ['add', 'skip', 'needs_human'],
      decision === 'accept' && relation === 'same_recording' ? 'add' : decision === 'reject' ? 'skip' : 'needs_human',
    );
    const baseDecision = {
      itemId,
      decisionKey: clean(raw.decision_key) || byId.get(itemId)?.decision_key || '',
      clusterId: byId.get(itemId)?.cluster_id || '',
      target: byId.get(itemId)?.target_platform || '',
      decision,
      relation,
      recommendedAction,
      confidence: clamp(Number(raw.confidence ?? 0), 0, 1),
      evidence: {
        title: clean(raw.evidence?.title).slice(0, 120),
        artist: clean(raw.evidence?.artist).slice(0, 120),
        album: clean(raw.evidence?.album).slice(0, 120),
        duration: clean(raw.evidence?.duration).slice(0, 120),
        version: clean(raw.evidence?.version).slice(0, 120),
      },
      reason: clean(raw.reason).slice(0, 600),
    };
    decisions.push(applySyncSuggestionSafety(baseDecision, byId.get(itemId)));
  }

  return {
    batchId: clean(result?.batch_id) || batch.batch_id,
    model: meta.model || '',
    usage: meta.usage || null,
    reviewedAt: new Date().toISOString(),
    decisions,
  };
}

export function applySyncSuggestionSafety(decision, context = {}) {
  if (decision.recommendedAction !== 'add') return decision;

  const facts = extractSyncFacts(context);
  const text = [
    decision.reason,
    decision.evidence?.title,
    decision.evidence?.artist,
    decision.evidence?.album,
    decision.evidence?.duration,
    decision.evidence?.version,
  ].filter(Boolean).join(' ');

  if (facts.targetInLibrary) {
    return downgradeAdd(decision, 'target already exists in the current target library', 'already_present');
  }
  if (decision.decision !== 'accept' || decision.relation !== 'same_recording') {
    return downgradeAdd(decision, 'AI add is inconsistent with decision/relation', 'inconsistent_action');
  }
  if (facts.durationDeltaSeconds !== null && facts.durationDeltaSeconds > 15) {
    return downgradeAdd(decision, `duration delta ${facts.durationDeltaSeconds}s is too large`, 'duration_delta');
  }
  if (hasVersionCueConflict(facts.sourceText, facts.targetText)) {
    return downgradeAdd(decision, 'version cue appears on only one side', 'version_cue_mismatch');
  }
  if (/\b(known|likely|seems?|appears on both|acceptable|mislabeled|metadata error|album difference|album discrepancy|album variance|despite version label)\b/i.test(text)) {
    return downgradeAdd(decision, 'AI used unverifiable or speculative evidence', 'speculative_evidence');
  }

  return decision;
}

function downgradeAdd(decision, reason, code) {
  return {
    ...decision,
    originalDecision: decision.originalDecision || decision.decision,
    originalRelation: decision.originalRelation || decision.relation,
    originalRecommendedAction: decision.originalRecommendedAction || decision.recommendedAction,
    decision: 'uncertain',
    relation: 'uncertain',
    recommendedAction: 'needs_human',
    safety: {
      guarded: true,
      code,
      reason,
    },
  };
}

function extractSyncFacts(context = {}) {
  const source = context.source_track || context.source?.track || {};
  const target = context.target_candidate || context.match?.track || {};
  const sourceCluster = context.source_cluster || context;
  const durationDeltaSeconds = context.duration_delta_seconds !== undefined
    ? Number(context.duration_delta_seconds)
    : durationDeltaSecondsFromTracks(source, target, sourceCluster);
  return {
    targetInLibrary: Boolean(context.target_candidate_in_current_library || context.targetPresence?.inLibrary),
    durationDeltaSeconds: Number.isFinite(durationDeltaSeconds) ? Math.abs(durationDeltaSeconds) : null,
    sourceText: [
      sourceCluster.title,
      sourceCluster.artist,
      sourceCluster.album,
      source.title,
      source.artist,
      source.album,
    ].filter(Boolean).join(' '),
    targetText: [
      target.title,
      target.artist,
      target.album,
    ].filter(Boolean).join(' '),
  };
}

function durationDeltaSecondsFromTracks(source, target, sourceCluster = {}) {
  const left = Number(source.duration_ms || source.durationMs || sourceCluster.duration_ms || sourceCluster.durationMs || 0);
  const right = Number(target.duration_ms || target.durationMs || 0);
  if (!left || !right) return null;
  return Math.round(Math.abs(left - right) / 1000);
}

function hasVersionCueConflict(sourceText, targetText) {
  const sourceCues = versionCueSet(sourceText);
  const targetCues = versionCueSet(targetText);
  for (const cue of sourceCues) {
    if (!targetCues.has(cue)) return true;
  }
  for (const cue of targetCues) {
    if (!sourceCues.has(cue)) return true;
  }
  return false;
}

function versionCueSet(text) {
  const value = clean(text).toLowerCase();
  const cues = new Set();
  const checks = [
    ['live', /\b(live|concert|the first take)\b|ライブ/u],
    ['cover', /\bcover\b|カバー|翻唱/u],
    ['acoustic', /\bacoustic\b|アコースティック|弾き語り/u],
    ['piano', /\bpiano\b|ピアノ|钢琴|鋼琴/u],
    ['instrumental', /\b(instrumental|inst\.?|off vocal|karaoke)\b|伴奏|器乐|器樂/u],
    ['tv-size', /\b(tv[- ]?size|short[- ]?(?:ver(?:sion)?|edit|size)|edit(?: version)?)\b|テレビサイズ|tvサイズ/u],
    ['remix', /\b(remix|mixed|dj mix)\b|リミックス/u],
    ['remaster', /\bremaster(?:ed)?\b|リマスター/u],
    ['single-version', /\bsingle version\b|シングル.?バージョン/u],
    ['album-version', /\balbum version\b|アルバム.?バージョン/u],
    ['movie-version', /\b(movie|film|cinema).?ver(?:sion)?\b/u],
  ];
  for (const [name, pattern] of checks) {
    if (pattern.test(value)) cues.add(name);
  }
  return cues;
}

function compactSyncItem(item) {
  const sourceTrack = item.source?.track || {};
  const targetTrack = item.match?.track || {};
  const targetPlatform = item.target || targetTrack.platform || 'netease';
  const durationDeltaMs = durationDelta(sourceTrack.durationMs, targetTrack.durationMs);
  const matchEvidence = buildMatchEvidence(sourceTrack, targetTrack, item.match?.score || null);
  return {
    item_id: item.decisionKey,
    decision_key: item.decisionKey,
    cluster_id: item.clusterId,
    target_platform: targetPlatform,
    status: item.status,
    algorithm_score: item.match?.score || null,
    source_cluster: {
      title: item.title || '',
      artist: item.artist || '',
      album: item.album || '',
      duration: item.duration || '',
      duration_ms: item.durationMs || null,
      present_platforms: item.presentPlatforms || [],
    },
    source_track: compactTrack(item.source?.platform || '', sourceTrack),
    target_candidate: compactTrack(targetPlatform, targetTrack),
    match_evidence: matchEvidence,
    target_candidate_in_current_library: Boolean(item.targetPresence?.inLibrary),
    target_presence: item.targetPresence?.inLibrary
      ? {
        source: item.targetPresence.source || '',
        fetched_at: item.targetPresence.fetchedAt || '',
        reason: item.targetPresence.reason || '',
        track: compactTrack(targetPlatform, item.targetPresence.track || {}),
      }
      : null,
    duration_delta_ms: durationDeltaMs,
    duration_delta_seconds: durationDeltaMs === null ? null : Math.round(durationDeltaMs / 1000),
    alternatives: (item.alternatives || []).slice(0, 3).map((track) => compactTrack(targetPlatform, track)),
    search_queries: (item.queries || []).slice(0, 6),
  };
}

function compactTrack(platform, track) {
  return compactTrackForAi(platform, track);
}

function durationDelta(left, right) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  if (!a || !b) return null;
  return Math.abs(a - b);
}

function normalizeEnum(value, allowed, fallback) {
  const text = clean(value);
  return allowed.includes(text) ? text : fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const SYNC_REVIEW_SYSTEM_PROMPT = `
You are a strict music sync safety judge. You only use the supplied JSON data. Do not browse, search, infer facts from memory, or invent missing metadata.

Task: decide whether a target platform search candidate is safe to add to the user's target playlist as the same recording/version as the source track.

Return strict JSON only. The word json is intentionally included here because response_format json_object is enabled.

Rules:
1. The app already searched the target platform. You judge the provided target_candidate, not whether a better song may exist elsewhere.
2. Same title can appear in Chinese, Japanese, English, kana, romaji, pinyin, translated parentheses, or punctuation variants.
3. Artist names may differ by alias, transliteration, localized spelling, or group/member formatting.
4. Duration is important. Use duration_ms and duration_delta_seconds whenever present: <= 5 seconds difference strongly supports same; 5-15 seconds weakly supports same; > 20 seconds is suspicious unless other metadata is extremely strong.
5. Version words matter. live, cover, acoustic, piano, instrumental, remix, movie ver, album version, single version, remaster, karaoke, off vocal, TV size, short, extended, and similar terms can mean a different version.
6. If source and target are the same song but a different version, reject it for automatic adding unless the supplied evidence clearly says this special version is intended.
7. If title and artist match but album/duration/version disagree strongly, output uncertain or reject. Do not force an add.
8. If evidence is insufficient, use decision uncertain and recommended_action needs_human.
9. Only use recommended_action add when you are confident it is the same recording/version.
10. If target_candidate_in_current_library is true, that exact target candidate already exists in the current target library. If it is the same recording, use relation same_recording but recommended_action skip because no write is needed. If it is not the same recording, use reject/uncertain and do not recommend add for that candidate.
11. Never use outside music knowledge as evidence. Phrases like "known alias", "likely", "seems", "appears on both", "metadata error", "mislabeled", or "album difference is acceptable" mean the evidence is not strong enough; use needs_human.
12. If a version cue appears on only one side, use needs_human or skip. Examples: remaster, live, cover, acoustic, piano, instrumental, TV size, short edit, remix, mixed, album version, single version.
13. Album mismatch is not positive evidence. It is acceptable only when the album names are explicit translations/romanizations/localizations in the supplied fields, or every other field is exact and no version cue differs.
14. external_evidence.musicbrainz comes from a provider-independent MusicBrainz ISRC lookup. Same ISRC or shared MusicBrainz recording IDs are strong positive evidence. Different ISRC or explicit version cue conflicts are risk signals. A missing or not_found MusicBrainz status is neutral, not negative evidence.
15. match_evidence.support_signals and match_evidence.risk_signals summarize deterministic checks. Use them as evidence, but do not override a large duration mismatch or one-sided version wording.

Local feedback from the user's previous NetEase liked write:
- 28 write candidates were already present before writing. Most were legitimate aliases: simplified/traditional Chinese, Japanese old/new kanji, kana/romaji/English transliteration, localized artist names, translated parentheses, and group-member artist formatting.
- Treat those alias patterns as positive evidence only when duration and the main title/artist are consistent.
- Stay conservative for TV size, short, cover, remix, instrumental, or soundtrack medley wording. Those caused the highest risk of version mistakes and should usually be needs_human unless the source explicitly has the same version wording.

Output schema:
{
  "batch_id": "same as input batch_id",
  "decisions": [
    {
      "item_id": "input item_id",
      "decision_key": "input decision_key",
      "decision": "accept | reject | uncertain",
      "relation": "same_recording | same_song_different_version | different_song | uncertain",
      "confidence": 0.0,
      "recommended_action": "add | skip | needs_human",
      "evidence": {
        "title": "short title evidence",
        "artist": "short artist evidence",
        "album": "short album evidence",
        "duration": "short duration evidence, mention duration_delta_seconds when available",
        "version": "short version evidence"
      },
      "reason": "one concise sentence with the key evidence"
    }
  ]
}
`;
