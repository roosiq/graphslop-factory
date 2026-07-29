import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceProjection, createMissingWorkReport } from '../../packages/graph-kernel/dist/index.js';

import { completeInput, task } from './completeness-fixtures.mjs';

function blockingDrift(repairTaskId, repairAuthorization) {
  return [{
    id: 'drift-alpha',
    status: 'open',
    severity: 'blocking',
    taskId: 'task-alpha',
    repairTaskId,
    repairAuthorization,
  }];
}

test('returns complete only from an empty closure', () => {
  const result = advanceProjection(completeInput());

  assert.equal(result.action, 'complete');
  assert.equal(result.completeness.complete, true);
  assert.equal(result.missingWork, null);
});

test('blocks an unauthorized accepted task instead of reporting early completion', () => {
  const input = completeInput();
  input.tasks[0].ownerAuthorization = 'not_authorized';

  const result = advanceProjection(input);

  assert.equal(result.scheduler.valid, false);
  assert.equal(result.completeness.complete, false);
  assert.equal(result.action, 'block_invalid_state');
});

test('routes baseline change and stale work to impact analysis before any scheduler task', () => {
  const pending = completeInput();
  pending.tasks[0].status = 'ready';
  pending.pendingBaselineChange = true;
  assert.equal(advanceProjection(pending).action, 'impact_analysis');

  const stale = completeInput();
  stale.tasks[0].status = 'ready';
  stale.tasks[0].protectedIntentBaseline = {
    baselineId: 'intent-v0',
    contentHash: stale.currentIntentBaseline.contentHash,
  };
  assert.equal(advanceProjection(stale).action, 'impact_analysis');
});

test('routes produced work to independent Check verification', () => {
  const input = completeInput();
  input.tasks[0].status = 'produced';

  const result = advanceProjection(input);

  assert.equal(result.action, 'verify_task');
  assert.deepEqual(result.refs, ['task-alpha']);
  assert.match(result.reason, /independent Check-role/);
});

test('waits without mutation while a leased, running, or verifying task is active', () => {
  for (const status of ['leased', 'running', 'verifying']) {
    const input = completeInput();
    input.tasks[0].status = status;
    const before = structuredClone(input);

  const result = advanceProjection(input);

    assert.equal(result.action, 'wait_for_active_task', status);
    assert.deepEqual(result.refs, ['task-alpha'], status);
    assert.deepEqual(input, before, status);
  }
});

test('requests explicit repair authorization and never grants it', () => {
  const input = completeInput();
  input.tasks.push(task('repair-alpha', {
    type: 'Repair', status: 'repair_proposed', ownerAuthorization: 'not_authorized', dependencies: ['task-alpha'],
  }));
  input.requiredTaskIds.push('repair-alpha');
  input.taskProducers.push({ taskId: 'repair-alpha', producerId: 'repair-worker-alpha' });
  input.drift = blockingDrift('repair-alpha', 'not_authorized');
  const before = structuredClone(input);

  const result = advanceProjection(input);

  assert.equal(result.action, 'request_repair_authorization');
  assert.equal(input.tasks.find((entry) => entry.id === 'repair-alpha').ownerAuthorization, 'not_authorized');
  assert.deepEqual(input, before);
});

test('executes only a scheduler-selected owner-authorized ready Repair for blocking drift', () => {
  const input = completeInput();
  input.tasks.push(task('repair-alpha', {
    type: 'Repair', status: 'ready', ownerAuthorization: 'authorized', dependencies: ['task-alpha'],
  }));
  input.requiredTaskIds.push('repair-alpha');
  input.taskProducers.push({ taskId: 'repair-alpha', producerId: 'repair-worker-alpha' });
  input.drift = blockingDrift('repair-alpha', 'authorized');

  const result = advanceProjection(input);

  assert.equal(result.scheduler.selectedTaskId, 'repair-alpha');
  assert.equal(result.action, 'execute_repair');
  assert.deepEqual(result.refs, ['drift-alpha', 'repair-alpha']);
});

test('MissingWork repair routes match the one flywheel action for every drift state', () => {
  const assertRoute = (input, expected) => {
    const result = advanceProjection(input);
    const missing = createMissingWorkReport(result.completeness);
    assert.equal(result.action, expected);
    assert.ok(missing.suggestedRoutes.some((route) => route.action === expected), expected);
  };

  const noRepair = completeInput();
  noRepair.drift = blockingDrift(null, 'not_applicable');
  assertRoute(noRepair, 'propose_repair');

  const waitingAuthorization = completeInput();
  waitingAuthorization.tasks.push(task('repair-awaiting', {
    type: 'Repair', status: 'repair_proposed', ownerAuthorization: 'not_authorized', dependencies: ['task-alpha'],
  }));
  waitingAuthorization.requiredTaskIds.push('repair-awaiting');
  waitingAuthorization.taskProducers.push({ taskId: 'repair-awaiting', producerId: 'repair-worker' });
  waitingAuthorization.drift = blockingDrift('repair-awaiting', 'not_authorized');
  assertRoute(waitingAuthorization, 'request_repair_authorization');

  const selectedRepair = completeInput();
  selectedRepair.tasks.push(task('repair-selected', {
    type: 'Repair', status: 'ready', ownerAuthorization: 'authorized', dependencies: ['task-alpha'],
  }));
  selectedRepair.requiredTaskIds.push('repair-selected');
  selectedRepair.taskProducers.push({ taskId: 'repair-selected', producerId: 'repair-worker' });
  selectedRepair.drift = blockingDrift('repair-selected', 'authorized');
  assertRoute(selectedRepair, 'execute_repair');

  const blockedRepair = completeInput();
  blockedRepair.tasks.push(task('repair-blocked', {
    type: 'Repair', status: 'blocked', ownerAuthorization: 'authorized', dependencies: ['task-alpha'],
  }));
  blockedRepair.requiredTaskIds.push('repair-blocked');
  blockedRepair.taskProducers.push({ taskId: 'repair-blocked', producerId: 'repair-worker' });
  blockedRepair.drift = blockingDrift('repair-blocked', 'authorized');
  assertRoute(blockedRepair, 'missing_work');
});

test('awaiting authorization wins over a simultaneous selected authorized repair', () => {
  const input = completeInput();
  input.tasks.push(
    task('repair-awaiting', { type: 'Repair', status: 'repair_proposed', ownerAuthorization: 'not_authorized', dependencies: ['task-alpha'] }),
    task('repair-selected', { type: 'Repair', status: 'ready', ownerAuthorization: 'authorized', dependencies: ['task-alpha'] }),
  );
  input.requiredTaskIds.push('repair-awaiting', 'repair-selected');
  input.taskProducers.push(
    { taskId: 'repair-awaiting', producerId: 'repair-worker-awaiting' },
    { taskId: 'repair-selected', producerId: 'repair-worker-selected' },
  );
  input.drift = [
    ...blockingDrift('repair-awaiting', 'not_authorized'),
    { ...blockingDrift('repair-selected', 'authorized')[0], id: 'drift-selected' },
  ];

  const result = advanceProjection(input);
  const missing = createMissingWorkReport(result.completeness);

  assert.equal(result.action, 'request_repair_authorization');
  assert.equal(missing.suggestedRoutes.find((route) => route.action === 'request_repair_authorization')?.action, result.action);
});

test('prioritizes blocking drift and coverage recompilation over a safe ordinary build', () => {
  const driftInput = completeInput();
  driftInput.tasks[0].status = 'ready';
  driftInput.drift = blockingDrift(null, 'not_applicable');
  assert.equal(advanceProjection(driftInput).action, 'propose_repair');

  const coverageInput = completeInput();
  coverageInput.tasks[0].status = 'ready';
  coverageInput.solutionToIntentTraces = [];
  const coverageResult = advanceProjection(coverageInput);
  assert.equal(coverageResult.scheduler.selectedTaskId, 'task-alpha');
  assert.equal(coverageResult.action, 'recompile_solution');

  const executionCoverageInput = completeInput();
  executionCoverageInput.tasks[0].status = 'ready';
  executionCoverageInput.taskToSolutionTraces = [];
  assert.equal(advanceProjection(executionCoverageInput).action, 'recompile_execution');
});

test('routes compiled/current baseline mismatch and stale observations to impact analysis', () => {
  const rebased = completeInput();
  rebased.compiledIntentBaseline = { baselineId: 'intent-v2', contentHash: 'c'.repeat(64) };
  assert.equal(advanceProjection(rebased).action, 'impact_analysis');

  const staleEvidence = completeInput();
  staleEvidence.evidence[0].solutionBaseline = { baselineId: 'solution-v0', contentHash: staleEvidence.currentSolutionBaseline.contentHash };
  assert.equal(advanceProjection(staleEvidence).action, 'impact_analysis');

  const staleSystemCheck = completeInput();
  staleSystemCheck.systemChecks[0].intentBaseline = { baselineId: 'intent-v0', contentHash: staleSystemCheck.currentIntentBaseline.contentHash };
  assert.equal(advanceProjection(staleSystemCheck).action, 'impact_analysis');
});

test('uses the scheduler selected task for ordinary execution', () => {
  const input = completeInput();
  input.tasks[0].status = 'ready';

  const result = advanceProjection(input);

  assert.equal(result.scheduler.selectedTaskId, 'task-alpha');
  assert.equal(result.action, 'execute_task');
  assert.deepEqual(result.refs, ['task-alpha']);
});

test('never executes through an accepted intermediary with an unfinished dependency ancestor', () => {
  const input = completeInput();
  input.tasks[0].status = 'proposed';
  input.tasks.push(
    task('accepted-middle', { status: 'accepted', dependencies: ['task-alpha'] }),
    task('candidate', { status: 'ready', dependencies: ['accepted-middle'] }),
  );
  input.requiredTaskIds.push('accepted-middle', 'candidate');
  input.taskProducers.push(
    { taskId: 'accepted-middle', producerId: 'middle-builder' },
    { taskId: 'candidate', producerId: 'candidate-builder' },
  );
  input.taskToSolutionTraces.push(
    { taskId: 'accepted-middle', solutionId: 'solution-alpha' },
    { taskId: 'candidate', solutionId: 'solution-alpha' },
  );
  input.evidence.push({
    ...structuredClone(input.evidence[0]),
    id: 'evidence-middle',
    taskId: 'accepted-middle',
    provenanceId: 'middle-checker',
    producerId: 'middle-builder',
  });

  const result = advanceProjection(input);

  assert.equal(result.scheduler.selectedTaskId, null);
  assert.ok(result.scheduler.blockers.some((entry) =>
    entry.code === 'dependency_blocked' && entry.taskIds.includes('candidate')),
  );
  assert.equal(result.action, 'missing_work');
});

test('routes failed or missing checks and unresolved blocking decisions after scheduling has no safe task', () => {
  const checkInput = completeInput();
  checkInput.systemChecks = [];
  assert.equal(advanceProjection(checkInput).action, 'run_system_check');

  const decisionInput = completeInput();
  decisionInput.decisions[0].status = 'unresolved';
  assert.equal(advanceProjection(decisionInput).action, 'owner_decision');
});

test('returns MissingWorkReport when incomplete work has no safe next action', () => {
  const input = completeInput();
  input.tasks[0].status = 'proposed';

  const result = advanceProjection(input);

  assert.equal(result.action, 'missing_work');
  assert.equal(result.completeness.complete, false);
  assert.equal(result.missingWork.incomplete, true);
  assert.deepEqual(result.missingWork.gaps.unacceptedRequiredTaskIds, ['task-alpha']);
});

test('invalid state fails closed and decisions are deterministic and non-mutating', () => {
  const invalid = completeInput();
  invalid.requiredTaskIds.push('task-alpha');
  const invalidResult = advanceProjection(invalid);
  assert.equal(invalidResult.action, 'block_invalid_state');
  assert.equal(invalidResult.completeness.complete, false);

  const input = completeInput();
  input.tasks[0].status = 'ready';
  const before = structuredClone(input);
  const first = advanceProjection(input);
  const second = advanceProjection(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});
