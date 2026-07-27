---

description: "Traceable, bounded Execution Graph task-list template"
---

# Tasks: [FEATURE NAME]

**Input**: Approved design documents from `/specs/[###-feature-name]/`

**Prerequisites**: An approved immutable Intent Baseline; an approved immutable
Solution Baseline; plan.md; spec.md; and, when applicable, research.md,
data-model.md, contracts/, and quickstart.md.

**Hard Gate**: Task generation MAY prepare a proposed Execution Graph, but no
implementation task may run unless deterministic checks verify the exact approved
Intent and Solution baseline versions. A model agent cannot grant either approval.

**Verification**: Acceptance and verification work is mandatory. Implementation and
verification MUST be assigned to independent roles or agent identities, and task
completion requires durable evidence from the declared acceptance checks.

**Organization**: Tasks are grouped by user story or solution slice. Every task MUST
trace to at least one approved Solution Graph node and transitively to approved
intent.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: May run in parallel only when dependencies are ready, files do not
  conflict, and deterministic controls allocate separate worktrees.
- **[Story]**: User story or solution slice served by the task, such as US1.
- **Description**: MUST include an exact file path and a Task Contract reference.
- Gate or cross-cutting tasks without a story label still require a Task Contract.

Example:

```text
- [ ] T012 [P] [US1] Implement approved behavior in src/example.ext per TC-012
```

## Task Contract Registry *(mandatory)*

Every task ID MUST have exactly one contract. A contract MUST NOT use phrases such
as "as needed", "where appropriate", or "make it work".

| Contract | Task | Solution Trace | Intent Trace | Objective | Prerequisites | Allowed Paths | Explicit Exclusions | Acceptance Checks | Required Evidence | Retry Budget | Implementer | Independent Verifier |
|----------|------|----------------|--------------|-----------|---------------|---------------|---------------------|-------------------|-------------------|--------------|-------------|----------------------|
| TC-001 | T001 | [SOL-###] | [INT-###] | [one bounded behavior] | [ready task IDs or baseline gates] | [exact paths] | [forbidden behavior and paths] | [check IDs and expected results] | [commands, results, artifacts, and trace links] | [finite count] | [role/agent] | [different role/agent] |

A missing field, orphan trace, unapproved baseline, unmet dependency, overlapping
worktree, path outside the allowlist, or non-independent verifier MUST leave the
task blocked.

## Phase 1: Approval and Baseline Readiness

**Purpose**: Deterministically prove that work is authorized before implementation.

- [ ] T001 Validate the exact Intent Baseline version and approval record in [evidence path] per TC-001
- [ ] T002 Validate the exact Solution Baseline version, approval record, and full solution-to-intent trace map in [evidence path] per TC-002
- [ ] T003 Validate protected assertions, dependency readiness, path allowlists, retry budgets, worktree allocation, and merge gates in [control/evidence path] per TC-003
- [ ] T004 Reject inferred, proposed, contradictory, unresolved, or orphan nodes that are not explicitly approved in [control/evidence path] per TC-004

**Checkpoint**: All readiness checks pass against immutable baseline versions. A
failure blocks every implementation phase.

---

## Phase 2: Foundational Deterministic Controls

**Purpose**: Establish shared controls required by all solution slices.

Examples below are placeholders and MUST be replaced with project-specific tasks:

- [ ] T005 Configure schema and state-transition validation in [exact path] per TC-005
- [ ] T006 [P] Configure least-privilege tool, network, credential, and persistence boundaries in [exact path] per TC-006
- [ ] T007 [P] Configure structured evidence, drift-report, and escalation outputs in [exact path] per TC-007
- [ ] T008 Configure isolated worktrees, allowed-path enforcement, and deterministic integration ordering in [exact path] per TC-008

**Checkpoint**: The control plane is independently verified before product-facing
implementation begins.

---

## Phase 3: User Story 1 - [Title] (Priority: P1)

**Goal**: [approved solution behavior and served intent]

**Solution Trace**: [SOL-### → INT-###]

**Independent Acceptance**: [behavioral outcome that can be checked without relying
on implementer self-report]

### Acceptance Checks for User Story 1 *(mandatory, before implementation)*

- [ ] T009 [P] [US1] Specify executable acceptance check [AC-ID] in tests/[exact path] per TC-009
- [ ] T010 [P] [US1] Specify negative, exclusion, and protected-assertion checks in tests/[exact path] per TC-010

### Implementation for User Story 1

- [ ] T011 [US1] Implement [bounded behavior] in src/[exact path] per TC-011
- [ ] T012 [US1] Add required observability and failure signals in src/[exact path] per TC-012

### Independent Verification for User Story 1

- [ ] T013 [US1] Run [acceptance check IDs], inspect the allowed-path diff, and store evidence in [exact evidence path] per TC-013
- [ ] T014 [US1] Compare repository state to approved baselines and emit a structured drift report in [exact evidence path] per TC-014

**Checkpoint**: The story is complete only when all checks pass, evidence is linked,
and drift is absent or represented by bounded repair tasks.

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [approved solution behavior and served intent]

**Solution Trace**: [SOL-### → INT-###]

**Independent Acceptance**: [behavioral outcome]

### Acceptance Checks for User Story 2 *(mandatory, before implementation)*

- [ ] T015 [P] [US2] Specify executable acceptance, exclusion, and protected-assertion checks in tests/[exact path] per TC-015

### Implementation for User Story 2

- [ ] T016 [US2] Implement [bounded behavior] in src/[exact path] per TC-016

### Independent Verification for User Story 2

- [ ] T017 [US2] Run acceptance checks, inspect the allowed-path diff, and store evidence in [exact evidence path] per TC-017
- [ ] T018 [US2] Compare repository state to approved baselines and emit a structured drift report in [exact evidence path] per TC-018

**Checkpoint**: The story satisfies the same evidence and drift gates as User Story 1.

---

[Add further user-story or solution-slice phases using the same check → implement →
independently verify sequence.]

---

## Final Phase: Cross-Cutting Verification and Draft Pull Request

**Purpose**: Prove repository-wide compliance and produce the MVP terminal artifact.

- [ ] TXXX [P] Run security and privacy acceptance checks and store evidence in [exact evidence path] per TC-XXX
- [ ] TXXX [P] For user-facing work, run accessibility and responsive browser acceptance across declared browsers and viewports and store evidence in [exact evidence path] per TC-XXX
- [ ] TXXX [P] Verify observability and the rollback procedure and store evidence in [exact evidence path] per TC-XXX
- [ ] TXXX Reconcile all drift reports; create bounded repair tasks or stop with an escalation record in [exact evidence path] per TC-XXX
- [ ] TXXX Verify every changed file, assertion, check, commit, and evidence artifact retains solution and intent trace links in [exact evidence path] per TC-XXX
- [ ] TXXX Run deterministic merge gates and open or update a reviewable draft pull request in [exact integration path] per TC-XXX

**MVP Stop**: Production deployment and domain or traffic cutover are not tasks in
this template. They require separate explicit verified authorization and remain
outside the MVP.

---

## Dependencies and Execution Order

### Gate Dependencies

- Approval and Baseline Readiness blocks every implementation task.
- Foundational Deterministic Controls depends on readiness and blocks user stories.
- Acceptance-check tasks for a story MUST complete before its implementation tasks.
- Independent verification depends on implementation but MUST use a different role
  or agent identity.
- Integration depends on passing evidence, resolved drift, and all required traces.

### Parallel Opportunities

- `[P]` is valid only for different files in separate allocated worktrees with all
  dependencies ready.
- Tasks that modify the same file, baseline, graph node, or protected assertion MUST
  run sequentially.
- Independent verification MUST NOT run concurrently with changes to the artifact it
  verifies.

## Failure, Drift, and Repair Rules

- A failed acceptance check MUST leave the task incomplete and attach evidence.
- Drift MUST produce a structured report with expected state, observed state,
  affected graph nodes, evidence, severity, and disposition.
- Repair MUST be a new bounded task with a new ID and Task Contract; existing task or
  baseline history MUST NOT be rewritten.
- Retries MUST stop at the declared budget. Exhaustion or repeated assertion failure
  MUST create an escalation record and block the affected dependency path.

## Completion Rules

A task is complete only when:

1. its exact Intent and Solution baseline versions remain approved;
2. its dependencies and deterministic readiness checks pass;
3. its writes stay within allowed paths and exclusions remain satisfied;
4. its independent verifier runs all acceptance checks;
5. required evidence and trace links are durable; and
6. drift is absent or represented by blocked, bounded repair work.

Never mark a task complete from model confidence, an implementer self-report, partial
success, or exhausted retries.
