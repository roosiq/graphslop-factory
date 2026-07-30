import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FactoryFileStore,
  FactoryStoreError,
  hashCanonicalJson,
} from '../../packages/file-store/dist/index.js';
import { validGraphValidationInput } from '../kernel/metamodel-fixtures.mjs';

async function root() {
  return mkdtemp(join(tmpdir(), 'graphslop-store-'));
}

const firstFiles = {
  'project.json': { projectId: 'one', lifecycleState: 'CAPTURE' },
  'views/intent.json': { graphId: 'intent-one', revision: 1 },
  'conversation/messages.jsonl': '',
};

test('commit writes a readable immutable head and human-readable files', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);

  const head = await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-001',
    files: firstFiles,
  });

  assert.equal((await store.read()).head.headHash, head.headHash);
  assert.deepEqual((await store.read()).files, firstFiles);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, '.factory', 'head.json'), 'utf8')),
    head,
  );
  assert.match(
    await readFile(join(directory, '.factory', 'commits', 'tx-001', 'project.json'), 'utf8'),
    /"lifecycleState": "CAPTURE"/,
  );
});

test('exact expected head rejects a stale writer without changing state', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  const first = await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-001',
    files: firstFiles,
  });
  await store.commit({
    expectedHeadHash: first.headHash,
    transactionId: 'tx-002',
    files: { ...firstFiles, 'project.json': { projectId: 'one', lifecycleState: 'DISCOVERY' } },
  });

  await assert.rejects(
    store.commit({
      expectedHeadHash: first.headHash,
      transactionId: 'tx-stale',
      files: firstFiles,
    }),
    (error) => error instanceof FactoryStoreError && error.code === 'stale_head',
  );
  assert.equal((await store.read()).files['project.json'].lifecycleState, 'DISCOVERY');
});

test('a second writer fails while the project writer lock exists', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  await store.initialize();
  await writeFile(
    join(directory, '.factory', 'writer.lock'),
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
  );

  await assert.rejects(
    store.commit({ expectedHeadHash: null, transactionId: 'tx-001', files: firstFiles }),
    (error) => error instanceof FactoryStoreError && error.code === 'writer_busy',
  );
});

test('recovery quarantines abandoned commits and keeps only the verified head', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  const head = await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-good',
    files: firstFiles,
  });
  await store.prepareCommit({
    transactionId: 'tx-abandoned',
    files: { ...firstFiles, 'project.json': { projectId: 'one', lifecycleState: 'COMPLETE' } },
  });

  const recovery = await store.recover();

  assert.equal(recovery.selectedHeadHash, head.headHash);
  assert.deepEqual(recovery.quarantinedTransactionIds, ['tx-abandoned']);
  assert.equal((await store.read()).files['project.json'].lifecycleState, 'CAPTURE');
});

test('recovery and read fail closed when the selected commit is hash-invalid', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-good',
    files: firstFiles,
  });
  await writeFile(
    join(directory, '.factory', 'commits', 'tx-good', 'project.json'),
    '{ "projectId": "tampered" }\n',
  );

  await assert.rejects(
    store.recover(),
    (error) => error instanceof FactoryStoreError && error.code === 'invalid_head',
  );
  await assert.rejects(
    store.read(),
    (error) => error instanceof FactoryStoreError && error.code === 'invalid_head',
  );
});

test('canonical JSON hashes do not depend on object key order', () => {
  assert.equal(hashCanonicalJson({ b: 2, a: 1 }), hashCanonicalJson({ a: 1, b: 2 }));
});

test('later heads cannot alter or remove an approved baseline', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  const files = {
    ...firstFiles,
    'intent/baselines/intent-v1.json': { baselineId: 'intent-v1', status: 'approved' },
  };
  const first = await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-001',
    files,
  });

  for (const changedFiles of [
    { ...files, 'intent/baselines/intent-v1.json': { baselineId: 'intent-v1', status: 'changed' } },
    firstFiles,
  ]) {
    await assert.rejects(
      store.commit({
        expectedHeadHash: first.headHash,
        transactionId: `tx-bad-${Object.keys(changedFiles).length}-${changedFiles === firstFiles ? 'removed' : 'changed'}`,
        files: changedFiles,
      }),
      (error) => error instanceof FactoryStoreError && error.code === 'immutable_history',
    );
  }
});

test('JSON Lines history can only append complete lines', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  const first = await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-001',
    files: { ...firstFiles, 'conversation/messages.jsonl': '{"messageId":"one"}\n' },
  });
  const second = await store.commit({
    expectedHeadHash: first.headHash,
    transactionId: 'tx-002',
    files: {
      ...firstFiles,
      'conversation/messages.jsonl': '{"messageId":"one"}\n{"messageId":"two"}\n',
    },
  });
  assert.match((await store.read()).files['conversation/messages.jsonl'], /"two"/);

  await assert.rejects(
    store.commit({
      expectedHeadHash: second.headHash,
      transactionId: 'tx-rewrite',
      files: { ...firstFiles, 'conversation/messages.jsonl': '{"messageId":"other"}\n' },
    }),
    (error) => error instanceof FactoryStoreError && error.code === 'immutable_history',
  );
});

test('malformed authoritative graph state cannot become head', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);

  await assert.rejects(
    store.commit({
      expectedHeadHash: null,
      transactionId: 'tx-invalid-graph',
      files: {
        ...firstFiles,
        'intent/graph.json': { graphKind: 'intent', nodes: 'not-an-array' },
      },
    }),
    (error) => error instanceof FactoryStoreError && error.code === 'invalid_graph_state',
  );
  await assert.rejects(
    store.read(),
    (error) => error instanceof FactoryStoreError && error.code === 'empty_store',
  );
});

test('transaction tree is durably synced before head publication', async () => {
  const directory = await root();
  const events = [];
  const store = new FactoryFileStore(
    directory,
    () => '2026-07-27T12:00:00Z',
    (event) => events.push(event),
  );

  await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-durable',
    files: firstFiles,
  });

  const treeSync = events.indexOf('transaction_tree_synced');
  const headRename = events.indexOf('head_renamed');
  assert.notEqual(treeSync, -1);
  assert.notEqual(headRename, -1);
  assert.ok(treeSync < headRename);
});

test('a valid complete Intent to Solution to Execution closure commits and reads as head', async () => {
  const directory = await root();
  const store = new FactoryFileStore(directory);
  const closure = validGraphValidationInput();
  const [intent, solution, execution] = closure.snapshots;
  const approvedRecord = (baseline, graph, artifactType) => ({
    schemaVersion: '1.0.0',
    baselineId: baseline.baselineId,
    graphKind: baseline.graphKind,
    projectId: 'project-one',
    status: 'approved',
    snapshotId: baseline.snapshotId,
    snapshotContentHash: baseline.snapshotContentHash,
    projectionId: `${baseline.baselineId}-view`,
    projectionContentHash: 'b'.repeat(64),
    nodeVersions: graph.nodes.map((node) => ({ nodeId: node.id, version: node.version })),
    protectedAssertions: [],
    unresolvedNonBlocking: [],
    approvalRecord: {
      approvalId: `${baseline.baselineId}-approval`,
      actorId: 'owner-one',
      actorKind: 'authenticated_project_owner',
      artifactType,
      artifactId: baseline.baselineId,
      artifactVersion: 1,
      artifactContentHash: baseline.snapshotContentHash,
      displayedProjectionHash: 'b'.repeat(64),
      sourceMessageId: `${baseline.baselineId}-message`,
      sourceQuote: 'Approved',
      approvedAt: '2026-07-27T20:00:00.000Z',
      includedEdgeRefs: [],
      renderedDataHash: 'b'.repeat(64),
      generatedAt: '2026-07-27T20:00:00.000Z',
    },
    createdAt: '2026-07-27T20:00:00.000Z',
    supersedesBaselineId: null,
  });

  const head = await store.commit({
    expectedHeadHash: null,
    transactionId: 'tx-full-closure',
    files: {
      'project.json': { projectId: 'project-one', lifecycleState: 'EXECUTION' },
      'intent/graph.json': intent,
      'solution/graph.json': solution,
      'execution/graph.json': execution,
      'intent/baselines/intent-v1.json': approvedRecord(
        closure.approvedBaselines[0],
        intent,
        'intent_baseline',
      ),
      'solution/baselines/solution-v1.json': approvedRecord(
        closure.approvedBaselines[1],
        solution,
        'solution_baseline',
      ),
    },
  });

  const stored = await store.read();
  assert.equal(stored.head.headHash, head.headHash);
  assert.equal(stored.files['execution/graph.json'].contentHash, execution.contentHash);
  assert.equal(Object.hasOwn(stored.files, 'execution/baselines/execution-v1.json'), false);
});
