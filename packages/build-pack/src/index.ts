import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ProjectConversationStateSchema,
  type GraphNode,
  type ProjectConversationState,
} from '@graphslop/contracts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type PortableTask = Readonly<{
  id: string;
  type: string;
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

export type BuildPackManifest = Readonly<{
  schemaVersion: '1.0.0';
  projectId: string;
  intentBaseline: Readonly<{ id: string; contentHash: string }>;
  solutionBaseline: Readonly<{ id: string; contentHash: string }>;
  executionHash: string;
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

function makeTask(state: ProjectConversationState, task: GraphNode): PortableTask {
  const solutionNode = relevantSolutionNode(state, task);
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
    type: task.type,
    role: typeof task.attributes.roleRef === 'string' ? task.attributes.roleRef : task.type,
    job: typeof task.attributes.objective === 'string' ? task.attributes.objective : task.statementOrName,
    use: [
      `Approved Intent: ${state.project.activeIntentBaselineId}.`,
      `Approved Solution: ${state.project.activeSolutionBaselineId}.`,
      ...(solutionNode ? [`Solution node: ${solutionNode.statementOrName}.`] : []),
    ],
    touch: strings(task.attributes.allowedPaths),
    dont: [
      'Change approved intent.',
      'Add unapproved scope.',
      'Push, merge, publish, or deploy.',
      ...constraints,
      ...exclusions,
    ],
    done: [
      ...strings(task.attributes.acceptanceChecks),
      ...(acceptedCommands.length ? ['Run every acceptance command successfully.'] : []),
      'Return changed files and check results as evidence.',
    ],
    dependencies: dependencyIds,
    solutionNodeIds: solutionNode ? [solutionNode.id] : [],
    acceptanceCommands: acceptedCommands,
  };
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
    'schema_version: "1.0.0"',
    `project_id: ${JSON.stringify(manifest.projectId)}`,
    'intent_baseline:',
    `  id: ${JSON.stringify(manifest.intentBaseline.id)}`,
    `  content_hash: ${JSON.stringify(manifest.intentBaseline.contentHash)}`,
    'solution_baseline:',
    `  id: ${JSON.stringify(manifest.solutionBaseline.id)}`,
    `  content_hash: ${JSON.stringify(manifest.solutionBaseline.contentHash)}`,
    `execution_hash: ${JSON.stringify(manifest.executionHash)}`,
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
description: Run one approved Graphslop task at a time without changing project intent.
---

# Graphslop build pack

Use the included \`factory.py\`. The graph is boss.

1. Run \`python .factory/factory.py next\`.
2. Read the named task in \`.factory/tasks/\`.
3. Run \`python .factory/factory.py claim <task-id>\`.
4. Do only JOB. Use only USE. Touch only TOUCH. Obey DON'T.
5. Run \`python .factory/factory.py check <task-id>\`.
6. If checks pass, run \`python .factory/factory.py accept <task-id>\`.
7. If approved work cannot be completed, run \`python .factory/factory.py report-drift <task-id> "reason"\`.
8. Repeat until \`status\` says complete.

Never edit graph files or \`runtime.json\` by hand. Never skip a dependency.
`;

const runMarkdown = `# Run this build pack

This directory is the approved build contract. Use any coding harness.

\`\`\`bash
python .factory/factory.py status
python .factory/factory.py next
\`\`\`

For every task:

\`\`\`bash
python .factory/factory.py claim TASK_ID
# Let your harness perform the task.
python .factory/factory.py check TASK_ID
python .factory/factory.py accept TASK_ID
\`\`\`

The controller requires a clean Git worktree at claim time. Commit each accepted
task before claiming the next one. It enforces dependency
order, allowed paths, acceptance commands, evidence records, and completion state.
It does not push, merge, publish, deploy, or grant external credentials.
`;

const codexAdapter = `# Codex adapter

Read ../SKILL.md and follow it exactly.

Start with:

\`\`\`bash
python .factory/factory.py next
\`\`\`

Treat the returned task as the complete assignment. Do not reinterpret the whole
project. Stop on missing authority and report drift instead of inventing scope.
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

def ready_tasks(execution: dict[str, Any], runtime: dict[str, Any]) -> list[dict[str, Any]]:
    states = runtime["tasks"]
    return [
        task for task in execution["tasks"]
        if states[task["id"]]["status"] == "pending"
        and all(states[item]["status"] == "accepted" for item in task["dependencies"])
    ]

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
    print(json.dumps({"task": task, "taskFile": f".factory/tasks/{task['id']}.md"}, indent=2))

def claim(execution: dict[str, Any], runtime: dict[str, Any], task_id: str) -> None:
    require_task_state(runtime, task_id, "pending")
    ready = {task["id"] for task in ready_tasks(execution, runtime)}
    if task_id not in ready:
        fail(f"{task_id} is blocked by dependencies.")
    if changed_paths():
        fail("Claim requires a clean Git worktree. Commit accepted work or stash unrelated changes first.")
    runtime["tasks"][task_id] = {
        "status": "running",
        "claimedAt": now(),
        "baseCommit": run_git("rev-parse", "HEAD"),
    }
    write_json(RUNTIME, runtime)
    print(f"Claimed {task_id}.")

def check(execution: dict[str, Any], runtime: dict[str, Any], task_id: str) -> None:
    require_task_state(runtime, task_id, "running")
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
            write_json(EVIDENCE / f"{task_id}.json", {
                "taskId": task_id, "status": "failed", "checkedAt": now(),
                "changedPaths": changes, "receipts": receipts,
            })
            fail(f"Acceptance command failed for {task_id}: {' '.join(command['argv'])}")
    evidence = {
        "schemaVersion": "1.0.0",
        "taskId": task_id,
        "status": "checked",
        "checkedAt": now(),
        "baseCommit": runtime["tasks"][task_id]["baseCommit"],
        "intentBaseline": execution["intentBaseline"],
        "solutionBaseline": execution["solutionBaseline"],
        "executionHash": execution["executionHash"],
        "changedPaths": changes,
        "receipts": receipts,
    }
    write_json(EVIDENCE / f"{task_id}.json", evidence)
    runtime["tasks"][task_id]["status"] = "checked"
    runtime["tasks"][task_id]["checkedAt"] = evidence["checkedAt"]
    write_json(RUNTIME, runtime)
    print(f"Checked {task_id}. Evidence: .factory/evidence/{task_id}.json")

def accept(runtime: dict[str, Any], task_id: str) -> None:
    require_task_state(runtime, task_id, "checked")
    runtime["tasks"][task_id]["status"] = "accepted"
    runtime["tasks"][task_id]["acceptedAt"] = now()
    write_json(RUNTIME, runtime)
    print(f"Accepted {task_id}.")

def report_drift(runtime: dict[str, Any], task_id: str, reason: str) -> None:
    current = runtime["tasks"].get(task_id, {}).get("status")
    if current not in {"running", "checked"}:
        fail(f"{task_id} cannot report drift from {current or 'unknown'}.")
    record = {"taskId": task_id, "status": "blocking", "reason": reason, "reportedAt": now()}
    write_json(DRIFT / f"{task_id}.json", record)
    runtime["tasks"][task_id]["status"] = "drift"
    runtime["tasks"][task_id]["driftFile"] = f".factory/drift/{task_id}.json"
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
        if len(argv) != 3:
            fail(f"Usage: factory.py {command} TASK_ID")
        {"claim": claim, "check": check, "accept": lambda _e, r, t: accept(r, t)}[command](execution, runtime, argv[2])
    elif command == "report-drift":
        if len(argv) < 4:
            fail("Usage: factory.py report-drift TASK_ID REASON")
        report_drift(runtime, argv[2], " ".join(argv[3:]))
    else:
        fail(f"Unknown command: {command}")

if __name__ == "__main__":
    main(sys.argv)
`;

async function writeJson(path: string, value: Json | object): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function exportBuildPack(input: unknown, outputRoot: string): Promise<BuildPackManifest> {
  const state = extractState(input);
  const { intent, solution } = requireApprovedState(state);
  const tasks = state.executionGraph!.nodes.map((task) => makeTask(state, task));
  const manifest: BuildPackManifest = {
    schemaVersion: '1.0.0',
    projectId: state.project.projectId,
    intentBaseline: { id: intent.baselineId, contentHash: intent.snapshotContentHash },
    solutionBaseline: { id: solution.baselineId, contentHash: solution.snapshotContentHash },
    executionHash: state.executionGraph!.contentHash,
    tasks,
  };
  await Promise.all([
    mkdir(join(outputRoot, 'tasks'), { recursive: true }),
    mkdir(join(outputRoot, 'evidence'), { recursive: true }),
    mkdir(join(outputRoot, 'drift'), { recursive: true }),
    mkdir(join(outputRoot, 'harnesses', 'codex'), { recursive: true }),
  ]);
  const runtime = {
    schemaVersion: '1.0.0',
    projectId: manifest.projectId,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, { status: 'pending' }])),
  };
  await Promise.all([
    writeFile(join(outputRoot, 'factory.yaml'), factoryYaml(manifest), 'utf8'),
    writeJson(join(outputRoot, 'intent.json'), state.intentGraph!),
    writeJson(join(outputRoot, 'solution.json'), state.solutionGraph!),
    writeJson(join(outputRoot, 'execution.json'), manifest),
    writeJson(join(outputRoot, 'runtime.json'), runtime),
    writeFile(join(outputRoot, 'SKILL.md'), skillMarkdown, 'utf8'),
    writeFile(join(outputRoot, 'RUN.md'), runMarkdown, 'utf8'),
    writeFile(join(outputRoot, 'factory.py'), controllerPython, 'utf8'),
    writeFile(join(outputRoot, 'harnesses', 'codex', 'AGENTS.md'), codexAdapter, 'utf8'),
    ...tasks.flatMap((task) => [
      writeJson(join(outputRoot, 'tasks', `${task.id}.json`), task),
      writeFile(join(outputRoot, 'tasks', `${task.id}.md`), taskMarkdown(task), 'utf8'),
    ]),
  ]);
  await chmod(join(outputRoot, 'factory.py'), 0o755);
  return manifest;
}
