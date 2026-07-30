# Architecture

Graphslop is a controlled compiler with three connected graphs.

## Intent Graph

Captures goals, users, inputs, behaviors, outputs, constraints, exclusions, success conditions, assumptions, decisions, and unresolved questions.

Only confirmed nodes become approved requirements. Corrections create new versions and preserve history.

## Solution Graph

Describes the approved product and technical interpretation: features, workflows, components, services, rules, data objects, integrations, and testable behavior.

Product-facing nodes must trace to Intent. Supporting infrastructure is labeled as implementation support.

## Execution Graph

Compiles the approved Solution into dependency-ordered tasks. Each task includes:

- one objective;
- exact graph and baseline bindings;
- allowed paths;
- prohibited changes;
- acceptance commands;
- required evidence;
- relevant protected decisions.

## Authority boundary

The model can propose normalized meaning and one high-value question. It cannot create IDs, timestamps, approvals, baseline hashes, capabilities, leases, or task authority.

Deterministic code owns:

- schema validation;
- state transitions;
- graph traversal;
- baseline versioning;
- dependency readiness;
- protected-decision checks;
- bounded file and command policy;
- evidence and drift records.

## Runtime components

| Component | Job |
| --- | --- |
| Local control plane | Single-user session, Q&A, graph editing, review, approval, and export |
| Graph kernel | Validation, hashing, scheduling, completeness, and flywheel checks |
| File store | Versioned project state and evidence persistence |
| Model adapter | Local OpenAI-compatible proposal calls |
| Build-pack exporter | Canonical `.factory/` plus generated Codex, Claude Code, and Cursor adapters |
| Runner | Optional bounded task execution in isolated Git worktrees |
| Edge Worker | Hosted identity, membership checks, project API, and static assets |
| Project Durable Object | One serialized graph authority per hosted project |
| D1 | Hosted users, sessions, project catalog, and roles |
| Queue pull worker | Capacity-aware bridge from hosted projects to local Qwen |
| R2 | Content-addressed hosted build-pack archives |

## Completeness flywheel

```text
ready task
  → bounded implementation
  → independent verification
  → trace code to task, solution, and intent
  → accept or emit drift
  → bounded repair
  → verify again
```

Completion requires accepted tasks, passing system checks, evidence for every success condition, and no blocking drift against the latest approved baseline.
