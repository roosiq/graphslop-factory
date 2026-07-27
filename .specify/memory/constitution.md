<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles:
  - Template Principle 1 -> I. Explicit Approval Before Implementation
  - Template Principle 2 -> II. Immutable Baselines and Honest Intent State
  - Template Principle 3 -> III. Complete Graph Traceability
  - Template Principle 4 -> IV. Deterministic Control Plane, Replaceable Agents
  - Template Principle 5 -> V. Bounded Execution and Independent Verification
  - Added Principle VI. Structured Drift Repair and Failure Escalation
  - Added Principle VII. Least-Privilege Security and Deliberate Persistence
  - Added Principle VIII. Release Quality and Human Deployment Authority
- Added sections:
  - Factory Scope and Product Boundary
  - Graph Lifecycle and Quality Gates
- Clarified product boundary:
  - Intent, Solution, and Execution are machine-validatable runtime graphs, not documentation metaphors
  - ordinary language is the owner-facing graph control surface
  - first-release simplification applies to orchestration scale, not to graph identity or traceability
- Removed sections: none; template placeholders were resolved
- Dependent artifacts:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ updated: .specify/workflows/speckit/workflow.yml
  - ✅ reviewed: installed Hermes Spec Kit command skills; no stale agent-specific names
  - ✅ reviewed: no repository runtime guidance documents were present
- Follow-up TODOs: none
- Amendment rationale: the project owner explicitly directed Graphslop to retain its graph
  components and practice graph engineering through a caveman-simple interface.
-->
# Graphslop Constitution

## Core Principles

### I. Explicit Approval Before Implementation

The factory MUST distinguish drafting from approval. It MAY capture, clarify, and propose an
Intent Graph and MAY derive a proposed Solution Graph, but it MUST NOT write application code,
mutate implementation files, dispatch implementation workers, or begin an Execution Graph task
until an authorized human has explicitly approved both a versioned Intent Baseline and the
corresponding versioned Solution Baseline. Approval MUST be attributable, recorded, scoped to
specific baseline versions, and verified by deterministic code. A model agent MUST NOT approve
its own output. This gate prevents plausible model output from becoming unauthorized product
scope.

### II. Immutable Baselines and Honest Intent State

Approved Intent, Solution, and Execution baselines MUST be immutable and versioned. Each
correction or approved change MUST create a new version that supersedes, but never overwrites or
deletes, prior history. Human-stated, inferred, proposed, contradictory, and unresolved intent
MUST remain explicitly typed and distinguishable. Inferred or proposed intent MUST NOT be treated
as approved, even when it appears necessary or highly likely. Contradictions MUST remain visible
until an authorized human resolves them. This preserves an auditable account of what was known,
assumed, approved, corrected, and executed.

### III. Complete Graph Traceability

Every product-facing Solution Graph node MUST trace to one or more nodes in the approved Intent
Baseline. Every Execution Graph task MUST trace to one or more approved Solution Graph nodes and
therefore transitively to intent. Acceptance checks, verification evidence, drift findings, repair
tasks, commits, and pull-request changes MUST retain the relevant trace links. Orphan solution
nodes and orphan tasks MUST fail deterministic readiness checks. Any proposed scope expansion
MUST return to intent review and require new intent and solution approvals before implementation.
Traceability is the proof that generated work serves approved human intent rather than model
initiative.

### IV. Deterministic Control Plane, Replaceable Agents

Deterministic code, not model judgment, MUST control graph schemas, state transitions, dependency
readiness, baseline versioning, protected assertions, allowed paths, retry budgets, worktree
allocation, integration ordering, and merge gates. Model agents MAY interpret, propose, implement,
or verify only within capabilities granted by that control plane. They MUST be replaceable and
MUST NOT alter approved scope, grant approval, weaken protected assertions, mark their own work
ready, bypass a gate, or expand filesystem authority. Model output is untrusted input until it
passes deterministic validation. This division keeps safety and process invariants enforceable
when agents are inconsistent or replaced.

### V. Bounded Execution and Independent Verification

Every execution task MUST declare its solution-node trace, behavioral objective, prerequisites,
allowed paths, explicit exclusions, acceptance checks, required evidence, and bounded retry
policy before it is ready. The task MUST run in an isolated worktree or equivalently isolated
workspace, and writes outside its allowed paths MUST fail the task. Implementation and
verification MUST be performed by independent roles or agent identities; a verifier MUST inspect
artifacts and run acceptance checks rather than accept an implementer's self-report. A task MUST
NOT be marked complete without durable evidence tied to its acceptance checks. These boundaries
make execution reviewable, composable, and resistant to accidental scope growth.

### VI. Structured Drift Repair and Failure Escalation

Differences among an approved baseline, generated artifacts, repository state, and verification
results MUST produce a structured drift report containing expected state, observed state,
affected graph nodes, evidence, severity, and disposition. Repair work MUST be represented as new,
bounded, traceable Execution Graph tasks; it MUST NOT silently edit intent, solution scope, or
protected assertions. Retries MUST obey deterministic budgets. Exhausted retries, repeated failure
of the same assertion, unresolved drift, or contradictory evidence MUST halt the affected path and
escalate to an authorized human with the accumulated evidence. The factory MUST prefer a clear
blocked state over an unbounded autonomous loop or a false completion claim.

### VII. Least-Privilege Security and Deliberate Persistence

All actors, agents, tools, worktrees, credentials, network access, and filesystem access MUST use
least privilege and explicit allowlists. Secrets MUST NOT appear in prompts, logs, graph payloads,
or generated artifacts. The factory MUST minimize collected data and MUST NOT silently persist
prompts, repository content, personal data, telemetry, or model context beyond the declared and
approved retention boundary. New durable storage, external data transfer, or expanded permissions
MUST be disclosed and explicitly authorized before use. Security and privacy failures are
release-blocking and MUST preserve enough non-secret evidence for investigation.

### VIII. Release Quality and Human Deployment Authority

A user-facing release MUST include explicit accessibility requirements, responsive browser
behavior, operational observability, a tested rollback path, and browser-based acceptance
evidence for supported journeys and viewports. Missing evidence for any applicable release gate
MUST block release readiness. Production deployment and domain or traffic cutover MUST require
separate, explicit, verified authorization that identifies the target environment, approved
baseline, and release artifact. A model agent MUST NOT infer deployment permission from approval
to implement, verify, open a pull request, or deploy elsewhere. Human authority remains the final
boundary for irreversible or externally visible release actions.

## Factory Scope and Product Boundary

Graphslop is a standalone Caveman-to-Graph Software Factory. It accepts incomplete, informal,
contradictory, or minimal human requests and compiles them into three persistent products:

- an Intent Graph that preserves human statements, ambiguity, contradiction, inference,
  proposals, decisions, and approval state;
- an approved Solution Graph that explains the product-facing behavior and design chosen to
  satisfy an approved Intent Baseline; and
- a bounded Execution Graph whose dependency-ready tasks implement and independently verify the
  approved solution.

These are machine-validatable runtime graphs, not diagrams, prose specifications, or documentation
metaphors. Graph mutations, snapshots, traversals, compilation records, and cross-graph traces are
product behavior. The owner-facing control surface MUST remain ordinary language: a human MAY view
graph projections but MUST NOT need to author graph syntax, identifiers, schemas, task files, or
agent prompts to use the supported factory lifecycle.

First-release simplification MUST reduce orchestration scale around this graph kernel, not replace
the graphs. The initial product MAY use one worker adapter, sequential dispatch, file-backed graph
storage, and owner-authorized repair dispatch while retaining the complete graph identities,
vocabularies, baselines, transformations, and traceability contracts.

The MVP MUST support exactly one repository and one active project at a time. Its terminal product
is a reviewable draft pull request with traceability and verification evidence. Autonomous
production deployment, autonomous domain cutover, multiple repositories, and multiple concurrently
active projects are outside MVP scope. Any capability beyond this boundary requires a
constitution-compliant amendment or an approved later-version intent and solution baseline; it
MUST NOT enter as an agent convenience or hidden assumption.

## Graph Lifecycle and Quality Gates

The factory MUST enforce the following lifecycle in order:

1. Capture source statements without normalizing away incompleteness or contradiction. Classify
   each intent node by provenance and approval state.
2. Resolve or explicitly defer blocking contradictions, then record human approval of an
   immutable Intent Baseline.
3. Generate a trace-complete proposed Solution Graph. Record exclusions, protected assertions,
   risks, user-facing release obligations, and rollback expectations where applicable.
4. Record explicit human approval of an immutable Solution Baseline. Any later solution change
   that alters product-facing behavior MUST create a new version and repeat approval.
5. Generate a bounded Execution Graph from the approved Solution Baseline. Deterministic checks
   MUST reject missing traces, unmet dependencies, unbounded paths, absent acceptance checks, or
   missing verification assignments.
6. Execute ready tasks in isolated worktrees within their declared permissions. Capture produced
   artifacts, commands, results, and assertion outcomes as evidence.
7. Run independent verification. Failed checks or detected drift MUST create structured reports
   and bounded repair tasks, subject to retry budgets and escalation rules.
8. Integrate only evidence-backed, trace-complete work through deterministic merge gates and stop
   the MVP at a reviewable draft pull request.

A gate failure MUST leave the project in a typed blocked state with a reason and remediation path.
No role MAY reinterpret silence, elapsed time, model confidence, partial success, or a prior
approval of a different version as permission to advance.

## Governance

This constitution is the highest-authority project governance document. Specifications, plans,
tasks, workflows, model prompts, generated artifacts, pull requests, and release procedures MUST
comply with it. A conflict MUST be resolved by changing the lower-authority artifact; a
non-negotiable principle has no ad hoc waiver path.

Amendments require an explicit human decision, a documented rationale, a Sync Impact Report, and
updates to affected templates and runtime guidance. A model agent MAY draft an amendment but MUST
NOT ratify it. If an amendment changes approved product scope or invalidates an active baseline,
the affected graph MUST be versioned, re-approved, and migrated or retired explicitly.

Constitution versions use semantic versioning:

- MAJOR for removal or backward-incompatible redefinition of a principle or approval boundary;
- MINOR for a new principle, a new governance section, or materially expanded obligations; and
- PATCH for non-semantic clarification, wording correction, or formatting repair.

Every feature and pull request MUST record a Constitution Check. Before design work, the check
MUST verify an approved Intent Baseline and honest separation of proposed or inferred intent.
Before implementation, it MUST additionally verify an approved Solution Baseline, complete
traceability, bounded tasks, independent verification assignments, and deterministic gate
coverage. Before draft pull-request readiness, it MUST verify acceptance evidence, drift
resolution or explicit blocking, security and privacy compliance, and all applicable user-facing
release gates. Constitution compliance MUST be re-evaluated whenever a baseline version changes.

**Version**: 1.1.0 | **Ratified**: 2026-07-27 | **Last Amended**: 2026-07-27
