# Successor Data Model: Roles, Personas, and Assignments

**Authority**: approved `intent-v2`
**Solution**: proposed `solution-v2`
**Canonical format**: strict JSON with exact versioned graph references

This document extends [data-model.md](data-model.md). Unchanged entities and validation rules are
inherited without modification.

## Capability

```text
capabilityId          intent | solution | execution | verification
name
authorityMode
allowedProposalKinds[]
forbiddenActions[]
contractVersion
sourceIntentRefs[]
```

Capabilities are fixed operating modes. They do not identify a model or worker and do not grant
task authority by themselves.

## PersonaProfile

```text
personaId
version
name
perspective
expertise[]
priorities[]
communicationGuidance
knownBlindSpots[]
informsRoleRefs[]
selectionRationale
sourceIntentRefs[]
sourceSolutionRefs[]
status
```

Validation:

- all source and Role references resolve to exact current Solution node versions;
- at least one source and one informed Role exist;
- known blind spots and selection rationale are required;
- Persona fields are never accepted by permission, readiness, approval, lease, or independence
  calculations;
- unknown fields fail.

## RoleContract

```text
roleId
version
name
objective
responsibilities[]
requiredInputs[]
requiredOutputs[]
requiredCapabilityRef
dependencyRoleRefs[]
permissionCeiling
forbiddenActions[]
reviewObligations[]
acceptanceResponsibilities[]
selectionRationale
sourceIntentRefs[]
sourceSolutionRefs[]
independenceClass
status
```

Validation:

- objective is one sentence;
- responsibilities, inputs, outputs, permissions, forbidden actions, and acceptance
  responsibilities are non-empty;
- required Capability and every dependency resolve;
- Role dependency edges remain acyclic;
- permission ceiling cannot conflict with protected assertions;
- verifier classes cannot depend on or resolve to the producer assignment for the same result;
- every Role has a project-specific selection rationale and at least one Solution justification.

## TeamPlan

```text
teamPlanId
solutionSnapshotRef
roleRefs[]
personaRefs[]
capabilityRefs[]
dependencyEdges[]
informingEdges[]
independenceEdges[]
projectionRef
contentHash
```

TeamPlan is a deterministic selection over Solution Graph nodes, not a fourth authoritative graph.
Its hash covers exact refs and edges. Approval occurs only through the enclosing Solution Baseline.

## Execution Task Extensions

```text
roleRef
personaContextRefs[]
assignmentPolicyVersion
requiredIndependenceClass
```

Validation:

- `roleRef` resolves into the approved Solution Baseline;
- the Role capability matches task type;
- task inputs and outputs fit the Role contract;
- task allowed paths and actions are subsets of the Role ceiling;
- Persona refs are optional, exact, and informative only;
- verifier assignment class satisfies every applicable independence edge.

## TaskAssignment

```text
assignmentId
version
taskRef
roleRef
personaContextRefs[]
workerAdapterId
workerInvocationId
leaseRef
protectedIntentBaselineRef
protectedSolutionBaselineRef
effectivePermissionHash
status                proposed | authorized | active | completed |
                      rejected | expired | cancelled | superseded
assignedAt
completedAt
evidenceRefs[]
rejectionReason
```

Effective permission is calculated from structural allowlists only:

```text
Role ceiling
∩ task allowed paths and actions
∩ protected assertions
∩ owner-authorized lease
∩ provider capability report
∩ runner policy
```

Persona content is not an operand.

## Evidence Extensions

Every producer or verifier EvidenceRecord adds:

```text
assignmentRef
roleRef
workerAdapterId
workerInvocationId
independenceClass
```

Evidence acceptance fails if these references are absent, stale, inconsistent with the lease, or
not independent where required.

## Drift Extensions

Existing drift types remain unchanged. Team violations map as follows:

| Violation | Drift type |
|---|---|
| Unjustified Role or Persona | scope_drift |
| Role changes approved behavior | behavior_drift |
| Persona influences architecture without approval | architecture_drift |
| Role expands permissions | constraint_drift |
| Persona grants authority | constraint_drift |
| Producer verifies own work | acceptance_drift |
| Assignment omits required evidence | acceptance_drift |
| Role meaning changes between tasks | terminology_drift |

## State Transitions

```text
Solution proposal
→ team proposal validated
→ owner reviews combined Solution
→ Solution Baseline approved
→ Execution tasks compiled with Role refs
→ owner authorizes ready task
→ assignment and lease created atomically
→ worker active
→ evidence returned
→ independent assignment verifies
→ accepted or drift + idle repair
```

Any successor Role or Persona change pauses trace-affected assignments. Active stale leases are
cancelled; history remains immutable.
