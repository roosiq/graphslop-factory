import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActorRefSchema,
  ArtifactRefSchema,
  BaselineRefSchema,
  GraphKindSchema,
  HashSchema,
  IdentifierSchema,
  NodeRefSchema,
  NodeVersionSchema,
  SourceRefSchema,
  TimestampSchema,
  ValidationIssueSchema,
  ValidationPathSegmentSchema,
  ValidationReportSchema,
  commonContractSchemas,
} from '../../packages/contracts/dist/index.js';

const digest = 'a'.repeat(64);
const nodeRef = {
  graphKind: 'evidence',
  graphId: 'graph-1',
  nodeId: 'node-1',
  nodeVersion: 1,
  snapshotId: 'snapshot-1',
  snapshotContentHash: digest,
};
const issue = {
  code: 'invalid-input',
  message: 'Input is invalid.',
  path: ['request', 'items', 0, 'id'],
};

const validFixtures = [
  [IdentifierSchema, 'graphslop.v1'],
  [HashSchema, digest],
  [TimestampSchema, '2026-07-27T12:34:56.789Z'],
  [GraphKindSchema, 'evidence'],
  [NodeVersionSchema, Number.MAX_SAFE_INTEGER],
  [NodeRefSchema, nodeRef],
  [SourceRefSchema, { sourceId: 'source-1', contentHash: digest }],
  [ActorRefSchema, { actorId: 'actor-1', actorKind: 'person' }],
  [ArtifactRefSchema, { artifactId: 'artifact-1', artifactKind: 'document', contentHash: digest }],
  [BaselineRefSchema, { baselineId: 'intent-v1', contentHash: digest }],
  [ValidationPathSegmentSchema, 'request'],
  [ValidationPathSegmentSchema, 0],
  [ValidationIssueSchema, issue],
  [ValidationReportSchema, { schemaVersion: '1.0.0', valid: true, issues: [] }],
  [ValidationReportSchema, { schemaVersion: '1.0.0', valid: false, issues: [issue] }],
];

test('common contracts accept portable valid fixtures', () => {
  for (const [schema, fixture] of validFixtures) {
    assert.deepEqual(schema.parse(fixture), fixture);
  }
});

test('node references bind every graph and snapshot version field', () => {
  for (const nodeVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(NodeRefSchema.safeParse({ ...nodeRef, nodeVersion }).success, false);
  }
  assert.equal(NodeRefSchema.safeParse({ ...nodeRef, extra: true }).success, false);
});

test('every exported strict object schema rejects each missing required field', () => {
  const strictObjectFixtures = [
    [NodeRefSchema, nodeRef],
    [SourceRefSchema, { sourceId: 'source-1' }],
    [ActorRefSchema, { actorId: 'actor-1', actorKind: 'person' }],
    [ArtifactRefSchema, { artifactId: 'artifact-1', artifactKind: 'document', contentHash: digest }],
    [BaselineRefSchema, { baselineId: 'intent-v1', contentHash: digest }],
    [ValidationIssueSchema, issue],
    [ValidationReportSchema, { schemaVersion: '1.0.0', valid: true, issues: [] }],
  ];

  for (const [schema, fixture] of strictObjectFixtures) {
    for (const requiredField of Object.keys(fixture)) {
      const incomplete = { ...fixture };
      delete incomplete[requiredField];
      assert.equal(schema.safeParse(incomplete).success, false, `${requiredField} is required`);
    }
  }
});

test('validation paths accept string object keys and safe nonnegative array indexes only', () => {
  for (const path of [['request', 0, 'id'], ['two words', 0], [], [Number.MAX_SAFE_INTEGER]]) {
    assert.equal(ValidationIssueSchema.safeParse({ ...issue, path }).success, true);
  }
  for (const path of [[-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], [true]]) {
    assert.equal(ValidationIssueSchema.safeParse({ ...issue, path }).success, false);
  }
});

test('validation reports reject contradictory validity and issue combinations', () => {
  assert.equal(ValidationReportSchema.safeParse({ schemaVersion: '1.0.0', valid: true, issues: [issue] }).success, false);
  assert.equal(ValidationReportSchema.safeParse({ schemaVersion: '1.0.0', valid: false, issues: [] }).success, false);
  assert.equal(ValidationReportSchema.safeParse({ schemaVersion: '1.0.0', valid: true, issues: [], extra: true }).success, false);
});

test('common contracts reject malformed and unknown-field fixtures', () => {
  assert.equal(IdentifierSchema.safeParse('two words').success, false);
  assert.equal(HashSchema.safeParse('A'.repeat(64)).success, false);
  assert.equal(TimestampSchema.safeParse('2026-07-27T12:34:56').success, false);
  assert.equal(SourceRefSchema.safeParse({ sourceId: 'source-1', extra: true }).success, false);
  assert.equal(ActorRefSchema.safeParse({ actorId: 'actor-1', actorKind: 'person', extra: true }).success, false);
  assert.equal(ArtifactRefSchema.safeParse({ artifactId: 'artifact-1', artifactKind: 'document', contentHash: digest, extra: true }).success, false);
  assert.equal(BaselineRefSchema.safeParse({ baselineId: 'intent-v1', contentHash: digest, extra: true }).success, false);
  assert.equal(ValidationIssueSchema.safeParse({ ...issue, extra: true }).success, false);
});

function assertDeepFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      assertDeepFrozen(child);
    }
  }
}

test('common contract registry is JSON portable and deeply immutable', () => {
  assertDeepFrozen(commonContractSchemas);
  assert.throws(() => {
    commonContractSchemas.schemas.nodeRef.properties.graphId.type = 'number';
  }, TypeError);
  assert.throws(() => {
    commonContractSchemas.schemas.nodeRef.required.push('extra');
  }, TypeError);

  const roundTripped = JSON.parse(JSON.stringify(commonContractSchemas));
  assert.deepEqual(roundTripped, commonContractSchemas);
  assert.equal(roundTripped.version, '1.0.0');
  assert.equal(roundTripped.schemas.hash.pattern, '^[a-f0-9]{64}$');
  assert.equal(roundTripped.schemas.timestamp.format, 'date-time');
  assert.equal(roundTripped.schemas.nodeVersion.type, 'integer');
  assert.equal(roundTripped.schemas.nodeVersion.exclusiveMinimum, 0);
  assert.equal(roundTripped.schemas.nodeVersion.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(roundTripped.schemas.nodeRef.additionalProperties, false);
  assert.deepEqual(roundTripped.schemas.nodeRef.required, [
    'graphKind', 'graphId', 'nodeId', 'nodeVersion', 'snapshotId', 'snapshotContentHash',
  ]);
});

test('common registry remains provider, runtime, and authority neutral', () => {
  const registryText = JSON.stringify(commonContractSchemas).toLowerCase();

  assert.equal(registryText.includes('provider'), false);
  assert.equal(registryText.includes('runtime'), false);
  assert.equal(registryText.includes('authority'), false);
});
