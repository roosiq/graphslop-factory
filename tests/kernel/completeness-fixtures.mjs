import { validGraphValidationInput } from './metamodel-fixtures.mjs';

export const hashes = { intent: 'a'.repeat(64), solution: 'b'.repeat(64) };

export function task(id, overrides = {}) {
  return {
    id,
    type: 'Implement',
    status: 'accepted',
    dependencies: [],
    protectedIntentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
    protectedSolutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
    ownerAuthorization: 'authorized',
    ...overrides,
  };
}

export function completeInput() {
  return {
    tasks: [task('task-alpha')],
    currentIntentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
    currentSolutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
    compiledIntentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
    compiledSolutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
    requiredIntentNodeIds: ['intent-alpha'],
    requiredSolutionNodeIds: ['solution-alpha'],
    requiredTaskIds: ['task-alpha'],
    requiredSuccessCriterionIds: ['SC-alpha'],
    requiredSystemCheckIds: ['system-alpha'],
    taskProducers: [{ taskId: 'task-alpha', producerId: 'implementer-alpha' }],
    solutionScopes: [{ solutionId: 'solution-alpha', scope: 'product' }],
    solutionSupports: [],
    solutionToIntentTraces: [{ solutionId: 'solution-alpha', intentId: 'intent-alpha' }],
    taskToSolutionTraces: [{ taskId: 'task-alpha', solutionId: 'solution-alpha' }],
    evidence: [
      {
        id: 'evidence-task-alpha',
        taskId: 'task-alpha',
        intentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
        solutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
        outcome: 'pass',
        provenance: 'independent_verifier',
        provenanceId: 'check-worker-alpha',
        provenanceRole: 'Check',
        producerId: 'implementer-alpha',
      },
      {
        id: 'evidence-sc-alpha',
        successCriterionId: 'SC-alpha',
        intentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
        solutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
        outcome: 'pass',
        provenance: 'system',
        provenanceId: 'system-alpha',
        provenanceRole: 'System',
      },
    ],
    drift: [],
    systemChecks: [{
      id: 'system-alpha',
      intentBaseline: { baselineId: 'intent-v1', contentHash: hashes.intent },
      solutionBaseline: { baselineId: 'solution-v1', contentHash: hashes.solution },
      outcome: 'pass',
    }],
    decisions: [{ id: 'decision-alpha', kind: 'decision', status: 'resolved', blocking: true }],
    pendingBaselineChange: false,
  };
}

/** A graph-backed closure for the authoritative factory boundary. */
export function completeComposedInput() {
  const graphValidation = validGraphValidationInput();
  const intent = graphValidation.snapshots.find((snapshot) => snapshot.graphKind === 'intent');
  const solution = graphValidation.snapshots.find((snapshot) => snapshot.graphKind === 'solution');
  const execution = graphValidation.snapshots.find((snapshot) => snapshot.graphKind === 'execution');
  const intentBaseline = graphValidation.approvedBaselines.find((baseline) => baseline.graphKind === 'intent');
  const solutionBaseline = graphValidation.approvedBaselines.find((baseline) => baseline.graphKind === 'solution');
  const baselinePair = {
    intent: { baselineId: intentBaseline.baselineId, contentHash: intentBaseline.snapshotContentHash },
    solution: { baselineId: solutionBaseline.baselineId, contentHash: solutionBaseline.snapshotContentHash },
  };
  const tasks = execution.nodes.map((node) => structuredClone(node.attributes.task));
  const taskProducers = execution.nodes.map((node) => ({ taskId: node.id, producerId: node.attributes.producerId }));
  const closure = {
    tasks,
    currentIntentBaseline: baselinePair.intent,
    currentSolutionBaseline: baselinePair.solution,
    compiledIntentBaseline: baselinePair.intent,
    compiledSolutionBaseline: baselinePair.solution,
    requiredIntentNodeIds: intent.nodes.filter((node) => node.status === 'confirmed').map((node) => node.id),
    requiredSolutionNodeIds: solution.nodes.map((node) => node.id),
    requiredTaskIds: execution.nodes.map((node) => node.id),
    requiredSuccessCriterionIds: intent.nodes.filter((node) =>
      node.status === 'confirmed' && node.type === 'SuccessCriterion',
    ).map((node) => node.id),
    requiredSystemCheckIds: solution.nodes.filter((node) => node.type === 'TestableBehavior').map((node) => node.id),
    taskProducers,
    solutionScopes: solution.nodes.map((node) => ({ solutionId: node.id, scope: node.scope })),
    solutionSupports: solution.nodes.flatMap((node) =>
      (node.supports ?? []).map((support) => ({ supportId: node.id, supportedSolutionId: support.nodeId })),
    ),
    solutionToIntentTraces: solution.crossGraphLinks
      .filter((link) => link.type === 'SATISFIES_INTENT')
      .map((link) => ({ solutionId: link.source.nodeId, intentId: link.target.nodeId })),
    taskToSolutionTraces: execution.crossGraphLinks
      .filter((link) => link.type === 'SATISFIES_SOLUTION')
      .map((link) => ({ taskId: link.source.nodeId, solutionId: link.target.nodeId })),
    evidence: [
      ...tasks.map((entry, index) => ({
        id: `evidence-${entry.id}`,
        taskId: entry.id,
        intentBaseline: baselinePair.intent,
        solutionBaseline: baselinePair.solution,
        outcome: 'pass',
        provenance: 'independent_verifier',
        provenanceId: `check-${entry.id}`,
        provenanceRole: 'Check',
        producerId: taskProducers[index].producerId,
      })),
      ...intent.nodes
        .filter((node) => node.status === 'confirmed' && node.type === 'SuccessCriterion')
        .map((node) => ({
          id: `evidence-${node.id}`,
          successCriterionId: node.id,
          intentBaseline: baselinePair.intent,
          solutionBaseline: baselinePair.solution,
          outcome: 'pass',
          provenance: 'system',
          provenanceId: `system-${node.id}`,
          provenanceRole: 'System',
        })),
    ],
    drift: [],
    systemChecks: solution.nodes
      .filter((node) => node.type === 'TestableBehavior')
      .map((node) => ({
        id: node.id,
        intentBaseline: baselinePair.intent,
        solutionBaseline: baselinePair.solution,
        outcome: 'pass',
      })),
    decisions: [],
    pendingBaselineChange: false,
  };
  return { graphValidation, closure };
}
