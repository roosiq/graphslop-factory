# Feature Specification: Initial Graphslop Product Intent

**Feature Branch**: `001-initial-product-intent`

**Created**: 2026-07-27

**Status**: Approved as `intent-v1`

**Input**: Product intent for a graph-native Caveman-to-Graph Software Factory, with graphslop.com as the leading deployment candidate and ordinary language as the owner-facing control surface.

## Intent and Scope Control *(mandatory)*

**Intent Status**: Approved as immutable baseline `intent-v1`. This approval authorizes generation and review of a proposed Solution Graph only. It MUST NOT authorize application coding, repository execution, task dispatch, merge, deployment, domain cutover, or traffic cutover.

**Intent Baseline**: `intent-v1`, approved by the authenticated project owner through the explicit message “Approved” on 2026-07-27 after the complete baseline summary was displayed.

### Human-Stated Intent

Each item below has provenance `user feature request, 2026-07-27`, normalized interpretation equal to the item text, confidence `explicit`, version `1`, and approval state `approved in intent-v1` unless stated otherwise. “Confirmed” means faithfully captured from the request and protected by the approved baseline at the listed version.

- **INT-001 — Project**: Graphslop is a standalone, graph-native Caveman-to-Graph Software Factory: caveman-simple ordinary-language input outside, typed graph engineering inside. **Status**: confirmed human statement, version `2`, superseding the narrower version `1` without deleting it. The tentative graphslop.com deployment target is preserved separately as an unapproved solution input.
- **INT-002 — Goal**: A software-project owner can begin with incomplete, informal, contradictory, or minimal language and turn the conversation into controlled, persistent, executable work without interpretation drift. **Status**: confirmed human statement.
- **INT-003 — Behavior**: The system does not begin coding from the first request; it first interprets the request and creates provisional understanding. **Status**: confirmed human statement.
- **INT-004 — Behavior**: The system identifies unknowns and contradictions, asks exactly one highest-value focused question per turn, and updates persistent project intent after each answer. **Status**: confirmed human statement.
- **INT-005 — Data**: The persistent Intent Graph contains typed nodes for projects, goals, users, problems, use cases, behaviors, inputs, outputs, constraints, preferences, exclusions, success criteria, assumptions, questions, decisions, examples, and risks. **Status**: confirmed human statement.
- **INT-006 — Data integrity**: Every Intent node preserves provenance, normalized interpretation, status, confidence, version, and approval state. Corrections supersede prior nodes without deleting history. **Status**: confirmed human statement.
- **INT-007 — Scope control**: Inferred and proposed nodes are never requirements unless the authenticated project owner explicitly accepts them into a new Intent Baseline. **Status**: confirmed human statement updated by the UNR-001 actor decision.
- **INT-008 — User view**: The owner sees compact confirmed, assumed, unresolved, and excluded views. Readiness is category-based; any blocking question overrides aggregate readiness. **Status**: confirmed human statement.
- **INT-009 — Decision control**: High-impact decisions require explicit human confirmation. The authenticated project owner explicitly approves an immutable, versioned Intent Baseline. **Status**: confirmed human statement updated by the UNR-001 actor decision.
- **INT-010 — Solution control**: After Intent Baseline approval, the system may propose a traceable Solution Graph. Product-facing Solution nodes trace to approved intent; support-only nodes are labeled implementation support. The authenticated project owner explicitly approves the Solution Baseline. **Status**: confirmed human statement updated by the UNR-001 actor decision.
- **INT-011 — Execution control**: Only after both approvals, the system compiles a dependency-aware Execution Graph and dispatches behaviorally bounded tasks. **Status**: confirmed human statement.
- **INT-012 — Task contract**: Every execution task traces to approved solution, references protected baseline versions, and declares dependencies, allowed paths, forbidden changes, required outputs, acceptance checks, retry limits, and required evidence. **Status**: confirmed human statement.
- **INT-013 — Enforcement**: Deterministic enforcement rejects execution before approvals, out-of-scope file changes, protected-decision violations, impossible state transitions, dependency violations, unbounded retries, and untraceable work. **Status**: confirmed human statement.
- **INT-014 — Capabilities**: Intent, solution, execution, and independent verification are model-independent operating modes, not personalities. **Status**: confirmed human statement.
- **INT-015 — Verification and repair**: Each result is independently verified. Drift produces a structured report and a bounded repair-task proposal. A repair never dispatches itself; the owner must authorize it. Repeated failure or exhausted retry limits halt affected work and escalate with evidence. **Status**: confirmed human statement, version `2`, preserving repair as an Execution Graph component while excluding an autonomous repair loop from the first release.
- **INT-016 — Change management**: A user change after approval triggers impact analysis and a proposed new baseline that distinguishes unaffected, changed, discarded, and new work. Affected work remains paused until explicit reapproval. **Status**: confirmed human statement.
- **INT-017 — MVP scope**: The MVP proves one complete graph compiler path for one owner, one active project, one repository, one implemented execution-provider adapter, and at most one dispatched task at a time. It includes conversational intake, the complete typed Intent, Solution, and Execution Graphs, immutable approvals, sequential dependency-aware execution, independent verification, drift reports, owner-authorized repair tasks, requirement-to-code traceability, and a reviewable draft pull request. **Status**: confirmed human scope decision, version `2`, superseding the broader first-release interpretation without deleting it.
- **INT-018 — Completion**: Completion requires accepted tasks, passing system-level checks, evidence for success criteria, no blocking drift, conformance to the latest approved baselines, and a reviewable draft pull request. **Status**: confirmed human statement.
- **INT-019 — Access boundary**: Owner-only private workspace. Only one authenticated project owner may access project state; that same owner alone may connect the sole repository and authorize execution. Public visibility of graphslop.com grants neither project-state access nor repository authority. **Status**: confirmed human clarification; resolved; unapproved.
- **INT-020 — Specification boundary**: This intent specification remains independent of technical frameworks, databases, model providers, and hosting implementation. It does not implement code or define a solution plan. **Status**: confirmed human statement.
- **INT-021 — Normative factory contracts**: The original brief explicitly defines the intent, solution, and execution graph vocabularies; answer classifications; question-value formula; readiness categories and thresholds; blocking-question rules; execution-task contract; agent authority boundaries; drift taxonomy; lifecycle states; and persistent audit artifacts. These graph contracts MUST remain first-class machine-validatable product behavior rather than being flattened into prose documents. **Status**: confirmed human statement, version `2`, strengthened by the graph-engineering clarification.
- **INT-022 — Graph engineering**: Intent, Solution, and Execution are real persistent graphs, not diagrams or documentation metaphors. Graph mutations, graph-to-graph compilation, baseline snapshots, dependency traversal, contradiction detection, impact traversal, and trace validation are core product operations. **Status**: confirmed human clarification.
- **INT-023 — Caveman control surface**: The owner communicates and corrects the project in ordinary, incomplete language and is never required to author graph syntax, node identifiers, edge types, task YAML, or agent prompts. Human-readable summaries are projections of the authoritative graphs. **Status**: confirmed human clarification.
- **INT-024 — First-release operational boundary**: The first release validates the graph compiler with sequential execution and one implemented worker adapter. Parallel workers, multiple implemented provider adapters, autonomous repair dispatch, a required public developer API, complex graph infrastructure, and a requirement that repository code execute inside the hosted web application are deferred productization work, not graph-kernel requirements. **Status**: confirmed human scope decision.

### Proposed or Inferred Intent

These items have provenance `specification author interpretation, 2026-07-27`, normalized interpretation equal to the item text, version `1`, approval state `unapproved`, and are not requirements.

- **PIN-001**: “Highest-value question” was provisionally interpreted as the single unanswered question expected to reduce the most blocking uncertainty, decision impact, dependency risk, or execution risk. **Rationale**: made question selection reviewable before the original formula was restored. **Status**: superseded by the explicit human formula in NC-006; retained as version-1 history; confidence medium; approval state unapproved.
- **PIN-002**: No relationship was assumed among product visitor, project owner, baseline approver, repository execution authorizer, and deployment authorizer while UNR-001 was unresolved. **Rationale**: avoided deciding the authority boundary by implication. **Status**: superseded by the explicit human resolution of UNR-001; retained as version-1 history; confidence high; approval state unapproved.

### Deferred Solution Inputs

The original brief suggested, but did not require at the intent layer, graphslop.com as the deployment target, a web interface, an orchestration service, local or hosted relational storage, Git worktrees, schema validation, GitHub as the pull-request boundary, versioned JSON storage for the first implementation, and a concrete HTTP action surface. The exact candidates are preserved in [solution-inputs.md](solution-inputs.md) for gate 2. They MUST NOT be treated as approved product requirements or selected technologies until the Solution Graph is proposed and approved.

### Contradictions and Clarification Decisions

- **UNR-001 — Hosted access and repository authority**: **Question resolved**: Who may access the hosted product, and which actor may connect a repository and authorize execution against it? **Current answer (Option A, recorded exactly)**: Owner-only private workspace. Only one authenticated project owner may access project state; that same owner alone may connect the sole repository and authorize execution. **Effect**: this authority decision is no longer a clarification blocker, but repository connection and execution remain prohibited until all applicable baseline approvals and execution gates are satisfied. It grants no merge, deployment, domain-cutover, or traffic-cutover authority. **Status**: resolved by explicit human clarification and approved in `intent-v1`. **Metadata**: provenance `user feature request and user clarification, 2026-07-27`; normalized interpretation equal to the recorded answer; confidence `explicit`; version `2`, superseding unresolved version `1` without deleting its history; approval state `approved in intent-v1`.
- **DEC-002 — Graph-native scope calibration**: **Decision resolved**: Preserve the graph architecture while reducing first-release operational scope. **Current answer (recorded from the owner’s correction and approval)**: “Retain the graph components. Remember we are doing the new trending ‘graph engineering’ here but as a caveman.” Followed by: “Sick. Do it.” **Effect**: all three typed graphs, their vocabularies, compilation stages, and traceability remain core MVP behavior. The first release uses sequential execution and one implemented worker adapter and does not require parallel workers, an autonomous repair loop, multiple provider implementations, a public developer API, a graph database, or hosted repository execution. **Status**: resolved by explicit human correction and approved in `intent-v1`.
- No direct contradictions are currently recorded. New contradictions remain visible until a correction or decision supersedes them; they are never silently reconciled.

### Compact Intent Views

- **Confirmed**: INT-001 through INT-024 are explicit human statements approved at their listed versions in `intent-v1`.
- **Assumed / proposed**: None remain active. PIN-001 and PIN-002 are superseded historical context.
- **Resolved decisions**: UNR-001 records the owner-only private-workspace authority boundary. DEC-002 records the graph-native, caveman-simple product thesis and reduced first-release operating boundary. Both are protected by `intent-v1`.
- **Unresolved**: None currently recorded.
- **Excluded**: EXC-001 through EXC-009 below.

### Explicit Exclusions

Each exclusion has provenance `user feature request, 2026-07-27`, normalized interpretation equal to its item text, status `confirmed exclusion`, confidence `explicit`, version `1`, and approval state `approved in intent-v1`.

- **EXC-001**: Visual graph editing.
- **EXC-002**: General multi-agent chat.
- **EXC-003**: Autonomous production deployment, domain cutover, or traffic cutover.
- **EXC-004**: Multiple simultaneous repositories.
- **EXC-005**: More than one active project at a time.
- **EXC-006**: Organization marketplaces.
- **EXC-007**: Agent personality systems or personality-based authority.
- **EXC-008**: Complex graph databases and self-modifying prompts as product requirements.
- **EXC-009**: Unrestricted background operation, unbounded retries, or work outside explicitly authorized scope.
- **EXC-010**: More than one implemented execution-provider adapter in the first release. Contracts remain provider-independent.
- **EXC-011**: Parallel task dispatch in the first release.
- **EXC-012**: Automatic dispatch of repair tasks or an autonomous repair loop. Repair remains a typed Execution Graph operation requiring owner authorization.
- **EXC-013**: A public developer API as a first-release requirement. The product action surface remains transport-independent.
- **EXC-014**: A requirement that repository code execute within the graphslop.com web runtime. The execution boundary is a Solution Graph decision and may use an owner-authorized local or isolated runner.

### MVP Boundary

- The MVP operates on exactly one active project and one repository at a time.
- The MVP has one authenticated project owner as its only hosted project-state actor. The same owner is the only actor permitted to connect the sole repository and authorize execution.
- A public graphslop.com surface does not expose project state or confer repository authority.
- The MVP retains complete typed Intent, Solution, and Execution Graphs. They are authoritative runtime state, and their human-readable summaries are projections rather than replacements.
- The owner controls the factory in ordinary language and never needs to manipulate graph syntax.
- The MVP implements one execution-provider adapter, dispatches at most one task at a time, and requires explicit owner authorization before a proposed repair task may run.
- Its user-facing lifecycle runs from conversational intent intake through a reviewable draft pull request with traceability and verification evidence.
- It ends at a draft pull request. Merge, production deployment, domain cutover, and traffic cutover require separate scope and explicit human authorization.
- It exposes intent, solution, execution, and independent-verification capabilities as replaceable operating modes rather than personas.
- This specification and its immutable `intent-v1` snapshot authorize proposed Solution Graph generation and review only. They do not authorize implementation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clarify Rough Intent Without Coding (Priority: P1)

As a software-project owner, I can submit a rough or contradictory request and see a faithful provisional interpretation while the system asks one focused question at a time instead of beginning implementation.

**Why this priority**: Preventing premature coding and interpretation drift is the product’s foundational value and safety boundary.

**Independent Test**: Supply incomplete, minimal, and contradictory sample requests. Confirm that each creates provisional typed intent, exposes unknowns or contradictions, asks one question only, and causes no repository execution or application-code change.

**Acceptance Scenarios**:

1. **Given** a first informal request and no approved baselines, **When** the owner submits it, **Then** the system records source statements and provisional normalized interpretations, shows their unapproved status, and performs no coding or repository execution.
2. **Given** several unresolved questions, **When** the next clarification turn begins, **Then** exactly one focused question is presented and its stated selection rationale identifies why it has the highest current value.
3. **Given** two statements that conflict, **When** both are captured, **Then** both remain in history, the contradiction is visible, and the system does not silently choose either statement.
4. **Given** a correction to an earlier statement, **When** the correction is accepted as the current human statement, **Then** a new version supersedes the old node while the prior node and its provenance remain reviewable.

---

### User Story 2 - Approve a Stable Intent Baseline (Priority: P1)

As the authenticated project owner, I can review compact intent views and explicitly approve a specific immutable version only when blocking questions and high-impact decisions are resolved.

**Why this priority**: A controlled baseline is the authority boundary between understanding a request and proposing how to satisfy it.

**Independent Test**: Construct project states with and without a blocking question, attempt approval, and verify that only an attributable approval of the exact ready version succeeds and that the approved content cannot be altered.

**Acceptance Scenarios**:

1. **Given** confirmed, assumed, unresolved, and excluded nodes, **When** the owner reviews project state, **Then** each category is compactly visible and proposals are distinguishable from requirements.
2. **Given** any blocking question, **When** baseline approval is attempted, **Then** approval is rejected even if every other readiness category is ready.
3. **Given** no blockers and confirmed high-impact decisions, **When** the authenticated project owner approves the displayed version, **Then** the approval records actor, scope, version, and time and produces an immutable Intent Baseline.
4. **Given** an approved baseline, **When** any later correction is made, **Then** the original remains unchanged and the correction appears only in a proposed successor version.
5. **Given** UNR-001 has been resolved in the draft, **When** no explicit Intent Baseline approval has occurred, **Then** the draft remains unapproved and mutable rather than being treated as an approved or frozen baseline.

---

### User Story 3 - Review and Approve a Traceable Solution (Priority: P1)

As the authenticated project owner, I can review a proposed Solution Graph whose product-facing choices trace to approved intent, distinguish implementation-support work, and explicitly approve one version before execution is compiled.

**Why this priority**: Intent approval alone does not authorize a proposed solution or code-producing work.

**Independent Test**: Use a controlled approved Intent Baseline and candidate Solution Graphs containing valid traces, an orphan product node, and a labeled support-only node. Confirm that only the trace-complete candidate can be approved.

**Acceptance Scenarios**:

1. **Given** no approved Intent Baseline, **When** solution approval or execution compilation is requested, **Then** the request is rejected.
2. **Given** a proposed product-facing Solution node, **When** it lacks a trace to approved intent, **Then** solution readiness and approval are blocked.
3. **Given** a support-only Solution node, **When** it is labeled implementation support and linked to the approved solution work it enables, **Then** it is not misrepresented as a human requirement.
4. **Given** a trace-complete proposed solution, **When** the authenticated project owner approves its exact version, **Then** the immutable Solution Baseline and attributable approval become reviewable.

---

### User Story 4 - Execute Bounded, Dependency-Aware Work (Priority: P2)

As the authenticated project owner, I can allow only ready tasks from approved baselines to run one at a time within declared behavioral, dependency, path, retry, output, acceptance, and evidence bounds.

**Why this priority**: Controlled execution converts approved intent into work without granting agents authority to expand scope.

**Independent Test**: Compile tasks from controlled approved baselines, then exercise valid and invalid states for approvals, traces, dependencies, path changes, protected decisions, retries, and required evidence.

**Acceptance Scenarios**:

1. **Given** both required approved baselines, **When** execution is compiled, **Then** every task names its solution trace, protected baseline versions, dependencies, allowed paths, forbidden changes, outputs, acceptance checks, retry limit, and evidence.
2. **Given** unmet dependencies, **When** task dispatch is attempted, **Then** dispatch is rejected and the unmet dependency is shown.
3. **Given** a worker attempts an out-of-scope file change or protected-decision violation, **When** the result is evaluated, **Then** the task fails without accepting the prohibited change and records non-secret evidence.
4. **Given** an exhausted retry limit, **When** another retry is requested, **Then** it is rejected and affected work is escalated rather than looping.
5. **Given** an unauthenticated actor or any actor other than the one authenticated project owner, **When** repository connection or execution authorization is attempted, **Then** the action is rejected without granting project-state or repository access.
6. **Given** the authenticated project owner authorizes execution, **When** either required baseline is not approved or another execution gate fails, **Then** execution remains rejected because owner authority does not bypass lifecycle gates.
7. **Given** one task is already dispatched, **When** another task becomes dependency-ready, **Then** the second task remains queued until the first task returns a terminal result.

---

### User Story 5 - Independently Verify, Repair, and Escalate (Priority: P2)

As the authenticated project owner, I receive independent evidence for each task, structured drift reports for mismatches, bounded repair-task proposals for recoverable failures, and clear escalation for repeated failure.

**Why this priority**: Completion claims are trustworthy only when separated from the implementer’s self-report and checked against approved state.

**Independent Test**: Feed the verifier conforming work, drifted work, failed acceptance checks, and repeated repair failures; confirm acceptance, reporting, bounded repair generation, and escalation behavior.

**Acceptance Scenarios**:

1. **Given** a worker reports completion, **When** independent verification has not produced required evidence, **Then** the task remains unaccepted.
2. **Given** observed work differs from approved expectations, **When** verification runs, **Then** a drift report records expected state, observed state, affected graph nodes, severity, evidence, and disposition.
3. **Given** repairable drift within the retry budget, **When** verification completes, **Then** a new bounded repair-task proposal traces to the failed task and protected baselines without altering approved intent or solution.
4. **Given** a proposed repair task, **When** the owner has not authorized its dispatch, **Then** it remains non-dispatchable and no autonomous repair loop begins.
5. **Given** repeated failure, exhausted retries, contradictory evidence, or unresolved blocking drift, **When** the escalation condition is met, **Then** affected work halts and the authenticated project owner receives the accumulated evidence and required decision.

---

### User Story 6 - Revise Approved Intent Without Losing History (Priority: P2)

As the authenticated project owner, I can request a change after approval and understand its impact before affected work resumes under newly approved baselines.

**Why this priority**: Real projects change, but change must not silently invalidate already approved or completed work.

**Independent Test**: Change an approved decision that affects only part of a sample graph and verify classification, pause boundaries, successor baselines, and reapproval requirements.

**Acceptance Scenarios**:

1. **Given** approved baselines and existing work, **When** the owner changes intent, **Then** an impact analysis classifies work as unaffected, changed, discarded, or new and cites the affected traces.
2. **Given** a proposed successor baseline, **When** impact analysis is incomplete or reapproval is absent, **Then** affected work remains paused while demonstrably unaffected work retains its recorded status.
3. **Given** explicit approval of the successor Intent and Solution Baselines, **When** work resumes, **Then** affected tasks reference the new protected versions and obsolete tasks cannot run.

---

### User Story 7 - Finish at a Reviewable Draft Pull Request (Priority: P3)

As the authenticated project owner, I can review a draft pull request only after all required work and evidence conform to the latest approved baselines, without granting merge or deployment authority.

**Why this priority**: The draft pull request is the MVP’s terminal artifact and a human review boundary, not an autonomous release.

**Independent Test**: Exercise completion with accepted and unaccepted tasks, passing and failing system checks, missing and present success evidence, blocking and resolved drift, and current and stale baselines.

**Acceptance Scenarios**:

1. **Given** any unaccepted required task, failed system check, missing success-criterion evidence, blocking drift, or stale-baseline work, **When** completion is evaluated, **Then** the project remains incomplete and names each blocker.
2. **Given** all completion conditions are satisfied, **When** the terminal artifact is produced, **Then** it is a reviewable draft pull request with requirement-to-change traces and verification evidence.
3. **Given** a reviewable draft pull request, **When** no separate merge or deployment authorization exists, **Then** no merge, production deployment, domain cutover, or traffic cutover occurs.

### Edge Cases

- A one-word request remains source-faithful; the system does not invent missing requirements and asks only the highest-value question.
- A statement can be both low-confidence in normalized meaning and high-confidence in provenance; these dimensions remain separate.
- An answer resolves one question but creates another contradiction; the resolved question is versioned and the new contradiction becomes visible in the next state.
- Two corrections arrive for the same node; each forms a supersession chain and no historical value is overwritten.
- A readiness category reports ready while a blocking question exists elsewhere; overall readiness remains blocked.
- A user attempts to approve a baseline other than the version currently displayed; the approval is rejected or requires explicit selection and review of that exact version.
- A product-facing Solution node traces only to an unapproved proposal; it is treated as untraceable to approved intent.
- An implementation-support node changes observable product behavior; it must be reclassified as product-facing and traced to approved intent before approval.
- A task has an allowed path that overlaps a forbidden change; the forbidden change wins and dispatch or acceptance is rejected.
- A dependency is later invalidated by a new baseline; dependent affected tasks return to a blocked state.
- A worker produces expected files but omits required evidence; the task is not accepted.
- A verifier and worker resolve to the same role or agent identity for the same result; independent verification is not satisfied.
- A repair would alter a protected decision; repair is blocked and escalated rather than widening its own scope.
- A late change leaves some work unaffected; unaffected work is not needlessly discarded, but its classification must be traceable and reviewable.
- A public visitor reaches graphslop.com; project state remains private, and no repository connection or execution authority is granted.
- A second authenticated identity attempts to access the active project, connect its repository, or authorize execution; every action fails closed because the MVP has one authenticated project owner.
- The authenticated project owner’s session expires during an authority-bearing action; the action fails without connecting the repository or authorizing execution.
- A browser session ends mid-clarification; persistent human-readable state allows the authenticated project owner to resume without losing source history or approval state.
- Two candidate questions have equal computed value; the system records the tie and selects deterministically without presenting both.
- A readiness score reaches a numeric threshold while a blocking question remains; the blocking question wins and advancement is rejected.
- Confidence in an interpretation is high while required outcome or workflow categories remain incomplete; confidence MUST NOT be presented as project completeness.
- A model proposes a new page, integration, storage behavior, user type, or output meaning during execution; the proposal is blocked and returned as a decision request rather than entering the task.
- A human-readable summary and the underlying graph disagree; the graph version and projection error are shown, and approval is blocked until the projection is regenerated or the graph is corrected.
- A user expresses a correction without graph vocabulary; the system derives a proposed graph delta and asks for ordinary-language confirmation rather than requiring manual node or edge editing.
- A second task becomes ready while another is dispatched; it remains queued because first-release execution concurrency is one.
- A verifier proposes a repair task; it remains in a proposed state until the owner explicitly authorizes dispatch.

## Requirements *(mandatory)*

### Functional Requirements

#### Conversational Intent and Persistent State

- **FR-001** *(Intent: INT-002, INT-003)*: On a project’s first request, the system MUST create provisional understanding and MUST NOT write application code, mutate repository content, dispatch execution, or claim implementation readiness.
- **FR-002** *(Intent: INT-002, INT-006)*: The system MUST preserve each source statement separately from its normalized interpretation so a reviewer can compare what was said with what was understood.
- **FR-003** *(Intent: INT-004)*: The system MUST identify unknowns and contradictions after every material intake or correction.
- **FR-004** *(Intent: INT-004)*: In each clarification turn, the system MUST present exactly one focused unresolved question and MUST record why that question has the highest current value.
- **FR-005** *(Intent: INT-004, INT-006)*: After each answer, the system MUST append a versioned state change and refresh affected intent, contradiction, assumption, decision, and readiness views without deleting prior history.
- **FR-006** *(Intent: INT-005)*: The Intent Graph MUST support nodes typed as project, goal, user, problem, use case, behavior, input, output, constraint, preference, exclusion, success criterion, assumption, question, decision, example, or risk.
- **FR-007** *(Intent: INT-006)*: Every Intent node MUST expose provenance, normalized interpretation, status, confidence, version, and approval state.
- **FR-008** *(Intent: INT-006)*: A correction MUST create a successor linked to the prior node; it MUST NOT overwrite or delete the corrected node.
- **FR-009** *(Intent: INT-007)*: Inferred and proposed nodes MUST be visibly typed as such and MUST NOT be treated as requirements, approval evidence, or execution authority.
- **FR-010** *(Intent: INT-008)*: The project state MUST provide compact confirmed, assumed, unresolved, and excluded views, with direct access to provenance and version history for each item.
- **FR-011** *(Intent: INT-008)*: Readiness MUST be reported by category, including at minimum scope, users and authority, behavior, constraints and exclusions, success criteria, and risks and permissions.
- **FR-012** *(Intent: INT-008)*: Any blocking question or contradiction MUST set overall readiness to blocked regardless of category scores or confidence.
- **FR-013** *(Intent: INT-009)*: Any decision marked high impact because it changes scope, authority, protected behavior, security, privacy, cost exposure, or irreversible work MUST require explicit human confirmation.
- **FR-014** *(Intent: INT-019)*: The system MUST enforce an owner-only private workspace: only one authenticated project owner may access project state, and that same owner alone may connect the sole repository and authorize execution. Every other actor MUST fail closed, and public site visibility MUST grant neither project-state access nor repository authority.

#### Baseline Approval and Immutability

- **FR-015** *(Intent: INT-009, INT-019)*: Intent Baseline approval MUST require no unresolved blockers and explicit authorization attributable to the authenticated project owner for one displayed version and scope.
- **FR-016** *(Intent: INT-009)*: An approved Intent Baseline MUST be immutable and retain its content, version, approving actor, approval time, and supersession status.
- **FR-017** *(Intent: INT-009, INT-013)*: Approval of a draft, a different version, a prior version, or a partial view MUST NOT authorize the current version.
- **FR-018** *(Intent: INT-007, INT-009)*: Accepting a proposed or inferred node as a requirement MUST create a successor Intent Baseline candidate and require explicit approval; it MUST NOT mutate an approved baseline.

#### Traceable Solution Control

- **FR-019** *(Intent: INT-010)*: The system MUST NOT treat an Intent Baseline as permission to approve a solution or execute work.
- **FR-020** *(Intent: INT-010)*: Every product-facing Solution node MUST trace to at least one node in the approved Intent Baseline and show the relationship it satisfies.
- **FR-021** *(Intent: INT-010)*: A support-only Solution node MUST be labeled implementation support, linked to the approved solution work it enables, and MUST NOT be presented as a human requirement.
- **FR-022** *(Intent: INT-010, INT-013)*: Orphan product-facing Solution nodes and support nodes that introduce unapproved observable behavior MUST block solution readiness and approval.
- **FR-023** *(Intent: INT-010, INT-019)*: Solution approval MUST be explicit, attributable to the authenticated project owner, scoped to one exact version, and recorded as an immutable Solution Baseline.

#### Dependency-Aware, Bounded Execution

- **FR-024** *(Intent: INT-011, INT-013, INT-019)*: Execution Graph compilation and task dispatch MUST be rejected unless the referenced Intent and Solution Baselines are both approved and mutually current and the same authenticated project owner has explicitly authorized execution.
- **FR-025** *(Intent: INT-011, INT-012)*: Every Execution task MUST trace to approved Solution nodes and transitively to the approved Intent Baseline.
- **FR-026** *(Intent: INT-012)*: Before a task is ready, it MUST declare protected Intent and Solution Baseline versions, behavioral objective, dependencies, allowed paths, forbidden changes, required outputs, acceptance checks, bounded retry limit, required evidence, and independent verification assignment.
- **FR-027** *(Intent: INT-011, INT-012)*: A task MUST become dispatchable only when every dependency is accepted and its protected baselines remain current.
- **FR-028** *(Intent: INT-013)*: The control plane MUST reject any attempt to dispatch or accept untraceable work.
- **FR-029** *(Intent: INT-013)*: The control plane MUST reject any task transition not permitted from its current state and record the attempted transition and reason without advancing state.
- **FR-030** *(Intent: INT-013)*: The control plane MUST reject task dispatch when any dependency is unmet, failed, discarded, or invalidated.
- **FR-031** *(Intent: INT-013)*: The control plane MUST reject and prevent acceptance of file changes outside allowed paths or changes matching a task’s forbidden-change rules.
- **FR-032** *(Intent: INT-013)*: The control plane MUST reject and prevent acceptance of changes that violate a protected decision or referenced baseline assertion.
- **FR-033** *(Intent: INT-013, INT-015)*: Every retry limit MUST be finite; another retry after exhaustion MUST be rejected and escalated.
- **FR-034** *(Intent: INT-014, INT-024)*: Intent, solution, execution, and independent verification MUST be represented as model-independent capabilities with explicit authority boundaries, not personalities or persona-derived permissions. The first release MUST implement exactly one execution-provider adapter while keeping its graph and task contracts provider-independent.

#### Independent Verification, Drift, and Repair

- **FR-035** *(Intent: INT-015)*: A task result MUST be evaluated by an independent verifier that did not produce that result, and an implementer’s self-report alone MUST NOT satisfy acceptance.
- **FR-036** *(Intent: INT-012, INT-015)*: A task MUST remain unaccepted until each acceptance check has durable pass evidence or an explicit blocking result tied to the task and baseline versions.
- **FR-037** *(Intent: INT-015)*: A mismatch among protected baselines, graph state, repository changes, required outputs, acceptance results, or observed behavior MUST create a drift report containing expected state, observed state, affected nodes and tasks, severity, evidence, and disposition.
- **FR-038** *(Intent: INT-015, INT-024)*: Repairable drift MUST produce a new bounded repair-task proposal with its own traces, dependencies, paths, forbidden changes, outputs, acceptance checks, retry limit, evidence, and independent verifier. It MUST remain non-dispatchable until the authenticated project owner explicitly authorizes it.
- **FR-039** *(Intent: INT-015)*: A repair task MUST NOT modify approved intent, approved solution scope, protected decisions, or its own authority bounds.
- **FR-040** *(Intent: INT-015, INT-019)*: Repeated failure of the same acceptance condition, exhausted retries, contradictory evidence, or unresolved blocking drift MUST halt affected work and escalate to the authenticated project owner with accumulated evidence and a requested decision.

#### Approved Change Management and Completion

- **FR-041** *(Intent: INT-016)*: A user-requested change after approval MUST create a proposed successor intent version and an impact analysis that classifies related work as unaffected, changed, discarded, or new with supporting traces.
- **FR-042** *(Intent: INT-016)*: Affected work MUST pause immediately after a baseline-changing proposal and MUST NOT resume until successor Intent and Solution Baselines are explicitly approved.
- **FR-043** *(Intent: INT-016)*: Unaffected work MAY retain its prior status only when impact analysis demonstrates that its intent, solution, protected decisions, dependencies, and acceptance evidence remain valid.
- **FR-044** *(Intent: INT-016)*: Obsolete or discarded tasks MUST remain in history, be non-dispatchable, and identify the successor baseline or decision that invalidated them.
- **FR-045** *(Intent: INT-017, INT-019, INT-024)*: Within the one authenticated project owner’s private workspace, the MVP MUST permit exactly one active project, one connected repository, one implemented execution-provider adapter, and at most one dispatched task at a time. It MUST reject a second project, repository, owner, delegated execution authorizer, adapter selection, or concurrent dispatch until the conflicting state is closed or terminal through an authorized action.
- **FR-046** *(Intent: INT-017)*: The MVP MUST maintain versioned, human-readable project state covering intent, contradictions, assumptions, decisions, approvals, solution traces, tasks, evidence, drift, repair, and completion status.
- **FR-047** *(Intent: INT-017, INT-018)*: Requirement-to-change traceability MUST allow a reviewer to navigate from approved intent through solution and execution tasks to changed repository artifacts, acceptance checks, and evidence, and back again.
- **FR-048** *(Intent: INT-018)*: The project MUST be marked complete only when all required tasks are accepted, all required system-level checks pass, every success criterion has evidence, no blocking drift remains, and all accepted work conforms to the latest approved baselines.
- **FR-049** *(Intent: INT-017, INT-018)*: The MVP’s terminal artifact MUST be a reviewable draft pull request that identifies protected baseline versions, traced requirements, included changes, acceptance evidence, unresolved non-blocking risks, and explicit non-authorization for merge or deployment.
- **FR-050** *(Intent: INT-020)*: Product intent and user-visible project state MUST remain independent of any particular technical framework, database, model provider, or hosting implementation.
- **FR-051** *(Intent: INT-001, INT-005, INT-010, INT-011, INT-021, INT-022)*: Intent, Solution, and Execution MUST be persisted and validated as typed node-and-edge graphs. A prose document, chat transcript, flat requirement list, or task list without graph identity and relationships MUST NOT substitute for any of the three graphs.
- **FR-052** *(Intent: INT-010, INT-011, INT-022)*: Each graph compilation MUST emit a reviewable transformation record identifying source graph and baseline versions, generated or changed nodes and edges, validation results, and cross-graph traces.
- **FR-053** *(Intent: INT-008, INT-022, INT-023)*: Every human-readable project view MUST be a reproducible projection of a named graph version and MUST expose enough provenance to navigate back to its source nodes and relationships.
- **FR-054** *(Intent: INT-004, INT-023)*: The owner MUST be able to create, correct, defer, reject, and approve project meaning using ordinary language without authoring graph syntax, identifiers, schemas, task files, or prompts.
- **FR-055** *(Intent: INT-024)*: The first release MUST NOT require parallel task dispatch, more than one implemented execution-provider adapter, automatic repair dispatch, a public developer API, a graph database, or repository execution inside the hosted web runtime.

### Normative Factory Contracts

The contracts below refine the functional requirements. Their enumerations, formulas, thresholds, and authority boundaries are product behavior, not optional implementation guidance.

#### Intent Vocabulary and Classification

- **NC-001** *(Intent: INT-005, INT-006, INT-021)*: The Intent Graph MUST support exactly these initial node types: `Project`, `Goal`, `UserType`, `Problem`, `UseCase`, `Behavior`, `Input`, `Output`, `Constraint`, `Preference`, `Exclusion`, `SuccessCriterion`, `Assumption`, `Question`, `Decision`, `Example`, and `Risk`. Later additions require a successor Intent Baseline.
- **NC-002** *(Intent: INT-005, INT-021)*: The Intent Graph MUST support these initial edge types: `PROJECT_HAS_GOAL`, `GOAL_SOLVES_PROBLEM`, `USER_HAS_PROBLEM`, `USER_PERFORMS_USE_CASE`, `USE_CASE_REQUIRES_BEHAVIOR`, `BEHAVIOR_ACCEPTS_INPUT`, `BEHAVIOR_PRODUCES_OUTPUT`, `CONSTRAINT_LIMITS`, `PREFERENCE_INFLUENCES`, `EXCLUSION_PROHIBITS`, `SUCCESS_VALIDATES`, `ASSUMPTION_SUPPORTS`, `QUESTION_RESOLVES`, `DECISION_RESOLVES`, `EXAMPLE_CLARIFIES`, `CONTRADICTS`, `SUPERSEDES`, and `DEPENDS_ON`.
- **NC-003** *(Intent: INT-006, INT-021)*: Every Intent node MUST contain a stable identifier, type, statement, status, confidence, source message identifier and quote, original and normalized interpretation, approval flag, version, creation time, and update time. Status MUST be one of `inferred`, `proposed`, `confirmed`, `rejected`, `superseded`, `unresolved`, or `deferred`.
- **NC-004** *(Intent: INT-006, INT-021)*: Numeric interpretation confidence MUST use the original ranges: `0.00–0.39` weak guess, `0.40–0.69` plausible interpretation, `0.70–0.89` strong but unconfirmed, and `0.90–1.00` explicitly confirmed. Confidence MUST NOT be used as a completeness score, and a high-impact decision requires confirmation regardless of confidence.
- **NC-005** *(Intent: INT-004, INT-006, INT-021)*: Each user answer MUST be classified as one or more of `confirmation`, `correction`, `new requirement`, `preference`, `constraint`, `exclusion`, `example`, `deferred decision`, `contradiction`, or `approval`. A correction supersedes earlier interpretation without deleting history; an approval MUST name its artifact and version.

#### Question Selection and Readiness

- **NC-006** *(Intent: INT-004, INT-021)*: Candidate questions MUST be ranked using `question_value = uncertainty_reduction × implementation_impact × drift_risk × dependency_count`. The system MUST prioritize decisions that materially change product behavior or architecture, affect many downstream choices, create expensive rework, or distinguish plausible interpretations. Cosmetic questions MUST NOT outrank unclear core behavior.
- **NC-007** *(Intent: INT-004, INT-021)*: The default clarification interaction MUST ask one question per turn. A question MAY include a small set of tightly related options, but unrelated questions MUST NOT be bundled.
- **NC-008** *(Intent: INT-008, INT-021)*: Uncertainty MUST be tracked across `Outcome`, `User`, `Input`, `Behavior`, `Output`, `Scope`, `Exclusions`, `Experience`, `Data`, `Constraints`, and `Success`. A category MAY remain incomplete when it is irrelevant or low impact for the project.
- **NC-009** *(Intent: INT-008, INT-021)*: Intent readiness MUST use the original weighted assessment: outcome clarity 20%, workflow clarity 20%, scope clarity 15%, input/output clarity 15%, constraint clarity 10%, success clarity 10%, and contradiction health 10%. A score of at least 75% MAY permit generation of a proposed solution; a score of at least 90% MAY satisfy the numeric portion of execution readiness. Scores never replace required approvals or other gates.
- **NC-010** *(Intent: INT-008, INT-009, INT-021)*: A project is ready for solution proposal only when its primary outcome, user or usage context, main input and output, core workflow, major exclusions, and at least one success condition are confirmed; high-impact contradictions are resolved; and high-impact assumptions are confirmed or explicitly deferred.
- **NC-011** *(Intent: INT-008, INT-021)*: A question is blocking when its answer could materially change application type, core data model, authentication, privacy requirements, architecture, primary workflow, hosting model, critical external integrations, or acceptance criteria. Any blocking question overrides readiness scores and MUST prevent approval or advancement.

#### Baselines, Solution, and Execution

- **NC-012** *(Intent: INT-009, INT-016, INT-021)*: Intent approval MUST create an immutable baseline containing a baseline identifier, project identifier, approved status, approval time, approving message identifier, and exact Intent node identifiers and versions. Plain-language approval such as “Yes, that’s right” or “Good enough. Build it” is valid only after the concise baseline summary is displayed. Later changes create a successor baseline and never rewrite the prior one.
- **NC-013** *(Intent: INT-010, INT-021)*: The Solution Graph MUST support `Application`, `Page`, `Feature`, `Workflow`, `Component`, `Service`, `DataObject`, `Rule`, `API`, `Integration`, `Technology`, `DeploymentTarget`, and `TestableBehavior`. Every product-facing node MUST cite one or more approved Intent nodes; support-only nodes MUST be labeled `implementation_support`.
- **NC-014** *(Intent: INT-010, INT-021)*: Solution review MUST default to a concise plain-language description of the planned product plus clearly separated technical defaults. Technical defaults MAY change without changing product intent only when observable behavior, constraints, exclusions, and success conditions remain unchanged.
- **NC-015** *(Intent: INT-011, INT-012, INT-021)*: The Execution Graph MUST be compiled per project rather than from a fixed universal agent sequence and MUST support `Inspect`, `Decide`, `Implement`, `Test`, `Verify`, `Integrate`, `Repair`, `Document`, and `Release` tasks.
- **NC-016** *(Intent: INT-012, INT-021)*: Every execution task MUST include identifier, type, one-sentence objective, status, satisfied Solution nodes, protected Intent and Solution baseline versions, dependencies, allowed paths, forbidden changes, required outputs, independently runnable acceptance checks, completion evidence, bounded retry policy, and verifier assignment. Tasks MUST be split by behavioral or architectural boundary rather than estimated token count.

#### Authority, Drift, and Change

- **NC-017** *(Intent: INT-013, INT-014, INT-021)*: The Intent capability may interpret language, update intent, detect contradictions, select questions, summarize understanding, and request approval, but MUST NOT generate code. The Solution capability may propose product and technical structure only from approved intent and MUST NOT change confirmed intent. The Execution capability may complete one bounded task and MUST NOT redefine the project. The Verification capability MUST independently compare code to task, task to solution, and solution to intent, and MUST NOT approve its own implementation work.
- **NC-018** *(Intent: INT-012, INT-013, INT-021)*: Protected assertions MUST represent confirmed constraints and exclusions. Execution capabilities MAY choose low-impact internal names, spacing, test organization, and error wording, but MUST create a blocking Decision node rather than assume new features, users, storage, integrations, authentication, output meaning, or approved-constraint changes.
- **NC-019** *(Intent: INT-015, INT-021)*: Drift MUST be classified as one or more of `scope_drift`, `behavior_drift`, `architecture_drift`, `ux_drift`, `constraint_drift`, `terminology_drift`, `exclusion_drift`, or `acceptance_drift`. A drift report MUST identify severity, task, expected statement and source Intent node, observed statement and files or evidence, and recommended action.
- **NC-020** *(Intent: INT-015, INT-016, INT-021, INT-024)*: Failed verification MUST create a bounded proposed repair task, but MUST NOT dispatch it without explicit owner authorization. Repeated failures MUST escalate rather than loop indefinitely. A user change that affects intent or solution MUST pause affected work, propose a successor baseline, and classify existing work as unaffected, requiring modification, discarded, or requiring new tasks, including tests requiring revision.

#### Lifecycle and Persistent Audit Record

- **NC-021** *(Intent: INT-003, INT-009, INT-010, INT-011, INT-015, INT-016, INT-018, INT-021)*: The project lifecycle MUST enforce `CAPTURE → DISCOVERY → INTENT_REVIEW → INTENT_APPROVED → SOLUTION_GENERATION → SOLUTION_REVIEW → SOLUTION_APPROVED → EXECUTION → VERIFICATION`, with `REPAIR` returning to verification until accepted or escalated, then `COMPLETE`. A user change at any state MUST route through impact analysis, a proposed new baseline, and recompilation of affected work.
- **NC-022** *(Intent: INT-006, INT-017, INT-021)*: Each project MUST maintain a human-readable, versioned audit record containing project metadata, append-only conversation messages, Intent and Solution graphs and baselines, the Execution Graph and task contracts, decision log, task evidence, drift reports, and current status. The first implementation MAY use versioned JSON and YAML files; a graph database is not required.
- **NC-023** *(Intent: INT-006, INT-009, INT-021)*: Every material decision record MUST contain a stable identifier, question, raw answer, normalized decision, downstream impact, source message identifier, status, and baseline association so settled questions are not silently re-asked or contradicted.
- **NC-024** *(Intent: INT-003, INT-009, INT-010, INT-011, INT-015, INT-021, INT-024)*: The product action surface MUST support submitting a project message, approving Intent, generating and approving Solution, compiling Execution, executing a ready task, and independently verifying a task. Exact transport, endpoint paths, and technology remain Solution Graph decisions; an externally supported public API is not required for the first release.

### Security and Privacy Requirements *(mandatory)*

- **SPR-001** *(Intent: INT-019)*: The sole authenticated project owner MUST be the only actor with hosted project-state access, repository-connection authority, and repository-execution authorization. Intent approval, solution approval, execution authorization, pull-request creation, merge, and deployment MUST remain distinct least-privilege actions; authority for one MUST NOT imply another, and any missing authorization MUST fail closed.
- **SPR-002** *(Intent: INT-012, INT-013)*: Every actor and capability MUST receive only the project, repository, filesystem-path, action, network-destination, and credential access required for its approved task, with deny taking precedence over allow.
- **SPR-003** *(Intent: INT-006, INT-017)*: Before project data persists, the product MUST disclose the persisted categories, purpose, retention boundary, deletion behavior, and any external transfer. Persistent project state MUST be limited to what is needed for the approved project lifecycle and review evidence.
- **SPR-004** *(Intent: INT-006, INT-017, INT-019)*: The authenticated project owner MUST be able to obtain a human-readable project record and request project deletion or closure; the resulting retention or deletion status MUST be visible and auditable.
- **SPR-005** *(Intent: INT-012, INT-013)*: Secrets MUST NOT appear in conversational prompts, graph nodes, evidence payloads, logs, reports, generated artifacts, or pull-request content. Any secret needed for authorized repository work MUST remain outside those records and be available only to the bounded action that requires it.
- **SPR-006** *(Intent: INT-013, INT-015)*: Security or privacy gate failures MUST block affected execution and release readiness while retaining non-secret evidence sufficient for review and escalation.
- **SPR-007** *(Intent: INT-019)*: Anonymous, public-page, secondary-account, or invited-collaborator access MUST NOT grant access to private project state, repository content, credentials, approvals, execution, evidence, or pull-request actions in the owner-only MVP.

### User-Facing Release Requirements *(mandatory when the feature has a UI)*

- **URR-001** *(Intent: INT-002, INT-008)*: Every supported journey MUST be operable by keyboard alone, expose meaningful structure and status to assistive technologies, preserve visible focus, and meet WCAG 2.2 AA acceptance criteria before any hosted release.
- **URR-002** *(Intent: INT-017)*: The conversational intake, compact intent views, approval review, task status, drift review, and draft-pull-request readiness journeys MUST be usable at viewport widths from 360 to 1440 pixels without loss of required information or action.
- **URR-003** *(Intent: INT-017)*: Browser acceptance MUST cover the current and immediately previous major releases of Chrome, Edge, Firefox, and Safari for all P1 journeys before any hosted release.
- **URR-004** *(Intent: INT-008)*: Confirmed, assumed, unresolved, excluded, approved, proposed, blocked, failed, and superseded states MUST be distinguishable without relying on color alone.
- **URR-005** *(Intent: INT-015, INT-018, INT-019)*: The authenticated project owner MUST be able to see current lifecycle state, blockers, baseline versions, last completed action, drift severity, and escalation status without inspecting hidden system internals; no other hosted-product actor may access that project state.
- **URR-006** *(Intent: INT-017, INT-018)*: Before any separately authorized hosted release, rollback to the prior known-good release MUST be tested, observable, and must preserve project and approval history without granting new execution authority.
- **URR-007** *(Intent: INT-018, INT-019)*: Approval to create or review a draft pull request MUST NOT be treated as authority to merge, deploy, change the domain, or alter traffic. Each externally visible release action requires a separate explicit authorization for its target and artifact.
- **URR-008** *(Intent: INT-022, INT-023)*: The owner-facing experience MUST explain graph-derived state in ordinary language and MUST NOT require manual node creation, edge selection, graph queries, schema knowledge, task-file editing, or prompt engineering for any supported P1 journey.

### Key Entities and Actors *(include if feature involves data)*

- **Authenticated Project Owner**: The MVP’s sole hosted project-state actor. Exactly one authenticated human may access the active project, connect its sole repository, and authorize execution. This authority does not itself approve or freeze a baseline and does not confer merge or deployment authority.
- **Project**: The single active software initiative, including lifecycle state, connected repository reference, active baseline references, authority status, and human-readable history.
- **Intent Node**: A typed unit of human-stated, inferred, proposed, unresolved, decided, assumed, excluded, example, risk, or success intent. It preserves source provenance, source reference, normalized interpretation, status, confidence, version, approval state, and supersession links.
- **Intent Graph**: The versioned relationships among Intent nodes, including contradictions, dependencies, decisions, and trace links; it never erases prior versions.
- **Graph Projection**: A compact human-readable view reproducibly derived from one named graph version; it never replaces or silently diverges from the graph it represents.
- **Graph Transformation Record**: An auditable compilation result naming its source and target graph versions, generated and changed nodes and edges, validation outcome, and cross-graph traces.
- **Readiness Assessment**: Category-level readiness and blockers for scope, users and authority, behavior, constraints and exclusions, success criteria, and risks and permissions. Blocking questions override all scores.
- **Approval Record**: Attributable authorization by the authenticated project owner naming actor, authority, exact artifact type, exact version, scope, and time. It cannot be created by a model capability for its own output, and one approval type does not imply another.
- **Intent Baseline**: An immutable approved snapshot of Intent nodes, relationships, protected decisions, exclusions, unresolved non-blocking matters if any, and approval record.
- **Solution Node**: A proposed product-facing choice traced to approved intent, or an explicitly labeled implementation-support item linked to the solution work it enables.
- **Solution Graph**: The versioned proposed or approved relationships among Solution nodes and their Intent Baseline traces.
- **Solution Baseline**: An immutable approved Solution Graph version tied to a specific approved Intent Baseline and approval record.
- **Execution Task**: A bounded behavioral work contract containing solution trace, protected baseline versions, objective, dependencies, allowed paths, forbidden changes, outputs, acceptance checks, retry limit, evidence requirements, state, and independent verification assignment.
- **Execution Graph**: The dependency-aware set of versioned Execution tasks compiled from one approved Solution Baseline.
- **Evidence Record**: A durable, non-secret observation tied to a task, acceptance check, baseline version, producer or verifier, time, and outcome.
- **Drift Report**: A structured mismatch record containing expected and observed state, affected nodes and tasks, severity, evidence, and disposition.
- **Repair Task**: A new bounded Execution task derived from a drift report; it cannot silently expand intent, solution, or authority.
- **Impact Analysis**: A trace-based comparison between current approved state and a proposed change, classifying work as unaffected, changed, discarded, or new.
- **Draft Pull Request Record**: The reviewable terminal MVP artifact linking current baselines, approved intent, solution, tasks, repository changes, acceptance evidence, drift status, and non-deployment boundary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of first-request acceptance tests, Graphslop records provisional intent and performs zero application-code changes or repository execution before both required baseline approvals.
- **SC-002**: Across a benchmark of at least 30 incomplete, minimal, or contradictory requests, every clarification turn presents exactly one question, and independent reviewers agree in at least 90% of turns that it targets the highest-value unresolved blocker or risk.
- **SC-003**: In 100% of audited Intent nodes, provenance, normalized interpretation, status, confidence, version, and approval state are present, and every correction retains a navigable supersession history.
- **SC-004**: In 100% of approval tests, blocking questions prevent approval, approval is attributable to the authenticated project owner and exact version, resolving a clarification alone never approves or freezes a baseline, and approved baselines remain unchanged after later corrections.
- **SC-005**: In 100% of approved Solution Graph samples, every product-facing node traces to approved intent and every support-only node is visibly labeled; no orphan product node reaches approval.
- **SC-006**: In 100% of compiled Execution tasks, all required bounds and traces are present before readiness; tasks with a missing field, unmet dependency, stale baseline, or missing independent verifier are rejected.
- **SC-007**: A deterministic conformance suite rejects 100% of fixtures representing unauthorized project-state access, repository connection or execution authorization by anyone other than the authenticated project owner, pre-approval execution, impossible transitions, dependency violations, out-of-scope changes, protected-decision violations, unbounded retries, retry exhaustion, and untraceable work.
- **SC-008**: In 100% of task-completion audits, acceptance is supported by independent evidence for every required check; an implementer’s self-report alone never produces accepted status.
- **SC-009**: In 100% of seeded drift cases, the next verification cycle creates a complete drift report; repairable cases produce bounded proposed repair tasks that remain non-dispatchable without owner authorization, while exhausted or repeated failures halt and escalate without an extra retry.
- **SC-010**: In 100% of post-approval change tests, impact analysis classifies affected work as unaffected, changed, discarded, or new, and no affected task resumes before successor baseline approval.
- **SC-011**: At least 90% of representative software-project owners can identify the current confirmed, assumed, unresolved, and excluded intent; active blockers; and approval state within 60 seconds of opening project state, without assistance.
- **SC-012**: At least 85% of representative owners rate the provisional interpretation and its provenance as 4 or higher on a 5-point “faithful and reviewable” scale after completing a clarification session.
- **SC-013**: For a single MVP project containing up to 500 Intent nodes and 250 Execution tasks, 95% of user actions that refresh conversation or compact project-state views show the resulting state within 2 seconds.
- **SC-014**: All P1 journeys pass keyboard-only, assistive-technology, responsive-viewport, and supported-browser acceptance with zero critical accessibility defects before any hosted release.
- **SC-015**: In the end-to-end MVP acceptance project, completion is withheld until every required task, system-level check, success criterion, drift gate, and current-baseline conformance check passes; the resulting terminal artifact is a reviewable draft pull request with complete requirement-to-change traces and no merge or deployment action.
- **SC-016**: In 100% of schema conformance fixtures, valid Intent node and edge types, statuses, required metadata, answer classifications, solution types, execution types, and drift types are accepted, while unknown or malformed values fail with a reviewable reason.
- **SC-017**: In 100% of question-selection and readiness fixtures, the recorded question-value factors and readiness weights reproduce the expected ranking and score; blocking questions prevent advancement even at or above the 75% and 90% numeric thresholds.
- **SC-018**: In 100% of lifecycle and recovery fixtures, only allowed state transitions occur, user changes create successor-baseline impact analysis, material decisions remain traceable, and repair cycles either produce accepted evidence or stop at the configured escalation boundary.
- **SC-019**: In 100% of end-to-end compiler fixtures, Graphslop materializes three independently valid typed graphs, records the Intent-to-Solution and Solution-to-Execution transformations, and provides a navigable trace from every product-facing changed artifact back to approved Intent nodes.
- **SC-020**: In usability acceptance, at least 90% of representative owners complete intake, correction, intent approval, solution approval, task authorization, drift review, and repair authorization without graph syntax, schema documentation, task-file editing, or prompt engineering.
- **SC-021**: In 100% of first-release concurrency and adapter fixtures, no more than one task is dispatched at once, only the configured execution-provider adapter is callable, and proposed repair work remains idle until explicit owner authorization.

## Assumptions

The following are working assumptions only. They are not approved requirements and may be superseded by later human decisions.

- The initial interaction is a text conversation in an owner-only private hosted workspace, while the resulting project state remains human-readable and resumable to that authenticated project owner.
- Human-readable summaries and status screens are graph projections; the three graphs remain the authoritative state even when the owner never sees their raw serialization.
- The authenticated project owner can provide or identify one repository suitable for bounded work and is the only actor permitted to connect it or authorize execution after all applicable gates are satisfied.
- “Highest-value” question selection prioritizes blocking authority and scope decisions, then high-impact contradictions, then dependencies and execution risks, before lower-impact preferences.
- “Independent verification” means the verifier for a result is not the same role or agent identity that produced that result and must inspect artifacts and acceptance evidence rather than accept self-report.
- The one active project and one repository limit applies to the single authenticated project owner’s private MVP workspace; team tenancy, invitations, delegated repository authority, and multiple owner accounts are outside this MVP boundary.
- Persistent state is necessary for the project lifecycle, but its retention and deletion boundary must be disclosed and authorized rather than silently inferred.
- A draft pull request is a review artifact only; review, merge, release, production deployment, domain cutover, and traffic cutover remain separate decisions.
- The Solution Graph may select a local or isolated owner-authorized execution runner; a hosted Graphslop interface does not imply that untrusted repository code must execute in the web application’s runtime.

### Dependencies

- Approved immutable `intent-v1`, recorded in `intent-v1.yaml`.
- Availability of the authenticated project owner for Intent and Solution Baseline approvals, high-impact decisions, repository connection, execution authorization, and failure escalation.
- Availability of one repository that the authenticated project owner is authorized to connect for bounded work after all applicable lifecycle gates are satisfied.
- Availability of one execution-provider adapter and an owner-authorized isolated or local runner selected during Solution planning.
- Availability of independent verification for each execution result.

### Readiness Summary

- **Scope**: Ready for intent review; DEC-002 preserves the complete three-graph kernel while bounding the first release to one adapter and sequential task dispatch.
- **Users and authority**: Ready for intent review. UNR-001 resolves the MVP to one authenticated project owner with sole project-state, repository-connection, and execution-authorization authority.
- **Behavior**: Ready for intent review; graph compilation, ordinary-language control, lifecycle, and gates are stated.
- **Constraints and exclusions**: Ready for intent review.
- **Success criteria**: Ready for intent review.
- **Risks and permissions**: Ready for intent review. Public, secondary-account, collaborator, and delegated execution access fail closed.
- **Overall**: `intent-v1` is approved. Solution Graph generation and planning may proceed. Repository execution and implementation remain blocked until a proposed `solution-v1` is displayed and explicitly approved.
