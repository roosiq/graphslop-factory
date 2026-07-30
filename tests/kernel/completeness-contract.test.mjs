import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceProjection, createMissingWorkReport, evaluateCompleteness } from '../../packages/graph-kernel/dist/index.js';

import { completeInput, hashes } from './completeness-fixtures.mjs';

test('returns a complete report only for full explicit trace and evidence closure', () => {
  const report = evaluateCompleteness(completeInput());

  assert.equal(report.valid, true);
  assert.equal(report.complete, true);
  assert.ok(Object.values(report.gaps).every((collection) => collection.length === 0));
  assert.equal(createMissingWorkReport(report), null);
});

test('reports each requested closure gap with stable IDs', () => {
  const cases = [
    {
      name: 'uncovered required Intent',
      mutate: (input) => { input.solutionToIntentTraces = []; },
      key: 'uncoveredRequiredIntentIds',
      expected: ['intent-alpha'],
    },
    {
      name: 'required Solution without Execution trace',
      mutate: (input) => { input.taskToSolutionTraces = []; },
      key: 'requiredSolutionIdsWithoutExecutionTrace',
      expected: ['solution-alpha'],
    },
    {
      name: 'unaccepted required task',
      mutate: (input) => { input.tasks[0].status = 'ready'; },
      key: 'unacceptedRequiredTaskIds',
      expected: ['task-alpha'],
    },
    {
      name: 'accepted task lacking independent passing evidence',
      mutate: (input) => { input.evidence = input.evidence.filter((entry) => entry.taskId === undefined); },
      key: 'acceptedTaskIdsWithoutIndependentPassingEvidence',
      expected: ['task-alpha'],
    },
    {
      name: 'success criterion lacking passing evidence',
      mutate: (input) => { input.evidence = input.evidence.filter((entry) => entry.successCriterionId === undefined); },
      key: 'successCriterionIdsWithoutPassingEvidence',
      expected: ['SC-alpha'],
    },
    {
      name: 'open blocking drift',
      mutate: (input) => {
        input.drift = [{
          id: 'drift-alpha', status: 'open', severity: 'blocking', taskId: 'task-alpha', repairTaskId: null, repairAuthorization: 'not_applicable',
        }];
      },
      key: 'openBlockingDriftIds',
      expected: ['drift-alpha'],
    },
    {
      name: 'stale protected baseline',
      mutate: (input) => {
        input.tasks[0].protectedSolutionBaseline = { baselineId: 'solution-v0', contentHash: hashes.solution };
      },
      key: 'staleTaskIds',
      expected: ['task-alpha'],
    },
    {
      name: 'failed system check',
      mutate: (input) => { input.systemChecks[0].outcome = 'fail'; },
      key: 'failedOrMissingRequiredSystemCheckIds',
      expected: ['system-alpha'],
    },
    {
      name: 'unresolved blocking question',
      mutate: (input) => { input.decisions[0] = { id: 'question-alpha', kind: 'question', status: 'unresolved', blocking: true }; },
      key: 'unresolvedBlockingDecisionOrQuestionIds',
      expected: ['question-alpha'],
    },
  ];

  for (const check of cases) {
    const input = completeInput();
    check.mutate(input);
    const report = evaluateCompleteness(input);
    assert.equal(report.complete, false, check.name);
    assert.deepEqual(report.gaps[check.key], check.expected, check.name);
  }
});

test('uses exact required trace closure and never infers unnamed nodes', () => {
  const input = completeInput();
  input.requiredIntentNodeIds = ['intent-zulu', 'intent-alpha'];
  input.solutionToIntentTraces = [{ solutionId: 'solution-alpha', intentId: 'intent-alpha' }];

  const report = evaluateCompleteness(input);

  assert.deepEqual(report.gaps.uncoveredRequiredIntentIds, ['intent-zulu']);
  assert.deepEqual(report.gaps.requiredSolutionIdsWithoutIntentTrace, []);
  assert.deepEqual(report.gaps.requiredSolutionIdsWithoutExecutionTrace, []);
});

test('requires every required node to participate in its own continuous Intent-to-Solution-to-Task chain', () => {
  const solutionWithoutIntent = completeInput();
  solutionWithoutIntent.solutionToIntentTraces = [];
  const solutionWithoutIntentReport = evaluateCompleteness(solutionWithoutIntent);
  assert.deepEqual(solutionWithoutIntentReport.gaps.uncoveredRequiredIntentIds, ['intent-alpha']);
  assert.deepEqual(solutionWithoutIntentReport.gaps.requiredSolutionIdsWithoutIntentTrace, ['solution-alpha']);

  const taskWithoutSolution = completeInput();
  taskWithoutSolution.taskToSolutionTraces = [];
  const taskWithoutSolutionReport = evaluateCompleteness(taskWithoutSolution);
  assert.deepEqual(taskWithoutSolutionReport.gaps.requiredSolutionIdsWithoutExecutionTrace, ['solution-alpha']);
  assert.deepEqual(taskWithoutSolutionReport.gaps.uncoveredRequiredTaskIds, ['task-alpha']);
});

test('routes missing Solution-to-Intent traces to Solution compilation and task traces to Execution compilation', () => {
  const missingIntentTrace = completeInput();
  missingIntentTrace.tasks.push({ ...missingIntentTrace.tasks[0], id: 'task-beta' });
  missingIntentTrace.requiredSolutionNodeIds.push('solution-beta');
  missingIntentTrace.requiredTaskIds.push('task-beta');
  missingIntentTrace.taskProducers.push({ taskId: 'task-beta', producerId: 'implementer-beta' });
  missingIntentTrace.solutionScopes.push({ solutionId: 'solution-beta', scope: 'product' });
  missingIntentTrace.taskToSolutionTraces.push({ taskId: 'task-beta', solutionId: 'solution-beta' });
  missingIntentTrace.solutionToIntentTraces = [{ solutionId: 'solution-beta', intentId: 'intent-alpha' }];
  missingIntentTrace.evidence.push({
    ...structuredClone(missingIntentTrace.evidence[0]),
    id: 'evidence-task-beta',
    taskId: 'task-beta',
    provenanceId: 'check-worker-beta',
    producerId: 'implementer-beta',
  });

  const missingIntentReport = evaluateCompleteness(missingIntentTrace);
  assert.deepEqual(missingIntentReport.gaps.uncoveredRequiredIntentIds, []);
  assert.deepEqual(missingIntentReport.gaps.requiredSolutionIdsWithoutIntentTrace, ['solution-alpha']);
  assert.deepEqual(missingIntentReport.gaps.requiredSolutionIdsWithoutExecutionTrace, []);
  assert.deepEqual(createMissingWorkReport(missingIntentReport)?.suggestedRoutes.map((route) => route.action), ['recompile_solution']);
  assert.equal(advanceProjection(missingIntentTrace).action, 'recompile_solution');

  const missingTaskTrace = completeInput();
  missingTaskTrace.taskToSolutionTraces = [];
  const missingTaskReport = evaluateCompleteness(missingTaskTrace);
  assert.deepEqual(missingTaskReport.gaps.requiredSolutionIdsWithoutIntentTrace, []);
  assert.deepEqual(missingTaskReport.gaps.requiredSolutionIdsWithoutExecutionTrace, ['solution-alpha']);
  assert.equal(advanceProjection(missingTaskTrace).action, 'recompile_execution');
  assert.deepEqual(createMissingWorkReport(missingTaskReport)?.suggestedRoutes.map((route) => route.action), ['recompile_execution']);
});

test('fails closed when a required task depends on work omitted from required closure', () => {
  const input = completeInput();
  input.tasks.push({
    ...input.tasks[0],
    id: 'task-dependency',
    status: 'accepted',
  });
  input.tasks[0].dependencies = ['task-dependency'];
  const report = evaluateCompleteness(input);

  assert.equal(report.valid, false);
  assert.equal(report.complete, false);
  assert.deepEqual(
    report.gaps.invalidInputIssues.filter((entry) => entry.code === 'required_task_dependency_not_required')[0]?.refs,
    ['task-alpha', 'task-dependency'],
  );
});

test('does not let an accepted required task hide a failed required dependency', () => {
  const input = completeInput();
  input.tasks.push({
    ...input.tasks[0],
    id: 'task-dependency',
    status: 'failed',
  });
  input.tasks[0].dependencies = ['task-dependency'];
  input.requiredTaskIds.push('task-dependency');
  input.taskProducers.push({ taskId: 'task-dependency', producerId: 'implementer-dependency' });
  input.taskToSolutionTraces.push({ taskId: 'task-dependency', solutionId: 'solution-alpha' });

  const report = evaluateCompleteness(input);

  assert.equal(report.valid, true);
  assert.deepEqual(report.gaps.unacceptedRequiredTaskIds, ['task-dependency']);
  assert.equal(report.complete, false);
});

test('requires exact compiled/current baseline bindings for tasks, evidence, and system checks', () => {
  const rebase = completeInput();
  rebase.compiledSolutionBaseline = { baselineId: 'solution-v2', contentHash: 'c'.repeat(64) };
  const rebaseReport = evaluateCompleteness(rebase);
  assert.equal(rebaseReport.valid, true);
  assert.deepEqual(rebaseReport.gaps.compiledBaselineMismatchRefs, ['solution:solution-v2']);
  assert.deepEqual(rebaseReport.gaps.staleTaskIds, ['task-alpha']);
  assert.deepEqual(rebaseReport.gaps.staleEvidenceIds, ['evidence-sc-alpha', 'evidence-task-alpha']);
  assert.deepEqual(rebaseReport.gaps.staleSystemCheckIds, ['system-alpha']);

  const staleEvidence = completeInput();
  staleEvidence.evidence[0].solutionBaseline = { baselineId: 'solution-v0', contentHash: hashes.solution };
  const staleEvidenceReport = evaluateCompleteness(staleEvidence);
  assert.deepEqual(staleEvidenceReport.gaps.staleEvidenceIds, ['evidence-task-alpha']);
  assert.deepEqual(staleEvidenceReport.gaps.acceptedTaskIdsWithoutIndependentPassingEvidence, ['task-alpha']);

  const staleCheck = completeInput();
  staleCheck.systemChecks[0].intentBaseline = { baselineId: 'intent-v0', contentHash: hashes.intent };
  const staleCheckReport = evaluateCompleteness(staleCheck);
  assert.deepEqual(staleCheckReport.gaps.staleSystemCheckIds, ['system-alpha']);
  assert.deepEqual(staleCheckReport.gaps.failedOrMissingRequiredSystemCheckIds, ['system-alpha']);

  const missingBaseline = completeInput();
  delete missingBaseline.evidence[0].intentBaseline;
  const missingBaselineReport = evaluateCompleteness(missingBaseline);
  assert.equal(missingBaselineReport.valid, false);
  assert.ok(missingBaselineReport.gaps.invalidInputIssues.some((entry) => entry.code === 'malformed_evidence_record'));
});

test('rejects unauthorized accepted work before it can close completion', () => {
  const input = completeInput();
  input.tasks[0].ownerAuthorization = 'not_authorized';

  const report = evaluateCompleteness(input);
  const advance = advanceProjection(input);

  assert.equal(report.valid, false);
  assert.equal(report.complete, false);
  assert.ok(report.gaps.invalidInputIssues.some((entry) => entry.code === 'scheduler_unauthorized_lifecycle_claim'));
  assert.equal(advance.action, 'block_invalid_state');
});

test('requires one authoritative producer and a distinct Check verifier for accepted task evidence', () => {
  const wrongProducer = completeInput();
  wrongProducer.evidence[0].producerId = 'other-worker';
  assert.deepEqual(
    evaluateCompleteness(wrongProducer).gaps.acceptedTaskIdsWithoutIndependentPassingEvidence,
    ['task-alpha'],
  );

  const selfVerified = completeInput();
  selfVerified.evidence[0].provenanceId = 'implementer-alpha';
  assert.deepEqual(
    evaluateCompleteness(selfVerified).gaps.acceptedTaskIdsWithoutIndependentPassingEvidence,
    ['task-alpha'],
  );

  const duplicateBinding = completeInput();
  duplicateBinding.taskProducers.push({ taskId: 'task-alpha', producerId: 'other-worker' });
  assert.equal(evaluateCompleteness(duplicateBinding).valid, false);

  const unknownBinding = completeInput();
  unknownBinding.taskProducers.push({ taskId: 'task-unknown', producerId: 'worker-unknown' });
  assert.equal(evaluateCompleteness(unknownBinding).valid, false);
});

test('closes the V2-004 implementation-support set through approved product targets without invented direct Intent traces', () => {
  const input = completeInput();
  const supportIds = ['SOL-SVC-001', 'SOL-SVC-003', 'SOL-SVC-008', 'SOL-DATA-007', 'SOL-DATA-008'];
  const productIds = ['SOL-FEAT-008', 'SOL-FEAT-009', 'SOL-FEAT-010'];
  const allIds = [...supportIds, ...productIds];
  input.requiredSolutionNodeIds = allIds;
  input.solutionScopes = [
    ...supportIds.map((solutionId) => ({ solutionId, scope: 'implementation_support' })),
    ...productIds.map((solutionId) => ({ solutionId, scope: 'product' })),
  ];
  input.solutionToIntentTraces = productIds.map((solutionId) => ({ solutionId, intentId: 'intent-alpha' }));
  input.solutionSupports = [
    { supportId: 'SOL-SVC-001', supportedSolutionId: 'SOL-FEAT-010' },
    { supportId: 'SOL-SVC-003', supportedSolutionId: 'SOL-FEAT-009' },
    { supportId: 'SOL-SVC-008', supportedSolutionId: 'SOL-FEAT-008' },
    { supportId: 'SOL-DATA-007', supportedSolutionId: 'SOL-FEAT-008' },
    { supportId: 'SOL-DATA-008', supportedSolutionId: 'SOL-FEAT-009' },
  ];
  input.requiredTaskIds = [];
  input.taskProducers = [];
  input.tasks = [];
  input.taskToSolutionTraces = [];
  input.evidence = input.evidence.filter((entry) => entry.taskId === undefined);
  for (const [index, solutionId] of allIds.entries()) {
    const taskId = `task-support-${index}`;
    input.requiredTaskIds.push(taskId);
    input.taskProducers.push({ taskId, producerId: `producer-${index}` });
    input.tasks.push({
      ...completeInput().tasks[0], id: taskId, dependencies: [], status: 'accepted',
    });
    input.taskToSolutionTraces.push({ taskId, solutionId });
    input.evidence.push({
      ...completeInput().evidence[0], id: `evidence-support-${index}`, taskId,
      producerId: `producer-${index}`, provenanceId: `verifier-${index}`,
    });
  }
  const closed = evaluateCompleteness(input);
  assert.equal(closed.complete, true);
  assert.deepEqual(closed.gaps.requiredSolutionIdsWithoutIntentTrace, []);

  const deadEnd = structuredClone(input);
  deadEnd.solutionSupports = deadEnd.solutionSupports.filter((edge) => edge.supportId !== 'SOL-DATA-008');
  assert.deepEqual(evaluateCompleteness(deadEnd).gaps.requiredSolutionIdsWithoutIntentTrace, ['SOL-DATA-008']);

  const badSource = structuredClone(input);
  badSource.solutionSupports.push({ supportId: 'SOL-FEAT-008', supportedSolutionId: 'SOL-FEAT-009' });
  assert.equal(evaluateCompleteness(badSource).valid, false);

  const duplicate = structuredClone(input);
  duplicate.solutionSupports.push(structuredClone(duplicate.solutionSupports[0]));
  assert.equal(evaluateCompleteness(duplicate).valid, false);

  const cycle = structuredClone(input);
  cycle.solutionSupports = cycle.solutionSupports.map((edge) => edge.supportId === 'SOL-SVC-001'
    ? { supportId: 'SOL-SVC-001', supportedSolutionId: 'SOL-DATA-007' }
    : edge).filter((edge) => edge.supportId !== 'SOL-DATA-007');
  cycle.solutionSupports.push({ supportId: 'SOL-DATA-007', supportedSolutionId: 'SOL-SVC-001' });
  assert.deepEqual(evaluateCompleteness(cycle).gaps.requiredSolutionIdsWithoutIntentTrace.sort(), ['SOL-DATA-007', 'SOL-SVC-001']);
});

test('invalid, dangling, and duplicate closure state fails closed', () => {
  const inputs = [
    (() => {
      const input = completeInput();
      input.requiredIntentNodeIds.push('intent-alpha');
      return input;
    })(),
    (() => {
      const input = completeInput();
      input.taskToSolutionTraces[0].taskId = 'task-missing';
      return input;
    })(),
    (() => {
      const input = completeInput();
      input.evidence.push(structuredClone(input.evidence[0]));
      return input;
    })(),
  ];

  for (const input of inputs) {
    const report = evaluateCompleteness(input);
    assert.equal(report.valid, false);
    assert.equal(report.complete, false);
    assert.ok(report.gaps.invalidInputIssues.length > 0);
  }
});

test('reports pending baseline change and missing system checks as closure gaps', () => {
  const input = completeInput();
  input.pendingBaselineChange = true;
  input.systemChecks = [];

  const report = evaluateCompleteness(input);

  assert.deepEqual(report.gaps.pendingBaselineChangeRefs, ['pending_baseline_change']);
  assert.deepEqual(report.gaps.failedOrMissingRequiredSystemCheckIds, ['system-alpha']);
  assert.equal(report.complete, false);
});

test('is deterministic, non-mutating, and gives MissingWork every current gap', () => {
  const input = completeInput();
  input.requiredIntentNodeIds = ['intent-zulu', 'intent-alpha'];
  input.pendingBaselineChange = true;
  input.systemChecks = [];
  const before = structuredClone(input);

  const first = evaluateCompleteness(input);
  const second = evaluateCompleteness(input);
  const missing = createMissingWorkReport(first);

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(missing.incomplete, true);
  assert.deepEqual(missing.gaps, first.gaps);
  assert.deepEqual(missing.suggestedRoutes.map((entry) => entry.action), ['impact_analysis', 'recompile_solution', 'run_system_check']);
});
