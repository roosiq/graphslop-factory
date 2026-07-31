import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  ProjectConversationStateSchema,
  SolutionArtifactHandoffDraftSchema,
  type GraphNode,
  type ProjectConversationState,
  type SolutionArtifactHandoffDraft,
} from '@graphslop/contracts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type PortableArtifact = Readonly<SolutionArtifactHandoffDraft>;

export type PortableTask = Readonly<{
  id: string;
  taskFile: string;
  type: string;
  roleId: string;
  roleFile: string;
  role: string;
  job: string;
  use: readonly string[];
  touch: readonly string[];
  dont: readonly string[];
  done: readonly string[];
  dependencies: readonly string[];
  requiredArtifacts: readonly PortableArtifact[];
  producedArtifacts: readonly PortableArtifact[];
  solutionNodeIds: readonly string[];
  acceptanceCommands: readonly Readonly<{ argv: readonly string[]; cwd?: string }>[];
}>;

export type PortableRole = Readonly<{
  id: string;
  roleFile: string;
  name: string;
  intentNodeIds: readonly string[];
  job: string;
  use: readonly string[];
  touch: readonly string[];
  dont: readonly string[];
  done: readonly string[];
}>;

export type PortableDependencyEdge = Readonly<{
  id: string;
  type: 'DEPENDS_ON';
  kind: string;
  sourceTaskId: string;
  targetTaskId: string;
  artifacts: readonly PortableArtifact[];
}>;

export type BuildPackManifest = Readonly<{
  schemaVersion: '1.2.0';
  projectId: string;
  intentBaseline: Readonly<{ id: string; contentHash: string }>;
  solutionBaseline: Readonly<{ id: string; contentHash: string }>;
  executionHash: string;
  roles: readonly PortableRole[];
  tasks: readonly PortableTask[];
  dependencyEdges: readonly PortableDependencyEdge[];
}>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function commands(value: unknown): { argv: string[]; cwd?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const argv = strings(record.argv);
    if (argv.length === 0) return [];
    return [{ argv, ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}) }];
  });
}

function artifacts(value: unknown): PortableArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => SolutionArtifactHandoffDraftSchema.parse(item));
}

function extractState(value: unknown): ProjectConversationState {
  const candidate = value && typeof value === 'object' && 'state' in value
    ? (value as { state: unknown }).state
    : value;
  return ProjectConversationStateSchema.parse(candidate);
}

function relevantSolutionNode(state: ProjectConversationState, task: GraphNode): GraphNode | undefined {
  const solutionNodeId = typeof task.attributes.solutionNodeId === 'string'
    ? task.attributes.solutionNodeId
    : undefined;
  return state.solutionGraph?.nodes.find((node) => node.id === solutionNodeId);
}

function approvedIntentBaselineNodes(state: ProjectConversationState): readonly GraphNode[] {
  const baseline = state.approvedBaselines.find((item) =>
    item.graphKind === 'intent'
    && item.baselineId === state.project.activeIntentBaselineId
    && item.snapshotId === state.intentGraph?.snapshotId
    && item.snapshotContentHash === state.intentGraph?.contentHash);
  if (!baseline || !state.intentGraph) throw new Error('Exact approved Intent baseline is required.');
  const memberIds = new Set(baseline.nodeVersions.map((node) => node.nodeId));
  return state.intentGraph.nodes.filter((node) => memberIds.has(node.id));
}

function portableRole(node: GraphNode): PortableRole {
  return {
    id: node.id,
    roleFile: `roles/${portableStem(node.id)}.md`,
    name: node.statementOrName,
    intentNodeIds: strings(node.attributes.intentNodeIds),
    job: typeof node.attributes.job === 'string' ? node.attributes.job : `Use the ${node.statementOrName} lens.`,
    use: strings(node.attributes.use),
    touch: strings(node.attributes.touch),
    dont: strings(node.attributes.dont),
    done: strings(node.attributes.done),
  };
}

function makeTask(state: ProjectConversationState, task: GraphNode): PortableTask {
  const solutionNode = relevantSolutionNode(state, task);
  const roleId = typeof task.attributes.roleRef === 'string' ? task.attributes.roleRef : '';
  const roleNode = state.solutionGraph?.nodes.find((node) => node.id === roleId && node.type === 'Role');
  if (!roleNode) throw new Error(`Task ${task.id} has no approved Role node.`);
  const dependencyIds = state.executionGraph?.edges
    .filter((edge) => edge.type === 'DEPENDS_ON' && edge.sourceNodeRef.nodeId === task.id)
    .map((edge) => edge.targetNodeRef.nodeId) ?? [];
  const incomingHandoffs = state.executionGraph?.edges
    .filter((edge) => edge.type === 'DEPENDS_ON' && edge.sourceNodeRef.nodeId === task.id)
    .flatMap((edge) => artifacts(edge.attributes.artifacts)) ?? [];
  const outgoingHandoffs = state.executionGraph?.edges
    .filter((edge) => edge.type === 'DEPENDS_ON' && edge.targetNodeRef.nodeId === task.id)
    .flatMap((edge) => artifacts(edge.attributes.artifacts)) ?? [];
  const constraints = approvedIntentBaselineNodes(state)
    .filter((node) => node.type === 'Constraint')
    .map((node) => node.statementOrName) ?? [];
  const exclusions = approvedIntentBaselineNodes(state)
    .filter((node) => node.type === 'Exclusion')
    .map((node) => node.statementOrName) ?? [];
  const acceptedCommands = commands(task.attributes.acceptanceCommands);
  return {
    id: task.id,
    taskFile: `tasks/${portableStem(task.id)}.md`,
    type: task.type,
    roleId: roleNode.id,
    roleFile: `roles/${portableStem(roleNode.id)}.md`,
    role: roleNode.statementOrName,
    job: typeof task.attributes.objective === 'string' ? task.attributes.objective : task.statementOrName,
    use: [
      `Approved Intent: ${state.project.activeIntentBaselineId}.`,
      `Approved Solution: ${state.project.activeSolutionBaselineId}.`,
      ...(solutionNode ? [`Solution node: ${solutionNode.statementOrName}.`] : []),
      `Role file: roles/${portableStem(roleNode.id)}.md.`,
      ...strings(roleNode.attributes.use),
    ],
    touch: strings(task.attributes.allowedPaths),
    dont: [
      'Change approved intent.',
      'Add unapproved scope.',
      'Push, merge, publish, or deploy.',
      ...strings(roleNode.attributes.dont),
      ...constraints,
      ...exclusions,
    ],
    done: [
      ...strings(task.attributes.acceptanceChecks),
      ...strings(roleNode.attributes.done),
      ...(acceptedCommands.length ? ['Run every acceptance command successfully.'] : []),
      'Return changed files and check results as evidence.',
    ],
    dependencies: dependencyIds,
    requiredArtifacts: incomingHandoffs,
    producedArtifacts: outgoingHandoffs,
    solutionNodeIds: solutionNode ? [solutionNode.id] : [],
    acceptanceCommands: acceptedCommands,
  };
}

function roleMarkdown(role: PortableRole): string {
  const section = (name: string, values: readonly string[]) => [
    `## ${name}`,
    '',
    ...(values.length ? values.map((value) => `- ${value}`) : ['- Nothing.']),
    '',
  ];
  return [
    `# ${role.name}`,
    '',
    ...section('JOB', [role.job]),
    ...section('USE', role.use),
    ...section('TOUCH', role.touch),
    ...section("DON'T", role.dont),
    ...section('DONE', role.done),
  ].join('\n');
}

function idHash(id: string): string {
  let hash = 2_166_136_261;
  for (const character of id) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function portableStem(id: string): string {
  if (/^[a-z][a-z0-9-]*$/.test(id) && id.length <= 80) return id;
  const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'role';
  const suffix = idHash(id);
  return `${slug.slice(0, 70 - suffix.length).replace(/-+$/g, '')}-${suffix}`;
}

function agentSlug(id: string): string {
  const direct = `graphslop-${id}`;
  if (/^[a-z][a-z0-9-]*$/.test(id) && direct.length <= 64) return direct;
  const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'role';
  const suffix = idHash(id);
  return `graphslop-${slug.slice(0, 53 - suffix.length).replace(/-+$/g, '')}-${suffix}`;
}

function roleInstructions(role: PortableRole): string {
  return [
    roleMarkdown(role),
    '## RUN',
    '',
    '- Read the assigned file in `.factory/tasks/`.',
    '- Do one task. Keep the same worker ID for claim, check, and accept. Then stop.',
    '- Do not choose a different task. Do not edit `.factory/` by hand.',
    '',
  ].join('\n');
}

function codexRoleAgent(role: PortableRole, readOnly: boolean): string {
  return [
    `name = ${JSON.stringify(agentSlug(role.id))}`,
    `description = ${JSON.stringify(`Run Graphslop tasks assigned to ${role.name}.`)}`,
    `developer_instructions = ${JSON.stringify(roleInstructions(role))}`,
    `sandbox_mode = ${JSON.stringify(readOnly ? 'read-only' : 'workspace-write')}`,
    '',
  ].join('\n');
}

function claudeRoleAgent(role: PortableRole, readOnly: boolean): string {
  return [
    '---',
    `name: ${agentSlug(role.id)}`,
    `description: ${JSON.stringify(`Run Graphslop tasks assigned to ${role.name}.`)}`,
    `tools: ${readOnly ? 'Read, Grep, Glob, Bash' : 'Read, Grep, Glob, Bash, Edit, Write'}`,
    'model: inherit',
    'skills:',
    '  - graphslop-build-pack',
    '---',
    '',
    roleInstructions(role),
    '',
  ].join('\n');
}

function cursorRoleAgent(role: PortableRole, readOnly: boolean): string {
  return [
    '---',
    `name: ${agentSlug(role.id)}`,
    `description: ${JSON.stringify(`Run Graphslop tasks assigned to ${role.name}.`)}`,
    'model: inherit',
    `readonly: ${readOnly}`,
    '---',
    '',
    roleInstructions(role),
    '',
  ].join('\n');
}

function requireApprovedState(state: ProjectConversationState) {
  if (!state.intentGraph || !state.solutionGraph || !state.executionGraph) {
    throw new Error('Intent, Solution, and Execution graphs are required.');
  }
  const intent = state.approvedBaselines.find((baseline) =>
    baseline.graphKind === 'intent'
    && baseline.baselineId === state.project.activeIntentBaselineId
    && baseline.snapshotContentHash === state.intentGraph?.contentHash);
  const solution = state.approvedBaselines.find((baseline) =>
    baseline.graphKind === 'solution'
    && baseline.baselineId === state.project.activeSolutionBaselineId
    && baseline.snapshotContentHash === state.solutionGraph?.contentHash);
  if (!intent || !solution) throw new Error('Exact approved Intent and Solution baselines are required.');
  return { intent, solution };
}

function factoryYaml(manifest: BuildPackManifest): string {
  return [
    'schema_version: "1.2.0"',
    `project_id: ${JSON.stringify(manifest.projectId)}`,
    'intent_baseline:',
    `  id: ${JSON.stringify(manifest.intentBaseline.id)}`,
    `  content_hash: ${JSON.stringify(manifest.intentBaseline.contentHash)}`,
    'solution_baseline:',
    `  id: ${JSON.stringify(manifest.solutionBaseline.id)}`,
    `  content_hash: ${JSON.stringify(manifest.solutionBaseline.contentHash)}`,
    `execution_hash: ${JSON.stringify(manifest.executionHash)}`,
    `role_count: ${manifest.roles.length}`,
    `task_count: ${manifest.tasks.length}`,
    'controller: factory.py',
    '',
  ].join('\n');
}

function taskMarkdown(task: PortableTask): string {
  const section = (name: string, values: readonly string[]) => [
    `## ${name}`,
    '',
    ...(values.length ? values.map((value) => `- ${value}`) : ['- Nothing.']),
    '',
  ];
  return [
    `# ${task.id}`,
    '',
    ...section('ROLE', [`${task.role} (${task.roleId})`]),
    ...section('JOB', [task.job]),
    ...section('USE', task.use),
    ...section('TOUCH', task.touch),
    ...section("DON'T", task.dont),
    ...section('DONE', task.done),
    ...section('REQUIRED ARTIFACTS', task.requiredArtifacts.map((artifact) =>
      `${artifact.key} (${artifact.type}): ${artifact.description}; files: ${artifact.paths.join(', ')}; evidence: ${artifact.requiredEvidence.join(', ')}`)),
    ...section('PRODUCED ARTIFACTS', task.producedArtifacts.map((artifact) =>
      `${artifact.key} (${artifact.type}): ${artifact.description}; files: ${artifact.paths.join(', ')}; evidence: ${artifact.requiredEvidence.join(', ')}`)),
    '## ORDER',
    '',
    ...(task.dependencies.length ? task.dependencies.map((id) => `- After ${id}`) : ['- Ready first.']),
    '',
  ].join('\n');
}

const skillMarkdown = `---
name: graphslop-build-pack
description: Run an approved Graphslop .factory build pack task by task. Use when a repository contains .factory/execution.json and the user asks to build, continue, implement, verify, repair, or inspect factory work.
---

# Graphslop build pack

Use \`.factory/factory.py\`. Graph is boss.

1. Run \`python .factory/factory.py next\`.
2. Read the named task and Role.
3. Hand the task to a fresh matching Role agent when the harness supports agents.
4. Make a unique worker ID: \`HARNESS:ROLE_ID:INVOCATION\`.
5. Run \`python .factory/factory.py claim <task-id> --worker <worker-id>\`.
6. Do only JOB. Use only USE. Touch only TOUCH. Obey DON'T.
7. Run \`python .factory/factory.py check <task-id> --worker <worker-id>\`.
8. Run \`python .factory/factory.py accept <task-id> --worker <worker-id>\`.
9. Stop that worker. Run \`next\` before the next handoff.

If work cannot match the graph, run \`report-drift\` with the same worker ID.
Never edit \`.factory/\` by hand. Never skip a dependency. Never reuse the
implementation worker for its Verify task.
`;

const skillOpenAiYaml = `interface:
  display_name: "Run Graphslop build pack"
  short_description: "Run approved graph tasks without intent drift"
  default_prompt: "Use $graphslop-build-pack to run the next approved task."
policy:
  allow_implicit_invocation: true
`;

const runMarkdown = `# Run this build pack

Unzip the pack at the repository root. The \`.factory/\` directory is the approved
build contract. The other generated folders let Codex, Claude Code, and Cursor
discover the same skill and Role agents.

\`\`\`bash
python .factory/factory.py status
python .factory/factory.py next
\`\`\`

For every task:

\`\`\`bash
python .factory/factory.py claim TASK_ID --worker HARNESS:ROLE_ID:INVOCATION
# Do JOB. Obey TOUCH and DON'T.
python .factory/factory.py check TASK_ID --worker HARNESS:ROLE_ID:INVOCATION
python .factory/factory.py accept TASK_ID --worker HARNESS:ROLE_ID:INVOCATION
\`\`\`

Use \`$graphslop-build-pack\` in Codex, \`/graphslop-build-pack\` in Claude Code,
or \`/graphslop-build-pack\` in Cursor. Copy ROLE_ID from the task.
Each Role handoff gets a fresh invocation and a new worker ID.

The controller requires a clean Git worktree at claim time. Commit accepted work
before claiming the next task. It enforces the assigned Role, dependency order,
worker separation, allowed paths, acceptance commands, evidence records, and
completion state. It does not push, merge, publish, deploy, or grant external
credentials.
`;

const cursorRule = `---
description: Protect the approved Graphslop build contract
alwaysApply: true
---

When \`.factory/execution.json\` exists, use the \`graphslop-build-pack\` skill for
factory work. Treat \`.factory/\` as authority. Do not edit it by hand or invent
work outside the active task.
`;

const controllerPython = String.raw`#!/usr/bin/env python3
"""Tiny dependency and evidence controller for a Graphslop build pack."""
from __future__ import annotations

import datetime as dt
import fnmatch
import hashlib
import json
import os
import pathlib
import subprocess
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
EXECUTION = ROOT / "execution.json"
RUNTIME = ROOT / "runtime.json"
EVIDENCE = ROOT / "evidence"
DRIFT = ROOT / "drift"
STATE_ROOT = pathlib.Path(
    os.environ.get(
        "GRAPHSLOP_STATE_ROOT",
        pathlib.Path(os.environ.get("XDG_STATE_HOME", pathlib.Path.home() / ".local" / "state"))
        / "graphslop" / "build-packs",
    )
)

def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)

def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()

def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def file_digest(path: pathlib.Path) -> str:
    return digest_bytes(path.read_bytes())

def authority_path(execution: dict[str, Any]) -> pathlib.Path:
    repository_key = digest_bytes(str(REPO.resolve()).encode("utf-8"))[:16]
    return STATE_ROOT / repository_key / f"run-{execution['executionHash'][:24]}.json"

def initial_runtime_is_pristine(runtime: dict[str, Any]) -> bool:
    return (
        not runtime.get("events")
        and all(
            node.get("status") == "pending"
            and node.get("attempt") == 0
            and node.get("workerId") is None
            and not node.get("evidenceRefs")
            and not node.get("producedArtifacts")
            for node in runtime.get("nodes", {}).values()
        )
        and all(
            edge.get("status") == "pending"
            and not edge.get("satisfiedArtifactKeys")
            and not edge.get("evidenceRefs")
            for edge in runtime.get("edges", [])
        )
    )

def load() -> tuple[dict[str, Any], dict[str, Any]]:
    execution = read_json(EXECUTION)
    mirror = read_json(RUNTIME)
    authority = authority_path(execution)
    if authority.exists():
        runtime = read_json(authority)
        if mirror != runtime:
            write_json(RUNTIME, runtime)
    else:
        if not initial_runtime_is_pristine(mirror):
            fail("Initial Runtime graph was edited before the controller established authority.")
        runtime = mirror
        write_json(authority, runtime)
    expected_run = f"run-{execution['executionHash'][:24]}"
    if (
        runtime.get("schemaVersion") != "1.2.0"
        or runtime.get("projectionKind") != "execution_run"
        or runtime.get("runId") != expected_run
        or runtime.get("executionHash") != execution["executionHash"]
        or runtime.get("intentBaseline") != execution["intentBaseline"]
        or runtime.get("solutionBaseline") != execution["solutionBaseline"]
        or not isinstance(runtime.get("nodes"), dict)
        or not isinstance(runtime.get("edges"), list)
        or not isinstance(runtime.get("events"), list)
    ):
        fail("Runtime graph is not bound to this Execution graph.")
    task_ids = {task["id"] for task in execution["tasks"]}
    if set(runtime["nodes"]) != task_ids:
        fail("Runtime nodes do not match the Execution tasks.")
    expected_edges = {edge["id"]: edge for edge in execution.get("dependencyEdges", [])}
    actual_edges = {
        edge.get("id"): edge
        for edge in runtime["edges"]
        if isinstance(edge, dict) and isinstance(edge.get("id"), str)
    }
    if len(actual_edges) != len(runtime["edges"]) or set(actual_edges) != set(expected_edges):
        fail("Runtime edges do not match the Execution dependencies.")
    for task_id, node in runtime["nodes"].items():
        if (
            node.get("taskId") != task_id
            or node.get("status") not in {"pending", "running", "checked", "accepted", "drift"}
            or not isinstance(node.get("attempt"), int)
            or node.get("attempt", -1) < 0
            or not isinstance(node.get("timestamps"), dict)
            or not isinstance(node.get("evidenceRefs"), list)
            or not isinstance(node.get("producedArtifacts"), list)
            or not (node.get("workerId") is None or isinstance(node.get("workerId"), str))
        ):
            fail("Runtime node shape is invalid.")
    for edge in runtime["edges"]:
        expected_edge = expected_edges.get(edge.get("id"), {})
        if (
            not isinstance(edge, dict)
            or not isinstance(edge.get("id"), str)
            or edge.get("sourceTaskId") not in task_ids
            or edge.get("targetTaskId") not in task_ids
            or edge.get("status") not in {"pending", "satisfied", "blocked"}
            or not isinstance(edge.get("artifacts"), list)
            or not isinstance(edge.get("satisfiedArtifactKeys"), list)
            or not isinstance(edge.get("evidenceRefs"), list)
            or edge.get("type") != "DEPENDS_ON"
            or edge.get("sourceTaskId") != expected_edge.get("sourceTaskId")
            or edge.get("targetTaskId") != expected_edge.get("targetTaskId")
            or edge.get("kind") != expected_edge.get("kind")
            or edge.get("artifacts") != expected_edge.get("artifacts")
        ):
            fail("Runtime edge shape is invalid.")
    for item in runtime["events"]:
        if (
            not isinstance(item, dict)
            or item.get("type") not in {"claim", "check", "accept", "drift"}
            or item.get("taskId") not in task_ids
            or not isinstance(item.get("workerId"), str)
            or not isinstance(item.get("timestamp"), str)
            or not isinstance(item.get("outcome"), str)
            or not isinstance(item.get("evidenceRefs"), list)
        ):
            fail("Runtime event shape is invalid.")
    return execution, runtime

def persist_runtime(runtime: dict[str, Any]) -> None:
    runtime["tasks"] = {
        task_id: dict(record)
        for task_id, record in runtime["nodes"].items()
    }
    execution = read_json(EXECUTION)
    authoritative = authority_path(execution)
    write_json(authoritative, runtime)
    try:
        authoritative.chmod(0o600)
    except OSError:
        pass
    write_json(RUNTIME, runtime)

def event(
    runtime: dict[str, Any],
    event_type: str,
    task_id: str,
    worker_id: str,
    at: str,
    outcome: str,
    evidence_refs: list[str] | None = None,
) -> None:
    runtime["events"].append({
        "id": f"event-{len(runtime['events']) + 1}",
        "type": event_type,
        "taskId": task_id,
        "workerId": worker_id,
        "timestamp": at,
        "outcome": outcome,
        "evidenceRefs": evidence_refs or [],
    })

def task_by_id(execution: dict[str, Any], task_id: str) -> dict[str, Any]:
    for task in execution["tasks"]:
        if task["id"] == task_id:
            return task
    fail(f"Unknown task: {task_id}")

def task_artifact_stem(task: dict[str, Any]) -> str:
    return pathlib.PurePosixPath(task["taskFile"]).stem

def ready_tasks(execution: dict[str, Any], runtime: dict[str, Any]) -> list[dict[str, Any]]:
    states = runtime["nodes"]
    traversed = {
        (edge["sourceTaskId"], edge["targetTaskId"])
        for edge in runtime["edges"]
        if edge.get("status") == "satisfied"
    }
    return sorted([
        task for task in execution["tasks"]
        if states[task["id"]]["status"] == "pending"
        and all(states[item]["status"] == "accepted" for item in task["dependencies"])
        and all((task["id"], item) in traversed for item in task["dependencies"])
    ], key=lambda task: task["id"])

def run_git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=REPO, text=True, capture_output=True)
    if result.returncode:
        fail(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()

def changed_paths() -> list[str]:
    tracked = run_git("diff", "--name-only", "HEAD").splitlines()
    untracked = run_git("ls-files", "--others", "--exclude-standard").splitlines()
    return sorted({
        path for path in [*tracked, *untracked]
        if path and not path.startswith(".factory/runtime.json")
        and not path.startswith(".factory/evidence/")
        and not path.startswith(".factory/drift/")
    })

def allowed(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)

def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)

def require_task_state(runtime: dict[str, Any], task_id: str, expected: str) -> None:
    actual = runtime["nodes"].get(task_id, {}).get("status")
    if actual != expected:
        fail(f"{task_id} is {actual or 'unknown'}, expected {expected}.")

def require_worker(runtime: dict[str, Any], task_id: str, worker_id: str) -> None:
    expected = runtime["nodes"].get(task_id, {}).get("workerId")
    if expected != worker_id:
        fail(f"{task_id} belongs to worker {expected or 'unknown'}, not {worker_id}.")

def parse_worker(argv: list[str], command: str) -> str:
    if len(argv) != 5 or argv[3] != "--worker":
        fail(f"Usage: factory.py {command} TASK_ID --worker HARNESS:ROLE_ID:INVOCATION")
    worker_id = argv[4].strip()
    if not worker_id or len(worker_id) > 200 or any(char.isspace() for char in worker_id):
        fail("Worker ID must be 1-200 non-space characters.")
    worker_role(worker_id)
    return worker_id

def worker_role(worker_id: str) -> str:
    first = worker_id.find(":")
    last = worker_id.rfind(":")
    if first <= 0 or last <= first + 1 or last >= len(worker_id) - 1:
        fail("Worker ID must use HARNESS:ROLE_ID:INVOCATION.")
    return worker_id[first + 1:last]

def producer_workers(
    execution: dict[str, Any],
    runtime: dict[str, Any],
    task: dict[str, Any],
) -> set[str]:
    if task["type"] != "Verify":
        return set()
    solution_ids = set(task["solutionNodeIds"])
    return {
        str(runtime["nodes"][candidate["id"]]["workerId"])
        for candidate in execution["tasks"]
        if candidate["type"] == "Implement"
        and solution_ids.intersection(candidate["solutionNodeIds"])
        and runtime["nodes"][candidate["id"]].get("status") == "accepted"
        and runtime["nodes"][candidate["id"]].get("workerId")
    }

def status(execution: dict[str, Any], runtime: dict[str, Any]) -> None:
    counts: dict[str, int] = {}
    for record in runtime["nodes"].values():
        counts[record["status"]] = counts.get(record["status"], 0) + 1
    complete = counts.get("accepted", 0) == len(execution["tasks"])
    print(json.dumps({
        "projectId": execution["projectId"],
        "status": "complete" if complete else "in_progress",
        "counts": counts,
        "next": [task["id"] for task in ready_tasks(execution, runtime)],
    }, indent=2))

def next_task(execution: dict[str, Any], runtime: dict[str, Any]) -> None:
    ready = ready_tasks(execution, runtime)
    if not ready:
        status(execution, runtime)
        return
    task = ready[0]
    print(json.dumps({"task": task, "taskFile": f".factory/{task['taskFile']}"}, indent=2))

def claim(
    execution: dict[str, Any],
    runtime: dict[str, Any],
    task_id: str,
    worker_id: str,
) -> None:
    require_task_state(runtime, task_id, "pending")
    ready = {task["id"] for task in ready_tasks(execution, runtime)}
    if task_id not in ready:
        fail(f"{task_id} is blocked by dependencies.")
    task = task_by_id(execution, task_id)
    claimed_role = worker_role(worker_id)
    if claimed_role != task["roleId"]:
        fail(f"{task_id} requires role {task['roleId']}, not {claimed_role}.")
    if changed_paths():
        fail("Claim requires a clean Git worktree. Commit accepted work or stash unrelated changes first.")
    if worker_id in producer_workers(execution, runtime, task):
        fail(f"{task_id} needs a fresh verifier worker. {worker_id} built the feature.")
    claimed_at = now()
    runtime["nodes"][task_id] = {
        **runtime["nodes"][task_id],
        "status": "running",
        "attempt": int(runtime["nodes"][task_id].get("attempt", 0)) + 1,
        "claimedAt": claimed_at,
        "baseCommit": run_git("rev-parse", "HEAD"),
        "workerId": worker_id,
        "roleId": task["roleId"],
        "timestamps": {**runtime["nodes"][task_id].get("timestamps", {}), "claimedAt": claimed_at},
    }
    event(runtime, "claim", task_id, worker_id, claimed_at, "running")
    persist_runtime(runtime)
    print(f"Claimed {task_id} for {worker_id}.")

def check(
    execution: dict[str, Any],
    runtime: dict[str, Any],
    task_id: str,
    worker_id: str,
) -> None:
    require_task_state(runtime, task_id, "running")
    require_worker(runtime, task_id, worker_id)
    task = task_by_id(execution, task_id)
    changes = changed_paths()
    violations = [path for path in changes if not allowed(path, task["touch"])]
    if violations:
        fail("Paths outside TOUCH: " + ", ".join(violations))
    receipts = []
    for command in task["acceptanceCommands"]:
        cwd = REPO / command.get("cwd", ".")
        result = subprocess.run(command["argv"], cwd=cwd, text=True, capture_output=True)
        receipts.append({
            "argv": command["argv"],
            "cwd": command.get("cwd", "."),
            "exitCode": result.returncode,
            "stdout": result.stdout[-20000:],
            "stderr": result.stderr[-20000:],
        })
        if result.returncode:
            failed_at = now()
            failed_file = f".factory/evidence/{task_artifact_stem(task)}.json"
            write_json(REPO / failed_file, {
                "schemaVersion": "1.1.0",
                "taskId": task_id, "status": "failed", "checkedAt": failed_at,
                "workerId": worker_id, "roleId": task["roleId"],
                "changedPaths": changed_paths(), "receipts": receipts,
            })
            event(runtime, "check", task_id, worker_id, failed_at, "failed", [failed_file])
            persist_runtime(runtime)
            fail(f"Acceptance command failed for {task_id}: {' '.join(command['argv'])}")
    changes = changed_paths()
    violations = [path for path in changes if not allowed(path, task["touch"])]
    if violations:
        failed_at = now()
        failed_file = f".factory/evidence/{task_artifact_stem(task)}.json"
        write_json(REPO / failed_file, {
            "schemaVersion": "1.1.0",
            "taskId": task_id, "status": "failed", "checkedAt": failed_at,
            "workerId": worker_id, "roleId": task["roleId"],
            "changedPaths": changes, "receipts": receipts,
        })
        event(runtime, "check", task_id, worker_id, failed_at, "failed", [failed_file])
        persist_runtime(runtime)
        fail("Acceptance commands changed paths outside TOUCH: " + ", ".join(violations))
    evidence_file = f".factory/evidence/{task_artifact_stem(task)}.json"
    produced_artifacts = []
    for artifact in task.get("producedArtifacts", []):
        matched_files = sorted({
            path for path in artifact["paths"]
            if (REPO / path).is_file()
        })
        if not matched_files:
            fail(f"Produced artifact {artifact['key']} has no file at its declared paths.")
        file_records = [
            {"path": path, "sha256": file_digest(REPO / path)}
            for path in matched_files
        ]
        refs = []
        for requirement in artifact["requiredEvidence"]:
            if requirement == "file_hash":
                refs.extend({
                    "requirement": requirement,
                    "kind": "file_hash",
                    "path": item["path"],
                    "sha256": item["sha256"],
                    "ref": f"{evidence_file}#/producedArtifacts/{artifact['key']}/files/{item['path']}",
                } for item in file_records)
            elif requirement == "independent_check":
                refs.append({
                    "requirement": requirement,
                    "kind": "acceptance_command",
                    "receiptIndex": 0,
                    "argv": receipts[0]["argv"],
                    "exitCode": receipts[0]["exitCode"],
                    "ref": f"{evidence_file}#/receipts/0",
                })
        produced_artifacts.append({
            **artifact,
            "files": file_records,
            "evidenceRefs": refs,
        })
    evidence = {
        "schemaVersion": "1.1.0",
        "taskId": task_id,
        "status": "checked",
        "checkedAt": now(),
        "workerId": worker_id,
        "roleId": task["roleId"],
        "baseCommit": runtime["nodes"][task_id]["baseCommit"],
        "intentBaseline": execution["intentBaseline"],
        "solutionBaseline": execution["solutionBaseline"],
        "executionHash": execution["executionHash"],
        "changedPaths": changes,
        "receipts": receipts,
        "producedArtifacts": produced_artifacts,
    }
    write_json(REPO / evidence_file, evidence)
    node = runtime["nodes"][task_id]
    node["status"] = "checked"
    node["checkedAt"] = evidence["checkedAt"]
    node["timestamps"]["checkedAt"] = evidence["checkedAt"]
    node["evidenceRefs"] = [evidence_file]
    node["evidenceHash"] = file_digest(REPO / evidence_file)
    node["producedArtifacts"] = evidence["producedArtifacts"]
    event(runtime, "check", task_id, worker_id, evidence["checkedAt"], "checked", [evidence_file])
    persist_runtime(runtime)
    print(f"Checked {task_id}. Evidence: {evidence_file}")

def accept(execution: dict[str, Any], runtime: dict[str, Any], task_id: str, worker_id: str) -> None:
    require_task_state(runtime, task_id, "checked")
    require_worker(runtime, task_id, worker_id)
    accepted_at = now()
    node = runtime["nodes"][task_id]
    evidence_refs = node.get("evidenceRefs", [])
    evidence_path = REPO / evidence_refs[0] if len(evidence_refs) == 1 else None
    evidence = read_json(evidence_path) if evidence_path and evidence_path.exists() else None
    evidence_valid = (
        isinstance(evidence, dict)
        and evidence.get("taskId") == task_id
        and evidence.get("workerId") == worker_id
        and evidence.get("status") == "checked"
        and file_digest(evidence_path) == node.get("evidenceHash")
        and evidence.get("producedArtifacts") == node.get("producedArtifacts")
        and all(
            receipt.get("exitCode") == 0
            for receipt in evidence.get("receipts", [])
        )
    )
    if not evidence_valid:
        rejected_at = now()
        node["status"] = "running"
        node["evidenceRefs"] = []
        node["producedArtifacts"] = []
        node.pop("evidenceHash", None)
        for edge in runtime["edges"]:
            if edge["targetTaskId"] == task_id:
                edge["status"] = "blocked"
                edge["blockedArtifactKeys"] = sorted(
                    contract["key"] for contract in edge.get("artifacts", [])
                )
        event(runtime, "accept", task_id, worker_id, rejected_at, "rejected")
        persist_runtime(runtime)
        fail("Checked evidence is missing or changed. Run check again.")
    produced = {
        artifact["key"]: artifact
        for artifact in evidence.get("producedArtifacts", [])
    }
    blocked_keys = []
    for edge in runtime["edges"]:
        if edge["targetTaskId"] != task_id:
            continue
        missing = []
        evidence_refs = []
        satisfied_keys = []
        for contract in edge.get("artifacts", []):
            artifact = produced.get(contract["key"])
            refs = artifact.get("evidenceRefs", []) if artifact else []
            requirements = {ref.get("requirement") for ref in refs}
            required = set(contract.get("requiredEvidence", []))
            receipts = evidence.get("receipts", [])
            refs_are_bound = all(
                (
                    ref.get("kind") == "acceptance_command"
                    and isinstance(ref.get("receiptIndex"), int)
                    and 0 <= ref["receiptIndex"] < len(receipts)
                    and ref.get("argv") == receipts[ref["receiptIndex"]].get("argv")
                    and ref.get("exitCode") == 0
                    and receipts[ref["receiptIndex"]].get("exitCode") == 0
                ) or (
                    ref.get("kind") == "file_hash"
                    and isinstance(ref.get("path"), str)
                    and isinstance(ref.get("sha256"), str)
                    and (REPO / ref["path"]).is_file()
                    and file_digest(REPO / ref["path"]) == ref["sha256"]
                    and any(fnmatch.fnmatch(ref["path"], pattern) for pattern in contract["paths"])
                )
                for ref in refs
            )
            if not artifact or not required.issubset(requirements) or not refs_are_bound:
                missing.append(contract["key"])
            else:
                satisfied_keys.append(contract["key"])
                evidence_refs.extend(ref.get("ref") for ref in refs if ref.get("ref"))
        if missing:
            edge["status"] = "blocked"
            edge["blockedArtifactKeys"] = sorted(missing)
            blocked_keys.extend(missing)
        else:
            edge["status"] = "satisfied"
            edge["satisfiedAt"] = accepted_at
            edge["satisfiedArtifactKeys"] = sorted(satisfied_keys)
            edge["evidenceRefs"] = sorted(set(evidence_refs or node.get("evidenceRefs", [])))
    if blocked_keys:
        rejected_at = now()
        node["status"] = "running"
        node["evidenceRefs"] = []
        node["producedArtifacts"] = []
        node.pop("evidenceHash", None)
        event(runtime, "accept", task_id, worker_id, rejected_at, "rejected")
        persist_runtime(runtime)
        fail("Required handoff evidence is missing: " + ", ".join(sorted(set(blocked_keys))))
    node["status"] = "accepted"
    node["acceptedAt"] = accepted_at
    node["timestamps"]["acceptedAt"] = accepted_at
    event(runtime, "accept", task_id, worker_id, accepted_at, "accepted", node.get("evidenceRefs", []))
    persist_runtime(runtime)
    print(f"Accepted {task_id}.")

def report_drift(
    execution: dict[str, Any],
    runtime: dict[str, Any],
    task_id: str,
    worker_id: str,
    reason: str,
) -> None:
    current = runtime["nodes"].get(task_id, {}).get("status")
    if current not in {"running", "checked"}:
        fail(f"{task_id} cannot report drift from {current or 'unknown'}.")
    require_worker(runtime, task_id, worker_id)
    task = task_by_id(execution, task_id)
    record = {
        "schemaVersion": "1.1.0",
        "taskId": task_id, "status": "blocking", "reason": reason, "reportedAt": now(),
        "workerId": worker_id, "roleId": task["roleId"],
    }
    drift_file = f".factory/drift/{task_artifact_stem(task)}.json"
    write_json(REPO / drift_file, record)
    reported_at = record["reportedAt"]
    runtime["nodes"][task_id]["status"] = "drift"
    runtime["nodes"][task_id]["driftFile"] = drift_file
    runtime["nodes"][task_id]["timestamps"]["driftAt"] = reported_at
    runtime["nodes"][task_id]["evidenceRefs"] = sorted(set([
        *runtime["nodes"][task_id].get("evidenceRefs", []),
        drift_file,
    ]))
    event(runtime, "drift", task_id, worker_id, reported_at, "drift", [drift_file])
    persist_runtime(runtime)
    print(f"Recorded drift for {task_id}.")

def main(argv: list[str]) -> None:
    execution, runtime = load()
    command = argv[1] if len(argv) > 1 else "status"
    if command == "status":
        status(execution, runtime)
    elif command == "next":
        next_task(execution, runtime)
    elif command in {"claim", "check", "accept"}:
        worker_id = parse_worker(argv, command)
        {
            "claim": claim,
            "check": check,
            "accept": accept,
        }[command](execution, runtime, argv[2], worker_id)
    elif command == "report-drift":
        if len(argv) < 6 or argv[3] != "--worker":
            fail("Usage: factory.py report-drift TASK_ID --worker HARNESS:ROLE:INVOCATION REASON")
        worker_id = argv[4].strip()
        if not worker_id or len(worker_id) > 200 or any(char.isspace() for char in worker_id):
            fail("Worker ID must be 1-200 non-space characters.")
        report_drift(execution, runtime, argv[2], worker_id, " ".join(argv[5:]))
    else:
        fail(f"Unknown command: {command}")

if __name__ == "__main__":
    main(sys.argv)
`;

function jsonText(value: Json | object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export type BuildPackFiles = Readonly<Record<string, string>>;

export function createBuildPackFiles(input: unknown): Readonly<{
  manifest: BuildPackManifest;
  files: BuildPackFiles;
  harnessFiles: BuildPackFiles;
}> {
  const state = extractState(input);
  const { intent, solution } = requireApprovedState(state);
  const roles = state.solutionGraph!.nodes.filter((node) => node.type === 'Role').map(portableRole);
  if (roles.length === 0) throw new Error('Approved Solution has no Role nodes.');
  const tasks = state.executionGraph!.nodes.map((task) => makeTask(state, task));
  const dependencyEdges: PortableDependencyEdge[] = state.executionGraph!.edges
    .filter((edge) => edge.type === 'DEPENDS_ON')
    .map((edge) => ({
      id: edge.id,
      type: 'DEPENDS_ON',
      kind: typeof edge.attributes.kind === 'string' ? edge.attributes.kind : 'task_dependency',
      sourceTaskId: edge.sourceNodeRef.nodeId,
      targetTaskId: edge.targetNodeRef.nodeId,
      artifacts: artifacts(edge.attributes.artifacts),
    }));
  const features = state.solutionGraph!.nodes.filter((node) => node.type === 'Feature');
  for (const feature of features) {
    const featureTasks = tasks.filter((task) => task.solutionNodeIds.includes(feature.id));
    for (const type of ['Implement', 'Verify']) {
      if (!featureTasks.some((task) => task.type === type)) {
        throw new Error(`Feature ${feature.id} has no ${type} task.`);
      }
    }
    const implementRoles = new Set(featureTasks
      .filter((task) => task.type === 'Implement')
      .map((task) => task.roleId));
    if (!featureTasks.some((task) => task.type === 'Verify' && !implementRoles.has(task.roleId))) {
      throw new Error(`Feature ${feature.id} has no independent Verify role.`);
    }
  }
  const manifest: BuildPackManifest = {
    schemaVersion: '1.2.0',
    projectId: state.project.projectId,
    intentBaseline: { id: intent.baselineId, contentHash: intent.snapshotContentHash },
    solutionBaseline: { id: solution.baselineId, contentHash: solution.snapshotContentHash },
    executionHash: state.executionGraph!.contentHash,
    roles,
    tasks,
    dependencyEdges,
  };
  const runtimeNodes = Object.fromEntries(tasks.map((task) => [task.id, {
    taskId: task.id,
    type: task.type,
    roleId: task.roleId,
    status: 'pending',
    attempt: 0,
    workerId: null,
    timestamps: {},
    evidenceRefs: [],
    producedArtifacts: [],
  }]));
  const runtimeEdges = dependencyEdges.map((edge) => ({
      id: edge.id,
      type: edge.type,
      kind: edge.kind,
      sourceTaskId: edge.sourceTaskId,
      targetTaskId: edge.targetTaskId,
      artifacts: edge.artifacts,
      status: 'pending',
      satisfiedAt: null,
      satisfiedArtifactKeys: [],
      evidenceRefs: [],
    }));
  const runtime = {
    schemaVersion: '1.2.0',
    projectionKind: 'execution_run',
    runId: `run-${manifest.executionHash.slice(0, 24)}`,
    executionHash: manifest.executionHash,
    intentBaseline: manifest.intentBaseline,
    solutionBaseline: manifest.solutionBaseline,
    projectId: manifest.projectId,
    nodes: runtimeNodes,
    edges: runtimeEdges,
    events: [],
    tasks: runtimeNodes,
  };
  const harnessFiles: Record<string, string> = {
    '.agents/skills/graphslop-build-pack/SKILL.md': skillMarkdown,
    '.agents/skills/graphslop-build-pack/agents/openai.yaml': skillOpenAiYaml,
    '.claude/skills/graphslop-build-pack/SKILL.md': skillMarkdown,
    '.cursor/skills/graphslop-build-pack/SKILL.md': skillMarkdown,
    '.cursor/rules/graphslop.mdc': cursorRule,
  };
  for (const role of roles) {
    const assignedTasks = tasks.filter((task) => task.roleId === role.id);
    const readOnly = assignedTasks.length > 0
      && assignedTasks.every((task) => ['Inspect', 'Verify', 'Release'].includes(task.type));
    const slug = agentSlug(role.id);
    harnessFiles[`.codex/agents/${slug}.toml`] = codexRoleAgent(role, readOnly);
    harnessFiles[`.claude/agents/${slug}.md`] = claudeRoleAgent(role, readOnly);
    harnessFiles[`.cursor/agents/${slug}.md`] = cursorRoleAgent(role, readOnly);
  }
  const files: Record<string, string> = {
    'factory.yaml': factoryYaml(manifest),
    'intent.json': jsonText(state.intentGraph!),
    'solution.json': jsonText(state.solutionGraph!),
    'roles.json': jsonText(roles),
    'execution.json': jsonText(manifest),
    'runtime.json': jsonText(runtime),
    'SKILL.md': skillMarkdown,
    'RUN.md': runMarkdown,
    'factory.py': controllerPython,
    'harnesses.json': jsonText({
      schemaVersion: '1.2.0',
      generated: ['codex', 'claude-code', 'cursor'],
      files: Object.keys(harnessFiles).sort(),
    }),
  };
  for (const task of tasks) {
    const stem = portableStem(task.id);
    files[`tasks/${stem}.json`] = jsonText(task);
    files[task.taskFile] = taskMarkdown(task);
  }
  for (const role of roles) files[role.roleFile] = roleMarkdown(role);
  return { manifest, files, harnessFiles };
}

export async function exportBuildPack(input: unknown, outputRoot: string): Promise<BuildPackManifest> {
  const { manifest, files, harnessFiles } = createBuildPackFiles(input);
  const repositoryRoot = dirname(outputRoot);
  await Promise.all(Object.keys(files).map((path) =>
    mkdir(dirname(join(outputRoot, path)), { recursive: true })));
  await Promise.all(Object.keys(harnessFiles).map((path) =>
    mkdir(dirname(join(repositoryRoot, path)), { recursive: true })));
  await Promise.all([
    ...Object.entries(files).map(([path, content]) =>
      writeFile(join(outputRoot, path), content, 'utf8')),
    ...Object.entries(harnessFiles).map(([path, content]) =>
      writeFile(join(repositoryRoot, path), content, 'utf8')),
  ]);
  await chmod(join(outputRoot, 'factory.py'), 0o755);
  return manifest;
}
