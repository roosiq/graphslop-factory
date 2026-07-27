# Phase 0 Research: Graphslop Graph-Native First Release

**Branch**: `001-initial-product-intent`  
**Intent authority**: `intent-v1`  
**Status**: Complete; no unresolved technical clarifications

## Decision 1: Ship a Local Two-Runtime Product

### Decision

Use one TypeScript npm-workspace repository with two local runtime processes:

1. **Control plane**: owner authentication, conversation, graph projections, approvals, graph
   compilation, state transitions, and the sole writer of persistent Graphslop state.
2. **Runner**: one-task lease consumption, Git worktree management, Codex CLI invocation, test
   execution, diff inspection, and evidence return.

Both start through one owner command and communicate over authenticated loopback HTTP. The runner
never writes authoritative graph state. The control plane never receives repository or model
credentials and never directly executes implementation commands.

Any future hosted store or outbound runner transport must pass the same graph-kernel, model
proposal, lease, result, evidence, recovery, and authorization conformance corpus before it may
replace a local adapter. Hosting changes transport and persistence adapters, not graph or authority
semantics.

### Rationale

- This preserves a real trust boundary without introducing cloud synchronization in the graph
  compiler’s first release.
- Node 24 is an active LTS line and supplies the filesystem and subprocess facilities the local
  runner requires ([Node release schedule](https://nodejs.org/en/about/previous-releases),
  [child processes](https://nodejs.org/api/child_process.html)).
- Cloudflare Workers are a suitable future control plane but not a repository runner: their
  writable filesystem is request-scoped and `node:child_process` is not a functional execution
  facility ([Workers filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/),
  [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)).

### Alternatives considered

- **One all-in-one local process**: rejected because an execution crash or compromise would share
  graph-store and repository authority.
- **Hosted control plane plus local runner immediately**: deferred because enrollment, replay
  protection, offline synchronization, hosted authentication, and cloud persistence do not prove
  the graph compiler.
- **Electron or Tauri**: deferred because packaging and updater work add no graph-kernel value.

## Decision 2: Use React, Vite, and Hono Rather Than Next.js

### Decision

Build the owner interface as a React 19 single-page application compiled by Vite 8. Serve its
assets and a versioned Fetch-compatible internal API from Hono 4 running on Node 24. Use WebSocket
or server-sent event updates only for task progress; authoritative mutations remain request/response
commands with idempotency keys.

### Rationale

- Graphslop is an interaction-heavy local application and does not require server rendering,
  React Server Components, incremental static regeneration, or a framework deployment adapter.
- Hono uses Web-standard request and response primitives across Node and Workers, leaving a direct
  future path to a hosted Cloudflare control plane
  ([Hono Web Standard](https://hono.dev/docs/concepts/web-standard)).
- Next.js can be self-hosted on Node and is a valid alternative, but its additional rendering and
  adapter surface does not serve the first-release graph kernel
  ([Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)).

### Alternatives considered

- **Next.js**: viable but rejected for the first release because SSR/RSC and a future edge adapter
  increase surface area without changing supported journeys.
- **Separate frontend and backend repositories**: rejected; one repository and one lockfile keep
  graph contracts and UI projections synchronized.

## Decision 3: Own an Immutable Typed Property-Graph Kernel

### Decision

Graphslop owns a domain-specific graph kernel. Canonical persistence is complete JSON snapshots
plus typed append-only graph deltas, cross-graph links, baselines, transformation records, and
projection records. Applying a delta is a pure function from one validated snapshot to the next.
Derived adjacency and lookup indexes are rebuilt on load and are never authoritative.

The kernel exposes bounded, stable-order operations:

- `activeVersions`
- `ancestors`, `descendants`, and `reachable`
- `unresolvedContradictions`
- `traceToIntent`
- `impactSet`
- `readyTasks`
- `stableTopologicalOrder`
- `compileIntentToSolution`
- `compileSolutionToExecution`
- `projectGraph`

### Rationale

- The product requires immutable approved snapshots, provenance, supersession, typed domain
  relationships, approval gates, cross-graph trace validation, and reproducible projections.
- Graphology is a useful mutable in-memory graph with serialization, traversal, and DAG utilities,
  but it does not supply Graphslop’s baseline, provenance, approval, or transformation semantics
  ([Graphology](https://graphology.github.io/),
  [serialization](https://graphology.github.io/serialization.html),
  [traversal](https://graphology.github.io/standard-library/traversal.html)).
- At the approved scale of 500 Intent nodes and 250 Execution tasks, deterministic O(V+E)
  traversal over rebuilt indexes is appropriate.

### Alternatives considered

- **Graphology as persistence and mutation authority**: rejected; its generic mutable API would
  become an escape hatch around domain invariants.
- **Event-log-only reconstruction**: rejected for the first release because replay and migration
  become the only recovery path.
- **SQLite or a graph database**: deferred until concurrency, query, or scale evidence requires it.
- **YAML as graph authority**: rejected because canonical hashing and parser behavior are harder to
  constrain. YAML remains acceptable for human review projections.

## Decision 4: Use Portable Schemas and Canonical Hashes

### Decision

Define strict Zod 4 schemas as the TypeScript source of truth and export JSON Schema for model
output contracts and portable fixture validation. Avoid Zod transforms or other constructs that
cannot be represented in JSON Schema. Reject unknown fields for security-sensitive envelopes.

Canonicalize persisted JSON according to RFC 8785 before SHA-256 hashing. Use a maintained RFC 8785
implementation and verify it against RFC fixtures and published errata rather than implementing
number and Unicode normalization ad hoc
([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html),
[errata](https://www.rfc-editor.org/errata/rfc8785),
[Zod JSON Schema](https://zod.dev/json-schema),
[JSON Schema object rules](https://json-schema.org/understanding-json-schema/reference/object)).

### Rationale

- The same contract must validate model proposals, disk artifacts, runner messages, and tests.
- A content hash makes baselines, projections, transformation inputs, task leases, and evidence
  independently comparable.
- Models may propose graph deltas but cannot choose authoritative IDs, timestamps, hashes, state
  transitions, approvals, or validation outcomes.

## Decision 5: Use a Single-Writer File Store

### Decision

Persist Graphslop state outside the connected repository under the owner’s XDG state directory:

```text
${XDG_STATE_HOME:-~/.local/state}/graphslop/projects/<project-id>/.factory/
├── project.json
├── conversation/messages.jsonl
├── graphs/{intent,solution,execution}/
│   ├── head.json
│   ├── snapshots/<content-hash>.json
│   └── deltas/<sequence>-<delta-id>.json
├── baselines/{intent,solution,execution}/
├── transformations/
├── projections/
├── decisions/
├── evidence/
├── drift/
└── status.json
```

The control plane is the only writer. It validates an expected head hash, writes immutable
artifacts to temporary files, fsyncs, atomically renames them, and updates `head.json` last.
Startup recovery ignores unreachable temporary artifacts and verifies all referenced hashes.

### Rationale

- Storing project state outside the repository prevents conversational capture from mutating the
  repository before execution is approved.
- File-backed canonical artifacts satisfy human export and audit requirements without adding a
  database.
- A single writer plus compare-and-swap head hashes is sufficient for the one-owner, one-project,
  sequential first release.

### Alternatives considered

- **Repository-local `.factory` authority**: rejected for runtime state because it would mutate a
  connected repository before task authorization. A sanitized export may be generated later.
- **SQLite**: retained as a future storage adapter if transactions or indexes become necessary.

## Decision 6: Make Projections Derived and Reproducible

### Decision

Every compact owner view records:

- source graph and snapshot hash
- query and template versions
- included node and edge references
- deterministic rendered-data hash
- optional model-authored explanatory copy kept separate from authoritative facts

The approval summary is generated by deterministic templates. If the projection hash does not
match its source graph, approval is blocked.

### Rationale

This keeps the experience caveman-simple without turning generated prose into hidden graph state.

## Decision 7: Use Expiring Task Leases

### Decision

The owner explicitly authorizes a ready task. The control plane issues one lease containing:

- lease ID and idempotency key
- task and attempt IDs
- exact Intent and Solution baseline hashes
- exact Execution Graph snapshot hash
- repository identity and expected base commit
- objective, dependencies, allowed paths, forbidden changes, outputs, checks, and evidence contract
- provider adapter ID
- issue and expiry times
- cancellation generation
- HMAC signature

Only one non-terminal lease may exist. The runner polls loopback, validates the signature and
hashes, acknowledges the lease, and returns an idempotent result envelope. Stale, expired,
cancelled, duplicated, or wrong-baseline results are rejected without advancing graph state.

### Rationale

Leases make authority bounded, replay-safe, recoverable after process crashes, and portable to a
future outbound hosted-runner protocol.

## Decision 8: Implement One Codex CLI Adapter

### Decision

Implement a single `codex-cli` provider adapter. Invoke a fresh ephemeral Codex process for each
implementation or verification attempt with:

- a generated bounded prompt
- a strict final-output JSON Schema
- an explicit working directory
- a generated permission profile that makes only the task’s exact allowed subtrees writable and
  explicitly denies `.git`, `.factory`, `.codex`, environment files, and secret locations
- a startup capability probe that refuses execution when the active Codex version cannot enforce
  the generated path policy
- no additional writable directories and network disabled for model-executed commands by default
- an allowlisted environment
- no inherited Graphslop owner or runner secrets

The runner, not Codex, determines final task status. It captures the complete changed-file set,
checks allowed and forbidden paths, runs acceptance commands itself, and packages non-secret
evidence. The verifier is a separate fresh invocation and cannot accept its own implementation.
Raw provider event streams are temporary input to redaction and evidence extraction and are deleted
after the sanitized evidence record is committed.

Local inspection confirmed Codex CLI `0.145.0` supports `exec`, ephemeral sessions, sandbox
selection, explicit working directories, JSONL events, last-message capture, and final-output JSON
Schema. Codex permission profiles are currently beta, so their capability probe is a blocking
startup and pre-dispatch gate rather than an assumed feature
([Codex permissions](https://learn.chatgpt.com/docs/permissions),
[non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)).

### Alternatives considered

- **Direct model API integration**: deferred; it would duplicate mature execution/session behavior
  without improving the graph contract.
- **Several adapters in v1**: prohibited by `intent-v1`.

## Decision 9: Treat Worktrees as Isolation, Not a Security Sandbox

### Decision

Create a dedicated branch and Git worktree per implementation attempt from the latest accepted
integration commit. A successful implementer attempt produces a candidate commit. Verify that
candidate in a separate fresh worktree with a fresh deterministic test process and a separate
read-only Codex invocation. Validate the repository and base commit before dispatch. After every
producer or verifier invocation:

1. enumerate tracked, staged, modified, deleted, renamed, and untracked paths using NUL-delimited
   Git plumbing;
2. reject symlink escapes, submodule boundary changes, `.git` changes, and paths outside the task
   allowlist;
3. run acceptance commands from an explicit command allowlist;
4. record exact command, exit status, duration, output digest, and redacted excerpts;
5. retain rejected worktree evidence without integrating it.

Codex’s generated permission profile and sandbox are the first provider-specific process boundary.
Graphslop’s independent enforcement is the lease, environment, worktree, path-diff, command,
evidence, candidate-commit, and integration boundary.
The first release supports owner-trusted repositories only and MUST state that a worktree and the
Node permission model are not hostile-code sandboxes
([Git worktree](https://git-scm.com/docs/git-worktree),
[Node permission-model warning](https://nodejs.org/api/permissions.html)).

### Alternatives considered

- **Bubblewrap or a rootless container as a mandatory first-release dependency**: deferred. It is
  valuable defense in depth but requires a separate compatibility and credentials design for the
  model adapter. The runner exposes a sandbox-driver boundary so it can be added without changing
  task contracts.
- **Worktree alone as sufficient sandboxing**: rejected.

## Decision 10: Make Repair Explicitly Human-Authorized

### Decision

Verification failure creates a complete drift report and a proposed `Repair` node in the Execution
Graph. The first-release default repair budget is one attempt. No retry or repair task dispatches
automatically. The owner may authorize the proposed repair while its budget remains, reject it,
change intent, or stop the project. An authorized repair starts from the latest accepted integration
commit, not from the rejected worktree.

## Decision 11: Use GitHub CLI Only at the Authorized PR Boundary

### Decision

Use local Git for branches, commits, diffs, and worktrees. Use GitHub CLI for the terminal draft
pull request only after a separate owner authorization names repository, base branch, head branch,
title, and body digest. Prefer a dry-run preview, then `gh pr create --draft` after authorization
([GitHub pull-request guidance](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request)).

The Graphslop repository currently has no Git remote. Implementation can proceed locally after gate
2, but terminal draft-PR creation remains blocked until the owner authorizes and configures a
specific GitHub remote.

## Decision 12: Keep graphslop.com as a Later Control-Plane Target

### Decision

Do not change the current `graphslop.com` route or deploy during the first local release. A future
hosted Solution Baseline may move the control plane to Cloudflare while the runner initiates
outbound authenticated requests. A per-project Durable Object is a candidate serialized
coordination boundary, and Cloudflare Access is a candidate owner authentication layer
([Durable Object rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
[Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)).
Neither candidate may replace local adapters until it passes the unchanged graph and runner
protocol conformance contracts.

The existing domain is configured for the `graph-slop` Worker in
`/home/ryan/slopslingers-infra/frontend/sumo-grounder/wrangler.jsonc`. Gate 2 and first-release
implementation MUST NOT modify that repository, Worker, route, domain, or traffic.

## Resolved Risks

| Risk | Resolution in this plan |
|---|---|
| Graph library bypasses domain invariants | Graphslop-owned immutable kernel; optional one-way Graphology adapter only |
| Partial file write exposes corrupt state | Single writer, atomic artifact writes, head update last, startup hash audit |
| Model invents authority | Model output is a proposed schema-validated delta; deterministic control plane applies or rejects |
| Runner replays stale work | Signed expiring lease tied to graph and baseline hashes plus idempotent result envelope |
| Repair loops forever | No automatic repair dispatch; finite retry budget and owner authorization |
| Projection changes meaning | Projection tied to exact graph and deterministic template hashes |
| Worktree is mistaken for a sandbox | Owner-trusted repository limitation, Codex sandbox, independent post-run enforcement |
| Hosted scope consumes the graph MVP | Both runtimes local; hosted control plane and domain cutover deferred |
| Draft PR implies release authority | Separate PR authorization; no merge or deployment action |
