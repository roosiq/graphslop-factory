# Successor Intent Specification: Generated Roles and Advisory Personas

**Project**: Graphslop
**Successor Baseline**: `intent-v2`
**Supersedes**: `intent-v1` without modifying it
**Status**: Approved by the authenticated project owner
**Approved message**: “Freeze and continue.” on 2026-07-27

## Change Goal

Graphslop must generate the project-specific roles and personas needed to create the approved
application. The generated team structure must remain graph-native, traceable, reviewable, and
bounded by the same authority and drift controls as every other factory decision.

The owner continues to communicate in ordinary language. The owner is not required to invent agent
names, write prompts, assign permissions, or design a team manually.

## Approved Interpretation

- A **Persona** is advisory context: perspective, domain expertise, priorities, working style, and
  known blind spots relevant to the project.
- A **Role** is an enforceable work contract: objective, responsibilities, required inputs,
  required outputs, capabilities, dependencies, permission ceiling, forbidden actions, review
  obligations, and acceptance responsibilities.
- A replaceable model or tool worker may be assigned to a Role for a bounded task. The worker does
  not become an authority merely because it has a Persona or Role label.
- Personas may influence how a worker evaluates or communicates work, but may never grant tools,
  paths, credentials, actions, task readiness, approval, verification independence, release
  authority, or any other permission.
- Delegated execution authority is the intersection of the approved Role, the approved task
  contract, the current protected baselines, and an owner-authorized task lease. The narrowest
  bound wins.
- A producer may not verify or approve its own result. Independent verification requires a
  different role assignment and worker invocation.
- The generated team must be project-specific. Graphslop must not impose a fixed fictional cast or
  universal agent sequence on every application.

## Successor Intent Changes

### Superseded Nodes

- **INT-014 v2 — Capabilities, roles, and personas**: Intent, solution, execution, and independent
  verification remain model-independent authority modes. Graphslop additionally generates
  project-specific Roles and advisory Personas. Roles refine bounded responsibility inside those
  modes; Personas never create or expand authority. This supersedes `INT-014 v1`, which rejected
  personas categorically, while preserving its purpose of preventing personality-derived
  authority.
- **INT-017 v3 — MVP scope**: The first release additionally generates and displays the
  project-specific build team, binds every dispatchable task to an approved Role, and records the
  worker assignment used for implementation and verification. Sequential dispatch and one
  implemented execution-provider adapter remain unchanged.

### New Nodes

- **INT-025 — Generated project team**: After sufficient project and Solution understanding,
  Graphslop proposes the smallest project-specific set of Personas and Roles needed to design,
  implement, test, verify, and review the application.
- **INT-026 — Role contract**: Every generated Role records its objective, responsibilities,
  required inputs and outputs, required capability mode, dependencies, permission ceiling,
  forbidden actions, acceptance responsibilities, and independence constraints, with trace links
  to the approved Solution needs that justify it.
- **INT-027 — Persona contract**: Every generated Persona records its perspective, relevant
  expertise, priorities, communication guidance, known blind spots, and the Roles it may inform.
  Persona content is advisory, reviewable, replaceable, and never an authority source.
- **INT-028 — Assignment and independence**: Every dispatchable Execution task names an approved
  Role and records the assigned worker invocation. Persona context is optional and explicit.
  Implementation and verification for the same result must use independent Role assignments and
  worker invocations.
- **INT-029 — Team traceability**: The owner can inspect why each Role and Persona exists, which
  Solution nodes it supports, which tasks use it, what authority it lacks, and whether any
  assignment violates protected decisions or verification independence.

### Superseded Exclusion

- **EXC-007 v2**: Persistent fictional agent identities, personality-based permissions,
  personality-derived authority, role-play as a substitute for competence or evidence, and
  general-purpose multi-agent social chat remain excluded. Project-specific advisory Personas and
  enforceable Roles generated for approved work are no longer excluded.

### Decision

- **DEC-003 — Role authority and persona boundary**: The owner accepted the recommended
  interpretation by replying “Freeze and continue.” Roles carry bounded responsibility and
  delegated authority; Personas are advisory only. Worker processes remain replaceable.

## Required Product Behavior

1. Team generation may begin only from an approved Intent Baseline and a proposed Solution that
   exposes the work and review needs the team must cover.
2. Every proposed Role and Persona must cite one or more approved Intent or traceable Solution
   sources. Unjustified team nodes fail validation.
3. The team proposal must explain ordinary-language responsibilities, handoffs, dependencies,
   permissions, forbidden actions, review separation, and selection rationale.
4. The owner reviews team structure as part of Solution review. Team generation does not approve
   the Solution or authorize execution.
5. Execution compilation must reject a dispatchable task without an approved Role reference.
6. Runtime assignment must reject stale, missing, over-privileged, or self-verifying bindings.
7. Evidence must record Role, worker invocation, task, protected baselines, checks, and verifier
   assignment without storing secrets or hidden chain-of-thought.
8. Role or Persona changes after approval follow normal successor-baseline impact analysis.
9. A Persona suggestion that conflicts with Intent, Solution, task bounds, or protected assertions
   is ignored and recorded as a rejected proposal when material.
10. The owner can understand and correct the generated team without graph syntax or prompt
    engineering.

## Acceptance Scenarios

1. **Project-specific generation**: Given two materially different approved projects, team
   generation produces different justified Role and Persona sets rather than a universal cast.
2. **No persona authority**: Given a Persona that recommends database access but the task and Role
   prohibit it, assignment validation denies database access.
3. **Role-bounded execution**: Given a ready task, dispatch fails until an approved Role, bounded
   task contract, current baselines, owner authorization, and valid worker binding all agree.
4. **Independent verification**: Given an implementation result, the producing Role assignment or
   worker invocation cannot accept that result.
5. **Traceable team**: Given any generated Role or Persona, the owner can navigate to its source
   Solution needs, dependent tasks, permission boundary, and current assignments.
6. **Ordinary-language correction**: Given “drop the security persona; make security a required
   reviewer role,” Graphslop proposes a versioned team change and impact analysis without silently
   editing the approved team.
7. **No personality theater**: Given a colorful Persona description with no project need, the
   proposal is rejected as unjustified rather than retained for entertainment.

## Measurable Success

- 100% of dispatchable tasks reference an approved Role and exact protected baselines.
- 100% of Role permissions are no broader than the associated task and owner authorization.
- 100% of Persona fields are excluded from permission and authority calculations.
- 100% of accepted results have a verifier Role assignment and worker invocation independent from
  the producer.
- 100% of generated Role and Persona nodes have complete source traces and selection rationale.
- 100% of seeded stale, over-privileged, missing-role, persona-authority, and self-verification
  fixtures fail closed with reviewable reasons.
- At least 90% of representative owners can explain who is doing what, why the role exists, what it
  may change, and who verifies it within 60 seconds without reading graph serialization.

## Unchanged Intent

All `intent-v1` requirements not explicitly superseded above remain approved at their exact prior
versions. In particular:

- Intent, Solution, and Execution remain the authoritative graph pipeline.
- Models propose; deterministic code validates and changes state.
- No coding begins before approved Intent and Solution Baselines.
- Execution remains sequential in the first release.
- Repair remains idle until explicit owner authorization.
- The owner remains the sole approval and execution-authority actor.
- Draft pull-request readiness grants no push, merge, deployment, domain, or traffic authority.

## Non-Goals

- A social chat room for agents.
- Persistent fictional characters.
- Authority derived from writing style, persona, model brand, or claimed expertise.
- Parallel task execution in the first release.
- Autonomous repair, merge, deployment, or production release.
- A fourth authoritative project graph as an Intent requirement. The Solution proposal may choose
  a derived team projection over existing graph state.

## Readiness

The outcome, authority boundary, team-generation behavior, task binding, traceability, exclusions,
and success conditions are confirmed. No blocking Intent question remains. This successor Intent
is ready for an immutable `intent-v2` baseline and generation of a proposed `solution-v2`.
