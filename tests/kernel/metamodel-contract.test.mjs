import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GraphSnapshotSchema,
  graphMetamodelRegistry,
  isCompatibleEdgeEndpoint,
  isKnownNodeType,
} from '../../packages/contracts/dist/index.js';
import { canonicalizeGraphSnapshot, hashGraphSnapshot, validateGraphSnapshots } from '../../packages/graph-kernel/dist/index.js';

import { rehashGraphValidation, rehashSnapshot, validGraphValidationInput } from './metamodel-fixtures.mjs';

function codes(report) {
  return report.issues.map((entry) => entry.code);
}

function changed(mutator) {
  const input = structuredClone(validGraphValidationInput());
  mutator(input);
  rehashGraphValidation(input);
  return validateGraphSnapshots(input);
}

function sourceAsTraceTarget(mutator) {
  const input = validGraphValidationInput();
  const source = structuredClone(input.snapshots[0]);
  input.snapshots.shift();
  input.currentSourceSnapshots = [source];
  mutator(source);
  rehashSnapshot(source);
  return validateGraphSnapshots(input);
}

function sourceAsParent(mutator) {
  const input = validGraphValidationInput();
  const parent = structuredClone(input.snapshots[0]);
  const current = input.snapshots[0];
  current.snapshotId = 'intent-snapshot-2';
  current.revision = 2;
  current.parentSnapshotId = parent.snapshotId;
  current.parentSnapshotContentHash = parent.contentHash;
  current.edges.forEach((entry) => {
    entry.sourceNodeRef.snapshotId = current.snapshotId;
    entry.targetNodeRef.snapshotId = current.snapshotId;
  });
  rehashSnapshot(current);
  input.snapshots[1].crossGraphLinks.forEach((entry) => {
    entry.target.snapshotId = current.snapshotId;
    entry.target.snapshotContentHash = current.contentHash;
  });
  input.approvedBaselines[0].snapshotId = current.snapshotId;
  input.approvedBaselines[0].snapshotContentHash = current.contentHash;
  input.currentSourceSnapshots = [parent];
  mutator(parent);
  rehashSnapshot(parent);
  current.parentSnapshotContentHash = parent.contentHash;
  rehashSnapshot(current);
  input.snapshots[1].crossGraphLinks.forEach((entry) => { entry.target.snapshotContentHash = current.contentHash; });
  input.approvedBaselines[0].snapshotContentHash = current.contentHash;
  rehashGraphValidation(input);
  return validateGraphSnapshots(input);
}

function assertDeepFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') assertDeepFrozen(child);
  }
}

test('the authoritative vocabulary is exact, complete, and deeply immutable', () => {
  assert.deepEqual(graphMetamodelRegistry.graphKinds, ['intent', 'solution', 'execution']);
  assert.deepEqual(graphMetamodelRegistry.graphs.intent.nodeTypes, [
    'Project', 'Goal', 'UserType', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output', 'Constraint',
    'Preference', 'Exclusion', 'SuccessCriterion', 'Assumption', 'Question', 'Decision', 'Example', 'Risk',
  ]);
  assert.deepEqual(graphMetamodelRegistry.graphs.execution.nodeTypes, [
    'Inspect', 'Decide', 'Implement', 'Test', 'Verify', 'Integrate', 'Repair', 'Document', 'Release',
  ]);
  assert.equal(graphMetamodelRegistry.graphs.solution.nodeTypes.includes('Role'), true);
  assert.equal(graphMetamodelRegistry.graphs.solution.nodeTypes.includes('Persona'), false);
  assert.equal(graphMetamodelRegistry.graphs.solution.nodeTypes.includes('Capability'), false);
  assert.deepEqual(Object.keys(graphMetamodelRegistry.graphs.intent.edgeTypes), [
    'PROJECT_HAS_GOAL', 'GOAL_SOLVES_PROBLEM', 'USER_HAS_PROBLEM', 'USER_PERFORMS_USE_CASE',
    'USE_CASE_REQUIRES_BEHAVIOR', 'BEHAVIOR_ACCEPTS_INPUT', 'BEHAVIOR_PRODUCES_OUTPUT',
    'CONSTRAINT_LIMITS', 'PREFERENCE_INFLUENCES', 'EXCLUSION_PROHIBITS', 'SUCCESS_VALIDATES',
    'ASSUMPTION_SUPPORTS', 'QUESTION_RESOLVES', 'DECISION_RESOLVES', 'EXAMPLE_CLARIFIES',
    'CONTRADICTS', 'SUPERSEDES', 'DEPENDS_ON',
  ]);
  assert.deepEqual(Object.keys(graphMetamodelRegistry.graphs.solution.edgeTypes), [
    'CONTAINS', 'REALIZES', 'DEPENDS_ON', 'USES', 'EXPOSES', 'DEPLOYED_TO', 'PROTECTED_BY', 'VALIDATED_BY',
  ]);
  assert.deepEqual(Object.keys(graphMetamodelRegistry.graphs.execution.edgeTypes), ['DEPENDS_ON']);
  assertDeepFrozen(graphMetamodelRegistry);
  assert.throws(() => {
    graphMetamodelRegistry.graphs.intent.edgeTypes.PROJECT_HAS_GOAL[0].sourceType = 'Goal';
  }, TypeError);
  assert.equal(isKnownNodeType('solution', 'Role'), true);
  assert.equal(isKnownNodeType('solution', 'Capability'), false);
  assert.equal(isCompatibleEdgeEndpoint('intent', 'PROJECT_HAS_GOAL', 'Project', 'Goal'), true);
  assert.equal(isCompatibleEdgeEndpoint('intent', 'PROJECT_HAS_GOAL', 'Goal', 'Project'), false);
});

test('strict portable graph snapshots accept only authoritative graph kinds and exact objects', () => {
  const valid = validGraphValidationInput().snapshots[0];
  assert.equal(GraphSnapshotSchema.safeParse(valid).success, true);
  assert.equal(GraphSnapshotSchema.safeParse({ ...valid, graphKind: 'evidence' }).success, false);
  assert.equal(GraphSnapshotSchema.safeParse({ ...valid, extra: true }).success, false);
  assert.equal(GraphSnapshotSchema.safeParse({ ...valid, nodes: [{ ...valid.nodes[0], extra: true }] }).success, false);
});

test('Intent provenance and status are exact, while Intent-only fields fail outside Intent', () => {
  assert.ok(codes(changed((input) => { input.snapshots[0].nodes[0].status = 'approved'; })).includes('invalid_intent_status'));
  assert.ok(codes(changed((input) => { delete input.snapshots[0].nodes[0].sourceQuote; })).includes('missing_intent_provenance'));
  assert.ok(codes(changed((input) => { input.snapshots[0].nodes[0].confidence = 1.1; })).includes('invalid_graph_snapshot'));
  assert.ok(codes(changed((input) => { input.snapshots[1].nodes[0].sourceQuote = 'not allowed'; })).includes('non_intent_provenance'));
});

test('a complete current Intent to Solution to Execution trace validates', () => {
  const result = validateGraphSnapshots(validGraphValidationInput());
  assert.deepEqual(result, { schemaVersion: '1.0.0', valid: true, issues: [] });
});

test('snapshot content hashes bind current graph bytes before semantic validation', () => {
  const input = validGraphValidationInput();
  input.snapshots[0].nodes[1].statementOrName = 'Changed without a new snapshot hash';
  assert.ok(codes(validateGraphSnapshots(input)).includes('snapshot_content_hash_mismatch'));
});

test('stale edge, trace, and current-source snapshot hashes fail before graph authority', () => {
  const edge = validGraphValidationInput();
  edge.snapshots[0].edges[0].type = 'DEPENDS_ON';
  assert.ok(codes(validateGraphSnapshots(edge)).includes('snapshot_content_hash_mismatch'));

  const trace = validGraphValidationInput();
  trace.snapshots[1].crossGraphLinks[0].target.nodeId = 'int-goal-1';
  assert.ok(codes(validateGraphSnapshots(trace)).includes('snapshot_content_hash_mismatch'));

  const source = validGraphValidationInput();
  const currentSource = structuredClone(source.snapshots[0]);
  source.snapshots.shift();
  source.currentSourceSnapshots = [currentSource];
  currentSource.nodes[0].statementOrName = 'Changed source snapshot';
  assert.ok(codes(validateGraphSnapshots(source)).includes('snapshot_content_hash_mismatch'));
});

test('a duplicate-declared current source still receives hash verification', () => {
  const input = validGraphValidationInput();
  const duplicate = structuredClone(input.snapshots[0]);
  duplicate.nodes[0].statementOrName = 'Changed duplicate source snapshot';
  input.currentSourceSnapshots = [duplicate];

  assert.ok(codes(validateGraphSnapshots(input)).includes('snapshot_content_hash_mismatch'));
});

test('snapshot hashes are deterministic, canonical, and non-mutating', () => {
  const snapshot = validGraphValidationInput().snapshots[0];
  const before = structuredClone(snapshot);
  const reordered = structuredClone(snapshot);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  reordered.nodes[0].attributes = { zebra: 1, alpha: 2 };
  const reorderedAgain = structuredClone(reordered);
  reorderedAgain.nodes[0].attributes = { alpha: 2, zebra: 1 };

  assert.equal(hashGraphSnapshot(reordered), hashGraphSnapshot(reorderedAgain));
  assert.equal(canonicalizeGraphSnapshot(reordered), canonicalizeGraphSnapshot(reorderedAgain));
  assert.notEqual(hashGraphSnapshot(snapshot), hashGraphSnapshot({ ...snapshot, revision: 2 }));
  assert.deepEqual(snapshot, before);
});

test('snapshot canonicalization rejects lone UTF-16 surrogates', () => {
  const snapshot = validGraphValidationInput().snapshots[0];
  snapshot.nodes[0].statementOrName = '\ud800';

  assert.throws(() => hashGraphSnapshot(snapshot), /ill-formed Unicode/);
  assert.ok(codes(validateGraphSnapshots({
    snapshots: [snapshot],
    approvedBaselines: [],
  })).includes('invalid_snapshot_canonicalization'));
});

test('unknown grammar, duplicate IDs, dangling endpoints, and incompatible pairs fail closed', () => {
  assert.ok(codes(changed((input) => { input.snapshots[1].nodes[0].type = 'Persona'; })).includes('unknown_node_type'));
  assert.ok(codes(changed((input) => { input.snapshots[0].edges[0].type = 'UNKNOWN_EDGE'; })).includes('unknown_edge_type'));
  assert.ok(codes(changed((input) => { input.snapshots[0].edges[0].targetNodeRef.nodeId = 'int-project-1'; })).includes('invalid_edge_endpoints'));
  assert.ok(codes(changed((input) => { input.snapshots[0].nodes.push(structuredClone(input.snapshots[0].nodes[0])); })).includes('duplicate_node_id'));
  assert.ok(codes(changed((input) => { input.snapshots[0].edges[0].targetNodeRef.nodeId = 'missing-node'; })).includes('dangling_node_ref'));
});

test('stale graph snapshot hash and node-version references fail closed', () => {
  assert.ok(codes(changed((input) => { input.snapshots[0].edges[0].targetNodeRef.graphId = 'other-intent-graph'; })).includes('wrong_graph_ref'));
  assert.ok(codes(changed((input) => { input.snapshots[1].crossGraphLinks[0].target.snapshotContentHash = 'd'.repeat(64); })).includes('stale_snapshot_hash'));
  assert.ok(codes(changed((input) => { input.snapshots[2].crossGraphLinks[0].target.nodeVersion = 2; })).includes('stale_node_version'));
  assert.ok(codes(changed((input) => { input.snapshots[2].crossGraphLinks[0].targetBaselineId = 'solution-v0'; })).includes('stale_target_baseline'));
});

test('wrong trace direction and missing mandatory trace closure fail closed', () => {
  assert.ok(codes(changed((input) => { input.snapshots[1].crossGraphLinks[0].type = 'SATISFIES_SOLUTION'; })).includes('wrong_link_direction'));
  assert.ok(codes(changed((input) => { input.snapshots[1].crossGraphLinks = input.snapshots[1].crossGraphLinks.filter((link) => link.source.nodeId !== 'sol-app-1'); })).includes('missing_intent_trace'));
  assert.ok(codes(changed((input) => { input.snapshots[2].crossGraphLinks = []; })).includes('missing_solution_trace'));
  assert.ok(codes(changed((input) => { delete input.snapshots[1].nodes[2].supports; })).includes('missing_supports_trace'));
});

test('implementation-support nodes retain supports references and may also trace to Intent', () => {
  const result = changed((input) => {
    const solution = input.snapshots[1];
    solution.crossGraphLinks.push({
      ...structuredClone(solution.crossGraphLinks[0]),
      id: 'solution-link-3',
      source: {
        ...structuredClone(solution.crossGraphLinks[0].source),
        nodeId: 'sol-service-1',
      },
      target: structuredClone(solution.crossGraphLinks[0].target),
    });
  });
  assert.equal(result.valid, true);
});

test('cross-graph sources require exact supplied approved baselines', () => {
  assert.ok(codes(changed((input) => {
    input.approvedBaselines = input.approvedBaselines.filter((baseline) => baseline.graphKind !== 'execution');
  })).includes('missing_approved_source_baseline'));
  assert.ok(codes(changed((input) => {
    input.snapshots[2].crossGraphLinks[0].sourceBaselineId = 'execution-v0';
  })).includes('stale_source_baseline'));
  assert.ok(codes(changed((input) => {
    input.approvedBaselines[2].snapshotContentHash = 'd'.repeat(64);
  })).includes('stale_source_snapshot'));
});

test('parent lineage binds exact supplied snapshots with consecutive revisions', () => {
  const input = validGraphValidationInput();
  const parent = structuredClone(input.snapshots[0]);
  const current = input.snapshots[0];
  current.snapshotId = 'intent-snapshot-2';
  current.revision = 2;
  current.parentSnapshotId = parent.snapshotId;
  current.parentSnapshotContentHash = parent.contentHash;
  current.edges[0].sourceNodeRef.snapshotId = current.snapshotId;
  current.edges[0].targetNodeRef.snapshotId = current.snapshotId;
  rehashSnapshot(current);
  input.snapshots[1].crossGraphLinks.forEach((entry) => {
    entry.target.snapshotId = current.snapshotId;
    entry.target.snapshotContentHash = current.contentHash;
  });
  input.approvedBaselines[0].snapshotId = current.snapshotId;
  input.approvedBaselines[0].snapshotContentHash = current.contentHash;
  input.currentSourceSnapshots = [parent];
  rehashGraphValidation(input);
  assert.equal(validateGraphSnapshots(input).valid, true);

  assert.ok(codes(changed((candidate) => {
    candidate.snapshots[0].revision = 2;
    candidate.snapshots[0].parentSnapshotId = 'made-up-parent';
    candidate.snapshots[0].parentSnapshotContentHash = 'd'.repeat(64);
  })).includes('invalid_parent_snapshot'));
  assert.ok(codes(changed((candidate) => {
    candidate.snapshots[0].parentSnapshotContentHash = 'd'.repeat(64);
  })).includes('invalid_parent_snapshot'));
});

test('current source snapshots are validated before serving trace targets or parents', () => {
  const invalidSources = [
    {
      code: 'unknown_node_type',
      mutate: (snapshot) => { snapshot.nodes[0].type = 'UnknownIntentNode'; },
    },
    {
      code: 'unknown_edge_type',
      mutate: (snapshot) => { snapshot.edges[0].type = 'UNKNOWN_EDGE'; },
    },
    {
      code: 'missing_intent_provenance',
      mutate: (snapshot) => { delete snapshot.nodes[0].sourceQuote; },
    },
    {
      code: 'dangling_node_ref',
      mutate: (snapshot) => { snapshot.edges[0].targetNodeRef.nodeId = 'missing-node'; },
    },
    {
      code: 'invalid_parent_snapshot',
      mutate: (snapshot) => {
        snapshot.revision = 2;
        snapshot.parentSnapshotId = 'missing-parent';
        snapshot.parentSnapshotContentHash = 'd'.repeat(64);
      },
    },
  ];

  for (const { code, mutate } of invalidSources) {
    assert.ok(codes(sourceAsTraceTarget(mutate)).includes(code), `${code} trace target`);
    assert.ok(codes(sourceAsParent(mutate)).includes(code), `${code} parent`);
  }
});

test('a current source snapshot rejects cross-links without its required approved baseline', () => {
  const input = validGraphValidationInput();
  const source = structuredClone(input.snapshots[1]);
  input.snapshots.splice(1, 1);
  input.currentSourceSnapshots = [source];
  input.approvedBaselines = input.approvedBaselines.filter((baseline) => baseline.graphKind !== 'intent');

  assert.ok(codes(validateGraphSnapshots(input)).includes('missing_approved_baseline'));
});

test('an identical current source snapshot already active does not add duplicate issues', () => {
  const input = validGraphValidationInput();
  input.currentSourceSnapshots = [structuredClone(input.snapshots[0])];

  assert.deepEqual(validateGraphSnapshots(input), { schemaVersion: '1.0.0', valid: true, issues: [] });
});
