# Successor Research: Generated Team Modeling

**Intent authority**: `intent-v2`
**Status**: Complete for Solution review; no unresolved technical clarification

## Decision 1: Keep Three Authoritative Graphs

**Decision**: Store Persona, Role, and Capability nodes in the Solution Graph, store task and worker
assignments in the Execution Graph, and derive a combined Team projection.

**Rationale**: Team composition explains how the approved Solution will be built, while assignment
is executable state. Existing exact cross-graph references, hashes, transformations, and approval
rules remain sufficient.

**Alternatives considered**:

- Fourth Team Graph: rejected for the first release because it creates another baseline,
  transformation, lifecycle, persistence, and approval surface without adding authority the
  existing graphs cannot express.
- Flat task prompt fields only: rejected because Roles, Personas, dependencies, and review
  relationships would lose graph identity, reuse, and navigable provenance.

## Decision 2: Roles Are Structural; Personas Are Advisory

**Decision**: Role contracts participate in task validation and permission ceilings. Persona
profiles may inform work but are excluded from authorization and permission calculation.

**Rationale**: This preserves the user’s requested generated personas without weakening the
constitution’s replaceable-agent and least-privilege requirements.

**Alternatives considered**:

- Personality-derived permissions: rejected as unreviewable and unsafe.
- No Personas: rejected because the owner explicitly added them to product scope.
- Persona-required execution: rejected; some mechanical tasks need a Role but no useful Persona.

## Decision 3: Generate the Team During Solution Planning

**Decision**: Team generation runs after product and architecture needs are visible but before
Solution approval. The generated team is reviewed and frozen inside the Solution Baseline.

**Rationale**: Roles must be justified by planned work, and task compilation needs approved Role
references. Generating the team during Intent discovery is premature; generating it after
Execution compilation is too late.

**Alternatives considered**:

- Intent-stage team generation: rejected because implementation boundaries are not known.
- Runtime-only generation: rejected because workers could invent their own authority.

## Decision 4: Bind Assignments Into Signed Task Leases

**Decision**: A lease binds the exact task, Role, optional Personas, worker adapter and invocation,
protected baselines, repository identity, permission hash, and expiry.

**Rationale**: Assignment drift must be detectable at the runner boundary, not merely visible in a
UI projection.

**Alternatives considered**:

- Unsigned prompt metadata: rejected because it cannot protect against stale or broadened
  assignment.
- Provider-specific agent identity: rejected because contracts must remain model-independent.

## Decision 5: Use Explicit Independence Classes

**Decision**: Roles declare one of `producer`, `specification_verifier`, `quality_verifier`, or
`integration_verifier`. Acceptance rules require distinct Role and invocation references across
the applicable producer-verifier edge.

**Rationale**: Merely changing a Role label or prompt is insufficient evidence of independent
verification.

**Alternatives considered**:

- Different Persona only: rejected because Persona has no authority or independence meaning.
- Same worker invocation with a new prompt: rejected because it is self-review.

## Decision 6: Preserve Failed Work and Reissue Repairs

**Decision**: Keep T002/T003 failures and their original repair proposals as immutable history.
After `solution-v2` approval, issue new repair IDs with current baseline hashes rather than editing
the old repair contracts.

**Rationale**: Exact baseline references and honest repair history matter more than reusing an old
identifier.

**Alternatives considered**:

- Edit old repair YAML: rejected because it would rewrite authorization context.
- Run old repairs against `intent-v1`/`solution-v1`: rejected because those baselines are no longer
  current.
