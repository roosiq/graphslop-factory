import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceFactory, advanceProjection } from '../../packages/graph-kernel/dist/index.js';

import { completeComposedInput, completeInput } from './completeness-fixtures.mjs';

function assertBlocked(input, label) {
  const result = advanceFactory(input);
  assert.equal(result.action, 'block_invalid_state', label);
  assert.equal(result.completeness.complete, false, label);
  assert.equal(result.completeness.valid, false, label);
}

test('the composed authoritative path validates graphs, binds closure facts, and can complete', () => {
  const input = completeComposedInput();
  const before = structuredClone(input);

  const result = advanceFactory(input);

  assert.equal(result.action, 'complete');
  assert.equal(result.completeness.complete, true);
  assert.deepEqual(input, before);
  assert.equal(advanceProjection(input.closure).action, 'complete');
});

test('a projection alone is non-authoritative and can never declare the factory complete', () => {
  const result = advanceFactory(completeInput());

  assert.equal(result.action, 'block_invalid_state');
  assert.equal(result.completeness.complete, false);
});

test('missing, corrupt, stale, or mismatched graph facts block before completion', () => {
  const missingKind = completeComposedInput();
  missingKind.graphValidation.snapshots = missingKind.graphValidation.snapshots
    .filter((snapshot) => snapshot.graphKind !== 'execution');
  missingKind.graphValidation.approvedBaselines = missingKind.graphValidation.approvedBaselines
    .filter((baseline) => baseline.graphKind !== 'execution');
  assertBlocked(missingKind, 'missing execution graph');

  const corruptGraph = completeComposedInput();
  corruptGraph.graphValidation.snapshots[1].nodes[0].type = 'Persona';
  assertBlocked(corruptGraph, 'corrupt solution graph');

  const staleContentHash = completeComposedInput();
  staleContentHash.graphValidation.snapshots[0].nodes[1].statementOrName = 'Changed without a new snapshot hash';
  const staleResult = advanceFactory(staleContentHash);
  assertBlocked(staleContentHash, 'stale snapshot content hash');
  assert.equal(staleResult.completeness.gaps.invalidInputIssues[0].code, 'graph_snapshot_content_hash_mismatch');

  const duplicateSource = completeComposedInput();
  const duplicateIntent = structuredClone(duplicateSource.graphValidation.snapshots[0]);
  duplicateIntent.nodes[0].statementOrName = 'Changed duplicate source snapshot';
  duplicateSource.graphValidation.currentSourceSnapshots = [duplicateIntent];
  const duplicateSourceResult = advanceFactory(duplicateSource);
  assertBlocked(duplicateSource, 'stale duplicate current source snapshot');
  assert.equal(duplicateSourceResult.completeness.gaps.invalidInputIssues[0].code, 'graph_snapshot_content_hash_mismatch');

  const staleGraph = completeComposedInput();
  staleGraph.graphValidation.snapshots[2].crossGraphLinks[0].target.snapshotContentHash = 'd'.repeat(64);
  assertBlocked(staleGraph, 'stale solution snapshot reference');

  const baselineMismatch = completeComposedInput();
  baselineMismatch.closure.currentIntentBaseline = {
    baselineId: 'intent-v0',
    contentHash: baselineMismatch.closure.currentIntentBaseline.contentHash,
  };
  assertBlocked(baselineMismatch, 'closure baseline mismatch');
});

test('omitted or invented graph projection facts cannot close the factory', () => {
  const omittedWork = completeComposedInput();
  omittedWork.closure.requiredSolutionNodeIds = omittedWork.closure.requiredSolutionNodeIds
    .filter((id) => id !== 'sol-role-1');
  assertBlocked(omittedWork, 'omitted solution work');

  const inventedTrace = completeComposedInput();
  inventedTrace.closure.solutionToIntentTraces.push({
    solutionId: 'sol-app-1',
    intentId: 'int-goal-1',
  });
  assertBlocked(inventedTrace, 'invented solution trace');

  const inventedTask = completeComposedInput();
  inventedTask.closure.tasks.push({
    ...structuredClone(inventedTask.closure.tasks[0]),
    id: 'exec-invented-1',
  });
  assertBlocked(inventedTask, 'invented task');
});

test('execution task lifecycle, authority, baseline, and dependency facts bind to graph nodes and edges', () => {
  const changedStatus = completeComposedInput();
  changedStatus.closure.tasks[0].status = 'ready';
  assertBlocked(changedStatus, 'task status');

  const changedAuthority = completeComposedInput();
  changedAuthority.closure.tasks[0].ownerAuthorization = 'not_authorized';
  assertBlocked(changedAuthority, 'task authorization');

  const changedBaseline = completeComposedInput();
  changedBaseline.closure.tasks[0].protectedSolutionBaseline = {
    baselineId: 'solution-v0',
    contentHash: changedBaseline.closure.tasks[0].protectedSolutionBaseline.contentHash,
  };
  assertBlocked(changedBaseline, 'task protected baseline');

  const changedDependency = completeComposedInput();
  changedDependency.closure.tasks.find((task) => task.id === 'exec-service-1').dependencies = [];
  assertBlocked(changedDependency, 'task dependency edge');
});
