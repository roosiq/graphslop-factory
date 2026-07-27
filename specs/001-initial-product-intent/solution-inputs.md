# Deferred Solution Inputs

**Status**: User-provided candidates, not an approved Solution Baseline

**Source**: Original product brief and follow-up, 2026-07-27

This file preserves implementation and deployment suggestions without allowing them to leak into
the Intent Baseline. Gate 2 must evaluate, trace, and either adopt or reject each candidate.

## Product and Deployment Candidate

- Product name: Graphslop
- Product thesis: caveman-simple ordinary language outside, typed graph engineering inside
- Leading public-domain candidate: `graphslop.com`
- The existing `graph-slop` Cloudflare Worker and current domain route must remain unchanged until
  an approved release plan includes verified cutover and rollback.

## Graph-Native First-Release Candidate

- A private owner-facing interface that projects graph state into compact ordinary-language views.
- A graph kernel with first-class typed Intent, Solution, and Execution nodes and edges.
- Deterministic graph operations for mutation, supersession, validation, traversal, immutable
  baseline snapshots, graph-to-graph compilation, impact traversal, and projection.
- Versioned JSON or YAML graph storage for the first release, validated by JSON Schema, Zod, or an
  equivalent schema system. A graph database is not required.
- One implemented execution-provider adapter behind provider-independent graph and task contracts.
- Sequential execution with at most one dispatched task, using an owner-authorized local or
  isolated runner and bounded Git worktrees or an equivalent workspace boundary.
- Independent verification, structured drift reports, and proposed repair tasks that never
  dispatch without owner authorization.
- GitHub as the initial source-control and draft-pull-request boundary.

## Candidate Application Shape

- A web interface is a candidate for conversation, graph projections, approvals, task state, and
  drift review.
- A small orchestration service or local coordinator is a candidate for deterministic graph
  transitions and worker dispatch.
- The hosted interface need not execute untrusted repository code in its own runtime. A local or
  separately isolated runner may perform authorized repository work.
- File-backed project state is the leading first-release candidate. SQLite remains a fallback if
  concurrent reads, indexing, or transaction requirements justify it during gate 2.

## Suggested Responsibility Split

Use model calls for:

- intent extraction
- question selection
- contradiction detection
- solution proposal
- task decomposition
- implementation
- semantic verification

Use deterministic code for:

- state transitions
- schema validation
- graph traversal
- dependency readiness
- baseline versioning
- protected-decision checks
- file permissions
- test execution
- retry limits
- worktree management
- merge control

Agent contracts must remain model-independent so Hermes, Codex, Claude Code, or another coding
worker can operate against the same graph format later. The first release implements one adapter;
portability is a contract constraint, not a requirement to ship several integrations.

## Suggested First-Implementation Project Layout

```text
.factory/
├── project.yaml
├── conversation/
│   └── messages.jsonl
├── intent/
│   ├── graph.json
│   ├── intent-v1.yaml
│   └── intent-v2.yaml
├── solution/
│   ├── graph.json
│   └── solution-v1.yaml
├── execution/
│   ├── graph.json
│   └── tasks/
│       ├── task-001.yaml
│       └── task-002.yaml
├── decisions/
│   └── decision-log.jsonl
├── evidence/
│   └── task-001/
│       ├── result.yaml
│       ├── tests.json
│       └── changed-files.txt
├── drift/
│   └── drift-017.yaml
└── status.yaml
```

A graph database is optional. The first implementation may store graphs as versioned JSON files.

## Deferred Productization

- Parallel execution workers.
- Multiple implemented model or coding-worker adapters.
- Automatic repair dispatch or a self-running repair loop.
- A public developer API and stable external endpoint contracts.
- Hosted execution of untrusted repositories inside the Graphslop web runtime.
- PostgreSQL or a graph database without demonstrated first-release need.
- Multi-owner, multi-project, multi-repository, or organization features.

## Capability Surface to Preserve

Whatever transport is selected at gate 2 must support:

- submit project message
- inspect a named graph version and its ordinary-language projection
- approve a named Intent Baseline
- generate, inspect, and approve a named Solution Graph version
- compile and inspect an Execution Graph
- authorize one ready task
- independently verify one task result
- inspect a drift report
- authorize or reject a proposed repair task

Exact transport, routes, payloads, framework, persistence engine, hosting, and repository provider
remain gate-2 decisions. This capability list does not require a public HTTP API.
