import {
  applyMirrorReviewDecisions,
  mirrorReviewDecisionKey,
  summarizeMirrorOperations,
} from './mirror-sync.js';
import { summarizePolicyOperations } from './sync-policy.js';

const IDENTITY_ACTIONS = new Set(['keep', 'separate', 'clear']);

export function patchProductIdentityDecisionPlan(plan = {}, options = {}) {
  if (plan.policy !== 'canonical_mirror') {
    throw new Error('Identity decision patches require a canonical mirror plan.');
  }

  const operationId = clean(options.operationId);
  const action = clean(options.action).toLowerCase();
  if (!operationId) throw new Error('Identity decision operation id is required.');
  if (!IDENTITY_ACTIONS.has(action)) throw new Error(`Unsupported identity decision action: ${action || 'empty'}.`);

  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  const selected = operations.find((operation) => operation.id === operationId);
  if (!selected) throw new Error(`Identity decision operation was not found: ${operationId}.`);
  if (action !== 'clear' && selected.action !== 'review') {
    throw new Error('Only review operations can receive a new identity decision.');
  }

  const decisionKey = operationDecisionKey(selected);
  const groupIndexes = operations
    .map((operation, index) => (operationDecisionKey(operation) === decisionKey ? index : -1))
    .filter((index) => index >= 0);
  const group = groupIndexes.map((index) => operations[index]);
  const decidedAt = clean(options.decidedAt) || new Date().toISOString();
  const recoveredTracks = action === 'clear' ? recoverDecisionTracks(operations, decisionKey) : {};
  const replacement = action === 'clear'
    ? restoreIdentityReviewGroup(group, selected, { decisionKey, ...recoveredTracks })
    : applyIdentityDecisionGroup(group, {
      action,
      decision: {
        ...(options.decision || {}),
        key: decisionKey,
        action,
        decidedAt: options.decision?.decidedAt || decidedAt,
        updatedAt: options.decision?.updatedAt || decidedAt,
      },
    });
  const nextOperations = replaceOperationGroup(operations, groupIndexes, replacement, selected.id);
  const changesAddOperations = countAction(group, 'add') !== countAction(replacement, 'add');
  const {
    convergence: _staleConvergence,
    previewId: _stalePreviewId,
    ...currentPlan
  } = plan;
  const nextPlan = {
    ...currentPlan,
    generatedAt: decidedAt,
    resolvedAt: decidedAt,
    operations: nextOperations,
    summary: productSummary(plan, nextOperations),
    childPlans: refreshChildPlanSummaries(plan.childPlans, nextOperations, decidedAt),
  };
  if (changesAddOperations) delete nextPlan.addResolution;

  return {
    plan: nextPlan,
    action,
    decisionKey,
    operationId,
    previousOperations: group,
    operations: replacement,
  };
}

function applyIdentityDecisionGroup(group, options) {
  const result = [];
  for (const operation of group) {
    if (operation.action !== 'review') {
      result.push(operation);
      continue;
    }
    const origin = operation.identityDecisionOrigin || compactIdentityOrigin(operation);
    const decided = applyMirrorReviewDecisions([operation], {
      items: {
        [options.decision.key]: options.decision,
      },
    });
    for (const item of decided) {
      const next = clearReviewOnlyFields({
        ...item,
        identityDecisionOrigin: origin,
        manualDecision: item.manualDecision ? {
          ...item.manualDecision,
          originalAction: operation.identityCollisionOriginalAction || item.manualDecision.originalAction,
          originalReason: origin.reason || item.manualDecision.originalReason,
        } : item.manualDecision,
      });
      result.push(guardDestructiveIdentityOperation(next));
    }
  }
  return result;
}

function restoreIdentityReviewGroup(group, selected, options) {
  const collisionOrigin = group.find((operation) => operation.identityCollisionOriginalAction);
  if (collisionOrigin && group.length === 1) {
    return [restoreIdentityCollisionOrigin(collisionOrigin)];
  }

  const savedOrigin = group.find((operation) => operation.identityDecisionOrigin)?.identityDecisionOrigin;
  const manualDecision = group.find((operation) => operation.manualDecision)?.manualDecision || {};
  const reference = group.find((operation) => operation.sourceTrack) || selected || group[0] || {};
  const sourceTrack = savedOrigin?.sourceTrack
    || group.find((operation) => operation.sourceTrack)?.sourceTrack
    || options.sourceTrack
    || null;
  const targetTrack = savedOrigin?.targetTrack
    || group.find((operation) => operation.targetTrack)?.targetTrack
    || options.targetTrack
    || null;
  const candidateTrack = savedOrigin?.candidateTrack || group.find((operation) => operation.candidateTrack)?.candidateTrack || null;
  const reason = savedOrigin?.reason || manualDecision.originalReason || reference.reason || 'identity_review_restored';
  const restored = clearDecisionFields({
    ...reference,
    id: selected.id,
    decisionKey: options.decisionKey,
    action: savedOrigin?.action || manualDecision.originalAction || 'review',
    status: savedOrigin?.status || 'needs_review',
    destructive: Boolean(savedOrigin?.destructive),
    reason,
    reviewKind: savedOrigin?.reviewKind || reference.reviewKind || '',
    message: savedOrigin?.message || reviewMessage(reason),
    sourceTrack,
    targetTrack,
    candidateTrack,
    resolvedTargetTrack: savedOrigin?.resolvedTargetTrack || null,
    blockedReason: savedOrigin?.blockedReason || '',
  });
  if (restored.action !== 'review') {
    return [guardDestructiveIdentityOperation(restored)];
  }
  return [{
    ...restored,
    status: 'needs_review',
    destructive: false,
    blockedReason: '',
  }];
}

function restoreIdentityCollisionOrigin(operation) {
  const originalAction = operation.identityCollisionOriginalAction || 'keep';
  const originalStatus = operation.identityCollisionOriginalStatus || 'ready';
  return guardDestructiveIdentityOperation(clearDecisionFields({
    ...operation,
    action: originalAction,
    status: originalStatus,
    destructive: originalAction === 'remove' || Boolean(operation.destructive && originalAction !== 'keep'),
    reviewKind: '',
    blockedReason: '',
    message: operation.identityDecisionOrigin?.message || defaultActionMessage(originalAction),
  }));
}

function replaceOperationGroup(operations, indexes, replacement, selectedId) {
  const indexSet = new Set(indexes);
  const insertionIndex = Math.min(...indexes);
  const used = new Set(operations
    .filter((_, index) => !indexSet.has(index))
    .map((operation) => operation.id));
  const identified = assignReplacementIds(replacement, selectedId, used);
  const result = [];
  for (let index = 0; index < operations.length; index += 1) {
    if (index === insertionIndex) result.push(...identified);
    if (!indexSet.has(index)) result.push(operations[index]);
  }
  return result;
}

function assignReplacementIds(operations, selectedId, used) {
  if (operations.length === 1) {
    const id = uniqueId(selectedId, used);
    used.add(id);
    return [{ ...operations[0], id }];
  }
  return operations.map((operation, index) => {
    const suffix = clean(operation.action) || String(index + 1);
    const id = uniqueId(`${selectedId}-${suffix}`, used);
    used.add(id);
    return { ...operation, id };
  });
}

function uniqueId(input, used) {
  const base = clean(input) || 'sync-identity-decision';
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function refreshChildPlanSummaries(childPlans, operations, generatedAt) {
  if (!Array.isArray(childPlans)) return childPlans;
  return childPlans.map((child) => ({
    ...child,
    generatedAt,
    summary: summarizeMirrorOperations(operations.filter((operation) => operation.targetPlatform === child.target)),
  }));
}

function productSummary(plan, operations) {
  return {
    ...summarizePolicyOperations(operations),
    baselineAdded: Number(plan.summary?.baselineAdded || 0),
    baselineDeleted: Number(plan.summary?.baselineDeleted || 0),
  };
}

function compactIdentityOrigin(operation) {
  return {
    action: operation.identityCollisionOriginalAction || operation.action || 'review',
    status: operation.identityCollisionOriginalStatus || operation.status || 'needs_review',
    destructive: Boolean(operation.destructive),
    reason: operation.reason || '',
    reviewKind: operation.reviewKind || '',
    message: operation.message || '',
    blockedReason: operation.identityCollisionOriginalAction ? '' : operation.blockedReason || '',
    sourceTrack: operation.sourceTrack || null,
    targetTrack: operation.targetTrack || null,
    candidateTrack: operation.candidateTrack || null,
    resolvedTargetTrack: operation.resolvedTargetTrack || null,
  };
}

function clearReviewOnlyFields(operation) {
  const {
    aiReview: _aiReview,
    addDecision: _addDecision,
    alternatives: _alternatives,
    resolution: _resolution,
    ...rest
  } = operation;
  return rest;
}

function clearDecisionFields(operation) {
  const {
    manualDecision: _manualDecision,
    aiReview: _aiReview,
    addDecision: _addDecision,
    alternatives: _alternatives,
    resolution: _resolution,
    identityDecisionOrigin: _identityDecisionOrigin,
    identityCollisionOriginalAction: _identityCollisionOriginalAction,
    identityCollisionOriginalStatus: _identityCollisionOriginalStatus,
    ...rest
  } = operation;
  return rest;
}

function guardDestructiveIdentityOperation(operation) {
  if (operation.action !== 'remove' || operation.targetTrack?.id) return operation;
  return {
    ...operation,
    status: 'blocked',
    blockedReason: 'missing_destructive_target_id',
    message: operation.message || 'This target track cannot be removed until the provider exposes a destructive track id.',
  };
}

function operationDecisionKey(operation) {
  return clean(operation.decisionKey || operation.manualDecision?.key) || mirrorReviewDecisionKey(operation);
}

function recoverDecisionTracks(operations, decisionKey) {
  const [, , sourceIdentity = '', targetIdentity = ''] = clean(decisionKey).split('|');
  return {
    sourceTrack: findTrackByDecisionIdentity(operations, sourceIdentity),
    targetTrack: findTrackByDecisionIdentity(operations, targetIdentity),
  };
}

function findTrackByDecisionIdentity(operations, identity) {
  const firstSeparator = identity.indexOf(':');
  const secondSeparator = identity.indexOf(':', firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator) return null;
  const platform = identity.slice(0, firstSeparator);
  const providerId = identity.slice(firstSeparator + 1, secondSeparator);
  if (!platform || !providerId || providerId === 'none') return null;
  for (const operation of operations) {
    for (const track of [
      operation.sourceTrack,
      operation.targetTrack,
      operation.candidateTrack,
      operation.resolvedTargetTrack,
    ]) {
      if (!track || clean(track.platform).toLowerCase() !== platform.toLowerCase()) continue;
      if ([track.id, track.mid, track.isrc].some((value) => clean(value) === providerId)) return track;
    }
  }
  return null;
}

function countAction(operations, action) {
  return operations.filter((operation) => operation.action === action).length;
}

function reviewMessage(reason) {
  if (reason === 'source_uncertain_match') return 'The best target candidate needs review before it can represent the Apple source track.';
  if (reason === 'duplicate_target_match') return 'Multiple Apple source tracks may map to the same target track and need review.';
  if (reason === 'reverse_only_match') return 'The target resembles an Apple source track but was only found by reverse matching.';
  if (reason === 'target_uncertain_orphan') return 'The target-only track resembles Apple source data, so its identity needs review.';
  return 'This cross-platform identity needs manual review before syncing.';
}

function defaultActionMessage(action) {
  if (action === 'keep') return 'The target already represents this Apple source track.';
  if (action === 'add') return 'The Apple source track is missing from the target.';
  if (action === 'remove') return 'The target track is not represented by the Apple source.';
  return reviewMessage('');
}

function clean(value) {
  return String(value || '').trim();
}
