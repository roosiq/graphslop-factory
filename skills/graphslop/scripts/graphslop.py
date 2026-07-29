#!/usr/bin/env python3
"""Deterministic guardrails for a Graphslop .factory build pack."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


INTENT_TYPES = {
    "Project", "Goal", "UserType", "Problem", "UseCase", "Behavior", "Input",
    "Output", "Constraint", "Preference", "Exclusion", "SuccessCriterion",
    "Assumption", "Question", "Decision", "Example", "Risk",
}
INTENT_STATUSES = {
    "inferred", "proposed", "confirmed", "rejected", "superseded",
    "unresolved", "deferred",
}
INTENT_EDGES = {
    "PROJECT_HAS_GOAL", "GOAL_SOLVES_PROBLEM", "USER_HAS_PROBLEM",
    "USER_PERFORMS_USE_CASE", "USE_CASE_REQUIRES_BEHAVIOR",
    "BEHAVIOR_ACCEPTS_INPUT", "BEHAVIOR_PRODUCES_OUTPUT", "CONSTRAINT_LIMITS",
    "PREFERENCE_INFLUENCES", "EXCLUSION_PROHIBITS", "SUCCESS_VALIDATES",
    "ASSUMPTION_SUPPORTS", "QUESTION_RESOLVES", "DECISION_RESOLVES",
    "EXAMPLE_CLARIFIES", "CONTRADICTS", "SUPERSEDES", "DEPENDS_ON",
}
SOLUTION_TYPES = {
    "Application", "Page", "Feature", "Workflow", "Component", "Service",
    "DataObject", "Rule", "API", "Integration", "Technology",
    "DeploymentTarget", "TestableBehavior",
}
SOLUTION_STATUSES = {
    "proposed", "confirmed", "rejected", "superseded",
    "implementation_support",
}
EXECUTION_TYPES = {
    "Inspect", "Decide", "Implement", "Test", "Verify", "Integrate", "Repair",
    "Document", "Release",
}
EXECUTION_STATUSES = {
    "pending", "ready", "in_progress", "complete", "accepted", "blocked",
    "rejected",
}
STATES = {
    "DISCOVERY", "INTENT_REVIEW", "INTENT_APPROVED", "SOLUTION_REVIEW",
    "SOLUTION_APPROVED", "EXECUTION_READY", "COMPLETE",
}


class PackError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return result or "project"


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PackError(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PackError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise PackError(f"{path} must contain a JSON object")
    return data


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def factory(root: str) -> Path:
    return Path(root).resolve() / ".factory"


def graph_path(base: Path, kind: str) -> Path:
    return base / kind / "graph.json"


def blank_graph(kind: str, project_id: str) -> dict[str, Any]:
    return {
        "edges": [],
        "graph_type": kind,
        "nodes": [],
        "project_id": project_id,
        "version": 0,
    }


def cmd_init(args: argparse.Namespace) -> None:
    base = factory(args.root)
    if base.exists():
        raise PackError(f"{base} already exists; read it instead of replacing it")
    project_id = args.project_id or slug(args.name)
    for directory in (
        "intent/baselines", "solution/baselines", "execution", "evidence", "drift"
    ):
        (base / directory).mkdir(parents=True, exist_ok=True)
    write_json(base / "project.json", {
        "created_at": now(), "id": project_id, "name": args.name,
    })
    write_json(base / "status.json", {
        "active_intent_baseline": None,
        "active_solution_baseline": None,
        "state": "DISCOVERY",
        "updated_at": now(),
    })
    for filename in ("messages.jsonl", "decisions.jsonl"):
        (base / filename).write_text("", encoding="utf-8")
    for kind in ("intent", "solution", "execution"):
        write_json(graph_path(base, kind), blank_graph(kind, project_id))
    print(json.dumps({"factory": str(base), "project_id": project_id}, indent=2))


def node_map(graph: dict[str, Any], label: str) -> dict[str, dict[str, Any]]:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        raise PackError(f"{label}.nodes must be a list")
    result: dict[str, dict[str, Any]] = {}
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise PackError(f"{label}.nodes[{index}] must be an object")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise PackError(f"{label}.nodes[{index}] needs a non-empty id")
        if node_id in result:
            raise PackError(f"{label} repeats node id {node_id}")
        result[node_id] = node
    return result


def validate_common(
    graph: dict[str, Any], kind: str, allowed_types: set[str],
    allowed_statuses: set[str],
) -> dict[str, dict[str, Any]]:
    if graph.get("graph_type") != kind:
        raise PackError(f"{kind} graph_type must be {kind!r}")
    if not isinstance(graph.get("project_id"), str) or not graph["project_id"]:
        raise PackError(f"{kind}.project_id must be a non-empty string")
    if not isinstance(graph.get("version"), int) or graph["version"] < 0:
        raise PackError(f"{kind}.version must be a non-negative integer")
    nodes = node_map(graph, kind)
    for node_id, node in nodes.items():
        if node.get("type") not in allowed_types:
            raise PackError(f"{kind} node {node_id} has invalid type {node.get('type')!r}")
        if node.get("status") not in allowed_statuses:
            raise PackError(
                f"{kind} node {node_id} has invalid status {node.get('status')!r}"
            )
    edges = graph.get("edges")
    if not isinstance(edges, list):
        raise PackError(f"{kind}.edges must be a list")
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            raise PackError(f"{kind}.edges[{index}] must be an object")
        if edge.get("from") not in nodes or edge.get("to") not in nodes:
            raise PackError(f"{kind}.edges[{index}] points to a missing node")
        if not isinstance(edge.get("type"), str) or not edge["type"]:
            raise PackError(f"{kind}.edges[{index}] needs a type")
    return nodes


def active_baseline(
    base: Path, kind: str, allowed_statuses: set[str] | None = None
) -> tuple[str | None, set[str]]:
    status = read_json(base / "status.json")
    baseline_id = status.get(f"active_{kind}_baseline")
    if not baseline_id:
        return None, set()
    snapshot = read_json(base / kind / "baselines" / f"{baseline_id}.json")
    graph = snapshot.get("graph")
    if not isinstance(graph, dict):
        raise PackError(f"baseline {baseline_id} has no graph snapshot")
    nodes = node_map(graph, baseline_id)
    if allowed_statuses is None:
        return baseline_id, set(nodes)
    return baseline_id, {
        node_id for node_id, node in nodes.items()
        if node.get("status") in allowed_statuses
    }


def validate_baseline_hashes(base: Path) -> None:
    for kind in ("intent", "solution"):
        for path in (base / kind / "baselines").glob(f"{kind}-v*.json"):
            snapshot = read_json(path)
            graph = snapshot.get("graph")
            if not isinstance(graph, dict):
                raise PackError(f"baseline {path.name} has no graph snapshot")
            canonical = json.dumps(
                graph, sort_keys=True, separators=(",", ":")
            ).encode()
            observed = hashlib.sha256(canonical).hexdigest()
            if snapshot.get("sha256") != observed:
                raise PackError(f"baseline {path.name} hash does not match its graph")


def validate_intent(graph: dict[str, Any], strict: bool = False) -> dict[str, dict[str, Any]]:
    nodes = validate_common(graph, "intent", INTENT_TYPES, INTENT_STATUSES)
    for index, edge in enumerate(graph["edges"]):
        if edge["type"] not in INTENT_EDGES:
            raise PackError(f"intent.edges[{index}] has invalid type {edge['type']!r}")
    if strict:
        blockers = [
            node_id for node_id, node in nodes.items()
            if node.get("blocking") is True
            and node["status"] in {"inferred", "proposed", "unresolved"}
        ]
        if blockers:
            raise PackError("blocking intent is unresolved: " + ", ".join(blockers))
        confirmed_types = {
            node["type"] for node in nodes.values() if node["status"] == "confirmed"
        }
        missing = {"Goal", "Behavior", "Input", "Output", "SuccessCriterion"} - confirmed_types
        if missing:
            raise PackError(
                "intent cannot freeze without confirmed: " + ", ".join(sorted(missing))
            )
        if not ({"UserType", "UseCase"} & confirmed_types):
            raise PackError("intent cannot freeze without a confirmed UserType or UseCase")
    return nodes


def validate_solution(
    graph: dict[str, Any], base: Path, strict: bool = False
) -> dict[str, dict[str, Any]]:
    nodes = validate_common(graph, "solution", SOLUTION_TYPES, SOLUTION_STATUSES)
    baseline_id, intent_ids = active_baseline(base, "intent", {"confirmed"})
    if nodes and not baseline_id:
        raise PackError("solution nodes require an active intent baseline")
    for node_id, node in nodes.items():
        support = node.get("implementation_support") is True
        links = node.get("satisfies_intent", [])
        if not isinstance(links, list) or any(not isinstance(link, str) for link in links):
            raise PackError(f"solution node {node_id} has invalid satisfies_intent")
        if not support and node["status"] not in {"rejected", "superseded"} and not links:
            raise PackError(f"solution node {node_id} does not trace to intent")
        missing = sorted(set(links) - intent_ids)
        if missing:
            raise PackError(
                f"solution node {node_id} references missing baseline intent: "
                + ", ".join(missing)
            )
        if strict and node["status"] == "proposed":
            raise PackError(f"solution node {node_id} is still proposed")
    if strict and not any(
        node["status"] in {"confirmed", "implementation_support"}
        for node in nodes.values()
    ):
        raise PackError("solution cannot freeze without an approved node")
    return nodes


def find_cycle(nodes: dict[str, dict[str, Any]]) -> list[str] | None:
    visiting: set[str] = set()
    visited: set[str] = set()
    trail: list[str] = []

    def visit(node_id: str) -> list[str] | None:
        if node_id in visiting:
            return trail[trail.index(node_id):] + [node_id]
        if node_id in visited:
            return None
        visiting.add(node_id)
        trail.append(node_id)
        for dependency in nodes[node_id].get("dependencies", []):
            cycle = visit(dependency)
            if cycle:
                return cycle
        trail.pop()
        visiting.remove(node_id)
        visited.add(node_id)
        return None

    for node_id in nodes:
        cycle = visit(node_id)
        if cycle:
            return cycle
    return None


def validate_execution(
    graph: dict[str, Any], base: Path
) -> dict[str, dict[str, Any]]:
    nodes = validate_common(graph, "execution", EXECUTION_TYPES, EXECUTION_STATUSES)
    intent_baseline, _ = active_baseline(base, "intent", {"confirmed"})
    solution_baseline, solution_ids = active_baseline(
        base, "solution", {"confirmed", "implementation_support"}
    )
    if nodes and not solution_baseline:
        raise PackError("execution nodes require an active solution baseline")
    for node_id, node in nodes.items():
        links = node.get("satisfies_solution")
        if not isinstance(links, list) or not links:
            raise PackError(f"execution node {node_id} does not trace to solution")
        missing_links = sorted(set(links) - solution_ids)
        if missing_links:
            raise PackError(
                f"execution node {node_id} references missing baseline solution: "
                + ", ".join(missing_links)
            )
        dependencies = node.get("dependencies", [])
        if not isinstance(dependencies, list) or any(
            not isinstance(item, str) for item in dependencies
        ):
            raise PackError(f"execution node {node_id} has invalid dependencies")
        missing_dependencies = sorted(set(dependencies) - set(nodes))
        if missing_dependencies:
            raise PackError(
                f"execution node {node_id} has missing dependencies: "
                + ", ".join(missing_dependencies)
            )
        if node_id in dependencies:
            raise PackError(f"execution node {node_id} depends on itself")
        if not isinstance(node.get("objective"), str) or not node["objective"].strip():
            raise PackError(f"execution node {node_id} needs a non-empty objective")
        for field in ("allowed_paths", "forbidden_changes", "acceptance_checks"):
            value = node.get(field)
            if not isinstance(value, list) or any(
                not isinstance(item, str) or not item for item in value
            ):
                raise PackError(f"execution node {node_id} needs a string list for {field}")
        if not node["allowed_paths"]:
            raise PackError(f"execution node {node_id} needs bounded allowed_paths")
        if not node["acceptance_checks"]:
            raise PackError(f"execution node {node_id} needs acceptance_checks")
        if node.get("protected_intent_baseline") != intent_baseline:
            raise PackError(f"execution node {node_id} protects the wrong intent baseline")
        if node.get("protected_solution_baseline") != solution_baseline:
            raise PackError(f"execution node {node_id} protects the wrong solution baseline")
    cycle = find_cycle(nodes)
    if cycle:
        raise PackError("execution dependency cycle: " + " -> ".join(cycle))
    return nodes


def validate_pack(base: Path) -> dict[str, int]:
    project = read_json(base / "project.json")
    status = read_json(base / "status.json")
    if status.get("state") not in STATES:
        raise PackError(f"invalid project state {status.get('state')!r}")
    validate_baseline_hashes(base)
    graphs = {
        kind: read_json(graph_path(base, kind))
        for kind in ("intent", "solution", "execution")
    }
    project_id = project.get("id")
    if any(graph.get("project_id") != project_id for graph in graphs.values()):
        raise PackError("all graphs must use project.json id")
    counts = {
        "intent": len(validate_intent(graphs["intent"])),
        "solution": len(validate_solution(graphs["solution"], base)),
        "execution": len(validate_execution(graphs["execution"], base)),
    }
    return counts


def cmd_validate(args: argparse.Namespace) -> None:
    counts = validate_pack(factory(args.root))
    print(json.dumps({"ok": True, "nodes": counts}, indent=2))


def cmd_freeze(args: argparse.Namespace) -> None:
    base = factory(args.root)
    validate_baseline_hashes(base)
    status_path = base / "status.json"
    status = read_json(status_path)
    graph = read_json(graph_path(base, args.graph))
    if args.graph == "intent":
        validate_intent(graph, strict=True)
    else:
        if not status.get("active_intent_baseline"):
            raise PackError("freeze intent before solution")
        validate_solution(graph, base, strict=True)
    baseline_dir = base / args.graph / "baselines"
    versions = []
    for path in baseline_dir.glob(f"{args.graph}-v*.json"):
        match = re.fullmatch(rf"{args.graph}-v(\d+)\.json", path.name)
        if match:
            versions.append(int(match.group(1)))
    version = max(versions, default=0) + 1
    baseline_id = f"{args.graph}-v{version}"
    canonical = json.dumps(graph, sort_keys=True, separators=(",", ":")).encode()
    snapshot = {
        "approved_at": now(),
        "approved_message_id": args.message_id,
        "baseline_id": baseline_id,
        "graph": graph,
        "sha256": hashlib.sha256(canonical).hexdigest(),
    }
    write_json(baseline_dir / f"{baseline_id}.json", snapshot)
    status[f"active_{args.graph}_baseline"] = baseline_id
    if args.graph == "intent":
        status["active_solution_baseline"] = None
    status["state"] = "INTENT_APPROVED" if args.graph == "intent" else "SOLUTION_APPROVED"
    status["updated_at"] = now()
    write_json(status_path, status)
    print(json.dumps({"baseline_id": baseline_id, "sha256": snapshot["sha256"]}, indent=2))


def cmd_next(args: argparse.Namespace) -> None:
    base = factory(args.root)
    nodes = validate_execution(read_json(graph_path(base, "execution")), base)
    done = {
        node_id for node_id, node in nodes.items()
        if node["status"] in {"complete", "accepted"}
    }
    ready = [
        node for node in nodes.values()
        if node["status"] in {"pending", "ready"}
        and set(node.get("dependencies", [])) <= done
    ]
    print(json.dumps({"ready": ready}, indent=2, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Create and validate Graphslop .factory build packs"
    )
    commands = result.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="create a new .factory directory")
    init.add_argument("--root", required=True)
    init.add_argument("--name", required=True)
    init.add_argument("--project-id")
    init.set_defaults(func=cmd_init)
    validate = commands.add_parser("validate", help="validate graph structure and links")
    validate.add_argument("--root", required=True)
    validate.set_defaults(func=cmd_validate)
    freeze = commands.add_parser("freeze", help="freeze approved intent or solution")
    freeze.add_argument("--root", required=True)
    freeze.add_argument("--graph", choices=("intent", "solution"), required=True)
    freeze.add_argument("--message-id", default=None)
    freeze.set_defaults(func=cmd_freeze)
    next_command = commands.add_parser("next", help="print dependency-ready jobs")
    next_command.add_argument("--root", required=True)
    next_command.set_defaults(func=cmd_next)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        args.func(args)
    except PackError as exc:
        print(f"graphslop: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
