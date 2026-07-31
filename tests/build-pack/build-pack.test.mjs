import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createBuildPackFiles, exportBuildPack } from '../../packages/build-pack/dist/index.js';

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

function baseline(kind, contentHash, nodeIds = [`${kind}-node`]) {
  const id = `${kind}-v1`;
  return {
    schemaVersion: '1.0.0', baselineId: id, graphKind: kind, projectId: 'portable-project',
    status: 'approved', snapshotId: `${kind}-snapshot`, snapshotContentHash: contentHash,
    projectionId: `${kind}-projection`, projectionContentHash: hash(kind === 'intent' ? 'd' : 'e'),
    nodeVersions: nodeIds.map((nodeId) => ({ nodeId, version: 1 })), protectedAssertions: [],
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
    solutionNodeId: 'solution-node', roleRef: 'role-node', objective: 'Write the bounded plan.',
    allowedPaths: ['docs/**'],
    acceptanceCommands: [{ argv: ['node', '-e', 'process.exit(0)'] }],
    acceptanceChecks: ['Plan names the approved feature.'],
  }, 'blocked');
  const build = node('task-build', 'Implement', 'Build the approved feature', {
    solutionNodeId: 'solution-node', roleRef: 'role-node', objective: 'Build only the approved feature.',
    allowedPaths: ['src/**'],
    acceptanceCommands: [{ argv: ['node', '-e', 'process.exit(0)'] }],
    acceptanceChecks: ['Feature exists and checks pass.'],
  }, 'blocked');
  const verify = node('task-verify', 'Verify', 'Check the approved feature', {
    solutionNodeId: 'solution-node', roleRef: 'reviewer-node', objective: 'Check only the approved feature.',
    allowedPaths: [],
    acceptanceCommands: [{ argv: ['node', '-e', 'process.exit(0)'] }],
    acceptanceChecks: ['Feature matches the approved need.'],
  }, 'blocked');
  const dependency = {
    id: 'dependency-one', version: 1, type: 'DEPENDS_ON',
    sourceNodeRef: ref('execution', 'task-build', executionHash),
    targetNodeRef: ref('execution', 'task-plan', executionHash),
    status: 'confirmed', createdAt: timestamp, updatedAt: timestamp,
    sourceRefs: [], attributes: { order: 1 },
  };
  const verificationDependency = {
    id: 'dependency-two', version: 1, type: 'DEPENDS_ON',
    sourceNodeRef: ref('execution', 'task-verify', executionHash),
    targetNodeRef: ref('execution', 'task-build', executionHash),
    status: 'confirmed', createdAt: timestamp, updatedAt: timestamp,
    sourceRefs: [], attributes: { order: 2 },
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
      { ...node('role-node', 'Role', 'Portable feature engineer', {
        intentNodeIds: ['intent-node'],
        job: 'Make the portable feature.',
        use: ['Approved need.'],
        touch: ['Portable feature.'],
        dont: ['Change intent.'],
        done: ['Checks pass.'],
      }, 'approved'), scope: 'implementation_support' },
      { ...node('reviewer-node', 'Role', 'Portable feature reviewer', {
        intentNodeIds: ['intent-node'],
        job: 'Check the portable feature.',
        use: ['Approved need and built result.'],
        touch: ['Verification only.'],
        dont: ['Build the feature.'],
        done: ['Report pass or gap.'],
      }, 'approved'), scope: 'implementation_support' },
    ], [], solutionHash),
    executionGraph: snapshot('execution', [plan, build, verify], [dependency, verificationDependency], executionHash),
    corrections: [], currentQuestion: null, questionResolutions: [], projections: [],
    approvedBaselines: [
      baseline('intent', intentHash, ['intent-node', 'constraint-node', 'exclusion-node']),
      baseline('solution', solutionHash, ['solution-node', 'role-node', 'reviewer-node']),
    ],
  };
}

async function git(cwd, ...args) {
  return exec('git', args, { cwd });
}

async function setupRepository(state = fixtureState()) {
  const root = await mkdtemp(join(tmpdir(), 'graphslop-pack-'));
  await git(root, 'init', '-q');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Graphslop Test');
  await writeFile(join(root, 'README.md'), '# Test\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'initial');
  await exportBuildPack(state, join(root, '.factory'));
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'add build pack');
  return root;
}

async function controller(root, ...args) {
  return exec('python3', [join(root, '.factory', 'factory.py'), ...args], {
    cwd: root,
    env: { ...process.env, GRAPHSLOP_STATE_ROOT: `${root}-authority` },
  });
}

test('exports a self-contained build pack with drop-in harness adapters', async () => {
  const root = await setupRepository();
  try {
    const expected = [
      'factory.yaml', 'intent.json', 'solution.json', 'execution.json', 'runtime.json',
      'roles.json', 'roles/role-node.md', 'roles/reviewer-node.md',
      'SKILL.md', 'RUN.md', 'factory.py', 'harnesses.json',
      'tasks/task-plan.json', 'tasks/task-plan.md', 'tasks/task-build.json', 'tasks/task-build.md',
      'tasks/task-verify.json', 'tasks/task-verify.md',
    ];
    for (const path of expected) {
      assert.ok((await readFile(join(root, '.factory', path), 'utf8')).length > 0, path);
    }
    const execution = JSON.parse(await readFile(join(root, '.factory', 'execution.json'), 'utf8'));
    assert.deepEqual(execution.tasks[1].dependencies, ['task-plan']);
    assert.deepEqual(execution.tasks[1].touch, ['src/**']);
    assert.equal(execution.tasks[1].role, 'Portable feature engineer');
    assert.equal(execution.tasks[1].roleId, 'role-node');
    assert.match(execution.tasks[1].dont.join('\n'), /Do not deploy automatically/);
    assert.match(await readFile(join(root, '.factory', 'SKILL.md'), 'utf8'), /Graph is boss/);
    const skillPaths = [
      '.agents/skills/graphslop-build-pack/SKILL.md',
      '.claude/skills/graphslop-build-pack/SKILL.md',
      '.cursor/skills/graphslop-build-pack/SKILL.md',
    ];
    const skills = await Promise.all(skillPaths.map((path) => readFile(join(root, path), 'utf8')));
    assert.equal(new Set(skills).size, 1);
    assert.match(skills[0], /Use when a repository contains \.factory\/execution\.json/);
    assert.match(
      await readFile(join(root, '.agents/skills/graphslop-build-pack/agents/openai.yaml'), 'utf8'),
      /allow_implicit_invocation: true/,
    );
    assert.match(
      await readFile(join(root, '.codex/agents/graphslop-reviewer-node.toml'), 'utf8'),
      /sandbox_mode = "read-only"/,
    );
    assert.match(
      await readFile(join(root, '.claude/agents/graphslop-reviewer-node.md'), 'utf8'),
      /tools: Read, Grep, Glob, Bash\n/,
    );
    assert.match(
      await readFile(join(root, '.cursor/rules/graphslop.mdc'), 'utf8'),
      /alwaysApply: true/,
    );
    assert.match(
      await readFile(join(root, '.cursor/agents/graphslop-reviewer-node.md'), 'utf8'),
      /readonly: true/,
    );
    await exec('python3', [
      '-c',
      'import pathlib,tomllib; tomllib.loads(pathlib.Path(".codex/agents/graphslop-role-node.toml").read_text())',
    ], { cwd: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('creates the same portable files without requiring a filesystem', () => {
  const { manifest, files, harnessFiles } = createBuildPackFiles(fixtureState());
  assert.equal(manifest.projectId, 'portable-project');
  assert.ok(files['factory.py'].startsWith('#!/usr/bin/env python3'));
  assert.equal(JSON.parse(files['intent.json']).graphKind, 'intent');
  assert.equal(JSON.parse(files['execution.json']).tasks.length, 3);
  assert.match(files['tasks/task-build.md'], /## DON'T/);
  assert.match(harnessFiles['.cursor/agents/graphslop-role-node.md'], /Portable feature engineer/);
});

test('exports handoff contracts and records a baseline-bound realized run graph', async () => {
  const state = fixtureState();
  const handoff = {
    key: 'approved-plan',
    type: 'documentation',
    description: 'The bounded plan consumed by implementation.',
    paths: ['docs/plan.md'],
    requiredEvidence: ['file_hash', 'independent_check'],
  };
  state.executionGraph.edges[0].attributes = {
    kind: 'feature_handoff',
    artifacts: [handoff],
  };
  const root = await setupRepository(state);
  try {
    const execution = JSON.parse(await readFile(join(root, '.factory', 'execution.json'), 'utf8'));
    assert.deepEqual(execution.tasks.find((task) => task.id === 'task-build').requiredArtifacts, [handoff]);
    assert.deepEqual(execution.tasks.find((task) => task.id === 'task-plan').producedArtifacts, [handoff]);
    assert.deepEqual(execution.dependencyEdges[0], {
      id: 'dependency-one',
      type: 'DEPENDS_ON',
      kind: 'feature_handoff',
      sourceTaskId: 'task-build',
      targetTaskId: 'task-plan',
      artifacts: [handoff],
    });
    const initialRuntime = JSON.parse(await readFile(join(root, '.factory', 'runtime.json'), 'utf8'));
    assert.equal(initialRuntime.schemaVersion, '1.2.0');
    assert.equal(initialRuntime.projectionKind, 'execution_run');
    assert.equal(initialRuntime.runId, `run-${execution.executionHash.slice(0, 24)}`);
    assert.deepEqual(initialRuntime.intentBaseline, execution.intentBaseline);
    assert.deepEqual(initialRuntime.solutionBaseline, execution.solutionBaseline);
    assert.equal(initialRuntime.nodes['task-plan'].attempt, 0);
    assert.equal(initialRuntime.edges[0].status, 'pending');

    const worker = 'codex:role-node:handoff-run';
    await controller(root, 'claim', 'task-plan', '--worker', worker);
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'plan.md'), '# Approved plan\n');
    await controller(root, 'check', 'task-plan', '--worker', worker);
    await controller(root, 'accept', 'task-plan', '--worker', worker);
    const runtime = JSON.parse(await readFile(join(root, '.factory', 'runtime.json'), 'utf8'));
    assert.equal(runtime.nodes['task-plan'].attempt, 1);
    assert.equal(runtime.nodes['task-plan'].workerId, worker);
    assert.deepEqual(runtime.nodes['task-plan'].evidenceRefs, ['.factory/evidence/task-plan.json']);
    assert.deepEqual(runtime.events.map((event) => event.type), ['claim', 'check', 'accept']);
    assert.ok(runtime.events.every((event) => event.workerId === worker && event.timestamp));
    assert.equal(runtime.edges[0].status, 'satisfied');
    assert.deepEqual(runtime.edges[0].satisfiedArtifactKeys, ['approved-plan']);
    assert.equal(runtime.edges[0].evidenceRefs.length, 2);
    assert.equal(runtime.nodes['task-plan'].producedArtifacts[0].evidenceRefs.length, 2);
    assert.deepEqual(
      runtime.nodes['task-plan'].producedArtifacts[0].evidenceRefs.map((ref) => ref.kind).sort(),
      ['acceptance_command', 'file_hash'],
    );
    assert.match((await controller(root, 'next')).stdout, /task-build/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not release a dependent task when handoff artifact evidence is missing', async () => {
  const state = fixtureState();
  state.executionGraph.edges[0].attributes = {
    kind: 'feature_handoff',
    artifacts: [{
      key: 'approved-plan',
      type: 'documentation',
      description: 'The plan required by implementation.',
      paths: ['docs/plan.md'],
      requiredEvidence: ['file_hash'],
    }],
  };
  const root = await setupRepository(state);
  try {
    const worker = 'codex:role-node:missing-evidence-run';
    await controller(root, 'claim', 'task-plan', '--worker', worker);
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'plan.md'), '# Approved plan\n');
    await controller(root, 'check', 'task-plan', '--worker', worker);
    const runtimePath = join(root, '.factory', 'runtime.json');
    const evidencePath = join(root, '.factory', 'evidence', 'task-plan.json');
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    evidence.producedArtifacts = [];
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await assert.rejects(
      () => controller(root, 'accept', 'task-plan', '--worker', worker),
      (error) => error.stderr.includes('Checked evidence is missing or changed'),
    );
    const blocked = JSON.parse(await readFile(runtimePath, 'utf8'));
    assert.equal(blocked.nodes['task-plan'].status, 'running');
    assert.equal(blocked.edges[0].status, 'blocked');
    assert.deepEqual(blocked.edges[0].blockedArtifactKeys, ['approved-plan']);
    const status = JSON.parse((await controller(root, 'status')).stdout);
    assert.deepEqual(status.next, []);
    await assert.rejects(
      () => controller(root, 'claim', 'task-build', '--worker', 'codex:role-node:blocked-run'),
      (error) => error.stderr.includes('blocked by dependencies'),
    );
    await controller(root, 'check', 'task-plan', '--worker', worker);
    await controller(root, 'accept', 'task-plan', '--worker', worker);
    assert.match((await controller(root, 'next')).stdout, /task-build/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-authority`, { recursive: true, force: true });
  }
});

test('does not invent artifact evidence from an unrelated passing command', async () => {
  const state = fixtureState();
  state.executionGraph.edges[0].attributes = {
    kind: 'feature_handoff',
    artifacts: [{
      key: 'approved-plan',
      type: 'documentation',
      description: 'The plan required by implementation.',
      paths: ['docs/plan.md'],
      requiredEvidence: ['file_hash', 'independent_check'],
    }],
  };
  const root = await setupRepository(state);
  try {
    const worker = 'codex:role-node:no-artifact-run';
    await controller(root, 'claim', 'task-plan', '--worker', worker);
    await assert.rejects(
      () => controller(root, 'check', 'task-plan', '--worker', worker),
      (error) => error.stderr.includes('has no file at its declared paths'),
    );
    const runtime = JSON.parse(await readFile(join(root, '.factory', 'runtime.json'), 'utf8'));
    assert.equal(runtime.nodes['task-plan'].status, 'running');
    assert.deepEqual(runtime.nodes['task-plan'].producedArtifacts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-authority`, { recursive: true, force: true });
  }
});

test('restores a worker-edited runtime mirror from controller authority', async () => {
  const root = await setupRepository();
  try {
    await controller(root, 'status');
    const runtimePath = join(root, '.factory', 'runtime.json');
    const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
    for (const node of Object.values(runtime.nodes)) node.status = 'accepted';
    for (const edge of runtime.edges) edge.status = 'satisfied';
    await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
    const status = JSON.parse((await controller(root, 'status')).stdout);
    assert.equal(status.status, 'in_progress');
    const restored = JSON.parse(await readFile(runtimePath, 'utf8'));
    assert.ok(Object.values(restored.nodes).every((node) => node.status === 'pending'));
    assert.ok(restored.edges.every((edge) => edge.status === 'pending'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-authority`, { recursive: true, force: true });
  }
});

test('approved baseline membership includes provisional constraints and exclusions in task prompts', () => {
  const state = fixtureState();
  state.intentGraph.nodes.find((item) => item.id === 'constraint-node').status = 'proposed';
  state.intentGraph.nodes.find((item) => item.id === 'exclusion-node').status = 'proposed';
  const { manifest } = createBuildPackFiles(state);
  const instructions = manifest.tasks.flatMap((task) => task.dont).join('\n');
  assert.match(instructions, /Keep operation local/);
  assert.match(instructions, /Do not deploy automatically/);
});

test('uses portable collision-resistant filenames for graph identifiers', async () => {
  const state = structuredClone(fixtureState());
  const role = state.solutionGraph.nodes.find((item) => item.id === 'role-node');
  role.id = 'Role:Engineer';
  role.stableId = 'Role:Engineer';
  for (const task of state.executionGraph.nodes) {
    if (task.attributes.roleRef === 'role-node') task.attributes.roleRef = 'Role:Engineer';
  }
  const plan = state.executionGraph.nodes.find((item) => item.id === 'task-plan');
  plan.id = 'Task:Plan';
  plan.stableId = 'Task:Plan';
  for (const edge of state.executionGraph.edges) {
    if (edge.targetNodeRef.nodeId === 'task-plan') edge.targetNodeRef.nodeId = 'Task:Plan';
  }
  const { manifest, files, harnessFiles } = createBuildPackFiles(state);
  const portableTask = manifest.tasks.find((task) => task.id === 'Task:Plan');
  const portableRole = manifest.roles.find((item) => item.id === 'Role:Engineer');
  assert.ok(portableTask);
  assert.ok(portableRole);
  assert.doesNotMatch(portableTask.taskFile, /[:\\]/);
  assert.doesNotMatch(portableRole.roleFile, /[:\\]/);
  assert.ok(files[portableTask.taskFile]);
  assert.ok(files[portableRole.roleFile]);
  assert.ok(Object.keys(harnessFiles).some((path) =>
    path.startsWith('.codex/agents/graphslop-role-engineer-')));
  const root = await setupRepository(state);
  try {
    const worker = 'codex:Role:Engineer:portable-run';
    await controller(root, 'claim', 'Task:Plan', '--worker', worker);
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'plan.md'), '# Plan\n');
    await controller(root, 'check', 'Task:Plan', '--worker', worker);
    const evidenceName = portableTask.taskFile.replace(/^tasks\//, '').replace(/\.md$/, '.json');
    const evidence = JSON.parse(await readFile(join(root, '.factory', 'evidence', evidenceName), 'utf8'));
    assert.equal(evidence.taskId, 'Task:Plan');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a pack without a complete independent task loop', () => {
  const state = structuredClone(fixtureState());
  state.executionGraph.nodes = state.executionGraph.nodes.filter((task) => task.type !== 'Verify');
  state.executionGraph.edges = state.executionGraph.edges.filter((edge) => edge.sourceNodeRef.nodeId !== 'task-verify');
  assert.throws(() => createBuildPackFiles(state), /no Verify task/);
});

test('python controller enforces order, paths, checks, evidence, and completion', async () => {
  const root = await setupRepository();
  try {
    const planner = 'codex:role-node:run-1';
    const builder = 'codex:role-node:run-2';
    const verifier = 'claude:reviewer-node:run-3';
    let result = await controller(root, 'next');
    assert.match(result.stdout, /task-plan/);
    await assert.rejects(
      () => controller(root, 'claim', 'task-plan', '--worker', 'codex:reviewer-node:wrong-role'),
      (error) => error.stderr.includes('requires role role-node, not reviewer-node'),
    );
    await controller(root, 'claim', 'task-plan', '--worker', planner);
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'plan.md'), '# Plan\n');
    await assert.rejects(
      () => controller(root, 'check', 'task-plan', '--worker', builder),
      (error) => error.stderr.includes(`belongs to worker ${planner}`),
    );
    await controller(root, 'check', 'task-plan', '--worker', planner);
    await controller(root, 'accept', 'task-plan', '--worker', planner);
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'accept plan');

    result = await controller(root, 'next');
    assert.match(result.stdout, /task-build/);
    await controller(root, 'claim', 'task-build', '--worker', builder);
    await writeFile(join(root, 'outside.txt'), 'not allowed\n');
    await assert.rejects(
      () => controller(root, 'check', 'task-build', '--worker', builder),
      (error) => error.stderr.includes('Paths outside TOUCH: outside.txt'),
    );
    await rm(join(root, 'outside.txt'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'app.js'), 'export const built = true;\n');
    await controller(root, 'check', 'task-build', '--worker', builder);
    await controller(root, 'accept', 'task-build', '--worker', builder);
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'accept build');

    result = await controller(root, 'next');
    assert.match(result.stdout, /task-verify/);
    await assert.rejects(
      () => controller(root, 'claim', 'task-verify', '--worker', builder),
      (error) => error.stderr.includes('requires role reviewer-node, not role-node'),
    );
    await controller(root, 'claim', 'task-verify', '--worker', verifier);
    await controller(root, 'check', 'task-verify', '--worker', verifier);
    await controller(root, 'accept', 'task-verify', '--worker', verifier);
    result = await controller(root, 'status');
    assert.equal(JSON.parse(result.stdout).status, 'complete');
    const evidence = JSON.parse(await readFile(join(root, '.factory', 'evidence', 'task-build.json'), 'utf8'));
    assert.deepEqual(evidence.changedPaths, ['src/app.js']);
    assert.equal(evidence.receipts[0].exitCode, 0);
    assert.equal(evidence.workerId, builder);
    assert.equal(evidence.roleId, 'role-node');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('python controller catches acceptance commands that write outside TOUCH', async () => {
  const state = fixtureState();
  state.executionGraph.nodes[0].attributes.acceptanceCommands = [{
    argv: ['node', '-e', "require('node:fs').writeFileSync('outside-from-check.txt', 'bad')"],
  }];
  const root = await setupRepository(state);
  try {
    const worker = 'cursor:role-node:run-1';
    await controller(root, 'claim', 'task-plan', '--worker', worker);
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'plan.md'), '# Plan\n');
    await assert.rejects(
      () => controller(root, 'check', 'task-plan', '--worker', worker),
      (error) => error.stderr.includes('Acceptance commands changed paths outside TOUCH'),
    );
    const evidence = JSON.parse(await readFile(join(root, '.factory', 'evidence', 'task-plan.json'), 'utf8'));
    assert.equal(evidence.status, 'failed');
    assert.ok(evidence.changedPaths.includes('outside-from-check.txt'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('python controller records blocking drift without inventing a repair', async () => {
  const root = await setupRepository();
  try {
    const worker = 'codex:role-node:run-1';
    await controller(root, 'claim', 'task-plan', '--worker', worker);
    await controller(
      root,
      'report-drift',
      'task-plan',
      '--worker',
      worker,
      'Required API decision is missing.',
    );
    const drift = JSON.parse(await readFile(join(root, '.factory', 'drift', 'task-plan.json'), 'utf8'));
    assert.equal(drift.status, 'blocking');
    assert.equal(drift.reason, 'Required API decision is missing.');
    assert.equal(drift.workerId, worker);
    const status = JSON.parse((await controller(root, 'status')).stdout);
    assert.equal(status.counts.drift, 1);
    assert.deepEqual(status.next, []);
    const runtime = JSON.parse(await readFile(join(root, '.factory', 'runtime.json'), 'utf8'));
    assert.deepEqual(runtime.events.map((event) => event.type), ['claim', 'drift']);
    assert.equal(runtime.events.at(-1).outcome, 'drift');
    assert.deepEqual(runtime.nodes['task-plan'].evidenceRefs, ['.factory/drift/task-plan.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
