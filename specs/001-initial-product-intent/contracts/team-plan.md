# Contract: Generated Team Plan and Assignment

## Authority

This contract is proposed under `intent-v2` and becomes binding only through an approved
`solution-v2`. Persona text is untrusted advisory input. Deterministic control-plane code owns
validation, IDs, versions, hashes, permissions, assignments, leases, and state transitions.

## Team Proposal

```text
proposeTeam(
  approvedIntentBaseline,
  proposedSolutionSnapshot,
  modelProposal
) -> TeamProposalResult
```

The proposal may suggest temporary Role, Persona, and dependency handles. The compiler:

1. assigns authoritative IDs and metadata;
2. validates strict schemas;
3. resolves every source and target;
4. validates capability, dependency, and independence compatibility;
5. rejects orphan, duplicate, circular, unjustified, or authority-bearing Persona nodes;
6. appends valid nodes and edges to the proposed Solution snapshot atomically;
7. emits trace and validation evidence.

No Team proposal freezes or approves the Solution.

## Team Projection

```text
projectTeam(solutionSnapshot, executionSnapshot?, templateVersion) -> Projection
```

The projection contains:

- Role and Persona names and statuses;
- selection rationale and Solution traces;
- Role responsibilities, inputs, outputs, capability, dependencies, permissions, exclusions,
  review obligations, and acceptance responsibilities;
- advisory Persona perspective, expertise, priorities, communication guidance, and blind spots;
- current task and worker assignments when an Execution snapshot exists;
- producer/verifier independence relationships.

The projection is derived, version-bound, hashable, and non-authoritative.

## Task Compilation

```text
compileTaskAssignmentPolicy(
  approvedSolutionBaseline,
  proposedExecutionTask
) -> AssignmentPolicyResult
```

Compilation fails unless:

- exactly one approved Role is selected;
- the Role is justified by Solution nodes satisfied by the task;
- the Role capability matches task type;
- the task is a subset of the Role permission ceiling;
- optional Persona refs resolve and add no authority;
- required verifier classes and independence edges exist;
- all refs name exact snapshots, versions, and hashes.

## Assignment Authorization

```text
authorizeAssignment(
  readyTask,
  roleRef,
  personaRefs,
  workerAdapter,
  ownerApproval
) -> TaskAssignment + SignedTaskLease
```

Authorization is atomic. Failure creates neither Assignment nor lease.

The effective permission hash is derived from canonical structural policy. Persona text, Role
display name, model name, and model claims are excluded.

## Runner Validation

Before invoking a worker, the runner must:

1. verify lease signature, expiry, cancellation generation, repository identity, base commit,
   task ref, Role ref, worker adapter, and protected baselines;
2. recompute the effective permission hash;
3. reject unknown, stale, missing, or broadened values;
4. generate the permission profile from structural policy only;
5. provide the Role contract and optional Persona context as non-authoritative instructions;
6. record the worker invocation ID before processing a result.

## Independence

For one candidate result:

```text
producer.assignmentId            != verifier.assignmentId
producer.roleRef                 != verifier.roleRef
producer.workerInvocationId      != verifier.workerInvocationId
producer.independenceClass       == producer
verifier.independenceClass       in specification_verifier |
                                    quality_verifier |
                                    integration_verifier
```

A different Persona, prompt, or display name does not satisfy independence.

## Required Failure Codes

```text
TEAM_SCHEMA_INVALID
TEAM_ORPHAN_NODE
TEAM_UNJUSTIFIED_ROLE
TEAM_UNJUSTIFIED_PERSONA
TEAM_DEPENDENCY_CYCLE
TEAM_UNSUPPORTED_CAPABILITY
PERSONA_AUTHORITY_FORBIDDEN
ROLE_PERMISSION_CONFLICT
ROLE_TASK_MISMATCH
ASSIGNMENT_STALE_REFERENCE
ASSIGNMENT_PERMISSION_ESCALATION
ASSIGNMENT_WORKER_MISMATCH
VERIFIER_NOT_INDEPENDENT
```

Every failure includes a redaction-safe path, expected rule, observed structural value, source
refs, and disposition. It never includes credentials, hidden prompts, or chain-of-thought.
