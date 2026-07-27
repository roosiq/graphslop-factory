# Quickstart Validation Guide: Graphslop First Release

This guide defines the commands and observable scenarios the implementation must support. It does
not authorize implementation or external actions before `solution-v1` approval.

## Prerequisites

- Linux x86-64
- Node.js 24 LTS and npm 11
- Git 2.55 or newer
- Codex CLI with authenticated model access
- GitHub CLI only for separately authorized draft-PR acceptance
- Chromium, Firefox, and Playwright WebKit browsers

Verify local capabilities:

```bash
node --version
npm --version
git --version
codex --version
codex exec --help
gh --version
```

## Install and Static Verification

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:schema
npm run test:unit
npm run test:contract
npm run build
```

Expected: every command exits `0`; schema tests accept all approved enum fixtures and reject all
malformed, stale, orphan, unknown-field, and illegal-transition fixtures.

## Full Deterministic CI

```bash
npm run ci
```

Expected pipeline:

1. formatting
2. lint
3. type check
4. schema conformance
5. unit and property tests
6. control-plane/runner contract tests
7. disposable-Git integration tests
8. component tests
9. Playwright browser acceptance
10. production build

Default CI uses a deterministic fixture provider and never calls an external model, pushes a branch,
creates a pull request, or deploys.

## Graph-Kernel Conformance

```bash
npm run graphslop -- validate-fixtures tests/fixtures/graphs
```

Expected:

- the three graph types materialize as typed node-and-edge snapshots;
- identical inputs produce identical canonical hashes;
- a delta never mutates its input;
- supersession and contradiction history remains navigable;
- Solution-to-Intent and Execution-to-Solution orphan fixtures fail;
- cyclic Execution dependencies fail;
- projections reproduce their recorded hashes;
- blocking questions override readiness scores.

## Start the Local Product

Use a disposable fixture repository:

```bash
npm run fixture:repo
npm run graphslop -- start --repo .tmp/fixtures/owner-project
```

Expected:

- one command starts the loopback control plane and runner;
- the terminal prints a one-time owner URL;
- the URL authenticates one browser session and cannot be reused;
- a second identity or non-loopback request cannot access project state;
- the runner capability probe is visible without revealing credentials.

Temporary fixture repositories and local services must be cleaned up by the test harness.

## Scenario A: Caveman Input Creates Intent, Not Code

Submit:

```text
Need app. Upload document. Find repeated bullshit. Show score. No enterprise thing.
```

Verify:

- raw text is appended before interpretation;
- an Intent Graph snapshot and GraphDelta exist;
- the projection separates confirmed, assumed, unresolved, and excluded state;
- exactly one ranked question is shown;
- no Solution or Execution baseline exists;
- the connected repository commit, status, and worktree list are unchanged.

## Scenario B: Approvals Bind Exact Graph Versions

1. Resolve the displayed blocking question.
2. Review the deterministic Intent projection.
3. Approve the exact graph and projection hashes.
4. Generate the proposed Solution Graph.
5. Attempt to approve a stale or modified projection.
6. Approve the current Solution version.

Verify:

- stale or altered approval fails;
- approved baseline files never change;
- every product-facing Solution node traces to approved Intent;
- implementation remains disabled until both current baselines exist.

## Scenario C: Compile and Execute One Task

1. Compile the Execution Graph.
2. Confirm every task has complete bounds and traces.
3. Authorize one ready task.
4. Attempt to authorize another task concurrently.

Verify:

- the second authorization is rejected;
- one signed lease names exact graph, baseline, repository, base commit, and task hashes;
- the runner creates a disposable worktree;
- the provider receives only the bounded task and relevant graph slices;
- out-of-scope changes fail the attempt;
- deterministic checks produce redaction-safe evidence;
- a fresh verifier worktree and fresh invocation evaluate the candidate;
- producer self-report alone never accepts the task.

The deterministic suite uses a fixture provider. A separately initiated live Codex smoke test may
run only after the owner supplies model authority for the fixture repository:

```bash
GRAPH_SLOP_LIVE_CODEX=1 npm run test:live-codex
```

## Scenario D: Drift and Repair Stay Human-Controlled

Use a seeded provider result that introduces a forbidden file:

```bash
npm run test:integration -- --scenario constraint-drift
```

Verify:

- acceptance fails;
- the drift report names expected intent, observed file, type, severity, and evidence;
- a proposed `Repair` task is appended to the Execution Graph;
- it remains idle until the owner authorizes its exact ID and baseline hashes;
- the one-attempt repair budget cannot loop;
- repair begins from the last accepted integration commit, not the rejected worktree.

## Scenario E: Change Intent Without Rewriting History

After accepted work, submit:

```text
Actually let people compare two versions.
```

Verify:

- the approved Intent Baseline is unchanged;
- a proposed successor Intent delta appears;
- graph impact traversal classifies work with trace evidence;
- affected tasks pause;
- no task references the successor version until new Intent and Solution approvals occur.

## Scenario F: Draft Pull Request Is a Separate Boundary

Without an authorized remote:

```bash
npm run graphslop -- pull-request preview
```

Expected: a reviewable local preview plus `REMOTE_NOT_AUTHORIZED`; no push occurs.

After a future explicit owner authorization naming remote and branches, acceptance may exercise:

```bash
gh pr view --json isDraft,state,headRefName,baseRefName,url
```

Expected: `isDraft=true`. No merge, deployment, domain, or traffic change follows.

## Browser Acceptance

```bash
npm run test:e2e
npm run test:accessibility
```

Required scenarios:

- intake, loading, empty, model failure, validation failure, blocked, and resumed states;
- Intent and Solution approval;
- task queued, authorized, running, verifying, failed, repair proposed, and accepted states;
- keyboard-only operation and visible focus;
- meaningful labels, headings, live regions, dialogs, and error association;
- state distinctions that do not rely on color;
- widths 360, 390, 768, and 1440;
- refresh and deep-link recovery;
- no unexplained console errors or failed requests.

## Recovery Acceptance

For each file-store commit boundary, terminate the control plane at the injected fault point:

```bash
npm run test:integration -- --scenario crash-recovery
```

Expected: startup selects only a complete hash-valid head; unreachable temporary artifacts are
quarantined; approved baselines and conversation history remain available; no partial graph becomes
authoritative.
