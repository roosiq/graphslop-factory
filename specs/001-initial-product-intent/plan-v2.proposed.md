# Successor Implementation Plan: Generated Team Contracts

**Status**: Withdrawn after the owner said the team model was overcooked. Do not implement this
plan. The proposed `intent-v3` keeps machine safety but requires caveman-simple worker briefs.

**Branch**: `001-initial-product-intent`
**Date**: 2026-07-27
**Intent**: approved [intent-v2.yaml](intent-v2.yaml)
**Solution**: proposed [solution-v2.proposed.yaml](solution-v2.proposed.yaml)
**Impact**: [impact-intent-v2.yaml](impact-intent-v2.yaml)
**Prior status**: Gate 2 proposal; no implementation or task dispatch was authorized

## Summary

Extend the approved three-graph factory so Solution generation proposes the project-specific team
needed to create the application:

```text
approved Intent
      ↓
Solution Graph
  ├─ product and architecture nodes
  ├─ Capability nodes
  ├─ advisory Persona nodes
  └─ enforceable Role nodes
      ↓ approved Solution Baseline
Execution Graph
  ├─ bounded tasks with exact Role refs
  ├─ optional advisory Persona refs
  ├─ worker assignments
  └─ producer/verifier independence edges
      ↓
derived Team projection for owner review
```

Intent, Solution, and Execution remain the only authoritative graph kinds. “Team Graph” is a
derived cross-graph projection over Solution team nodes and Execution assignments. This avoids a
fourth source of authority while retaining graph-native team structure and navigation.

## Technical Context

The approved stack remains unchanged: Node.js 24, TypeScript 5.9, React 19, Vite 8, Hono 4, Zod
4, canonical file-backed JSON, one local control plane, one local runner, one Codex adapter, and
sequential task dispatch.

No new production dependency, storage engine, process, network destination, provider adapter,
repository, hosting target, or release authority is introduced.

### Schema Extensions

The Solution Graph adds:

- node types `Persona`, `Role`, and `Capability`;
- team-supporting Feature, Workflow, Component, Service, DataObject, Rule, and TestableBehavior
  nodes;
- `USES_CAPABILITY`, `JUSTIFIED_BY`, `INFORMS`, and `MUST_BE_INDEPENDENT_FROM` edges.

The Execution task contract adds:

```text
roleRef                    exact approved Solution Role NodeRef
personaContextRefs[]       optional approved Solution Persona NodeRefs
assignmentPolicyVersion    deterministic policy identifier
requiredIndependenceClass  producer | specification_verifier |
                           quality_verifier | integration_verifier
```

The runtime `TaskAssignment` adds:

```text
assignmentId
taskRef
roleRef
personaContextRefs[]
workerAdapterId
workerInvocationId
leaseRef
protectedBaselineRefs
effectivePermissionHash
assignedAt
completedAt
status
```

Persona fields are excluded from permission calculation. Effective permission is the intersection
of Role ceiling, task allowlist, current baseline assertions, lease scope, provider capability,
and runner policy.

## Architecture Changes

### Solution generation

1. The Solution capability proposes product and architecture nodes.
2. The team-plan compiler derives candidate work and review boundaries from those nodes.
3. A schema-bound model proposal may suggest the smallest justified Roles and Personas.
4. Deterministic code rejects incomplete contracts, orphan team nodes, unsupported capability
   modes, independence cycles, and Personas referenced as authority sources.
5. The owner reviews product, technical defaults, Roles, Personas, permissions, handoffs, and
   selection rationale as one Solution proposal.

### Execution compilation

1. Each generated task maps to exactly one implementation or verification Role.
2. Persona context is optional; absence is valid.
3. Every task retains Solution and transitive Intent traces.
4. The compiler rejects a Role whose permission ceiling cannot contain the task, a verifier Role
   that is not independent from the producer class, or an unjustified team node.
5. Assignment occurs only after task readiness and exact owner authorization.

### Runtime enforcement

1. The control plane signs the exact task, Role, optional Persona refs, worker adapter, baselines,
   repository identity, effective permission hash, and expiry into the lease.
2. The runner recomputes the permission intersection and rejects mismatch or escalation.
3. The provider receives the Role contract and optional Persona context as bounded instructions.
4. Persona text never enters the permission profile generator.
5. Evidence records producer and verifier assignments.
6. Acceptance fails when worker invocation, Role assignment, or independence evidence is missing
   or stale.

### Owner experience

The existing single project workspace adds a Team projection containing:

- why each Role and Persona exists;
- capability and Solution traces;
- responsibilities, inputs, outputs, dependencies, and permission ceiling;
- current task and worker assignments;
- producer/verifier separation;
- proposed, approved, stale, blocked, and superseded states.

The owner corrects the team using ordinary language. Raw graph editing and prompt authoring remain
out of scope.

## Project Structure Changes

```text
packages/contracts/src/
├── team.ts
└── assignment.ts

packages/graph-kernel/src/
└── team/
    ├── validate-team-plan.ts
    └── project-team.ts

packages/control-state/src/
└── assignments/

apps/control-plane/src/
├── services/team/
├── services/execution/assignments/
├── api/team/
└── web/features/team/

apps/runner/src/
└── execution/assignment.ts

tests/
├── contract/team/
├── integration/assignments/
└── e2e/team-review.spec.ts
```

## Security and Privacy

- Persona content is untrusted advisory text and is never interpolated into shell commands,
  filesystem paths, permission profiles, credentials, network destinations, or approval records.
- Role permission ceilings are deny-by-default and cannot exceed task or owner authorization.
- Persona and Role content is persisted as project graph state under the existing disclosed
  retention boundary; no hidden profile or behavioral telemetry is added.
- Worker binding records identifiers, versions, and outcomes, not chain-of-thought or credentials.
- Producer and verifier assignments must differ by Role independence class and invocation ID.
- Any missing, stale, forged, or broadened team reference blocks affected execution.

## Testing Strategy

### Contract

- strict valid and invalid Persona, Role, Capability, and TaskAssignment fixtures;
- unknown-field, missing-source, unsupported-capability, stale-ref, and authority-from-Persona
  failures;
- JSON Schema export parity and canonical hash stability.

### Unit and property

- deterministic team generation normalization;
- permission intersection is associative, monotonic, and never broadened by Persona content;
- stable team projection ordering;
- producer/verifier independence validation.

### Integration

- Solution proposal to approved team to Execution task assignment;
- owner authorization to signed lease to runner recomputation;
- stale or over-privileged assignment rejection;
- evidence and drift creation for team violations;
- successor Role or Persona change impact traversal.

### Browser acceptance

- understand and review the generated team at 360, 736, and 1440 pixels;
- inspect Role responsibilities, permissions, Solution trace, tasks, and assigned worker;
- distinguish advisory Persona from authority-bearing Role without color alone;
- correct a team decision using ordinary language;
- keyboard, semantics, focus, loading, empty, proposed, blocked, stale, and error states.

## Rollout and Compatibility

- `intent-v1`, `solution-v1`, `execution-v1`, accepted T001 evidence, failed candidate commits,
  drift reports, and repair proposals remain immutable history.
- `solution-v2` approval creates a new baseline; it never edits `solution-v1`.
- `execution-v2` recompiles the 40 historical tasks according to the impact classification and
  adds T041–T045.
- T001 evidence may be reused because its objective is trace-unaffected.
- T002 and T003 failures remain historical. New repair IDs will be issued only after
  `solution-v2` approval with exact current baseline hashes.
- There is no data migration or production rollout because no running product or hosted state
  exists.

## Constitution Check

### Pre-design

- Approved Intent: PASS — immutable `intent-v2`.
- Honest successor history: PASS — `intent-v1` remains unchanged and referenced by hash.
- Blocking questions: PASS — none.
- Persona authority boundary: PASS — Personas are advisory only.
- Three authoritative graphs: PASS — Team is a derived projection.

### Pre-implementation

- Approved Solution: BLOCKED — `solution-v2` remains proposed.
- Current Execution: BLOCKED — `execution-v1` protects stale baselines and is paused.
- Traceability design: PASS FOR PLAN — all 28 new Solution nodes trace to `intent-v2`.
- Task bounds: PASS FOR PLAN — Role and assignment fields narrow existing task authority.
- Independent verification: PASS FOR PLAN — distinct Role classes and invocation IDs are required.
- Repair authority: BLOCKED — successor repair IDs cannot exist until the Solution Baseline hash
  exists and still require exact owner authorization.
- External action authority: PASS — no push, PR creation, merge, deployment, domain, or traffic
  action is granted.

## Risks

| Risk | Mitigation |
|---|---|
| Persona becomes personality theater | Require project trace, selection rationale, known blind spots, and optional use |
| Role names imply authority | Calculate authority only from validated contract, task, baselines, lease, and runner policy |
| Fixed team replaces project decomposition | Generate Roles from Solution boundaries and reject unjustified nodes |
| Team graph creates a fourth authority | Keep Team as a derived projection over Solution and Execution |
| Prompt text leaks into enforcement | Keep permission calculation structural and exclude Persona text |
| Reviewer independence is cosmetic | Require different independence class, Role ref, and invocation ID |
| Rebaseline discards useful evidence | Reuse only trace-unaffected accepted evidence; preserve all failure history |

## Gate 2

Implementation may resume only after the owner explicitly approves `solution-v2`, after which the
factory may freeze the Solution Baseline, compile `execution-v2`, and present exact successor
repair IDs for authorization. This proposal grants no execution or external-action authority.
