import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ControlStateError,
  appendCorrection,
  approveBaseline,
  lifecycleTransitions,
  transitionLifecycle,
} from '../../packages/control-state/dist/index.js';

const hash = (character) => character.repeat(64);
const baseProject = {
  schemaVersion: '1.0.0',
  projectId: 'project-one',
  displayName: 'One',
  lifecycleState: 'INTENT_REVIEW',
  activeIntentBaselineId: null,
  activeSolutionBaselineId: null,
  activeExecutionSnapshotId: null,
  connectedRepository: null,
  integrationCommit: null,
  activeLeaseId: null,
  runnerEnrollmentId: null,
  currentQuestionId: null,
  createdAt: '2026-07-27T12:00:00Z',
  updatedAt: '2026-07-27T12:00:00Z',
  closedAt: null,
};

test('lifecycle permits only declared forward and repair transitions', () => {
  const approved = transitionLifecycle(baseProject, {
    expectedState: 'INTENT_REVIEW',
    nextState: 'INTENT_APPROVED',
    changedAt: '2026-07-27T12:01:00Z',
  });
  assert.equal(approved.lifecycleState, 'INTENT_APPROVED');

  assert.throws(
    () => transitionLifecycle(approved, {
      expectedState: 'INTENT_APPROVED',
      nextState: 'EXECUTION',
      changedAt: '2026-07-27T12:02:00Z',
    }),
    (error) => error instanceof ControlStateError && error.code === 'illegal_transition',
  );
  assert.throws(
    () => transitionLifecycle(approved, {
      expectedState: 'DISCOVERY',
      nextState: 'SOLUTION_GENERATION',
      changedAt: '2026-07-27T12:02:00Z',
    }),
    (error) => error instanceof ControlStateError && error.code === 'stale_state',
  );
});

test('approval binds owner, exact graph and projection hashes, and ready state', () => {
  const result = approveBaseline({
    project: baseProject,
    graphKind: 'intent',
    baselineId: 'intent-v1',
    snapshotId: 'intent-snapshot-1',
    snapshotContentHash: hash('a'),
    projectionId: 'intent-view-1',
    projectionContentHash: hash('b'),
    displayedProjectionHash: hash('b'),
    unresolvedBlockingQuestionIds: [],
    approval: {
      approvalId: 'approval-1',
      actorId: 'owner-one',
      actorKind: 'authenticated_project_owner',
      artifactType: 'intent_baseline',
      artifactId: 'intent-v1',
      artifactVersion: 1,
      artifactContentHash: hash('a'),
      displayedProjectionHash: hash('b'),
      sourceMessageId: 'message-1',
      sourceQuote: 'Approved',
      approvedAt: '2026-07-27T12:01:00Z',
      includedEdgeRefs: [],
      renderedDataHash: hash('b'),
      generatedAt: '2026-07-27T12:00:30Z',
    },
    nodeVersions: [{ nodeId: 'goal-1', version: 1 }],
    protectedAssertions: [],
    unresolvedNonBlocking: [],
    createdAt: '2026-07-27T12:01:00Z',
  });

  assert.equal(result.baseline.status, 'approved');
  assert.equal(result.project.activeIntentBaselineId, 'intent-v1');
  assert.equal(result.project.lifecycleState, 'INTENT_APPROVED');

  assert.throws(
    () => approveBaseline({
      ...result.input,
      project: baseProject,
      displayedProjectionHash: hash('c'),
    }),
    (error) => error instanceof ControlStateError && error.code === 'projection_mismatch',
  );
  assert.throws(
    () => approveBaseline({
      ...result.input,
      project: baseProject,
      unresolvedBlockingQuestionIds: ['question-1'],
    }),
    (error) => error instanceof ControlStateError && error.code === 'blocking_questions',
  );
});

test('approved baseline objects are deeply immutable', () => {
  const result = approveBaseline({
    project: baseProject,
    graphKind: 'intent',
    baselineId: 'intent-v1',
    snapshotId: 'intent-snapshot-1',
    snapshotContentHash: hash('a'),
    projectionId: 'intent-view-1',
    projectionContentHash: hash('b'),
    displayedProjectionHash: hash('b'),
    unresolvedBlockingQuestionIds: [],
    approval: {
      approvalId: 'approval-1',
      actorId: 'owner-one',
      actorKind: 'authenticated_project_owner',
      artifactType: 'intent_baseline',
      artifactId: 'intent-v1',
      artifactVersion: 1,
      artifactContentHash: hash('a'),
      displayedProjectionHash: hash('b'),
      sourceMessageId: 'message-1',
      sourceQuote: 'Approved',
      approvedAt: '2026-07-27T12:01:00Z',
      includedEdgeRefs: [],
      renderedDataHash: hash('b'),
      generatedAt: '2026-07-27T12:00:30Z',
    },
    nodeVersions: [{ nodeId: 'goal-1', version: 1 }],
    protectedAssertions: [],
    unresolvedNonBlocking: [],
    createdAt: '2026-07-27T12:01:00Z',
  });

  assert.equal(Object.isFrozen(result.baseline), true);
  assert.equal(Object.isFrozen(result.baseline.approvalRecord), true);
  assert.throws(() => { result.baseline.status = 'proposed'; }, TypeError);
});

test('corrections append a successor and retain exact prior history', () => {
  const prior = [{
    correctionId: 'correction-1',
    nodeId: 'goal-1',
    priorVersion: 1,
    nextVersion: 2,
    sourceMessageId: 'message-1',
    rawContent: 'No, keep it local.',
    normalizedContent: 'Run locally.',
    createdAt: '2026-07-27T12:00:00Z',
  }];
  const next = appendCorrection(prior, {
    correctionId: 'correction-2',
    nodeId: 'goal-1',
    priorVersion: 2,
    nextVersion: 3,
    sourceMessageId: 'message-2',
    rawContent: 'Also no database.',
    normalizedContent: 'Do not add a database.',
    createdAt: '2026-07-27T12:01:00Z',
  });

  assert.equal(next.length, 2);
  assert.deepEqual(next[0], prior[0]);
  assert.notEqual(next, prior);
  assert.throws(
    () => appendCorrection(next, { ...next[1], correctionId: 'correction-3', priorVersion: 1, nextVersion: 4 }),
    (error) => error instanceof ControlStateError && error.code === 'broken_correction_chain',
  );
});

test('callers cannot mutate lifecycle transition policy', () => {
  const exposed = lifecycleTransitions();
  assert.equal(Object.isFrozen(exposed), true);
  assert.equal(Object.isFrozen(exposed.CAPTURE), true);
  assert.throws(() => exposed.CAPTURE.push('COMPLETE'), TypeError);
  assert.throws(() => { exposed.CAPTURE = ['COMPLETE']; }, TypeError);

  const discovered = transitionLifecycle(
    { ...baseProject, lifecycleState: 'CAPTURE' },
    {
      expectedState: 'CAPTURE',
      nextState: 'DISCOVERY',
      changedAt: '2026-07-27T12:01:00Z',
    },
  );
  assert.equal(discovered.lifecycleState, 'DISCOVERY');
});

test('solution approval requires the exact active approved Intent record', () => {
  const solutionProject = {
    ...baseProject,
    lifecycleState: 'SOLUTION_REVIEW',
    activeIntentBaselineId: 'intent-v1',
  };
  const solutionApproval = {
    project: solutionProject,
    graphKind: 'solution',
    baselineId: 'solution-v1',
    snapshotId: 'solution-snapshot-1',
    snapshotContentHash: hash('c'),
    projectionId: 'solution-view-1',
    projectionContentHash: hash('d'),
    displayedProjectionHash: hash('d'),
    unresolvedBlockingQuestionIds: [],
    approval: {
      approvalId: 'approval-solution-1',
      actorId: 'owner-one',
      actorKind: 'authenticated_project_owner',
      artifactType: 'solution_baseline',
      artifactId: 'solution-v1',
      artifactVersion: 1,
      artifactContentHash: hash('c'),
      displayedProjectionHash: hash('d'),
      sourceMessageId: 'message-2',
      sourceQuote: 'Approved',
      approvedAt: '2026-07-27T12:02:00Z',
      includedEdgeRefs: [],
      renderedDataHash: hash('d'),
      generatedAt: '2026-07-27T12:01:30Z',
    },
    nodeVersions: [{ nodeId: 'feature-1', version: 1 }],
    protectedAssertions: [],
    unresolvedNonBlocking: [],
    createdAt: '2026-07-27T12:02:00Z',
  };

  assert.throws(
    () => approveBaseline(solutionApproval),
    (error) => error instanceof ControlStateError && error.code === 'missing_prerequisite',
  );
});

test('execution requires exact active approved Intent and Solution records', () => {
  const executionProject = {
    ...baseProject,
    lifecycleState: 'SOLUTION_APPROVED',
    activeIntentBaselineId: null,
    activeSolutionBaselineId: null,
  };
  assert.throws(
    () => transitionLifecycle(executionProject, {
      expectedState: 'SOLUTION_APPROVED',
      nextState: 'EXECUTION',
      changedAt: '2026-07-27T12:03:00Z',
      approvedBaselines: [],
    }),
    (error) => error instanceof ControlStateError && error.code === 'missing_prerequisite',
  );
});
