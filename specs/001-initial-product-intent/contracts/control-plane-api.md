# Contract: Local Control-Plane API

**Visibility**: owner-local, loopback only; not a public developer API  
**Base path**: `/v1`  
**Encoding**: strict JSON, `Content-Type: application/json`  
**Mutation idempotency**: required `Idempotency-Key` header

## Authentication

- Browser routes require the HttpOnly owner session plus CSRF token.
- Runner routes require runner enrollment authentication and signed message envelopes.
- A browser session cannot call runner routes. A runner credential cannot approve, authorize, or
  mutate owner intent.
- Authentication failure returns the same non-enumerating error for nonexistent and inaccessible
  projects.

## Common Error

```json
{
  "error": {
    "code": "STALE_GRAPH_HEAD",
    "message": "The project changed before this command could be applied.",
    "projectId": "project_graphslop",
    "lifecycleState": "DISCOVERY",
    "details": {
      "expectedSnapshotId": "snapshot_a",
      "actualSnapshotId": "snapshot_b"
    },
    "retryable": true
  }
}
```

Error codes are stable enums. Messages contain no secrets, raw model output, repository contents,
or paths outside the connected repository display name.

## Owner Session

### `POST /v1/session/claim`

Exchanges the one-time fragment token for an owner session.

Request:

```json
{ "claimToken": "<one-time-value>" }
```

Success: `204`, sets HttpOnly, SameSite=Strict session cookie and separate CSRF cookie. The claim
token expires after five minutes, is invalidated before the response is returned, and cannot be
replayed. The owner session expires after eight hours or when the control-plane process stops,
whichever occurs first. Every mutating browser request must present the matching CSRF header and
cookie; expiry requires a new launcher-issued claim.

Errors: `INVALID_CLAIM`, `CLAIM_ALREADY_USED`, `CLAIM_EXPIRED`.

## Project Query

### `GET /v1/project`

Returns lifecycle state, active graph and baseline versions, current deterministic projections,
blocking items, ready task summary, runner status, and the last completed action. It never returns
raw provider streams or secrets.

Query may include `?snapshotId=` to review an immutable historical version.

## Conversation

### `POST /v1/messages`

Request:

```json
{
  "content": "Need app. Upload document. Find repeated bullshit.",
  "expectedIntentSnapshotId": "snapshot_...",
  "expectedIntentContentHash": "..."
}
```

Success `202`:

```json
{
  "messageId": "msg_...",
  "operationId": "operation_...",
  "status": "interpreting"
}
```

Completion updates `GET /v1/project` with the validated Intent Graph delta, deterministic projection,
readiness, contradictions, and exactly one next question. Model failure preserves the raw message
and produces a retryable operation error without changing the graph.

## Intent Approval

### `POST /v1/intent/approve`

```json
{
  "snapshotId": "snapshot_...",
  "snapshotContentHash": "...",
  "projectionId": "projection_...",
  "projectionContentHash": "...",
  "approvalPhrase": "Approved"
}
```

Success `201` returns immutable baseline ID and hashes. Blocking questions, stale hashes, wrong
owner, projection drift, or already-approved different content fail closed.

## Solution Commands

### `POST /v1/solution/generate`

Requires exact approved Intent Baseline ID/hash and no active proposed Solution generation.
Returns `202 operationId`.

### `POST /v1/solution/approve`

Uses the same exact snapshot-and-projection approval contract as Intent approval and returns an
immutable Solution Baseline.

## Execution Compilation

### `POST /v1/execution/compile`

Requires exact approved Intent and Solution baseline IDs/hashes. Success returns the proposed
Execution Graph snapshot, transformation ID, validation report, and deterministic task projection.
It does not authorize any task.

## Task Authorization

### `POST /v1/tasks/{taskId}/authorize`

```json
{
  "executionSnapshotId": "snapshot_...",
  "intentBaselineHash": "...",
  "solutionBaselineHash": "...",
  "expectedIntegrationCommit": "...",
  "authorizationPhrase": "Run this task"
}
```

Success returns `202` with authorization ID. The lease coordinator issues a lease only when:

- the task is `ready`;
- all dependencies are accepted;
- no task is active;
- baseline and graph hashes match;
- the runner capability probe is current;
- retry budget remains;
- the sole owner session authorized this exact task.

## Repair Authorization

### `POST /v1/repairs/{taskId}/authorize`

Uses the task authorization shape and additionally requires `driftId`. Only a proposed `Repair`
task with remaining budget can be authorized.

## Change Proposal

### `POST /v1/changes`

Accepts ordinary language plus the expected active baseline and graph hashes. Returns a proposed
Intent delta and graph impact traversal. Affected work pauses; no active baseline changes before
owner approval.

## Draft Pull Request Boundary

### `POST /v1/pull-request/preview`

Returns target remote, base/head branches, title, body, body hash, baseline hashes, task/evidence
summary, and exact command preview. It performs no push or external mutation.

### `POST /v1/pull-request/authorize`

Requires the preview ID/hash and explicit owner phrase. It authorizes only branch push and draft PR
creation for the named remote and refs. It does not authorize merge or deployment.

## Event Progress

### `GET /v1/events`

Server-sent events keyed by monotonically increasing local event sequence. Events contain lifecycle
state, operation/task IDs, progress enum, and redaction-safe status only. Clients reconnect with
`Last-Event-ID`; event delivery never mutates state.
