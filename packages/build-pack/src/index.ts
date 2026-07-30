import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  ProjectConversationStateSchema,
  type GraphNode,
  type ProjectConversationState,
} from '@graphslop/contracts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

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

export type BuildPackManifest = Readonly<{
  schemaVersion: '1.1.0';
  projectId: string;
  intentBaseline: Readonly<{ id: string; contentHash: string }>;
  solutionBaseline: Readonly<{ id: string; contentHash: string }>;
  executionHash: string;
  roles: readonly PortableRole[];
  tasks: readonly PortableTask[];
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
  const constraints = state.intentGraph?.nodes
    .filter((node) => node.status === 'confirmed' && node.type === 'Constraint')
    .map((node) => node.statementOrName) ?? [];
  const exclusions = state.intentGraph?.nodes
    .filter((node) => node.status === 'confirmed' && node.type === 'Exclusion')
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
    'schema_version: "1.1.0"',
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
import json
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

def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)

def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()

def load() -> tuple[dict[str, Any], dict[str, Any]]:
    execution = read_json(EXECUTION)
    runtime = read_json(RUNTIME)
    return execution, runtime

def task_by_id(execution: dict[str, Any], task_id: str) -> dict[str, Any]:
    for task in execution["tasks"]:
        if task["id"] == task_id:
            return task
    fail(f"Unknown task: {task_id}")

def task_artifact_stem(task: dict[str, Any]) -> str:
    return pathlib.PurePosixPath(task["taskFile"]).stem

def ready_tasks(execution: dict[str, Any], runtime: dict[str, Any]) -> list[dict[str, Any]]:
    states = runtime["tasks"]
    return sorted([
        task for task in execution["tasks"]
        if states[task["id"]]["status"] == "pending"
        and all(states[item]["status"] == "accepted" for item in task["dependencies"])
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
    actual = runtime["tasks"].get(task_id, {}).get("status")
    if actual != expected:
        fail(f"{task_id} is {actual or 'unknown'}, expected {expected}.")

def require_worker(runtime: dict[str, Any], task_id: str, worker_id: str) -> None:
    expected = runtime["tasks"].get(task_id, {}).get("workerId")
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
        str(runtime["tasks"][candidate["id"]]["workerId"])
        for candidate in execution["tasks"]
        if candidate["type"] == "Implement"
        and solution_ids.intersection(candidate["solutionNodeIds"])
        and runtime["tasks"][candidate["id"]].get("status") == "accepted"
        and runtime["tasks"][candidate["id"]].get("workerId")
    }

def status(execution: dict[str, Any], runtime: dict[str, Any]) -> None:
    counts: dict[str, int] = {}
    for record in runtime["tasks"].values():
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
    runtime["tasks"][task_id] = {
        "status": "running",
        "claimedAt": now(),
        "baseCommit": run_git("rev-parse", "HEAD"),
        "workerId": worker_id,
        "roleId": task["roleId"],
    }
    write_json(RUNTIME, runtime)
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
            write_json(EVIDENCE / f"{task_artifact_stem(task)}.json", {
                "schemaVersion": "1.1.0",
                "taskId": task_id, "status": "failed", "checkedAt": now(),
                "workerId": worker_id, "roleId": task["roleId"],
                "changedPaths": changed_paths(), "receipts": receipts,
            })
            fail(f"Acceptance command failed for {task_id}: {' '.join(command['argv'])}")
    changes = changed_paths()
    violations = [path for path in changes if not allowed(path, task["touch"])]
    if violations:
        write_json(EVIDENCE / f"{task_artifact_stem(task)}.json", {
            "schemaVersion": "1.1.0",
            "taskId": task_id, "status": "failed", "checkedAt": now(),
            "workerId": worker_id, "roleId": task["roleId"],
            "changedPaths": changes, "receipts": receipts,
        })
        fail("Acceptance commands changed paths outside TOUCH: " + ", ".join(violations))
    evidence = {
        "schemaVersion": "1.1.0",
        "taskId": task_id,
        "status": "checked",
        "checkedAt": now(),
        "workerId": worker_id,
        "roleId": task["roleId"],
        "baseCommit": runtime["tasks"][task_id]["baseCommit"],
        "intentBaseline": execution["intentBaseline"],
        "solutionBaseline": execution["solutionBaseline"],
        "executionHash": execution["executionHash"],
        "changedPaths": changes,
        "receipts": receipts,
    }
    evidence_file = f".factory/evidence/{task_artifact_stem(task)}.json"
    write_json(REPO / evidence_file, evidence)
    runtime["tasks"][task_id]["status"] = "checked"
    runtime["tasks"][task_id]["checkedAt"] = evidence["checkedAt"]
    write_json(RUNTIME, runtime)
    print(f"Checked {task_id}. Evidence: {evidence_file}")

def accept(runtime: dict[str, Any], task_id: str, worker_id: str) -> None:
    require_task_state(runtime, task_id, "checked")
    require_worker(runtime, task_id, worker_id)
    runtime["tasks"][task_id]["status"] = "accepted"
    runtime["tasks"][task_id]["acceptedAt"] = now()
    write_json(RUNTIME, runtime)
    print(f"Accepted {task_id}.")

def report_drift(
    execution: dict[str, Any],
    runtime: dict[str, Any],
    task_id: str,
    worker_id: str,
    reason: str,
) -> None:
    current = runtime["tasks"].get(task_id, {}).get("status")
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
    runtime["tasks"][task_id]["status"] = "drift"
    runtime["tasks"][task_id]["driftFile"] = drift_file
    write_json(RUNTIME, runtime)
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
            "accept": lambda _e, r, t, w: accept(r, t, w),
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
  const features = state.solutionGraph!.nodes.filter((node) => node.type === 'Feature');
  for (const feature of features) {
    const featureTasks = tasks.filter((task) => task.solutionNodeIds.includes(feature.id));
    for (const type of ['Decide', 'Implement', 'Verify']) {
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
    schemaVersion: '1.1.0',
    projectId: state.project.projectId,
    intentBaseline: { id: intent.baselineId, contentHash: intent.snapshotContentHash },
    solutionBaseline: { id: solution.baselineId, contentHash: solution.snapshotContentHash },
    executionHash: state.executionGraph!.contentHash,
    roles,
    tasks,
  };
  const runtime = {
    schemaVersion: '1.1.0',
    projectId: manifest.projectId,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, { status: 'pending' }])),
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
    const readOnly = assignedTasks.length > 0 && assignedTasks.every((task) => task.type === 'Verify');
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
      schemaVersion: '1.1.0',
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
