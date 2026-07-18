import { buildMatchEvidence, compactTrackForAi } from './evidence.js';
import { requestAiJson, resolveAiProviderConfig } from './ai-provider.js';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_PROVIDER = 'deepseek';

export async function requestDeepSeekMirrorReview({ apiKey, model, operations, thinking = true, baseUrl = DEFAULT_BASE_URL }) {
  const batch = buildMirrorReviewBatch(operations);
  const response = await requestAiJson({
    providerConfig: resolveAiProviderConfig({
      provider: DEFAULT_PROVIDER,
      apiKey,
      model: model || DEFAULT_MODEL,
      baseUrl,
    }),
    messages: [
      { role: 'system', content: MIRROR_REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(batch, null, 2) },
    ],
    maxTokens: 12000,
    thinking,
  });

  return normalizeMirrorReviewResult(response.json, batch, {
    model: response.model,
    usage: response.usage,
  });
}

export function buildMirrorReviewBatch(operations, options = {}) {
  const batchId = options.batchId || `mirror-ai-${new Date().toISOString()}`;
  return {
    batch_id: batchId,
    instruction: 'Return strict JSON only. Judge whether each target track is the same recording/version as the Apple source track.',
    items: operations.map(compactMirrorOperation),
  };
}

export function normalizeMirrorReviewResult(result, batch, meta = {}) {
  const byId = new Map(batch.items.map((item) => [item.item_id, item]));
  const decisions = [];
  for (const raw of result?.decisions || []) {
    const itemId = clean(raw.item_id);
    if (!byId.has(itemId)) continue;
    const decision = normalizeEnum(raw.decision, ['same', 'different', 'uncertain'], 'uncertain');
    const relation = normalizeEnum(
      raw.relation,
      ['same_recording', 'same_song_different_version', 'different_song', 'uncertain'],
      decision === 'same' ? 'same_recording' : decision === 'different' ? 'different_song' : 'uncertain',
    );
    const recommendedAction = normalizeEnum(
      raw.recommended_action,
      ['keep', 'separate', 'needs_human'],
      fallbackAction(decision, relation),
    );
    const context = byId.get(itemId);
    const normalized = {
      itemId,
      decisionKey: clean(raw.decision_key) || context.decision_key || '',
      operationId: clean(raw.operation_id) || context.operation_id || '',
      target: context.target_platform || '',
      reasonCode: context.reason || '',
      decision,
      relation,
      recommendedAction,
      confidence: clamp(Number(raw.confidence ?? 0), 0, 1),
      evidence: {
        title: clean(raw.evidence?.title).slice(0, 120),
        artist: clean(raw.evidence?.artist).slice(0, 120),
        album: clean(raw.evidence?.album).slice(0, 120),
        duration: clean(raw.evidence?.duration).slice(0, 120),
        external: clean(raw.evidence?.external).slice(0, 160),
        version: clean(raw.evidence?.version).slice(0, 120),
      },
      reason: clean(raw.reason).slice(0, 600),
    };
    decisions.push(applyMirrorSuggestionSafety(normalized, context));
  }

  return {
    batchId: clean(result?.batch_id) || batch.batch_id,
    model: meta.model || '',
    usage: meta.usage || null,
    reviewedAt: new Date().toISOString(),
    decisions,
  };
}

export function applyMirrorSuggestionSafety(decision, context = {}) {
  if (decision.recommendedAction !== 'keep') return normalizeActionConsistency(decision);

  const facts = extractMirrorFacts(context);
  if (decision.decision !== 'same' || decision.relation !== 'same_recording') {
    return downgrade(decision, 'keep is inconsistent with decision/relation', 'inconsistent_keep');
  }
  if (facts.differentIsrc) {
    return downgrade(decision, 'source and target have different ISRC values', 'different_isrc');
  }
  if (facts.durationOver20 && !facts.hasRecordingIdentity) {
    return downgrade(decision, 'duration delta is over 20 seconds without shared recording identity', 'duration_delta');
  }
  if (facts.versionCueConflict && !facts.hasRecordingIdentity) {
    return downgrade(decision, 'version cue appears on only one side without shared recording identity', 'version_cue');
  }
  if (!facts.hasStrongSupport) {
    return downgrade(decision, 'same-recording evidence is not strong enough for automatic keep', 'weak_support');
  }

  const text = [
    decision.reason,
    decision.evidence?.title,
    decision.evidence?.artist,
    decision.evidence?.album,
    decision.evidence?.duration,
    decision.evidence?.external,
    decision.evidence?.version,
  ].filter(Boolean).join(' ');
  if (/\b(known|likely|seems?|appears on both|acceptable|mislabeled|metadata error|album difference|album discrepancy|album variance|despite version label)\b/i.test(text)) {
    return downgrade(decision, 'AI used unverifiable or speculative evidence', 'speculative_evidence');
  }

  return decision;
}

function normalizeActionConsistency(decision) {
  if (decision.recommendedAction !== 'separate') return decision;
  if (decision.decision === 'same' && decision.relation === 'same_recording') {
    return downgrade(decision, 'separate is inconsistent with same_recording', 'inconsistent_separate');
  }
  return decision;
}

function extractMirrorFacts(context = {}) {
  const evidence = context.match_evidence || {};
  const support = new Set(evidence.support_signals || []);
  const risk = new Set(evidence.risk_signals || []);
  const hasRecordingIdentity = support.has('same_isrc')
    || support.has('shared_musicbrainz_recording_id')
    || support.has('apple_storefront_equivalent_fingerprint')
    || support.has('same_album_track_number');
  const hasRecordingFingerprint = support.has('exact_recording_fingerprint');
  const hasStrongTextSupport = (
    support.has('duration_within_5_seconds')
    && support.has('title_alias_overlap')
    && support.has('artist_alias_overlap')
  );
  return {
    hasRecordingIdentity,
    hasStrongSupport: hasRecordingIdentity || hasRecordingFingerprint || hasStrongTextSupport,
    differentIsrc: risk.has('different_isrc'),
    durationOver20: risk.has('duration_over_20_seconds'),
    versionCueConflict: risk.has('version_cue_conflict'),
  };
}

function downgrade(decision, reason, code) {
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

function compactMirrorOperation(operation = {}) {
  const sourceTrack = operation.sourceTrack || {};
  const targetTrack = operation.targetTrack || operation.candidateTrack || {};
  const targetPlatform = targetTrack.platform || operation.target?.platform || '';
  const score = operation.score || operation.resolvedScore || null;
  return {
    item_id: operation.decisionKey || operation.id,
    decision_key: operation.decisionKey || '',
    operation_id: operation.id || '',
    target_platform: targetPlatform,
    reason: operation.reason || '',
    message: operation.message || '',
    confidence_label: operation.confidence || '',
    algorithm_score: score,
    source_track: compactTrackForAi('apple', sourceTrack),
    target_track: targetTrack?.title || targetTrack?.id || targetTrack?.mid
      ? compactTrackForAi(targetPlatform, targetTrack)
      : null,
    match_evidence: buildMatchEvidence(sourceTrack, targetTrack, score),
  };
}

function fallbackAction(decision, relation) {
  if (decision === 'same' && relation === 'same_recording') return 'keep';
  if (relation === 'same_song_different_version' || relation === 'different_song' || decision === 'different') return 'separate';
  return 'needs_human';
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

const MIRROR_REVIEW_SYSTEM_PROMPT = `
You are a strict mirror-sync safety judge. You only use the supplied JSON data. Do not browse, search, infer facts from memory, or invent missing metadata.

Task: decide whether a target-platform track is the same recording/version as the Apple Music source-of-truth track.

Return strict JSON only. The word json is intentionally included here because response_format json_object is enabled.

Rules:
1. Apple is the source of truth. Your job is only to decide the review relation, not to execute sync.
2. recommended_action keep means the target track already represents the Apple source track and no add/delete is needed.
3. recommended_action separate means the target track should stay separate from the Apple source track; the app will still require dry-run and explicit delete confirmation before any deletion.
4. Same ISRC or shared MusicBrainz recording IDs are strong positive evidence unless version/title evidence clearly contradicts them.
5. external_evidence.musicbrainz comes from a provider-independent MusicBrainz ISRC lookup. Missing or not_found MusicBrainz is neutral, not negative evidence.
6. match_evidence.support_signals and match_evidence.risk_signals summarize deterministic checks. Use them as evidence, but do not override a large duration mismatch or one-sided version wording.
7. Duration matters: <= 5 seconds supports same, 5-15 seconds weakly supports same, > 20 seconds is suspicious unless ISRC/shared MusicBrainz recording identity is present.
8. Version words matter. live, cover, acoustic, piano, instrumental, remix, movie ver, album version, single version, remaster, karaoke, off vocal, TV size, short, extended, year/version labels, and similar terms can mean a different version. When an explicit cue appears on only one side and no supplied recording identity proves equivalence, use different + same_song_different_version + separate.
9. Alias overlap may include deterministic Unicode, Chinese script, kana/romaji normalization plus MusicBrainz or platform aliases. Treat supplied overlap as evidence for localized names, but it is not enough when duration/version risks exist.
10. exact_recording_fingerprint means normalized title and album are exact, duration differs by no more than 2 seconds, no version cue conflicts, and no different ISRC is present. Treat it as strong supplied evidence even when storefront-localized artist credits differ.
11. If evidence is insufficient, use decision uncertain and recommended_action needs_human. Do not use needs_human when supplied titles, artists, albums, track positions, or explicit version labels directly prove a different song/version.
12. Do not use speculative wording such as "likely", "known alias", "seems", "metadata error", or "album difference is acceptable" as evidence.
13. confidence is confidence that your decision and relation are correct, not a similarity score or probability that the tracks match. A clearly different song/version should normally use separate with high confidence near 1.0.

Output schema:
{
  "batch_id": "same as input batch_id",
  "decisions": [
    {
      "item_id": "input item_id",
      "decision_key": "input decision_key",
      "operation_id": "input operation_id",
      "decision": "same | different | uncertain",
      "relation": "same_recording | same_song_different_version | different_song | uncertain",
      "confidence": 0.0,
      "recommended_action": "keep | separate | needs_human",
      "evidence": {
        "title": "short title evidence",
        "artist": "short artist evidence",
        "album": "short album evidence",
        "duration": "short duration evidence",
        "external": "short ISRC/MusicBrainz evidence",
        "version": "short version evidence"
      },
      "reason": "one concise sentence with the key evidence"
    }
  ]
}
`;
