# Generated Team Requirements Quality Checklist

**Purpose**: Unit tests for the `intent-v2` and proposed `solution-v2` requirements
**Created**: 2026-07-27
**Audience**: Gate 2 product, architecture, security, and execution reviewers

## Requirement Completeness

- [x] CHK001 Are Persona fields, purpose, required traces, blind spots, and advisory-only boundary completely specified? [Completeness, Intent v2 §Approved Interpretation, §INT-027]
- [x] CHK002 Are Role objectives, responsibilities, inputs, outputs, capabilities, dependencies, permissions, exclusions, review duties, and acceptance obligations completely specified? [Completeness, Intent v2 §INT-026]
- [x] CHK003 Are task-to-Role, optional task-to-Persona, worker, lease, baseline, evidence, and verifier relationships documented? [Completeness, Intent v2 §INT-028, Data Model v2 §TaskAssignment]
- [x] CHK004 Are requirements defined for team generation, review, approval, assignment, execution, verification, drift, repair, and successor change? [Coverage, Intent v2 §Required Product Behavior]
- [x] CHK005 Is the distinction between authoritative graphs and the derived Team projection explicitly documented? [Completeness, Plan v2 §Summary]

## Requirement Clarity

- [x] CHK006 Is “advisory” defined by an explicit list of permission and authority calculations Persona content cannot affect? [Clarity, Intent v2 §Approved Interpretation]
- [x] CHK007 Is delegated worker authority defined as a deterministic intersection rather than a vague least-privilege goal? [Clarity, Plan v2 §Schema Extensions]
- [x] CHK008 Is project-specific team generation distinguished from a fixed universal cast with objective rejection criteria? [Clarity, Intent v2 §Acceptance Scenarios 1 and 7]
- [x] CHK009 Is independent verification defined using Role assignment, independence class, and worker invocation rather than display names or Personas? [Clarity, Contract §Independence]
- [x] CHK010 Is the lifecycle point at which team generation occurs unambiguous? [Clarity, Research v2 §Decision 3]

## Requirement Consistency

- [x] CHK011 Are generated Roles and Personas consistent with the constitution’s replaceable-agent and deterministic-control-plane principles? [Consistency, Plan v2 §Constitution Check]
- [x] CHK012 Is the new Persona allowance consistent with the narrowed EXC-007 prohibition on personality-derived authority? [Consistency, Intent v2 §Superseded Exclusion]
- [x] CHK013 Do Solution team nodes and Execution assignments preserve Intent-to-Solution-to-Execution trace direction? [Consistency, Plan v2 §Summary]
- [x] CHK014 Are one-owner, one-repository, one-provider, sequential-dispatch, repair-authorization, and no-deployment boundaries unchanged everywhere? [Consistency, Intent v2 §Unchanged Intent]
- [x] CHK015 Do the proposed Role permission ceiling and existing task allowlist both use the narrowest-bound-wins rule? [Consistency, Data Model v2 §TaskAssignment]

## Acceptance Criteria Quality

- [x] CHK016 Are measurable criteria defined for Role coverage, Persona non-authority, independent verification, complete traces, and seeded failure rejection? [Measurability, Intent v2 §Measurable Success]
- [x] CHK017 Can the project-specific-versus-universal-team requirement be objectively evaluated using materially different fixture projects? [Acceptance Criteria, Quickstart v2 §Scenario G]
- [x] CHK018 Can permission non-interference be objectively evaluated by changing Persona text while holding structural policy constant? [Acceptance Criteria, Quickstart v2 §Scenario H]
- [x] CHK019 Are exact failure codes defined for malformed, stale, over-privileged, unsupported, and self-verifying team state? [Acceptance Criteria, Contract §Required Failure Codes]
- [x] CHK020 Is owner comprehension measured without requiring raw graph serialization? [Measurability, Intent v2 §Measurable Success]

## Scenario and Edge-Case Coverage

- [x] CHK021 Are missing Role, missing Persona, extra Persona, stale Role, stale worker, dependency cycle, and unsupported capability cases addressed? [Coverage, Contract §Team Proposal, §Task Compilation]
- [x] CHK022 Are correction, supersession, active-lease cancellation, evidence reuse, and affected-work pause requirements defined for team changes? [Recovery, Data Model v2 §State Transitions]
- [x] CHK023 Are zero-Persona mechanical tasks explicitly permitted while every dispatchable task still requires a Role? [Edge Case, Plan v2 §Execution compilation]
- [x] CHK024 Is Role or Persona proposal failure atomic and prevented from partially changing a Solution proposal? [Exception Flow, Contract §Team Proposal]
- [x] CHK025 Are repeated failure and repair authorization still governed by existing bounded escalation rules? [Consistency, Intent v2 §Unchanged Intent]

## Security, Privacy, Accessibility, and Performance

- [x] CHK026 Are Persona injection, permission escalation, self-verification, secret exposure, and stale binding threats covered by explicit requirements? [Security, Plan v2 §Security and Privacy]
- [x] CHK027 Are persisted team fields and excluded hidden data categories documented within the existing retention boundary? [Privacy, Plan v2 §Security and Privacy]
- [x] CHK028 Are keyboard, semantic, focus, responsive, non-color status, loading, empty, stale, blocked, and error requirements defined for the Team projection? [Accessibility, Plan v2 §Owner experience, §Testing Strategy]
- [x] CHK029 Are performance fixtures required to include the larger Solution graph and derived Team projection? [Performance, Impact §T037]
- [x] CHK030 Are release, PR, merge, deployment, domain, and traffic authorities explicitly excluded from this change? [Authority, Intent v2 §Unchanged Intent, Plan v2 §Gate 2]

## Dependencies and Assumptions

- [x] CHK031 Is Solution approval identified as the prerequisite for binding Role refs into Execution tasks? [Dependency, Plan v2 §Gate 2]
- [x] CHK032 Are T001 evidence reuse, T002/T003 failure retention, repair reissue, modified work, and new tasks classified without rewriting history? [Dependency, Impact §Execution Impact]
- [x] CHK033 Is the proposed three-graph Team projection clearly labeled as a Solution default rather than frozen Intent? [Assumption, Impact §Architectural Decision]
- [x] CHK034 Are the four fixed capability modes separated from the project-specific generated Role set? [Consistency, Data Model v2 §Capability]
- [x] CHK035 Are model/provider identity and claimed expertise excluded as sources of Role or worker authority? [Security, Intent v2 §Non-Goals]
