# Proposed Successor Tasks: Generated Team Contracts

**Intent**: approved `intent-v2`
**Solution**: proposed `solution-v2`
**Status**: Withdrawn after owner correction; not dispatchable
**Complete prior task set**: [tasks.md](tasks.md)
**Existing-task classification**: [impact-intent-v2.yaml](impact-intent-v2.yaml)

The prior 40 task records remain in history. After `solution-v2` approval, `execution-v2` will
retain T001, retain T002/T003 as failed history, rebind 14 trace-unaffected blocked tasks, amend 23
affected tasks, and add the five tasks below. No old task file or evidence record is overwritten.

## Phase 1: Team Contracts and Compiler

**Story goal**: Generate a strict, trace-complete project team inside the proposed Solution Graph.

**Independent test**: Two materially different Solution fixtures produce different justified team
plans; malformed, orphan, circular, unsupported, and authority-bearing Persona proposals fail
atomically.

- [ ] T041 [US7] Implement strict Persona, Role, Capability, TeamPlan, and team-projection contracts plus failing-first contract tests in `packages/contracts/src/team.ts`, `packages/graph-kernel/src/team/`, and `tests/contract/team/`

## Phase 2: Owner Team Review

**Story goal**: Let the owner understand and correct the generated team without graph syntax.

**Independent test**: At 360, 736, and 1440 pixels, the owner can inspect why each team node
exists, distinguish Persona advice from Role authority, inspect traces and permissions, and submit
an ordinary-language correction using keyboard-only interaction.

- [ ] T042 [US7] Implement the Team projection, Solution-review interaction, accessibility states, and browser tests in `apps/control-plane/src/web/features/team/`, `apps/control-plane/src/api/team/`, and `tests/e2e/team-review.spec.ts`

## Phase 3: Role-Bound Assignment

**Story goal**: Bind every authorized task to an approved Role and worker without allowing Persona
content to expand permissions.

**Independent test**: A valid control-plane assignment binds exact task, Role, optional Personas,
worker adapter, baselines, lease, and permission hash; missing, stale, over-privileged, and
Persona-authority fixtures fail atomically.

- [ ] T043 [US7] Implement Role-bound task assignment, structural permission intersection, signed lease binding, and failing-first control-plane integration tests in `packages/control-state/src/assignments/`, `apps/control-plane/src/services/execution/assignments/`, and `tests/integration/assignments/control-plane/`

## Phase 4: Runner and Provider Enforcement

**Story goal**: Make the provider and runner reject any assignment that differs from the
owner-authorized structural policy.

**Independent test**: The runner recomputes the control-plane permission hash; missing, stale,
wrong-worker, broadened, and Persona-derived policies fail before process invocation, while valid
Role and advisory Persona context reaches the fixture provider.

- [ ] T044 [US7] Implement provider Role context, runner assignment validation, permission-hash recomputation, and failing-first boundary tests in `packages/codex-adapter/`, `apps/runner/src/execution/assignment.ts`, and `tests/integration/assignments/runner/`

## Phase 5: Team Verification and Convergence

**Story goal**: Prove generated team traceability and independent producer-verifier assignments
across the complete factory lifecycle.

**Independent test**: The end-to-end fixture generates, reviews, approves, assigns, executes,
verifies, reports drift, and proposes a repair while every Role, Persona, task, assignment,
evidence, and protected baseline remains navigable and no external action occurs.

- [ ] T045 [US7] Add independent team-policy verification, seeded drift, successor-impact, security, performance, and end-to-end acceptance coverage in `tests/contract/team/`, `tests/integration/assignments/`, `tests/e2e/team-review.spec.ts`, and `tests/fixtures/team/`

## Dependencies

```text
T018 (amended Solution compiler)
  ↓
T041 team contracts
  ├─→ T042 team review UI
  └─→ T043 control-plane assignment
          ↓
        T044 runner enforcement
          ↓
T026 + T027 + T028 + T042 + T044
          ↓
        T045
```

- T041 depends on amended T018 and accepted graph/common-contract foundations.
- T042 depends on amended T019 and T041.
- T043 depends on amended T020, T021, and T041.
- T044 depends on amended T022, T024, and T043.
- T045 depends on amended T026, T027, T028, T042, and T044.
- Existing dependency order remains sequential in the MVP. `[P]` is intentionally absent because
  no proposed task is dependency-independent at its ready point.

## Trace and Acceptance Proposal

| Task | Type | Satisfies Solution nodes | Independently runnable acceptance |
|---|---|---|---|
| T041 | Implement | SOL-FEAT-012, SOL-SVC-010, SOL-DATA-009, SOL-RULE-009, SOL-CAP-001–004, SOL-PERSONA-001–004, SOL-ROLE-001–009, SOL-TEST-013 | Strict schemas and JSON Schema accept complete fixtures; two materially different Solutions generate different justified teams; malformed, orphan, circular, unsupported, and Persona-authority fixtures fail atomically; projection order and hashes are stable. |
| T042 | Implement | SOL-WORK-006, SOL-COMP-007, SOL-FEAT-012, SOL-TEST-013 | At 360, 736, and 1440 pixels, keyboard-only review exposes rationale, traces, permissions, dependencies, advisory status, loading, empty, stale, blocked, and error states with no critical accessibility or console failures. |
| T043 | Implement | SOL-FEAT-013, SOL-DATA-010, SOL-RULE-010, SOL-ROLE-003–008 | Valid control-plane assignments bind exact structural policy; Persona changes never change permission hashes; missing, stale, and over-privileged requests fail atomically. |
| T044 | Implement | SOL-FEAT-013, SOL-RULE-010, SOL-TEST-014, SOL-ROLE-003–008 | Valid runner and provider permission hashes agree; missing, stale, wrong-worker, broadened, and Persona-derived policies fail before process invocation; provider context remains bounded. |
| T045 | Verify | SOL-FEAT-012, SOL-FEAT-013, SOL-RULE-009, SOL-RULE-010, SOL-TEST-013, SOL-TEST-014 | The complete fixture generates, reviews, approves, assigns, executes, independently verifies, reports seeded team drift, proposes an idle repair, and produces complete traces without push, PR creation, merge, deployment, domain, or traffic action. |

All four task contracts inherit current Intent and Solution hashes, one-sentence objective, exact
dependencies, allowed paths listed in the task line, the no-scope-change and no-external-action
forbidden set, required changed-file and test evidence, retry limit one, a fresh specification
reviewer, and a fresh code-quality reviewer. Exact contracts are compiled only after
`solution-v2` approval.

## Role Assignment Proposal

| Task | Producer Role | Advisory Persona | Required independent review |
|---|---|---|---|
| T041 | Graph kernel engineer | Graph systems architect | Specification verifier, then code-quality verifier |
| T042 | Owner-experience engineer | Caveman owner advocate | Specification verifier, then code-quality verifier |
| T043 | Control-plane engineer | Graph systems architect | Specification verifier, then code-quality verifier |
| T044 | Runner and security engineer | Adversarial authority reviewer | Specification verifier, then code-quality verifier |
| T045 | Integration and release-readiness reviewer | Adversarial authority reviewer | Specification verifier, then code-quality verifier; no producer self-acceptance |

These assignments remain proposals until `solution-v2` approval and `execution-v2` compilation.
