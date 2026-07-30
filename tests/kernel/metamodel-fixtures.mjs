import { hashGraphSnapshot } from '../../packages/graph-kernel/dist/index.js';

const timestamp = '2026-07-27T20:00:00.000Z';
const placeholderHash = '0'.repeat(64);

const actorRef = { actorId: 'owner-1', actorKind: 'owner' };

function node(id, type, overrides = {}) {
  return {
    id,
    stableId: `${id}-stable`,
    version: 1,
    type,
    status: 'confirmed',
    statementOrName: id,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceRefs: [{ sourceId: `message-${id}` }],
    actorRef,
    attributes: {},
    ...overrides,
  };
}

function intentNode(id, type, overrides = {}) {
  return node(id, type, {
    sourceQuote: `Quoted source for ${id}`,
    originalInterpretation: `Original interpretation for ${id}`,
    normalizedInterpretation: `Normalized interpretation for ${id}`,
    confidence: 0.9,
    approvedByUser: true,
    baselineMembership: ['intent-v1'],
    ...overrides,
  });
}

function snapshot(graphKind, graphId, snapshotId, contentHash, nodes, edges = [], crossGraphLinks = []) {
  return {
    schemaVersion: '1.0.0',
    graphKind,
    graphId,
    snapshotId,
    revision: 1,
    parentSnapshotId: null,
    parentSnapshotContentHash: null,
    createdAt: timestamp,
    createdBy: actorRef,
    nodes,
    edges,
    crossGraphLinks,
    contentHash,
  };
}

function ref(graph, nodeId, nodeVersion = 1) {
  return {
    graphKind: graph.graphKind,
    graphId: graph.graphId,
    nodeId,
    nodeVersion,
    snapshotId: graph.snapshotId,
    snapshotContentHash: graph.contentHash,
  };
}

function refreshLocalRef(refValue, snapshot) {
  if (refValue.graphKind === snapshot.graphKind
    && refValue.graphId === snapshot.graphId
    && refValue.snapshotId === snapshot.snapshotId) {
    refValue.snapshotContentHash = snapshot.contentHash;
  }
}

export function rehashSnapshot(snapshot) {
  snapshot.contentHash = hashGraphSnapshot(snapshot);
  snapshot.nodes.forEach((entry) => entry.supports?.forEach((support) => refreshLocalRef(support, snapshot)));
  snapshot.edges.forEach((entry) => {
    refreshLocalRef(entry.sourceNodeRef, snapshot);
    refreshLocalRef(entry.targetNodeRef, snapshot);
  });
  snapshot.crossGraphLinks.forEach((entry) => {
    refreshLocalRef(entry.source, snapshot);
    refreshLocalRef(entry.target, snapshot);
  });
  return snapshot;
}

function updateReference(refValue, previous, snapshot) {
  if (refValue.graphKind === previous.graphKind
    && refValue.graphId === previous.graphId
    && refValue.snapshotId === previous.snapshotId
    && refValue.snapshotContentHash === previous.contentHash) {
    refValue.snapshotContentHash = snapshot.contentHash;
  }
}

function updateSnapshotBindings(input, previous, snapshot) {
  input.snapshots.forEach((candidate) => {
    candidate.nodes.forEach((node) => node.supports?.forEach((support) => updateReference(support, previous, snapshot)));
    candidate.edges.forEach((edge) => {
      updateReference(edge.sourceNodeRef, previous, snapshot);
      updateReference(edge.targetNodeRef, previous, snapshot);
    });
    candidate.crossGraphLinks.forEach((link) => {
      updateReference(link.source, previous, snapshot);
      updateReference(link.target, previous, snapshot);
    });
  });
  input.approvedBaselines.forEach((baseline) => {
    if (baseline.graphKind === previous.graphKind
      && baseline.graphId === previous.graphId
      && baseline.snapshotId === previous.snapshotId
      && baseline.snapshotContentHash === previous.contentHash) {
      baseline.snapshotContentHash = snapshot.contentHash;
    }
  });
}

export function rehashGraphValidation(input) {
  for (const graphKind of ['intent', 'solution', 'execution']) {
    const snapshot = input.snapshots.find((candidate) => candidate.graphKind === graphKind);
    if (!snapshot) continue;
    const previous = { ...snapshot };
    rehashSnapshot(snapshot);
    updateSnapshotBindings(input, previous, snapshot);
  }
  return input;
}

function edge(id, type, sourceNodeRef, targetNodeRef) {
  return {
    id,
    version: 1,
    type,
    sourceNodeRef,
    targetNodeRef,
    status: 'confirmed',
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceRefs: [],
    attributes: {},
  };
}

function link(id, type, source, target, sourceBaselineId, targetBaselineId) {
  return {
    id,
    type,
    source,
    target,
    sourceBaselineId,
    targetBaselineId,
    createdAt: timestamp,
    transformationId: 'transform-1',
  };
}

function executionTask(id, type, dependencies, producerId, intentHash, solutionHash) {
  return {
    task: {
      id,
      type,
      status: 'accepted',
      dependencies,
      protectedIntentBaseline: { baselineId: 'intent-v1', contentHash: intentHash },
      protectedSolutionBaseline: { baselineId: 'solution-v1', contentHash: solutionHash },
      ownerAuthorization: 'authorized',
    },
    producerId,
  };
}

export function validGraphValidationInput() {
  const intent = snapshot('intent', 'intent-graph-1', 'intent-snapshot-1', placeholderHash, [
    intentNode('int-project-1', 'Project'),
    intentNode('int-goal-1', 'Goal'),
    intentNode('int-success-1', 'SuccessCriterion'),
  ]);
  intent.edges.push(edge('intent-edge-1', 'PROJECT_HAS_GOAL', ref(intent, 'int-project-1'), ref(intent, 'int-goal-1')));
  rehashSnapshot(intent);

  const solution = snapshot('solution', 'solution-graph-1', 'solution-snapshot-1', placeholderHash, [
    node('sol-app-1', 'Application', { scope: 'product' }),
    node('sol-role-1', 'Role', { scope: 'product' }),
    node('sol-service-1', 'Service', {
      scope: 'implementation_support',
      supports: [],
    }),
    node('sol-check-1', 'TestableBehavior', { scope: 'product' }),
  ]);
  solution.nodes[2].supports.push(ref(solution, 'sol-app-1'));
  solution.edges.push(edge('solution-edge-1', 'CONTAINS', ref(solution, 'sol-app-1'), ref(solution, 'sol-role-1')));
  solution.crossGraphLinks.push(
    link('solution-link-1', 'SATISFIES_INTENT', ref(solution, 'sol-app-1'), ref(intent, 'int-project-1'), 'solution-v1', 'intent-v1'),
    link('solution-link-2', 'SATISFIES_INTENT', ref(solution, 'sol-role-1'), ref(intent, 'int-goal-1'), 'solution-v1', 'intent-v1'),
    link('solution-link-4', 'SATISFIES_INTENT', ref(solution, 'sol-check-1'), ref(intent, 'int-success-1'), 'solution-v1', 'intent-v1'),
  );
  rehashSnapshot(solution);

  const execution = snapshot('execution', 'execution-graph-1', 'execution-snapshot-1', placeholderHash, [
    node('exec-app-1', 'Implement', {
      attributes: executionTask('exec-app-1', 'Implement', [], 'implementer-app-1', intent.contentHash, solution.contentHash),
    }),
    node('exec-role-1', 'Implement', {
      attributes: executionTask('exec-role-1', 'Implement', [], 'implementer-role-1', intent.contentHash, solution.contentHash),
    }),
    node('exec-service-1', 'Implement', {
      attributes: executionTask('exec-service-1', 'Implement', ['exec-app-1'], 'implementer-service-1', intent.contentHash, solution.contentHash),
    }),
    node('exec-check-1', 'Verify', {
      attributes: executionTask('exec-check-1', 'Verify', [], 'implementer-check-1', intent.contentHash, solution.contentHash),
    }),
  ]);
  execution.edges.push(edge('execution-edge-1', 'DEPENDS_ON', ref(execution, 'exec-service-1'), ref(execution, 'exec-app-1')));
  execution.crossGraphLinks.push(
    link('execution-link-1', 'SATISFIES_SOLUTION', ref(execution, 'exec-app-1'), ref(solution, 'sol-app-1'), 'execution-v1', 'solution-v1'),
    link('execution-link-2', 'SATISFIES_SOLUTION', ref(execution, 'exec-role-1'), ref(solution, 'sol-role-1'), 'execution-v1', 'solution-v1'),
    link('execution-link-3', 'SATISFIES_SOLUTION', ref(execution, 'exec-service-1'), ref(solution, 'sol-service-1'), 'execution-v1', 'solution-v1'),
    link('execution-link-4', 'SATISFIES_SOLUTION', ref(execution, 'exec-check-1'), ref(solution, 'sol-check-1'), 'execution-v1', 'solution-v1'),
  );
  rehashSnapshot(execution);

  return {
    snapshots: [intent, solution, execution],
    approvedBaselines: [
      {
        graphKind: 'intent',
        graphId: intent.graphId,
        baselineId: 'intent-v1',
        snapshotId: intent.snapshotId,
        snapshotContentHash: intent.contentHash,
      },
      {
        graphKind: 'solution',
        graphId: solution.graphId,
        baselineId: 'solution-v1',
        snapshotId: solution.snapshotId,
        snapshotContentHash: solution.contentHash,
      },
      {
        graphKind: 'execution',
        graphId: execution.graphId,
        baselineId: 'execution-v1',
        snapshotId: execution.snapshotId,
        snapshotContentHash: execution.contentHash,
      },
    ],
  };
}
