# Solution Readiness Checklist: Graphslop Graph-Native First Release

**Purpose**: Unit-test the completeness, clarity, consistency, and measurability of the approved
intent and proposed Solution requirements before task generation  
**Created**: 2026-07-27  
**Feature**: [spec.md](../spec.md), [plan.md](../plan.md),
[solution-v1.proposed.yaml](../solution-v1.proposed.yaml)

**Depth**: Formal gate-2 review  
**Audience**: Product owner, specification reviewer, and execution planner  
**Focus**: Graph authority and traceability; execution authority and failure recovery

## Requirement Completeness

- [x] CHK001 Are all Intent, Solution, and Execution node/edge vocabularies plus legal endpoint combinations defined or assigned to a specific schema artifact? [Completeness, Spec §NC-001–NC-003, §NC-013, §NC-015]
- [x] CHK002 Are requirements documented for every authoritative graph mutation, including supersession, contradiction resolution, status transition, and cross-graph linking? [Completeness, Data Model §GraphDelta]
- [x] CHK003 Are cross-graph trace requirements complete in both directions from changed artifact to Intent and from Intent to evidence? [Completeness, Spec §FR-047, Plan §State Ownership]
- [x] CHK004 Are projection-authority requirements defined for generation, hashing, staleness, optional model commentary, and approval blocking? [Completeness, Spec §FR-053, Contract §Graph Kernel]
- [x] CHK005 Are approval requirements complete for Intent, Solution, task authorization, repair authorization, and draft-PR authorization without conflating their authority? [Completeness, Spec §FR-015–FR-023, Plan §Security]
- [x] CHK006 Are runner protocol requirements complete for enrollment, capability expiry, lease acknowledgement, heartbeat, cancellation, idempotent result, evidence upload, and recovery? [Completeness, Contract §Runner Protocol]
- [x] CHK007 Are repair requirements complete for proposal, owner authorization, attempt budget, fresh base commit, independent verification, rejection, and escalation? [Completeness, Spec §FR-038–FR-040, Research §Decision 10]
- [x] CHK008 Are successor-baseline requirements complete for impact traversal, affected-work pause, unaffected evidence reuse, discarded tasks, reapproval, and recompilation? [Completeness, Spec §FR-041–FR-044]

## Requirement Clarity

- [x] CHK009 Is the control plane’s exclusive graph-write authority distinguished unambiguously from the runner’s temporary worktree and evidence-staging writes? [Clarity, Plan §State Ownership, Contract §Runner Write Boundary]
- [x] CHK010 Is “one authenticated project owner” translated into an explicit local claim, session, expiry, CSRF, second-identity, and runner-credential boundary? [Clarity, Spec §FR-014, Plan §Security]
- [x] CHK011 Is “owner-trusted repository” defined as a first-release limitation without implying that Git worktrees or Node permissions contain hostile code? [Clarity, Plan §Constraints, Research §Decision 9]
- [x] CHK012 Is the Codex permission-profile capability gate defined with an objective pass/fail probe and a fail-closed outcome? [Clarity, Contract §Provider Adapter]
- [x] CHK013 Are the 100 ms and 2 second performance thresholds tied to named graph sizes, operations, percentile, and reference environment? [Clarity, Spec §SC-013, Plan §Technical Context]
- [x] CHK014 Is the draft-PR boundary explicit about preview, named remote and refs, external mutation, merge prohibition, and deployment prohibition? [Clarity, Contract §Control-Plane API]

## Requirement Consistency

- [x] CHK015 Are single-writer requirements consistent with runner evidence upload and incapable of allowing the runner to write graph state indirectly? [Consistency, Plan §Architecture, Contract §Runner Protocol]
- [x] CHK016 Is the “one implemented provider adapter” constraint consistent with use of deterministic fixture providers in tests and clearly limited to product integrations? [Consistency, Spec §FR-034, Quickstart §Full CI]
- [x] CHK017 Are repair states and terms consistent across the Intent spec, Solution proposal, data model, runner protocol, and quickstart? [Consistency, Spec §FR-038, Solution §SOL-FEAT-009, Data Model §Drift]
- [x] CHK018 Are local-first requirements consistent with the deferred graphslop.com target and the prohibition on changing the existing Worker or domain? [Consistency, Plan §Risks, Research §Decision 12]

## Acceptance Criteria Quality

- [x] CHK019 Can every “100%” conformance criterion be evaluated against a named finite fixture corpus with ownership for adding future regressions? [Measurability, Spec §SC-001–SC-010, §SC-016–SC-021]
- [x] CHK020 Is “representative software-project owner” defined well enough to reproduce the 85% and 90% usability studies? [Ambiguity, Spec §SC-011, §SC-012, §SC-020]
- [x] CHK021 Is the 2 second state-view criterion separated from model inference duration and tied to observable start and end timestamps? [Measurability, Spec §SC-013, Plan §Performance]
- [x] CHK022 Can graph and projection determinism be measured from canonical bytes, exact hashes, query/template versions, and repeated-run fixtures? [Measurability, Spec §SC-019, Contract §Graph Kernel]

## Scenario Coverage

- [x] CHK023 Are requirements complete for the primary conversation-to-approved-graphs-to-verified-task-to-draft-PR-readiness journey? [Coverage, Spec §User Stories 1–7]
- [x] CHK024 Are requirements defined for model timeout, malformed schema output, refusal, provider authentication failure, and retry without graph corruption? [Coverage, Exception Flow, Quickstart §Scenario A]
- [x] CHK025 Are recovery requirements defined for process termination before and after every atomic head-update boundary? [Coverage, Recovery, Quickstart §Recovery Acceptance]
- [x] CHK026 Are stale, expired, forged, duplicated, cancelled, wrong-baseline, and wrong-base-commit lease/result scenarios specified? [Coverage, Exception Flow, Contract §Runner Protocol]
- [x] CHK027 Are anonymous, second-owner, expired-session, runner-credential, and CSRF misuse scenarios specified consistently? [Coverage, Security, Spec §SPR-001–SPR-007]
- [x] CHK028 Are local completion and PR-preview requirements defined when no Git remote exists, without weakening the final draft-PR completion criterion? [Coverage, Dependency, Research §Decision 11]

## Edge Case Coverage

- [x] CHK029 Are deterministic tie-breaking requirements documented when candidate questions have equal value? [Coverage, Edge Case, Spec §Edge Cases]
- [x] CHK030 Are cycles, dangling endpoints, duplicate stable IDs, stale node versions, incompatible edge endpoints, and orphan traces addressed? [Coverage, Edge Case, Contract §Graph Kernel]
- [x] CHK031 Are symlink escapes, submodule changes, case-normalized paths, renamed files, untracked files, and `.git` boundary changes addressed in execution requirements? [Coverage, Edge Case, Plan §Security]
- [x] CHK032 Are session expiry, runner restart, lease expiry, process-tree cancellation, and evidence-upload interruption requirements defined? [Coverage, Recovery, Contract §Runner Protocol]

## Non-Functional Requirements

- [x] CHK033 Are accessibility, responsive, keyboard, browser-engine, console, network-error, and hosted Safari gates clearly separated by release type? [Coverage, Spec §URR-001–URR-008, Plan §Testing]
- [x] CHK034 Is a first-release threat model documented for owner session, runner enrollment, model credentials, repository content, task leases, path escapes, command execution, and evidence leakage? [Gap, Security, Plan §Security]
- [x] CHK035 Are observability requirements specific about permitted fields, forbidden content, health status, correlation IDs, retention, and redaction? [Completeness, Plan §Observability]
- [x] CHK036 Are export, project closure, deletion, retention, quarantined-artifact, and immutable-baseline handling requirements mutually compatible? [Coverage, Privacy, Spec §SPR-003–SPR-004]

## Dependencies and Assumptions

- [x] CHK037 Are supported Node, Git, Codex, GitHub CLI, browser, and operating-system version policies documented rather than inferred from the current workstation? [Dependency, Plan §Technical Context]
- [x] CHK038 Is the missing initial commit and Git remote recorded as a release-boundary dependency with a separate authorization path? [Dependency, Research §Decision 11]
- [x] CHK039 Are future hosted storage and runner transports required to pass the same graph and protocol conformance contracts before replacing local adapters? [Assumption, Research §Decision 1, §Decision 12]

## Ambiguities and Conflicts

- [x] CHK040 Is Graphology’s optional future role constrained to one-way projection, differential testing, or non-authoritative algorithms so it cannot become a second graph authority? [Ambiguity, Research §Decision 3]

## Notes

- All 40 requirement-quality checks passed on 2026-07-27 after cross-artifact analysis.
- The analysis added an explicit portability rule, eliminated isolated Solution nodes, completed
  Solution-to-task coverage, specified local session expiry, completed retention and closure
  semantics, documented toolchain compatibility policy, and required hosted adapters to pass the
  unchanged conformance contracts.
- This checklist evaluates requirement quality, not whether implementation exists.
