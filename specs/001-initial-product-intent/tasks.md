---
description: "Approved dependency-ordered implementation tasks for Graphslop"
---

# Tasks: Graphslop Graph-Native First Release

**Input**: [intent-v1.yaml](intent-v1.yaml), [solution-v1.yaml](solution-v1.yaml),
[execution-v1.yaml](execution-v1.yaml), [plan.md](plan.md), [data-model.md](data-model.md),
[contracts/](contracts/), [acceptance.md](acceptance.md), and [quickstart.md](quickstart.md)

**Hard Gate**: Gate 2 passed at `2026-07-27T15:45:07-04:00`. The authenticated project owner
approved `solution-v1`; immutable Intent and Solution Baselines are frozen; `execution-v1` passed
hash, trace, dependency, permission, retry, and independent-review preflight. Only the next
dependency-ready task may run.

**Execution discipline**: Each task uses TDD, one fresh implementer, a separate specification
compliance reviewer, and a separate code-quality reviewer. A task is complete only after both
reviews pass and evidence is recorded. The task’s implementer cannot verify or approve its work.

## Contract Defaults

Every `TC-*` row inherits these exact fields:

- **Protected baselines**: approved `intent-v1` hash plus the future approved `solution-v1` hash.
- **Explicit exclusions**: no new product feature, user, repository, storage engine, public API,
  provider adapter, parallel dispatch, automatic repair, hosted execution, graphslop.com change,
  push, PR, merge, deployment, domain cutover, or traffic cutover unless the row explicitly names
  an already-approved boundary.
- **Required evidence**: changed-file list and hashes, focused failing-test result, focused passing
  result, relevant regression result, requirement mapping, implementer invocation ID, independent
  compliance review, independent quality review, and unresolved issues.
- **Retry budget**: one repair attempt; further failure escalates.
- **Implementer**: fresh bounded implementation agent.
- **Independent verifier**: separate compliance reviewer followed by separate quality reviewer.
- **Path rule**: only listed paths are writable; `.git`, `.factory`, credentials, environment
  files, other repositories, and all unlisted paths are forbidden.

## Task Contract Registry

| Contract | Task | Solution / Intent Trace | Objective | Prerequisites | Allowed Paths | Additional Exclusions | Acceptance |
|---|---|---|---|---|---|---|---|
| TC-001 | T001 | SOL-TECH-001, SOL-APP-001 / INT-017, INT-024 | Create the deterministic npm-workspace and TypeScript build skeleton | Gate 2 | `package.json`, `package-lock.json`, `tsconfig*.json`, `.nvmrc`, `apps/*/package.json`, `packages/*/package.json` | No runtime behavior or dependency outside approved stack | AC-001 |
| TC-002 | T002 | SOL-TEST-001–012 / INT-018 | Configure formatting, lint, type, unit, browser, and build commands | T001 | `package.json`, `package-lock.json`, `.prettierrc*`, `eslint.config.*`, `vitest*.ts`, `playwright.config.ts`, `vite.config.ts`, `.gitignore` | No hosted CI or deploy workflow | AC-002 |
| TC-003 | T003 | SOL-TECH-003, SOL-API-001–002, SOL-RULE-008 / INT-012, INT-020, INT-021, INT-024 | Define common strict, implementation-portable schemas and exported JSON Schema registry | T001 | `packages/contracts/**`, `tests/contract/common-*`, `package-lock.json` | No graph-specific behavior or provider-specific authority | AC-003 |
| TC-004 | T004 | SOL-SVC-001, SOL-DATA-001–004 / INT-005, INT-006, INT-021, INT-022 | Implement canonical graph schemas, RFC 8785 hashing, and immutable delta application | T003 | `packages/graph-kernel/src/schema/**`, `packages/graph-kernel/src/canonical/**`, `packages/graph-kernel/src/delta/**`, `packages/graph-kernel/test/schema/**`, `packages/graph-kernel/package.json`, `package-lock.json` | No filesystem, UI, model, Git, or mutable graph authority | AC-004 |
| TC-005 | T005 | SOL-SVC-001 / INT-008, INT-011, INT-016, INT-022 | Implement deterministic indexes, traversal, trace, impact, and stable topological order | T004 | `packages/graph-kernel/src/indexes/**`, `packages/graph-kernel/src/traversal/**`, `packages/graph-kernel/test/traversal/**` | No Graphology authority or persisted indexes | AC-005 |
| TC-006 | T006 | SOL-SVC-002, SOL-TECH-004 / INT-006, INT-009, INT-017 | Implement single-writer atomic file persistence, recovery, export, and deletion | T004 | `packages/file-store/**`, `tests/integration/file-store/**`, `package-lock.json` | No repository-local authority or database | AC-006 |
| TC-007 | T007 | SOL-SVC-003, SOL-DATA-005, SOL-RULE-001–008 / INT-007, INT-009, INT-013, INT-015, INT-020 | Implement lifecycle, readiness, approvals, protected assertions, and rejected-transition records | T003, T004 | `packages/control-state/src/**`, `packages/control-state/test/**` | No model judgment advances state | AC-007 |
| TC-008 | T008 | SOL-PAGE-001, SOL-RULE-004 / INT-019 | Implement loopback owner claim, session, CSRF, and sole-owner enforcement | T001, T003 | `apps/control-plane/src/auth/**`, `apps/control-plane/tests/auth/**` | No accounts, OAuth, collaborators, or hosted auth | AC-008 |
| TC-009 | T009 | SOL-DATA-007–008 / INT-012, INT-015, INT-018 | Implement structured evidence, secret redaction, safe logs, and health contracts | T003 | `apps/runner/src/evidence/**`, `packages/contracts/src/evidence/**`, `tests/security/evidence/**` | No raw stream or repository-content retention | AC-009 |
| TC-010 | T010 | SOL-TEST-001–012 / INT-018 | Build versioned conformance manifests, graph fixtures, and disposable Git repositories | T001, T003 | `tests/fixtures/**`, `packages/testing/**` | No live provider or external mutations | AC-010 |

| TC-011 | T011 | SOL-FEAT-001–003, SOL-TEST-001–003 / INT-003–INT-008, INT-021–INT-023 | Implement Intent graph schemas, edge compatibility, answer classification, question ranking, and readiness tests | T005, T010 | `packages/contracts/src/intent/**`, `packages/graph-kernel/src/intent/**`, `tests/contract/intent/**` | No code execution or Solution generation | AC-011 |
| TC-012 | T012 | SOL-SVC-004, SOL-RULE-001 / INT-003, INT-004, INT-007, INT-014 | Implement schema-bound Codex proposal invocation and all failure dispositions | T003, T009, T011 | `packages/codex-adapter/src/proposal/**`, `packages/codex-adapter/test/proposal/**` | No direct graph mutation, repository access, or unbounded retry | AC-012 |
| TC-013 | T013 | SOL-WORK-001, SOL-FEAT-001–003 / INT-002–INT-008 | Implement message append, Intent delta validation/application, contradiction detection, projection, and next-question orchestration | T006, T007, T011, T012 | `apps/control-plane/src/services/intent/**`, `apps/control-plane/src/api/messages/**`, `apps/control-plane/tests/intent/**`, `apps/control-plane/package.json`, `package-lock.json` | No approval inference or repository mutation | AC-013 |
| TC-014 | T014 | SOL-COMP-001–002, SOL-PAGE-001, SOL-TECH-002 / INT-004, INT-008, INT-023 | Implement accessible conversation and compact graph-projection owner interface | T002, T008, T011 | `apps/control-plane/src/web/features/intent/**`, `apps/control-plane/src/web/components/project-state/**`, `apps/control-plane/tests/components/intent/**`, `apps/control-plane/package.json`, `package-lock.json` | No raw graph editor or prompt editor | AC-014 |
| TC-015 | T015 | SOL-TEST-001–003 / INT-003, INT-004, INT-023 | Prove rough input produces graph state, one question, and zero repository change | T013, T014 | `tests/e2e/us1-intent.spec.ts`, `tests/fixtures/conversations/**` | Fixture provider only; no live model | AC-015 |

| TC-016 | T016 | SOL-FEAT-004, SOL-RULE-002 / INT-007, INT-009, INT-019 | Implement exact graph/projection approval and immutable Intent Baseline service | T006, T007, T013 | `apps/control-plane/src/services/approval/**`, `apps/control-plane/src/api/intent/**`, `apps/control-plane/tests/approval/**` | No Solution approval or approval of stale/blocked state | AC-016 |
| TC-017 | T017 | SOL-COMP-003, SOL-TEST-004 / INT-008, INT-009, INT-023 | Implement Intent approval review UI and stale/blocking/second-owner acceptance | T014, T016 | `apps/control-plane/src/web/features/approval/**`, `tests/e2e/us2-intent-approval.spec.ts` | No approval from model or runner credentials | AC-017 |

| TC-018 | T018 | SOL-FEAT-005, SOL-WORK-002, SOL-TEST-005 / INT-010, INT-021, INT-022 | Implement Solution graph schema, proposal compiler, trace validation, transformation, and approval tests | T005, T012, T016 | `packages/contracts/src/solution/**`, `packages/graph-kernel/src/solution/**`, `apps/control-plane/src/services/solution/**`, `tests/contract/solution/**` | No orphan product node or observable support-only behavior | AC-018 |
| TC-019 | T019 | SOL-COMP-003, SOL-FEAT-005 / INT-010, INT-023 | Implement plain-language Solution review, technical-default separation, and exact approval UI | T017, T018 | `apps/control-plane/src/web/features/solution/**`, `apps/control-plane/src/api/solution/**`, `tests/e2e/us3-solution.spec.ts` | No implementation start or hidden technical approval | AC-019 |

| TC-020 | T020 | SOL-FEAT-006, SOL-DATA-006, SOL-TEST-005 / INT-011, INT-012, INT-021, INT-022 | Implement Execution task schema, DAG validation, stable readiness, and Solution-to-Execution compiler | T005, T018 | `packages/contracts/src/execution/**`, `packages/graph-kernel/src/execution/**`, `apps/control-plane/src/services/execution/compiler/**`, `tests/contract/execution/**` | No fixed universal task sequence or task authorization | AC-020 |
| TC-021 | T021 | SOL-SVC-006, SOL-API-002, SOL-TEST-006 / INT-013, INT-017, INT-019, INT-024 | Implement signed expiring single-task leases, idempotency, cancellation, and stale-result rejection | T007, T020 | `apps/control-plane/src/services/leases/**`, `apps/control-plane/src/api/runner/**`, `tests/contract/runner/**` | No concurrent lease or implicit authorization | AC-021 |
| TC-022 | T022 | SOL-INTG-001, SOL-SVC-007 / INT-012–INT-015, INT-024 | Implement Codex CLI capability probe, generated permission profile, implementation invocation, and typed result | T009, T010, T020 | `packages/codex-adapter/src/execution/**`, `packages/codex-adapter/test/execution/**` | No second provider, inherited secrets, shell string, or fail-open probe | AC-022 |
| TC-023 | T023 | SOL-INTG-002, SOL-SVC-007, SOL-TEST-007 / INT-012, INT-013 | Implement repository identity, worktree lifecycle, realpath-safe allowed paths, Git diff, and candidate commits | T009, T010, T020 | `apps/runner/src/repository/**`, `apps/runner/tests/repository/**` | No primary-checkout write, `.git` mutation, symlink escape, submodule change, or integration | AC-023 |
| TC-024 | T024 | SOL-WORK-003, SOL-SVC-007, SOL-API-002, SOL-DEPLOY-001 / INT-011–INT-014, INT-017, INT-024 | Implement runner enrollment, lease polling, process cancellation, execution orchestration, and result upload | T021, T022, T023 | `apps/runner/src/lease/**`, `apps/runner/src/execution/**`, `apps/runner/src/index.ts`, `apps/runner/tests/integration/**` | No graph-state write or external push | AC-024 |
| TC-025 | T025 | SOL-COMP-004, SOL-FEAT-006–007 / INT-011, INT-012, INT-017, INT-023 | Implement Execution projection, dependency queue, exact task authorization, and sequential-dispatch UI | T019, T020, T021, T024 | `apps/control-plane/src/web/features/execution/**`, `apps/control-plane/src/api/execution/**`, `tests/e2e/us4-execution.spec.ts` | No auto-dispatch or graph/task file editing | AC-025 |

| TC-026 | T026 | SOL-DATA-007, SOL-FEAT-008 / INT-012, INT-015, INT-018 | Implement evidence ingestion, content hashes, command outcomes, requirement mapping, and retention | T009, T024 | `apps/control-plane/src/services/evidence/**`, `apps/control-plane/src/api/evidence/**`, `tests/integration/evidence/**` | No raw streams, secrets, or self-acceptance | AC-026 |
| TC-027 | T027 | SOL-SVC-008, SOL-RULE-005, SOL-TEST-008 / INT-014, INT-015 | Implement fresh verifier worktree, deterministic checks, separate semantic verifier, and acceptance decision | T022, T023, T026 | `apps/runner/src/verification/**`, `packages/codex-adapter/src/verification/**`, `tests/integration/verification/**` | Verifier cannot edit source, share invocation, or accept without evidence | AC-027 |
| TC-028 | T028 | SOL-FEAT-009, SOL-DATA-008, SOL-RULE-006, SOL-TEST-009 / INT-015, INT-024 | Implement eight-type drift classification, bounded Repair proposal, owner authorization, and escalation | T007, T020, T027 | `apps/control-plane/src/services/drift/**`, `apps/control-plane/src/services/repair/**`, `tests/integration/drift/**` | No automatic repair, baseline change, or second repair after exhaustion | AC-028 |
| TC-029 | T029 | SOL-COMP-005–006, SOL-WORK-004 / INT-015, INT-018, INT-023 | Implement evidence, drift, and repair-decision UI with independent provenance | T025, T026, T028 | `apps/control-plane/src/web/features/evidence/**`, `apps/control-plane/src/web/features/drift/**`, `apps/control-plane/src/api/repairs/**`, `tests/e2e/us5-verification.spec.ts` | No hidden auto-retry or color-only severity | AC-029 |

| TC-030 | T030 | SOL-FEAT-010, SOL-WORK-005, SOL-TEST-010 / INT-016, INT-022 | Implement successor Intent delta, cross-graph impact traversal, classification, pause, and recompilation proposal | T005, T007, T020, T028 | `apps/control-plane/src/services/change-management/**`, `tests/integration/change-management/**` | No approved-history rewrite or affected-task resume | AC-030 |
| TC-031 | T031 | SOL-FEAT-010, SOL-COMP-002 / INT-016, INT-023 | Implement ordinary-language change review and affected/unaffected/discarded/new projection | T029, T030 | `apps/control-plane/src/web/features/change-management/**`, `apps/control-plane/src/api/changes/**`, `tests/e2e/us6-change.spec.ts` | No manual graph editing or silent successor approval | AC-031 |

| TC-032 | T032 | SOL-FEAT-011, SOL-SVC-009, SOL-INTG-003, SOL-RULE-007, SOL-DEPLOY-002, SOL-TEST-011 / INT-017–INT-019 | Implement completion gate, trace manifest, PR preview, exact remote/ref/body authorization, and GitHub CLI adapter | T025, T027, T028, T030 | `apps/control-plane/src/services/completion/**`, `apps/runner/src/repository/pull-request/**`, `tests/integration/completion/**` | Preview may not push; authorization may not merge or deploy | AC-032 |
| TC-033 | T033 | SOL-COMP-005, SOL-FEAT-011 / INT-018, INT-019, INT-023 | Implement draft-PR readiness review and no-remote/no-authority owner journey | T029, T031, T032 | `apps/control-plane/src/web/features/completion/**`, `apps/control-plane/src/api/pull-request/**`, `tests/e2e/us7-completion.spec.ts` | No actual PR without future exact authorization | AC-033 |

| TC-034 | T034 | SOL-RULE-001–007 / INT-013, INT-019 | Complete the threat-model security suite for sessions, leases, paths, commands, secrets, and authority | T033 | `tests/security/**` | No live secrets or hostile-repository claim | AC-034 |
| TC-035 | T035 | SOL-SVC-002–003 / INT-006, INT-009, INT-018 | Complete fault-injected file, process, lease, and restart recovery acceptance | T033 | `tests/integration/recovery/**` | No deletion or rewriting of approved artifacts | AC-035 |
| TC-036 | T036 | SOL-PAGE-001, SOL-TEST-012 / INT-008, INT-017, INT-023 | Complete responsive, keyboard, semantics, focus, axe, console, and failed-request browser acceptance | T033 | `tests/e2e/**`, `tests/accessibility/**` | No hosted Safari claim or visual graph editor | AC-036 |
| TC-037 | T037 | SOL-SVC-001–005 / INT-008, INT-017, INT-022 | Benchmark graph and UI performance against the fixed acceptance profile | T033 | `tests/performance/**`, `scripts/benchmark/**` | No benchmark-specific product behavior | AC-037 |
| TC-038 | T038 | SOL-INTG-001–002 / INT-012–INT-015 | Run an explicitly enabled live Codex smoke task in a disposable trusted fixture repository | T034, T035 | `tests/live/codex/**`, `scripts/live-codex-smoke.*` | No default CI model call, external repo, push, PR, or retained raw stream | AC-038 |
| TC-039 | T039 | SOL-APP-001, SOL-TEST-001–012 / INT-001–INT-024 | Reconcile documentation, trace matrix, threat model, quickstart, and exact verification commands | T034–T038 | `README.md`, `docs/**`, `specs/001-initial-product-intent/**` excluding immutable baselines | No baseline edit or deployment instructions presented as executed | AC-039 |
| TC-040 | T040 | SOL-FEAT-011, SOL-RULE-007 / INT-018, INT-019 | Run integrated compliance, quality, browser, and convergence review and prepare the exact draft-PR artifact | T039 | `specs/001-initial-product-intent/evidence/**`, `artifacts/pull-request/**` | No push, PR creation, merge, deploy, or domain change without new exact authority | AC-040 |

## Acceptance Check Catalog

- **AC-001**: `npm ci`, workspace package discovery, `npm run typecheck`, and Node 24 engine rejection fixture.
- **AC-002**: `npm run format:check`, `npm run lint`, `npm run test -- --run`, `npm run build`, and Playwright config discovery.
- **AC-003**: common-contract valid/invalid fixtures, unknown-field rejection, exported JSON Schema round-trip, and provider/runtime substitution without contract or authority changes.
- **AC-004**: schema enumeration fixtures, RFC 8785 vectors and errata, stable SHA-256, input immutability, atomic delta rejection.
- **AC-005**: bounded BFS/DFS, active versions, contradiction, trace, impact, cycle rejection, ready tasks, and stable topological order.
- **AC-006**: expected-head CAS, atomic write fault points, recovery, export, closure, complete deletion, and content-free receipt.
- **AC-007**: every allowed and rejected lifecycle transition, formula fixture, blocking override, protected assertion, exact approval authority.
- **AC-008**: one-time claim, reuse/expiry, CSRF, session expiry, non-loopback, anonymous, second-owner, and runner-credential rejection.
- **AC-009**: secret corpus redaction, size limits, log field allowlist, raw stream deletion, health response, and evidence-schema rejection.
- **AC-010**: fixture-manifest minimum counts, unique IDs, requirement mappings, disposable repo cleanup, and zero network/external mutation.
- **AC-011**: all Intent enums and compatibility rows, correction/supersession, contradiction, question ties, readiness weights, blockers.
- **AC-012**: typed proposal success plus timeout, termination, auth/quota, refusal, invalid JSON, schema, stale hash, unknown enum, and secret failure.
- **AC-013**: raw-message-first ordering, complete graph delta, deterministic projection, exactly one question, failure without graph mutation.
- **AC-014**: component tests for empty/loading/error/blocked/history/provenance states, keyboard and non-color state distinctions.
- **AC-015**: first rough request produces Intent graph/projection/question and leaves repository commit, status, and worktrees unchanged.
- **AC-016**: exact hash approval, stale/wrong projection rejection, blocking rejection, immutable baseline bytes, authority-not-granted fields.
- **AC-017**: owner can review and approve current version; stale, blocked, model, runner, anonymous, and second-owner attempts fail.
- **AC-018**: every Solution type, product trace, support label, orphan rejection, transformation record, immutable Solution approval candidate.
- **AC-019**: plain-language Solution projection separates product behavior and technical defaults and cannot trigger implementation.
- **AC-020**: every task type/field, dependency DAG, stable order, stale baseline, orphan trace, missing verifier, and unbounded path/retry rejection.
- **AC-021**: signed lease success and forged, stale, expired, duplicate-conflict, cancelled, wrong-base, wrong-capability, and concurrent rejection.
- **AC-022**: local CLI capability probe, fail-closed missing permission feature, argv construction, environment allowlist, schema result, process timeout.
- **AC-023**: tracked/staged/deleted/renamed/untracked paths, realpath, symlink, case collision, submodule, `.git`, primary checkout, cleanup.
- **AC-024**: enrollment, poll, ack, heartbeat, cancel process tree, idempotent result/evidence upload, restart and lease recovery.
- **AC-025**: dependency projection, one exact authorization, second-task rejection, stale task rejection, no graph/task-file editing.
- **AC-026**: exact evidence hashes and mappings, duplicate upload, malformed record, retention, redaction, and self-report non-acceptance.
- **AC-027**: fresh candidate verifier worktree, deterministic checks, distinct invocation, semantic mapping, verifier-write rejection, accepted integration.
- **AC-028**: all eight drift types, complete report, idle Repair proposal, exact owner authorization, one budget, fresh base, exhaustion escalation.
- **AC-029**: evidence provenance, drift severity semantics, repair decision, error/empty states, keyboard use, and no hidden retry.
- **AC-030**: unaffected/changed/discarded/new classifications, trace evidence, affected pause, unaffected preservation, successor reapproval.
- **AC-031**: ordinary-language change projection and approval boundaries with no graph syntax.
- **AC-032**: complete gate blockers, trace manifest, no-remote preview, exact authorization hashes, draft-only command, no merge/deploy.
- **AC-033**: owner sees every blocker and PR preview; absent remote or authority performs no external mutation.
- **AC-034**: every threat-model row has one rejecting case and one allowed control case.
- **AC-035**: crash before/after every store step, control/runner restart, lease expiry, evidence interruption, and prior-valid-head recovery.
- **AC-036**: Chromium/Firefox/WebKit at 360/390/768/1440, keyboard, focus, semantics, axe, console, failed requests, refresh, deep links.
- **AC-037**: fixed 500/250/2,000 dataset, 10 warmups, 100 runs, p50/p95/max, graph operations under 100 ms p95, UI under 2 seconds.
- **AC-038**: opt-in live Codex task produces typed result and redacted evidence in disposable repo with zero external Git mutation.
- **AC-039**: every documented command exists, links resolve, trace matrix covers INT→SOL→task→check, immutable baseline hash still matches.
- **AC-040**: `npm run ci`, production build, integrated spec review, code-quality review, browser evidence, zero blocking drift, convergence report.

## Phase 1: Setup

**Purpose**: Establish a reproducible TypeScript workspace and verification commands.

- [x] T001 Create the Node/npm workspace and package skeleton in `package.json`, `apps/*/package.json`, and `packages/*/package.json` per TC-001
- [ ] T002 Configure formatting, linting, type checking, Vitest, Vite, Playwright, and build commands in root config files per TC-002
- [ ] T003 Define common strict schemas and JSON Schema exports in `packages/contracts/` per TC-003

`T002` failed independent quality verification after its one revision. Its candidate commits were
reverted, `drift-001` is blocking for T002-dependent work, and `repair-t002-001` remains
non-dispatchable until explicit owner authorization. T003 and its descendants are unaffected.

**Checkpoint**: Fresh `npm ci`, type check, empty suite, and production skeleton build pass.

## Phase 2: Foundational Graph and Control Boundaries

**Purpose**: Complete the deterministic authority layer before product behavior.

- [ ] T004 Implement graph schemas, canonical hashing, and immutable delta application in `packages/graph-kernel/` per TC-004
- [ ] T005 Implement graph indexes, traversal, trace, impact, and topological order in `packages/graph-kernel/` per TC-005
- [ ] T006 Implement atomic file persistence and recovery in `packages/file-store/` per TC-006
- [ ] T007 Implement lifecycle, readiness, approvals, and protected assertions in `packages/control-state/` per TC-007
- [ ] T008 [P] Implement local owner authentication in `apps/control-plane/src/auth/` per TC-008
- [ ] T009 [P] Implement evidence, redaction, safe logging, and health contracts in `apps/runner/src/evidence/` and `packages/contracts/src/evidence/` per TC-009
- [ ] T010 [P] Build conformance and disposable Git fixtures in `tests/fixtures/` and `packages/testing/` per TC-010

**Checkpoint**: Pure graph and control conformance passes with no UI, model, or repository execution.

## Phase 3: User Story 1 — Clarify Rough Intent Without Coding (P1)

**Goal**: Caveman input becomes a persistent Intent Graph, faithful projection, and one question.

**Solution Trace**: SOL-FEAT-001–003 → INT-002–INT-008, INT-021–INT-023

**Independent Acceptance**: AC-015 proves repository state is untouched.

- [ ] T011 [US1] Implement Intent contracts, compatibility, ranking, and readiness in `packages/contracts/src/intent/` and `packages/graph-kernel/src/intent/` per TC-011
- [ ] T012 [US1] Implement schema-bound proposal invocation in `packages/codex-adapter/src/proposal/` per TC-012
- [ ] T013 [US1] Implement conversational Intent orchestration in `apps/control-plane/src/services/intent/` per TC-013
- [ ] T014 [P] [US1] Implement the conversation and compact graph-projection UI in `apps/control-plane/src/web/features/intent/` per TC-014
- [ ] T015 [US1] Add the no-code caveman-input acceptance journey in `tests/e2e/us1-intent.spec.ts` per TC-015

## Phase 4: User Story 2 — Approve a Stable Intent Baseline (P1)

**Goal**: The sole owner approves one exact graph and projection version.

**Solution Trace**: SOL-FEAT-004 → INT-007, INT-009, INT-019

- [ ] T016 [US2] Implement Intent approval and immutable baseline service in `apps/control-plane/src/services/approval/` per TC-016
- [ ] T017 [US2] Implement approval review and negative authority journeys in `apps/control-plane/src/web/features/approval/` and `tests/e2e/us2-intent-approval.spec.ts` per TC-017

## Phase 5: User Story 3 — Review and Approve a Traceable Solution (P1)

**Goal**: A proposed Solution Graph separates product behavior from technical support and traces
every product node to approved Intent.

**Solution Trace**: SOL-FEAT-005 → INT-010, INT-021, INT-022

- [ ] T018 [US3] Implement Solution contracts, compiler, transformation, trace validation, and approval tests in `packages/graph-kernel/src/solution/` per TC-018
- [ ] T019 [US3] Implement Solution projection and approval UI in `apps/control-plane/src/web/features/solution/` per TC-019

## Phase 6: User Story 4 — Execute Bounded Dependency-Aware Work (P2)

**Goal**: Compile and run only one exact authorized ready task within its bounds.

**Solution Trace**: SOL-FEAT-006–007 → INT-011–INT-014, INT-017, INT-019, INT-024

- [ ] T020 [US4] Implement Execution contracts, DAG validation, and compiler in `packages/graph-kernel/src/execution/` per TC-020
- [ ] T021 [US4] Implement signed sequential task leases in `apps/control-plane/src/services/leases/` per TC-021
- [ ] T022 [US4] Implement the Codex execution adapter and capability probe in `packages/codex-adapter/src/execution/` per TC-022
- [ ] T023 [US4] Implement Git worktree and path enforcement in `apps/runner/src/repository/` per TC-023
- [ ] T024 [US4] Implement runner enrollment and task execution in `apps/runner/src/` per TC-024
- [ ] T025 [US4] Implement Execution projection and authorization UI in `apps/control-plane/src/web/features/execution/` per TC-025

## Phase 7: User Story 5 — Independently Verify, Repair, and Escalate (P2)

**Goal**: Independent evidence accepts work or creates human-controlled drift and repair state.

**Solution Trace**: SOL-FEAT-008–009 → INT-014, INT-015, INT-018, INT-024

- [ ] T026 [US5] Implement evidence ingestion and requirement mapping in `apps/control-plane/src/services/evidence/` per TC-026
- [ ] T027 [US5] Implement deterministic and semantic independent verification in `apps/runner/src/verification/` per TC-027
- [ ] T028 [US5] Implement drift, Repair proposal, owner authorization, budget, and escalation in `apps/control-plane/src/services/drift/` per TC-028
- [ ] T029 [US5] Implement evidence, drift, and repair-decision UI in `apps/control-plane/src/web/features/drift/` per TC-029

## Phase 8: User Story 6 — Revise Approved Intent Without Losing History (P2)

**Goal**: Ordinary-language change creates a successor graph proposal and pauses only trace-affected
work.

**Solution Trace**: SOL-FEAT-010 → INT-016, INT-022, INT-023

- [ ] T030 [US6] Implement successor baseline impact traversal and recompilation proposal in `apps/control-plane/src/services/change-management/` per TC-030
- [ ] T031 [US6] Implement ordinary-language change-impact review in `apps/control-plane/src/web/features/change-management/` per TC-031

## Phase 9: User Story 7 — Finish at Draft Pull-Request Readiness (P3)

**Goal**: Produce a complete review artifact without inferring external authority.

**Solution Trace**: SOL-FEAT-011 → INT-017–INT-019

- [ ] T032 [US7] Implement completion, trace manifest, PR preview, and exact GitHub boundary in `apps/control-plane/src/services/completion/` per TC-032
- [ ] T033 [US7] Implement completion review and no-remote/no-authority journey in `apps/control-plane/src/web/features/completion/` per TC-033

## Final Phase: Cross-Cutting Verification and Convergence

- [ ] T034 [P] Complete threat-model security acceptance in `tests/security/` per TC-034
- [ ] T035 [P] Complete crash and restart recovery acceptance in `tests/integration/recovery/` per TC-035
- [ ] T036 [P] Complete responsive and accessible browser acceptance in `tests/e2e/` and `tests/accessibility/` per TC-036
- [ ] T037 [P] Complete graph and UI performance measurements in `tests/performance/` per TC-037
- [ ] T038 Run the separately enabled live Codex smoke in `tests/live/codex/` per TC-038
- [ ] T039 Reconcile docs, contracts, traces, and verification commands in `README.md`, `docs/`, and feature specs per TC-039
- [ ] T040 Run integrated review and convergence and prepare local draft-PR artifacts in `specs/001-initial-product-intent/evidence/` per TC-040

**External stop**: Actual push and draft-PR creation remain blocked until the owner separately names
and authorizes a GitHub remote, base branch, head branch, and reviewed PR body hash.

## Dependencies and Execution Order

```text
Gate 2
  ↓
T001 → T002
  └──→ T003 → T004 → T005
             ├──────→ T006
             └──────→ T007
T003 ──┬──→ T008
       ├──→ T009
       └──→ T010

Foundation complete
  ↓
US1: T011 → T012 → T013 ─┬→ T014 → T015
                         └─────────────┘
  ↓
US2: T016 → T017
  ↓
US3: T018 → T019
  ↓
US4: T020 → T021 ─┬→ T024 → T025
                  ├→ T022 ─┘
                  └→ T023 ─┘
  ↓
US5: T026 → T027 → T028 → T029
  ↓
US6: T030 → T031
  ↓
US7: T032 → T033
  ↓
T034 ∥ T035 ∥ T036 ∥ T037 → T038 → T039 → T040
```

User stories are sequential because each represents the factory state transition required by the
next. Parallel markers apply only inside a ready phase and only to non-overlapping paths.

## Independent Story Acceptance

| Story | Independent result |
|---|---|
| US1 | Rough text produces an Intent Graph, compact projection, and one question with no repository mutation |
| US2 | Only the sole owner can freeze the exact displayed Intent graph/projection; stale or blocked approval fails |
| US3 | Solution review is trace-complete and cannot begin implementation |
| US4 | One authorized ready task produces a bounded candidate; concurrent and out-of-scope work fails |
| US5 | Fresh independent verification accepts evidence or emits drift and an idle Repair proposal |
| US6 | A change preserves approved history and pauses only graph-trace-affected work |
| US7 | Completion produces a reviewable PR preview and performs no external action without exact authority |

## Implementation Strategy

1. **Graph kernel first**: T001–T010 establish the authority layer.
2. **Discovery product slice**: T011–T017 yields a useful caveman-to-Intent product before any code
   worker exists.
3. **Three-graph compiler**: T018–T020 materializes the complete graph thesis.
4. **Bounded execution**: T021–T029 adds one safe sequential worker and independent verification.
5. **Change and completion**: T030–T033 completes rebaselining and PR readiness.
6. **Release evidence**: T034–T040 satisfies security, recovery, browser, performance, documentation,
   review, and convergence gates.

No task is checked complete until its contract evidence and both independent reviews pass.
