import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleExecutionTasks } from '../../packages/graph-kernel/dist/index.js';

const hashes = { intent: 'a'.repeat(64), solution: 'b'.repeat(64) };

function task(id, overrides = {}) {
  return {
    id,
    type: 'Implement',
    status: 'ready',
    dependencies: [],
    protectedIntentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
    protectedSolutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
    ownerAuthorization: 'authorized',
    ...overrides,
  };
}

function input(tasks) {
  return {
    tasks,
    currentIntentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
    currentSolutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
  };
}

test('orders independent branches by lexical ID and selects one task only', () => {
  const result = scheduleExecutionTasks(input([
    task('charlie', { dependencies: ['bravo'] }),
    task('alpha'),
    task('bravo', { dependencies: ['alpha'] }),
    task('delta'),
  ]));

  assert.equal(result.valid, true);
  assert.deepEqual(result.order, ['alpha', 'bravo', 'charlie', 'delta']);
  assert.deepEqual(result.dispatchableTaskIds, ['alpha', 'delta']);
  assert.equal(result.selectedTaskId, 'alpha');
  assert.equal(result.incompleteReason, null);
});

test('rejects cycles, missing dependencies, repeated dependencies, self-dependencies, duplicate IDs, and multiple active tasks', () => {
  const checks = [
    { tasks: [task('alpha', { dependencies: ['bravo'] }), task('bravo', { dependencies: ['alpha'] }), task('charlie', { dependencies: ['alpha'] })], code: 'dependency_cycle', ids: ['alpha', 'bravo'] },
    { tasks: [task('alpha', { dependencies: ['missing'] })], code: 'missing_dependency', ids: ['alpha', 'missing'] },
    { tasks: [task('alpha', { dependencies: ['bravo', 'bravo'] }), task('bravo')], code: 'duplicate_dependency', ids: ['alpha', 'bravo'] },
    { tasks: [task('alpha', { dependencies: ['alpha'] })], code: 'self_dependency', ids: ['alpha'] },
    { tasks: [task('alpha'), task('alpha')], code: 'duplicate_task_id', ids: ['alpha'] },
    { tasks: [task('alpha', { status: 'running' }), task('bravo', { status: 'verifying' })], code: 'multiple_active_tasks', ids: ['alpha', 'bravo'] },
  ];
  for (const check of checks) {
    const result = scheduleExecutionTasks(input(check.tasks));
    const issue = result.issues.find((entry) => entry.code === check.code);
    assert.ok(issue, check.code);
    assert.deepEqual(issue.taskIds, check.ids);
    assert.equal(result.selectedTaskId, null);
    assert.equal(result.blockers[0].code, check.code === 'dependency_cycle' ? 'cycle' : 'invalid_input');
  }
});

test('reports every material blocker without dispatching and separates failed from unfinished dependencies', () => {
  const result = scheduleExecutionTasks(input([
    task('failed-dependency', { status: 'failed' }),
    task('waiting-dependency', { status: 'blocked' }),
    task('stale', { protectedSolutionBaseline: { baselineId: 'solution-v0', contentHash: hashes.solution } }),
    task('unauthorized', { ownerAuthorization: 'not_authorized' }),
    task('failed-dependent', { dependencies: ['failed-dependency'] }),
    task('waiting-dependent', { dependencies: ['waiting-dependency'] }),
    task('mixed-dependent', { dependencies: ['failed-dependency', 'waiting-dependency'] }),
  ]));

  assert.deepEqual(result.dispatchableTaskIds, []);
  assert.equal(result.selectedTaskId, null);
  assert.equal(result.incompleteReason.code, 'stale_baseline');
  assert.deepEqual(result.blockers.map(({ code, taskIds }) => ({ code, taskIds })), [
    { code: 'stale_baseline', taskIds: ['stale'] },
    { code: 'unauthorized', taskIds: ['unauthorized'] },
    { code: 'failed_dependency', taskIds: ['failed-dependent', 'mixed-dependent'] },
    { code: 'dependency_blocked', taskIds: ['mixed-dependent', 'waiting-dependent'] },
  ]);
});

test('selects one safe task while reporting blockers for other eligible tasks', () => {
  const result = scheduleExecutionTasks(input([
    task('alpha'),
    task('failed-dependency', { status: 'discarded' }),
    task('waiting-dependency', { status: 'blocked' }),
    task('stale', { protectedSolutionBaseline: { baselineId: 'solution-v0', contentHash: hashes.solution } }),
    task('unauthorized', { ownerAuthorization: 'not_authorized' }),
    task('failed-dependent', { dependencies: ['failed-dependency'] }),
    task('waiting-dependent', { dependencies: ['waiting-dependency'] }),
  ]));

  assert.deepEqual(result.dispatchableTaskIds, ['alpha']);
  assert.equal(result.selectedTaskId, 'alpha');
  assert.equal(result.incompleteReason, null);
  assert.deepEqual(result.blockers.map(({ code, taskIds }) => ({ code, taskIds })), [
    { code: 'stale_baseline', taskIds: ['stale'] },
    { code: 'unauthorized', taskIds: ['unauthorized'] },
    { code: 'failed_dependency', taskIds: ['failed-dependent'] },
    { code: 'dependency_blocked', taskIds: ['waiting-dependent'] },
  ]);
});

test('rejects unknown task values and malformed baseline references without throwing', () => {
  const invalid = input([task('alpha', {
    type: 'Unknown',
    status: 'whatever',
    protectedIntentBaseline: { baselineId: 'bad id', contentHash: 'not-a-hash' },
  })]);
  assert.doesNotThrow(() => scheduleExecutionTasks(invalid));
  const result = scheduleExecutionTasks(invalid);
  assert.equal(result.valid, false);
  assert.deepEqual(new Set(result.issues.map((entry) => entry.code)), new Set([
    'unknown_task_type',
    'unknown_task_status',
    'malformed_baseline_ref',
  ]));
});

test('stale and unauthorized ready tasks are not dispatchable', () => {
  const stale = scheduleExecutionTasks(input([task('alpha', {
    protectedSolutionBaseline: { baselineId: 'solution-v0', contentHash: hashes.solution },
  })]));
  assert.deepEqual(stale.dispatchableTaskIds, []);
  assert.equal(stale.incompleteReason.code, 'stale_baseline');

  const unauthorized = scheduleExecutionTasks(input([task('alpha', { ownerAuthorization: 'not_authorized' })]));
  assert.deepEqual(unauthorized.dispatchableTaskIds, []);
  assert.equal(unauthorized.incompleteReason.code, 'unauthorized');
});

test('rejects lifecycle claims that require owner authorization and preserves valid pre-authorization states', () => {
  for (const status of ['authorized', 'leased', 'running', 'produced', 'verifying', 'accepted']) {
    const result = scheduleExecutionTasks(input([task('claimant', { status, ownerAuthorization: 'not_authorized' })]));
    assert.equal(result.valid, false, status);
    assert.deepEqual(
      result.issues.filter((issue) => issue.code === 'unauthorized_lifecycle_claim').map((issue) => issue.taskIds),
      [['claimant']],
      status,
    );
  }

  for (const status of ['proposed', 'blocked', 'ready', 'repair_proposed', 'failed', 'discarded']) {
    const result = scheduleExecutionTasks(input([task('pre-authorized', { status, ownerAuthorization: 'not_authorized' })]));
    assert.equal(result.valid, true, status);
    assert.equal(result.selectedTaskId, null, status);
  }
});

test('unauthorized accepted work cannot satisfy direct or transitive dependency closure', () => {
  const direct = scheduleExecutionTasks(input([
    task('unauthorized-accepted', { status: 'accepted', ownerAuthorization: 'not_authorized' }),
    task('candidate', { dependencies: ['unauthorized-accepted'] }),
  ]));
  assert.equal(direct.valid, false);
  assert.equal(direct.selectedTaskId, null);
  assert.deepEqual(
    direct.issues.filter((issue) => issue.code === 'unauthorized_lifecycle_claim').map((issue) => issue.taskIds),
    [['unauthorized-accepted']],
  );

  const transitive = scheduleExecutionTasks(input([
    task('unauthorized-accepted', { status: 'accepted', ownerAuthorization: 'not_authorized' }),
    task('accepted-middle', { status: 'accepted', dependencies: ['unauthorized-accepted'] }),
    task('candidate', { dependencies: ['accepted-middle'] }),
  ]));
  assert.equal(transitive.valid, false);
  assert.equal(transitive.selectedTaskId, null);
  assert.deepEqual(
    transitive.issues.filter((issue) => issue.code === 'unauthorized_lifecycle_claim').map((issue) => issue.taskIds),
    [['unauthorized-accepted']],
  );
});

test('stale accepted dependencies block direct and transitive dependants while fresh accepted dependencies still dispatch', () => {
  const direct = scheduleExecutionTasks(input([
    task('stale-root', {
      status: 'accepted',
      protectedSolutionBaseline: { baselineId: 'solution-v0', contentHash: hashes.solution },
    }),
    task('direct-dependent', { dependencies: ['stale-root'] }),
    task('fresh-root', { status: 'accepted' }),
    task('fresh-dependent', { dependencies: ['fresh-root'] }),
  ]));

  assert.deepEqual(direct.dispatchableTaskIds, ['fresh-dependent']);
  assert.equal(direct.selectedTaskId, 'fresh-dependent');
  assert.deepEqual(direct.blockers.map(({ code, taskIds }) => ({ code, taskIds })), [
    { code: 'stale_baseline', taskIds: ['stale-root'] },
    { code: 'dependency_blocked', taskIds: ['direct-dependent'] },
  ]);

  const transitive = scheduleExecutionTasks(input([
    task('stale-root', {
      status: 'accepted',
      protectedIntentBaseline: { baselineId: 'intent-v0', contentHash: hashes.intent },
    }),
    task('accepted-middle', { status: 'accepted', dependencies: ['stale-root'] }),
    task('transitive-dependent', { dependencies: ['accepted-middle'] }),
  ]));

  assert.deepEqual(transitive.dispatchableTaskIds, []);
  assert.equal(transitive.selectedTaskId, null);
  assert.deepEqual(transitive.blockers.map(({ code, taskIds }) => ({ code, taskIds })), [
    { code: 'stale_baseline', taskIds: ['stale-root'] },
    { code: 'dependency_blocked', taskIds: ['transitive-dependent'] },
  ]);
});

test('requires every direct and transitive dependency ancestor to be accepted before dispatch', () => {
  const cases = [
    { status: 'proposed', blocker: 'dependency_blocked' },
    { status: 'blocked', blocker: 'dependency_blocked' },
    { status: 'repair_proposed', blocker: 'dependency_blocked' },
    { status: 'failed', blocker: 'failed_dependency' },
    { status: 'discarded', blocker: 'failed_dependency' },
  ];

  for (const { status, blocker } of cases) {
    const direct = scheduleExecutionTasks(input([
      task('ancestor', { status }),
      task('candidate', { dependencies: ['ancestor'] }),
    ]));
    assert.equal(direct.selectedTaskId, null, `direct ${status}`);
    assert.deepEqual(
      direct.blockers.filter((entry) => entry.code === blocker).map((entry) => entry.taskIds),
      [['candidate']],
      `direct ${status}`,
    );

    const transitive = scheduleExecutionTasks(input([
      task('ancestor', { status }),
      task('accepted-middle', { status: 'accepted', dependencies: ['ancestor'] }),
      task('candidate', { dependencies: ['accepted-middle'] }),
    ]));
    assert.equal(transitive.selectedTaskId, null, `transitive ${status}`);
    assert.deepEqual(
      transitive.blockers.filter((entry) => entry.code === blocker).map((entry) => entry.taskIds),
      [['candidate']],
      `transitive ${status}`,
    );
  }

  const freshClosure = scheduleExecutionTasks(input([
    task('accepted-root', { status: 'accepted' }),
    task('accepted-middle', { status: 'accepted', dependencies: ['accepted-root'] }),
    task('candidate', { dependencies: ['accepted-middle'] }),
  ]));
  assert.deepEqual(freshClosure.dispatchableTaskIds, ['candidate']);
  assert.equal(freshClosure.selectedTaskId, 'candidate');
});

test('reports no eligible pre-dispatch work when all tasks are terminal', () => {
  const result = scheduleExecutionTasks(input([task('alpha', { status: 'accepted' })]));

  assert.equal(result.selectedTaskId, null);
  assert.deepEqual(result.blockers.map(({ code, taskIds }) => ({ code, taskIds })), [
    { code: 'no_eligible_task', taskIds: [] },
  ]);
});

test('failed, discarded, and unfinished dependencies block ready tasks', () => {
  for (const status of ['failed', 'discarded']) {
    const result = scheduleExecutionTasks(input([
      task('alpha', { status }),
      task('bravo', { dependencies: ['alpha'] }),
    ]));
    assert.equal(result.selectedTaskId, null);
    assert.equal(result.incompleteReason.code, 'failed_dependency');
  }
  const blocked = scheduleExecutionTasks(input([
    task('alpha', { status: 'produced' }),
    task('bravo', { dependencies: ['alpha'] }),
  ]));
  assert.equal(blocked.incompleteReason.code, 'active_task_in_progress');
});

test('active and other blockers remain visible, and scheduling is deterministic and non-mutating', () => {
  const candidate = input([
    task('alpha', { status: 'running' }),
    task('bravo', { protectedSolutionBaseline: { baselineId: 'solution-v0', contentHash: hashes.solution } }),
    task('charlie', { ownerAuthorization: 'not_authorized' }),
    task('failed-upstream', { status: 'failed' }),
    task('failed-dependent', { dependencies: ['failed-upstream'] }),
    task('waiting-upstream', { status: 'proposed' }),
    task('waiting-dependent', { dependencies: ['waiting-upstream'] }),
  ]);
  const before = structuredClone(candidate);
  const first = scheduleExecutionTasks(candidate);
  const second = scheduleExecutionTasks(candidate);

  assert.equal(first.selectedTaskId, null);
  assert.equal(first.incompleteReason.code, 'active_task_in_progress');
  assert.deepEqual(first.blockers.map(({ code, taskIds }) => ({ code, taskIds })), [
    { code: 'active_task_in_progress', taskIds: ['alpha'] },
    { code: 'stale_baseline', taskIds: ['bravo'] },
    { code: 'unauthorized', taskIds: ['charlie'] },
    { code: 'failed_dependency', taskIds: ['failed-dependent'] },
    { code: 'dependency_blocked', taskIds: ['waiting-dependent'] },
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(candidate, before);
});
