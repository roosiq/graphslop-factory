# Graph contract

Store all project memory in `<project>/.factory/`.

## Files

```text
.factory/
  project.json
  status.json
  messages.jsonl
  decisions.jsonl
  intent/
    graph.json
    baselines/
  solution/
    graph.json
    baselines/
  execution/
    graph.json
  evidence/
  drift/
```

`graphslop.py init` creates this layout. Agents edit graph JSON. The script
validates and freezes it.

## Common graph shape

```json
{
  "graph_type": "intent",
  "project_id": "example-project",
  "version": 1,
  "nodes": [],
  "edges": []
}
```

Every node needs `id`, `type`, and `status`. Every edge needs `type`, `from`, and
`to`. IDs are stable strings. Never reuse an ID for a different meaning.

## Intent graph

Node types:

`Project`, `Goal`, `UserType`, `Problem`, `UseCase`, `Behavior`, `Input`,
`Output`, `Constraint`, `Preference`, `Exclusion`, `SuccessCriterion`,
`Assumption`, `Question`, `Decision`, `Example`, `Risk`.

Statuses:

`inferred`, `proposed`, `confirmed`, `rejected`, `superseded`, `unresolved`,
`deferred`.

Each node should also contain:

```json
{
  "statement": "Normal-language meaning",
  "confidence": 0.8,
  "source": {"message_id": "msg-001", "quote": "user words"},
  "version": 1,
  "blocking": false
}
```

Use `blocking: true` on unresolved questions or contradictions that could change
the product, data, privacy, architecture, workflow, integrations, or acceptance.

Intent edge types:

`PROJECT_HAS_GOAL`, `GOAL_SOLVES_PROBLEM`, `USER_HAS_PROBLEM`,
`USER_PERFORMS_USE_CASE`, `USE_CASE_REQUIRES_BEHAVIOR`,
`BEHAVIOR_ACCEPTS_INPUT`, `BEHAVIOR_PRODUCES_OUTPUT`, `CONSTRAINT_LIMITS`,
`PREFERENCE_INFLUENCES`, `EXCLUSION_PROHIBITS`, `SUCCESS_VALIDATES`,
`ASSUMPTION_SUPPORTS`, `QUESTION_RESOLVES`, `DECISION_RESOLVES`,
`EXAMPLE_CLARIFIES`, `CONTRADICTS`, `SUPERSEDES`, `DEPENDS_ON`.

## Solution graph

Node types:

`Application`, `Page`, `Feature`, `Workflow`, `Component`, `Service`,
`DataObject`, `Rule`, `API`, `Integration`, `Technology`, `DeploymentTarget`,
`TestableBehavior`.

Statuses:

`proposed`, `confirmed`, `rejected`, `superseded`,
`implementation_support`.

Every product-facing node needs:

```json
{
  "satisfies_intent": ["intent-node-id"]
}
```

Pure plumbing may use `"implementation_support": true`, but must not add product
behavior.

## Execution graph

Node types:

`Inspect`, `Decide`, `Implement`, `Test`, `Verify`, `Integrate`, `Repair`,
`Document`, `Release`.

Statuses:

`pending`, `ready`, `in_progress`, `complete`, `accepted`, `blocked`, `rejected`.

Every job needs:

```json
{
  "id": "task-analysis",
  "type": "Implement",
  "status": "pending",
  "objective": "Build deterministic analysis",
  "satisfies_solution": ["feature-score"],
  "dependencies": ["task-inspect"],
  "allowed_paths": ["src/analysis/**", "tests/analysis/**"],
  "forbidden_changes": ["add accounts", "persist submitted text"],
  "acceptance_checks": ["same input returns same score"],
  "protected_intent_baseline": "intent-v1",
  "protected_solution_baseline": "solution-v1"
}
```

Use dependency IDs to specify order. Do not rely on list position. No dependency
cycles are allowed.

## Baselines and changes

Freeze creates an immutable snapshot and content hash. Never edit a baseline.
Edit the live graph, preserve superseded nodes, then freeze a new version.

A user change after approval must identify affected intent and solution nodes,
then mark execution jobs as unaffected, modify, discard, or new. Do not silently
rewrite active work.
