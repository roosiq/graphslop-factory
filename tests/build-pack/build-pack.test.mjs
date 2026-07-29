import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { exportBuildPack } from '../../packages/build-pack/dist/index.js';

const exec = promisify(execFile);
const hash = (character) => character.repeat(64);
const timestamp = '2026-07-28T12:00:00Z';
const actor = { actorId: 'graphslop-system', actorKind: 'deterministic_service' };

function node(id, type, statementOrName, attributes = {}, status = 'confirmed') {
  return {
    id, stableId: id, version: 1, type, status, statementOrName,
    createdAt: timestamp, updatedAt: timestamp, sourceRefs: [], actorRef: actor, attributes,
  };
}

function snapshot(kind, nodes, edges, contentHash) {
  return {
    schemaVersion: '1.0.0', graphKind: kind, graphId: `${kind}-graph`,
    snapshotId: `${kind}-snapshot`, revision: 1, parentSnapshotId: null,
    parentSnapshotContentHash: null, createdAt: timestamp, createdBy: actor,
    nodes, edges, crossGraphLinks: [], contentHash,
  };
}

function ref(kind, id, contentHash) {
  return {
    graphKind: kind, graphId: `${kind}-graph`, nodeId: id, nodeVersion: 1,
    snapshotId: `${kind}-snapshot`, snapshotContentHash: contentHash,
  };
}

function baseline(kind, contentHash) {
  const id = `${kind}-v1`;
  return {
    schemaVersion: '1.0.0', baselineId: id, graphKind: kind, projectId: 'portable-project',
    status: 'approved', snapshotId: `${kind}-snapshot`, snapshotContentHash: contentHash,
    projectionId: `${kind}-projection`, projectionContentHash: hash(kind === 'intent' ? 'd' : 'e'),
    nodeVersions: [{ nodeId: `${kind}-node`, version: 1 }], protectedAssertions: [],
    unresolvedNonBlocking: [], createdAt: timestamp, supersedesBaselineId: null,
    approvalRecord: {
      approvalId: `${kind}-approval`, actorId: 'owner', actorKind: 'authenticated_project_owner',
      artifactType: `${kind}_baseline`, artifactId: id, artifactVersion: 1,
      artifactContentHash: contentHash, displayedProjectionHash: hash(kind === 'intent' ? 'd' : 'e'),
      sourceMessageId: 'message-one', sourceQuote: 'Approved', approvedAt: timestamp,
      includedEdgeRefs: [], renderedDataHash: hash(kind === 'intent' ? 'd' : 'e'), generatedAt: timestamp,
    },
  };
}

function fixtureState() {
  const intentHash = hash('a');
  const solutionHash = hash('b');
  const executionHash = hash('c');
  const plan = node('task-plan', 'Decide', 'Plan the approved feature', {
    solutionNodeId: 'solution-node', roleRef: 'Plan', objective: 'Write the bounded plan.',
    allowedPaths: ['docs/**'],
    acceptanceCommands: [{ argv: ['node', '-e', 'process.exit(0)'] }],
    acceptanceChecks: ['Plan names the approved feature.'],
  }, 'blocked');
  const build = node('task-build', 'Implement', 'Build the approved feature', {
    solutionNodeId: 'solution-node', roleRef: 'Build', objective: 'Build only the approved feature.',
    allowedPaths: ['src/**'],
    acceptanceCommands: [{ argv: ['node', '-e', 'process.exit(0)'] }],
    acceptanceChecks: ['Feature exists and checks pass.'],
  }, 'blocked');
  const dependency = {
    id: 'dependency-one', version: 1, type: 'DEPENDS_ON',
    sourceNodeRef: ref('execution', 'task-build', executionHash),
    targetNodeRef: ref('execution', 'task-plan', executionHash),
    status: 'confirmed', createdAt: timestamp, updatedAt: timestamp,
    sourceRefs: [], attributes: { order: 1 },
  };
  return {
    project: {
      schemaVersion: '1.0.0', projectId: 'portable-project', displayName: 'Portable project',
      lifecycleState: 'EXECUTION', activeIntentBaselineId: 'intent-v1',
      activeSolutionBaselineId: 'solution-v1', activeExecutionSnapshotId: 'execution-snapshot',
      connectedRepository: null, integrationCommit: null, activeLeaseId: null,
      runnerEnrollmentId: null, currentQuestionId: null,
      createdAt: timestamp, updatedAt: timestamp, closedAt: null,
    },
    messages: [{
      messageId: 'message-one', projectId: 'portable-project', actor: 'owner',
      content: 'Build the portable thing.', createdAt: timestamp,
    }],
    intentGraph: snapshot('intent', [
      node('intent-node', 'Goal', 'Build a portable feature'),
      node('constraint-node', 'Constraint', 'Keep operation local'),
      node('exclusion-node', 'Exclusion', 'Do not deploy automatically'),
    ], [], intentHash),
    solutionGraph: snapshot('solution', [
      { ...node('solution-node', 'Feature', 'Portable feature', { intentNodeIds: ['intent-node'] }, 'approved'), scope: 'product' },
    ], [], solutionHash),
    executionGraph: snapshot('execution', [plan, build], [dependency], executionHash),
    corrections: [], currentQuestion: null, questionResolutions: [], projections: [],
    approvedBaselines: [baseline('intent', intentHash), baseline('solution', solutionHash)],
  };
}

async function git(cwd, ...args) {
  return exec('git', args, { cwd });
}

async function setupRepository() {
  const root = await mkdtemp(join(tmpdir(), 'graphslop-pack-'));
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Graphslop Test');
  await writeFile(join(root, 'README.md'), '# Test\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'initial');
  await exportBuildPack(fixtureState(), join(root, '.factory'));
  await git(root, 'add', '.factory');
  await git(root, 'commit', '-qm', 'add build pack');
  return root;
}

async function controller(root, ...args) {
  return exec('python3', [join(root, '.factory', 'factory.py'), ...args], { cwd: root });
}

test('exports a self-contained harness-neutral build pack', async () => {
  const root = await setupRepository();
  try {
    const expected = [
      'factory.yaml', 'intent.json', 'solution.json', 'execution.json', 'runtime.json',
      'SKILL.md', 'RUN.md', 'factory.py', 'harnesses/codex/AGENTS.md',
      'tasks/task-plan.json', 'tasks/task-plan.md', 'tasks/task-build.json', 'tasks/task-build.md',
    ];
    for (const path of expected) {
      assert.ok((await readFile(join(root, '.factory', path), 'utf8')).length > 0, path);
    }
    const execution = JSON.parse(await readFile(join(root, '.factory', 'execution.json'), 'utf8'));
    assert.deepEqual(execution.tasks[1].dependencies, ['task-plan']);
    assert.deepEqual(execution.tasks[1].touch, ['src/**']);
    assert.match(execution.tasks[1].dont.join('\n'), /Do not deploy automatically/);
    assert.match(await readFile(join(root, '.factory', 'SKILL.md'), 'utf8'), /The graph is boss/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('python controller enforces order, paths, checks, evidence, and completion', async () => {
  const root = await setupRepository();
  try {
    let result = await controller(root, 'next');
    assert.match(result.stdout, /task-plan/);
    await controller(root, 'claim', 'task-plan');
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'plan.md'), '# Plan\n');
    await controller(root, 'check', 'task-plan');
    await controller(root, 'accept', 'task-plan');
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'accept plan');

    result = await controller(root, 'next');
    assert.match(result.stdout, /task-build/);
    await controller(root, 'claim', 'task-build');
    await writeFile(join(root, 'outside.txt'), 'not allowed\n');
    await assert.rejects(
      () => controller(root, 'check', 'task-build'),
      (error) => error.stderr.includes('Paths outside TOUCH: outside.txt'),
    );
    await rm(join(root, 'outside.txt'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'app.js'), 'export const built = true;\n');
    await controller(root, 'check', 'task-build');
    await controller(root, 'accept', 'task-build');
    result = await controller(root, 'status');
    assert.equal(JSON.parse(result.stdout).status, 'complete');
    const evidence = JSON.parse(await readFile(join(root, '.factory', 'evidence', 'task-build.json'), 'utf8'));
    assert.deepEqual(evidence.changedPaths, ['src/app.js']);
    assert.equal(evidence.receipts[0].exitCode, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('python controller records blocking drift without inventing a repair', async () => {
  const root = await setupRepository();
  try {
    await controller(root, 'claim', 'task-plan');
    await controller(root, 'report-drift', 'task-plan', 'Required API decision is missing.');
    const drift = JSON.parse(await readFile(join(root, '.factory', 'drift', 'task-plan.json'), 'utf8'));
    assert.equal(drift.status, 'blocking');
    assert.equal(drift.reason, 'Required API decision is missing.');
    const status = JSON.parse((await controller(root, 'status')).stdout);
    assert.equal(status.counts.drift, 1);
    assert.deepEqual(status.next, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
