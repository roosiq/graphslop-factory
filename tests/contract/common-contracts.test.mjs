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
  SourceRefSchema,
  TimestampSchema,
  ValidationIssueSchema,
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
};

const validFixtures = [
  [IdentifierSchema, 'graphslop.v1'],
  [HashSchema, digest],
  [TimestampSchema, '2026-07-27T12:34:56.789Z'],
  [GraphKindSchema, 'evidence'],
  [NodeRefSchema, nodeRef],
  [SourceRefSchema, { sourceId: 'source-1', contentHash: digest }],
  [ActorRefSchema, { actorId: 'actor-1', actorKind: 'person' }],
  [
    ArtifactRefSchema,
    { artifactId: 'artifact-1', artifactKind: 'document', contentHash: digest },
  ],
  [BaselineRefSchema, { baselineId: 'intent-v1', contentHash: digest }],
  [
    ValidationIssueSchema,
    { code: 'invalid-input', message: 'Input is invalid.', path: ['request', 'id'] },
  ],
  [
    ValidationReportSchema,
    {
      schemaVersion: '1.0.0',
      valid: false,
      issues: [{ code: 'invalid-input', message: 'Input is invalid.', path: ['request'] }],
    },
  ],
];

test('common contracts accept portable valid fixtures', () => {
  for (const [schema, fixture] of validFixtures) {
    assert.deepEqual(schema.parse(fixture), fixture);
  }
});

test('common contracts reject invalid and unknown-field fixtures', () => {
  assert.equal(IdentifierSchema.safeParse('two words').success, false);
  assert.equal(HashSchema.safeParse('A'.repeat(64)).success, false);
  assert.equal(TimestampSchema.safeParse('2026-07-27T12:34:56').success, false);
  for (const requiredField of ['graphKind', 'graphId', 'nodeId', 'nodeVersion', 'snapshotId']) {
    const incompleteNodeRef = { ...nodeRef };
    delete incompleteNodeRef[requiredField];
    assert.equal(NodeRefSchema.safeParse(incompleteNodeRef).success, false, `${requiredField} is required`);
  }
  assert.equal(NodeRefSchema.safeParse({ ...nodeRef, nodeVersion: 0 }).success, false);
  assert.equal(NodeRefSchema.safeParse({ ...nodeRef, nodeVersion: 1.5 }).success, false);
  assert.equal(NodeRefSchema.safeParse({ ...nodeRef, extra: true }).success, false);
  assert.equal(SourceRefSchema.safeParse({ sourceId: 'source-1', extra: true }).success, false);
  assert.equal(ActorRefSchema.safeParse({ actorId: 'actor-1', actorKind: 'person', extra: true }).success, false);
  assert.equal(ArtifactRefSchema.safeParse({ artifactId: 'artifact-1', artifactKind: 'document', contentHash: digest, extra: true }).success, false);
  assert.equal(BaselineRefSchema.safeParse({ baselineId: 'intent-v1', contentHash: digest, extra: true }).success, false);
  assert.equal(ValidationIssueSchema.safeParse({ code: 'invalid-input', message: 'Input is invalid.', path: [], extra: true }).success, false);
  assert.equal(ValidationReportSchema.safeParse({ schemaVersion: '1.0.0', valid: true, issues: [], authority: 'provider' }).success, false);
});

test('common contract registry exposes portable strict schemas', () => {
  assert.ok(commonContractSchemas);
  const roundTripped = JSON.parse(JSON.stringify(commonContractSchemas));

  assert.deepEqual(roundTripped, commonContractSchemas);
  assert.equal(roundTripped.version, '1.0.0');
  assert.equal(roundTripped.schemas.nodeRef.additionalProperties, false);
  assert.deepEqual(roundTripped.schemas.nodeRef.required, ['graphKind', 'graphId', 'nodeId', 'nodeVersion', 'snapshotId']);
  assert.equal(roundTripped.schemas.validationReport.additionalProperties, false);
  assert.deepEqual(roundTripped.schemas.validationReport.required, ['schemaVersion', 'valid', 'issues']);
});

test('common registry remains provider and runtime neutral', () => {
  const registryText = JSON.stringify(commonContractSchemas).toLowerCase();

  assert.equal(registryText.includes('provider'), false);
  assert.equal(registryText.includes('runtime'), false);
  assert.equal(registryText.includes('authority'), false);
});
