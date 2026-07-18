import { buildMatchEvidence, compactTrackForAi } from './evidence.js';
import { requestAiJson, resolveAiProviderConfig } from './ai-provider.js';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_PROVIDER = 'deepseek';

export async function requestDeepSeekReview({ apiKey, model, items, thinking = true, baseUrl = DEFAULT_BASE_URL }) {
  const batch = buildReviewBatch(items);
  const response = await requestAiJson({
    providerConfig: resolveAiProviderConfig({
      provider: DEFAULT_PROVIDER,
      apiKey,
      model: model || DEFAULT_MODEL,
      baseUrl,
    }),
    messages: [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(batch, null, 2) },
    ],
    maxTokens: 12000,
    thinking,
  });

  return normalizeReviewResult(response.json, batch, {
    model: response.model,
    usage: response.usage,
  });
}

export function buildReviewBatch(items, options = {}) {
  const batchId = options.batchId || `ai-${new Date().toISOString()}`;
  return {
    batch_id: batchId,
    instruction: 'Return strict JSON only. Do not use markdown. The response must follow the schema in the system prompt.',
    items: items.map((item) => item.type === 'candidate'
      ? compactCandidateItem(item)
      : compactClusterItem(item)),
  };
}

export function normalizeReviewResult(result, batch, meta = {}) {
  const byId = new Map(batch.items.map((item) => [item.item_id, item]));
  const decisions = [];
  for (const raw of result?.decisions || []) {
    const itemId = String(raw.item_id || '').trim();
    if (!byId.has(itemId)) continue;
    const decision = normalizeEnum(raw.decision, ['same', 'different', 'uncertain'], 'uncertain');
    const relation = normalizeEnum(
      raw.relation,
      ['same_recording', 'same_song_different_version', 'different_song', 'uncertain'],
      decision === 'same' ? 'same_recording' : decision === 'different' ? 'different_song' : 'uncertain',
    );
    const recommendedAction = normalizeEnum(
      raw.recommended_action,
      ['merge', 'split_versions', 'keep_separate', 'needs_human'],
      fallbackAction(decision, relation),
    );
    decisions.push({
      itemId,
      itemType: byId.get(itemId).type,
      decision,
      relation,
      recommendedAction,
      confidence: clamp(Number(raw.confidence ?? 0), 0, 1),
      canonical: {
        title: clean(raw.canonical?.title),
        artist: clean(raw.canonical?.artist),
        album: clean(raw.canonical?.album),
      },
      preferred: {
        platform: clean(raw.preferred?.platform),
        id: clean(raw.preferred?.id),
        title: clean(raw.preferred?.title),
        reason: clean(raw.preferred?.reason).slice(0, 300),
      },
      reason: clean(raw.reason).slice(0, 600),
    });
  }

  return {
    batchId: clean(result?.batch_id) || batch.batch_id,
    model: meta.model || '',
    usage: meta.usage || null,
    reviewedAt: new Date().toISOString(),
    decisions,
  };
}

function compactCandidateItem(item) {
  return {
    item_id: item.key,
    type: 'low_confidence_candidate',
    existing_score: item.score || {},
    match_evidence: buildMatchEvidence(item.source?.track || {}, item.target?.track || {}, item.score || null),
    tracks: [
      compactEndpoint(item.source),
      compactEndpoint(item.target),
    ],
  };
}

function compactClusterItem(item) {
  return {
    item_id: item.id,
    type: item.needsReview ? 'cluster_conflict' : 'cluster',
    status: item.status,
    platforms: item.platforms,
    missing_platforms: item.missingPlatforms,
    tracks: Object.entries(item.sources || {}).flatMap(([platform, tracks]) => (
      tracks.map((track) => compactTrack(platform, track))
    )),
    version_review: item.versionReview || null,
    conflicts: (item.conflicts || []).map((conflict) => ({
      platform: conflict.platform,
      count: conflict.count,
      tracks: conflict.tracks.map((track) => compactTrack(conflict.platform, track)),
    })),
  };
}

function compactEndpoint(endpoint) {
  return compactTrack(endpoint?.platform || '', endpoint?.track || {});
}

function compactTrack(platform, track) {
  return compactTrackForAi(platform, track);
}

function normalizeEnum(value, allowed, fallback) {
  const text = String(value || '').trim();
  return allowed.includes(text) ? text : fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function fallbackAction(decision, relation) {
  if (relation === 'same_recording' || decision === 'same') return 'merge';
  if (relation === 'same_song_different_version') return 'split_versions';
  if (relation === 'different_song' || decision === 'different') return 'keep_separate';
  return 'needs_human';
}

const REVIEW_SYSTEM_PROMPT = `
You are a strict music matching judge. You only use the supplied JSON data. You do not browse, search, infer facts from memory, or invent missing metadata.

You will receive JSON with a batch_id and items. Each item is one of:
- low_confidence_candidate: two platform tracks that may be the same recording.
- cluster_conflict: one existing merged cluster with duplicate or conflicting tracks.
- cluster: one merged cluster, usually lower risk.

Return strict JSON only. The word json is intentionally included here because response_format json_object is enabled.

Rules:
1. Same ISRC strongly supports same, unless the version or title clearly contradicts it.
2. Titles may be equivalent across Chinese, Japanese, English, kana, romaji, pinyin, and parenthesized translations. Deterministic normalized overlap is supplied in match_evidence.
3. Artist names may differ by alias, transliteration, or localized spelling. Use supplied aliases and overlap rather than model memory.
4. Duration difference <= 5 seconds strongly supports same; 5-15 seconds weakly supports same; >20 seconds requires caution.
5. Version words matter. live, cover, acoustic, piano, instrumental, remix, movie ver, album version, single version, remaster, karaoke, off vocal, TV size, and similar differences usually mean different unless other evidence is very strong.
6. For cluster_conflict, decide whether the tracks already grouped together should remain together. If some tracks should split, use different or uncertain and recommended_action keep_separate or needs_human.
7. The user's target library is the union of all platforms. Missing-platform sync is assumed. Your job is not to decide whether to sync, but whether grouped tracks are the same recording/version.
8. If tracks are the same song but different versions, set relation to same_song_different_version and recommended_action to split_versions. Prefer the full studio/original/single-or-album canonical release over TV size, off vocal, karaoke, instrumental, live, cover, remix, movie edit, short, or acoustic versions unless the supplied evidence suggests the special version is the intended one.
9. If evidence is insufficient, output uncertain. Do not force a merge.
10. external_evidence.musicbrainz comes from a provider-independent MusicBrainz ISRC lookup. Same ISRC or shared MusicBrainz recording IDs are strong positive evidence. Different ISRC or explicit version cue conflicts are risk signals. A missing or not_found MusicBrainz status is neutral, not negative evidence.
11. match_evidence.support_signals and match_evidence.risk_signals summarize deterministic checks. Use them as evidence, but do not override a large duration mismatch or one-sided version wording.
12. exact_recording_fingerprint means normalized title and album are exact, duration differs by no more than 2 seconds, no version cue conflicts exist, and no different ISRC is present. It is strong supplied evidence even when storefront-localized artist credits differ.

Output schema:
{
  "batch_id": "same as input batch_id",
  "decisions": [
    {
      "item_id": "input item_id",
      "decision": "same | different | uncertain",
      "relation": "same_recording | same_song_different_version | different_song | uncertain",
      "confidence": 0.0,
      "recommended_action": "merge | split_versions | keep_separate | needs_human",
      "canonical": {
        "title": "",
        "artist": "",
        "album": ""
      },
      "preferred": {
        "platform": "",
        "id": "",
        "title": "",
        "reason": ""
      },
      "reason": "one concise sentence with the key evidence"
    }
  ]
}
`;
