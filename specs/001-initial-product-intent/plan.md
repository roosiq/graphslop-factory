# Implementation Plan: Graphslop Graph-Native First Release

**Branch**: `001-initial-product-intent` | **Date**: 2026-07-27 | **Spec**: [spec.md](spec.md)

**Input**: Approved Intent Baseline [intent-v1.yaml](intent-v1.yaml)

## Summary

Build Graphslop as a local-first, two-runtime TypeScript product that compiles ordinary-language
project requests into three authoritative typed graphs:

```text
caveman language
      ↓ proposed, validated graph delta
Intent Graph
      ↓ approved transformation
Solution Graph
      ↓ approved transformation
Execution Graph
      ↓ one signed task lease at a time
local runner → Codex worker → independent verification → evidence or proposed repair
```

The control plane owns conversation, graphs, projections, approvals, compilation, and persistent
state. A separate local runner owns Git worktrees, the single Codex CLI adapter, tests, and evidence
collection. Both ship locally behind one owner command. `graphslop.com`, hosted synchronization,
parallel execution, automatic repair dispatch, additional worker adapters, and production
deployment remain outside this Solution proposal.

## Technical Context

**Language/Version**: Node.js 24 LTS and TypeScript 5.9

**Primary Dependencies**: React 19, Vite 8, Hono 4, Zod 4, YAML, RFC 8785
canonicalization, Git, Codex CLI, and GitHub CLI

**Storage**: Canonical JSON snapshots and deltas plus JSONL audit streams under the owner’s XDG
state directory; no application database

**Testing**: Vitest 4 for unit, schema, graph, and service tests; React Testing Library for
components; Playwright 1.62 plus axe for browser acceptance; disposable Git fixture repositories
for runner and worktree integration tests

**Target Platform**: Linux x86-64 local owner workstation with Node 24, Git, Codex CLI, and a
modern browser. Hosted and additional desktop platforms require successor Solution Baselines.

**Project Type**: Local web application plus local execution daemon in one npm-workspace monorepo

**Toolchain compatibility policy**:

- Node must be an actively supported `24.x` LTS release; TypeScript, package-manager, test, and
  browser-driver versions are locked by the repository lockfile.
- Git, Codex CLI, and GitHub CLI are accepted by behavior probes rather than by copying this
  workstation’s versions into product policy. Git must pass disposable-fixture probes for worktree
  creation, NUL-delimited status/diff enumeration, and candidate commits. Codex must pass the
  provider-adapter capability probe. GitHub CLI is optional until draft-PR authorization and must
  pass an authenticated draft-only dry run for the named remote.
- Local browser acceptance uses the locked Playwright Chromium, Firefox, and WebKit builds.
  Hosted-release browser policy, including real Safari, remains a successor-baseline gate.
- Every capability report records exact binary and platform versions. A failed or unknown required
  capability disables only the affected boundary and fails closed with owner-visible status.

**Performance Goals**:

- At 500 Intent nodes and 250 Execution tasks, graph validation, projection refresh, trace
  traversal, impact traversal, and ready-task calculation each complete within 100 ms p95 on the
  reference profile: Linux x86-64, four CPU cores, 8 GiB RAM, Node 24 LTS, local SSD, warm process,
  100 measured iterations after 10 warmups.
- Cached project-state views render updated graph state within 2 seconds for at least 95% of owner
  actions.
- Progress state is visible within 200 ms after an authorized task changes lifecycle state.

**Constraints**:

- Exactly one owner, active project, connected repository, implemented provider adapter, and
  dispatched task at a time.
- Models propose typed graph deltas; deterministic code assigns IDs, validates, applies, freezes,
  and advances state.
- The control plane is the only graph-state writer. The runner never writes `.factory`.
- The runner receives expiring signed leases and an allowlisted environment; secrets never enter
  graphs, prompts, evidence, logs, or pull-request content.
- Repair budget defaults to one and repair cannot dispatch without explicit owner authorization.
- A worktree is not represented as hostile-code containment. The first release supports
  owner-trusted repositories and fails closed when the Codex permission-profile capability probe
  cannot enforce task-specific path policy.

**Scale/Scope**: One project, one repository, up to 500 Intent nodes, 250 Execution tasks, 2,000
total graph edges, one active task lease, and one draft pull request

## Constitution Check

### Pre-Design Gate: Approved Intent

- **Intent Baseline**: PASS — immutable `intent-v1`; specification hash
  `d6f64a0971dc53a2fa32e48c3da4867b5798eb04dc738c3ed3b16853728b035e`
- **Approval Evidence**: PASS — `msg-approval-intent-v1-20260727-01`, authenticated project owner,
  quote “Approved,” recorded at `2026-07-27T14:25:00-04:00`
- **Intent State Integrity**: PASS — approved nodes and exclusions, superseded provisional
  interpretations, resolved decisions, and empty blocking-question set remain distinguishable
- **Contradiction Disposition**: PASS — UNR-001 and DEC-002 resolved; no blocking contradiction
- **MVP Boundary**: PASS — one repository, one active project, one adapter, sequential dispatch,
  draft pull request terminal artifact
- **No Premature Implementation**: PASS AT GATE — the approval sequence completed before any
  application source, dependency installation, worker dispatch, PR, remote, or deployment action

### Pre-Implementation Gate: Approved Solution and Bounded Execution

- **Solution Baseline**: PASS — immutable `solution-v1`; baseline file hash
  `a654b9ba058db098af279acc46ed6c61bb6c2d3c063534e8a4a0efdd33596fb1`
- **Approval Evidence**: PASS — `msg-approval-solution-v1-20260727-01`, authenticated project owner,
  quote “Approved,” recorded at `2026-07-27T15:45:07-04:00`
- **Execution Compilation**: PASS — authorized `execution-v1` contains 40 bounded tasks and 89
  dependency edges; only `T001` is initially ready
- **Traceability**: PASS — all 24 Intent nodes trace into the 72-node Solution Graph, and all 72
  Solution nodes have Execution task coverage with no orphan or isolated nodes
- **Deterministic Controls**: PASS FOR PLAN — graph schemas, pure delta application, state-machine
  transitions, head-hash compare-and-swap, protected assertions, leases, path checks, retry budget,
  and integration gates have named owners and acceptance contracts
- **Task Bounds**: PASS FOR PLAN — task schema requires objective, prerequisites, allowed paths,
  forbidden changes, acceptance checks, evidence, adapter, verifier, and retry budget
- **Independent Verification**: PASS FOR PLAN — producer and semantic verifier are distinct fresh
  Codex invocations; deterministic acceptance commands run independently in a fresh worktree
- **Drift and Escalation**: PASS FOR PLAN — drift report plus non-dispatchable proposed Repair node;
  one owner-authorized repair attempt; exhaustion escalates
- **Security and Privacy**: PASS FOR PLAN — loopback-only services, one-time owner claim, signed
  leases, environment allowlist, external state directory, redacted evidence, no raw stream
  retention
- **User-Facing Release Gates**: PASS FOR LOCAL PLAN — keyboard, focus, semantics, contrast,
  responsive viewports, Chromium/Firefox/WebKit, console, network, recovery, and error-state
  acceptance are specified. Safari and full hosted rollback testing remain gates for a future
  hosted release.
- **Deployment Authority**: PASS — this plan changes neither the existing `graph-slop` Worker nor
  graphslop.com; no deploy or traffic authority is inferred

### Post-Design Re-check

Design artifacts are internally consistent and constitution-compliant. The only failed gate is the
intentional absence of an approved Solution Baseline. Implementation MUST remain blocked until the
owner approves the displayed `solution-v1` proposal and the approval is frozen.

## Architecture

```text
┌──────────────────────────────── local owner workstation ────────────────────────────────┐
│                                                                                         │
│  Browser                                                                                │
│     │ HttpOnly owner session                                                            │
│     ▼                                                                                   │
│  Control Plane (loopback)                         XDG state directory                    │
│  ├─ Hono command API ───────────── sole writer ──► .factory/ graphs, deltas, baselines  │
│  ├─ React/Vite owner UI                           projections, decisions, evidence       │
│  ├─ graph compiler                                                                      │
│  ├─ deterministic state machine                                                        │
│  └─ signed task-lease issuer                                                            │
│             │ authenticated loopback lease/result                                       │
│             ▼                                                                           │
│  Runner                                                                                 │
│  ├─ repository/worktree boundary                                                        │
│  ├─ Codex CLI adapter                                                                   │
│  ├─ permission-profile capability probe                                                 │
│  ├─ deterministic acceptance runner                                                     │
│  ├─ changed-path and secret redaction gates                                              │
│  └─ evidence envelope ────────────────────────────────────────────────► control plane    │
│             │                                                                           │
│             ▼                                                                           │
│  task worktree → candidate commit → fresh verifier worktree → accepted integration SHA  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘

Future successor baseline only:
graphslop.com control plane ◄── outbound authenticated polling ── local runner
```

## State Ownership and Data Flow

1. The control plane appends the raw owner message before invoking a model.
2. The Intent capability returns a strict proposed `GraphDelta`.
3. The graph kernel assigns authoritative metadata, validates the delta against the current head,
   applies it as a pure function, writes the new snapshot atomically, and updates the head last.
4. The UI renders a versioned graph projection and one next question.
5. Owner approval freezes an exact graph snapshot and projection hash as a baseline.
6. Intent-to-Solution and Solution-to-Execution compilers emit target graphs plus transformation
   records and complete cross-graph traces.
7. Owner task authorization creates one signed, expiring lease.
8. The runner builds a worktree from the latest accepted integration commit and invokes one fresh
   Codex implementer.
9. Deterministic changed-path and acceptance gates either reject the attempt or create a candidate
   commit.
10. A fresh worktree and fresh semantic verifier independently evaluate the candidate.
11. The control plane accepts evidence or appends a drift report and non-dispatchable Repair node.
12. After all tasks are accepted, a separately authorized integration action may push one branch
   and create a draft pull request.

## Project Structure

```text
apps/
├── control-plane/
│   ├── src/
│   │   ├── api/                 # versioned command/query routes
│   │   ├── auth/                # local one-time owner claim and session
│   │   ├── services/            # orchestration and application use cases
│   │   └── web/                 # React owner experience
│   └── tests/
└── runner/
    ├── src/
    │   ├── lease/               # polling, validation, acknowledgement
    │   ├── execution/           # adapter and process boundary
    │   ├── repository/          # Git/worktree/path enforcement
    │   ├── verification/        # checks and independent verifier
    │   └── evidence/            # redaction and result envelopes
    └── tests/

packages/
├── contracts/                   # Zod and exported JSON Schema contracts
├── graph-kernel/                # immutable snapshots, deltas, traversal, compilation
├── file-store/                  # canonical JSON, atomic writes, recovery, migrations
├── control-state/               # lifecycle, readiness, approvals, protected assertions
├── codex-adapter/               # sole first-release provider adapter
└── testing/                     # graph fixtures and disposable Git repositories

tests/
├── contract/                    # schemas and control-plane/runner protocol
├── integration/                 # graph pipeline, leases, Git, recovery, drift
├── e2e/                         # complete owner journeys
├── accessibility/               # axe and keyboard scenarios
└── fixtures/                    # caveman prompts, graphs, repositories, seeded drift

specs/001-initial-product-intent/
├── intent-v1.yaml
├── spec.md
├── solution-v1.proposed.yaml
├── plan.md
├── research.md
├── data-model.md
├── contracts/
├── quickstart.md
└── tasks.md
```

**Structure Decision**: One npm-workspace monorepo with two deployable local applications and six
dependency-directed packages. Applications may import packages; packages MUST NOT import
applications. `graph-kernel` and `contracts` are pure and have no filesystem, process, browser,
Git, or provider dependencies.

## Security and Privacy Design

- Both processes bind to loopback only. The launcher creates a one-time in-memory owner claim token
  and prints a URL with the token in the fragment; exchange produces a short-lived HttpOnly,
  SameSite=Strict session and clears the fragment.
- Runner enrollment uses a separate 256-bit secret stored outside `.factory` with owner-only file
  permissions. Task leases are HMAC-signed and expire.
- The runner passes an explicit environment allowlist. Graphslop owner, runner, GitHub, and provider
  credentials never appear in prompts or evidence.
- The Codex adapter generates task-specific path permissions, denies control directories and secret
  files, disables model-command network access by default, and fails closed when the active CLI
  cannot prove the required permission feature.
- Acceptance commands are predeclared arrays, not shell strings. Time, output, process, and path
  limits are mandatory.
- Changed-path enforcement resolves real paths, rejects symlinks that leave the worktree, treats
  case-colliding paths as invalid, and includes tracked, staged, deleted, renamed, untracked,
  submodule, and `.git` boundary changes.
- Raw provider streams are temporary. Sanitized evidence contains hashes, selected redacted
  excerpts, versions, command outcomes, and requirement mappings.
- The first release is for owner-trusted repositories. Worktrees and the Node permission model are
  explicitly not represented as hostile-code sandboxes.
- An owner export is a human-readable, hash-manifested copy of canonical project records and
  deterministic projections; it excludes credentials, raw provider streams, operational logs, and
  quarantined temporary files. Closing a project is a separately confirmed administrative action
  that makes the project read-only while retaining immutable baselines and evidence for export.
- Baseline immutability prevents in-project editing and history rewriting; it does not override an
  explicit owner request to delete the complete project. Project deletion requires a separate
  confirmation, removes the entire state directory, and retains only a content-free deletion
  receipt outside the project store.
- Unreachable partial-write artifacts are quarantined on recovery and deleted after the prior
  valid head is confirmed. Provider output that triggers a secret finding is deleted immediately
  after a redaction-safe security record is created; it never becomes project evidence.

## Testing Strategy

| Layer | Coverage |
|---|---|
| Schema | Every accepted and malformed node, edge, delta, snapshot, baseline, transformation, projection, lease, result, evidence, drift, and repair fixture |
| Unit | Pure delta application, canonical hash, indexes, traversal, topological order, readiness formula, blockers, lifecycle, protected assertions, path rules |
| Property | Append-only history, stable hashing, deterministic projection, no orphan traces, DAG acyclicity, stale-head rejection |
| Contract | Control-plane/runner lease and result envelopes, idempotency, expiry, cancellation, wrong-baseline rejection |
| Integration | Atomic recovery, disposable Git repos and worktrees, Codex adapter probe, changed-path gates, checks, candidate/verifier commits |
| UI | Intake, graph projections, one-question loop, approvals, task authorization, evidence, drift, repair authorization, blocked states |
| E2E | Rough request through approved intent, approved solution, sequential task, independent verification, and draft-PR readiness |
| Browser | 360, 390, 768, and 1440 widths; keyboard-only; visible focus; screen-reader semantics; axe; no console errors or failed requests |
| Security | Session and lease forgery, replay, stale result, path escape, symlink, submodule, secret fixture, command injection, second-owner rejection |

Implementation uses test-driven development per task. Behavioral tasks start with a failing focused
test, then the smallest implementation, then relevant regression suites.

The reproducible usability panel contains at least 10 adult software-project owners who have
personally specified work for a repository in the prior year. At least five must primarily work
solo or in teams of five or fewer, at least five must have used an issue tracker, and no more than
two may have professional graph-database or graph-visualization experience. The same scripted
journeys, starting state, completion rubric, time limit, and post-task questions are used for every
participant. Unassisted completion and rating denominators include every started session except a
documented equipment failure.

## Observability and Evidence

- Structured local logs contain timestamp, severity, process, event ID, correlation ID, operation
  ID, graph versions, task and attempt IDs, durations, state transitions, and redaction-safe error
  codes. All other fields are rejected by the logging schema.
- Logs never contain prompt bodies, repository file contents, tokens, raw model streams, or
  unredacted command output.
- Operational logs rotate at 10 MiB, retain at most three files, and expire after seven days.
  Evidence follows project retention instead: it persists until separately confirmed closure or
  deletion and is covered by owner export. Quarantined files are not logs or evidence.
- `/health` reports process version, schema versions, store integrity, runner enrollment, adapter
  capability probe, repository connection state, and current lifecycle without secrets.
- Every acceptance result maps to an Intent node, Solution node, Execution task, command or semantic
  check, evidence hash, producer, verifier, and time.

## Rollout and Rollback

1. Ship the graph kernel and conformance CLI before enabling model calls or repository execution.
2. Enable conversational intent and projections against fixture projects.
3. Enable approvals and graph compilation with execution still disabled.
4. Enable the runner only after permission, lease, worktree, path, evidence, and recovery suites pass.
5. Enable draft-PR creation only after a remote is explicitly authorized and dry-run output is
   reviewed.

Rollback stops both local processes and returns the active head pointers to the prior verified
snapshots without deleting later immutable artifacts. Candidate and failed worktrees remain
non-integrated. No graphslop.com or production rollback exists because no hosted release or domain
change is authorized.

## Risks and Decisions Deferred

| Item | Current disposition |
|---|---|
| Codex permission profiles are beta | Blocking capability probe plus independent post-run enforcement |
| Hostile repository code | Unsupported in v1; trusted repositories only; sandbox-driver seam retained |
| GitHub remote absent | Implementation may be local; draft PR task blocks until separate remote authorization |
| Additional model providers | Contracts remain portable; implementation deferred |
| Parallel execution | Prohibited by `intent-v1` |
| Automatic repairs | Prohibited; owner authorization required |
| Hosted control plane | Successor baseline; outbound runner protocol retained |
| graphslop.com cutover | Separate explicit release and rollback decision |
| Graph visualization | Raw visual editor excluded; optional read-only projection can be proposed later |

## Complexity Tracking

No constitution violation is justified or accepted. The two-process boundary is the minimum design
that separates authoritative graph mutation from repository and subprocess authority.
