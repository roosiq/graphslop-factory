# Contract: Control Plane to Local Runner

**Transport**: authenticated loopback HTTP in first release  
**Future compatibility**: runner-initiated outbound HTTPS polling without changing message schemas  
**Concurrency**: exactly one active lease

## Capability Report

The runner sends at enrollment and startup:

```json
{
  "runnerId": "runner_...",
  "protocolVersion": "1.0.0",
  "platform": { "os": "linux", "arch": "x64" },
  "nodeVersion": "24.x",
  "gitVersion": "2.55.0",
  "adapter": {
    "id": "codex-cli",
    "version": "0.145.0",
    "ephemeral": true,
    "jsonEvents": true,
    "outputSchema": true,
    "taskPathPermissions": true,
    "networkDefaultDeny": true
  },
  "githubCliAvailable": true,
  "capabilityProbeHash": "..."
}
```

Any required capability set to false makes execution unavailable. Capability results expire when a
binary version or configured permission profile changes.

## Lease Poll

### `GET /v1/runner/leases/next`

Returns `204` when none is authorized. Otherwise returns one signed lease:

```json
{
  "lease": {
    "leaseId": "lease_...",
    "idempotencyKey": "...",
    "taskId": "task_...",
    "attemptId": "task_...:1",
    "executionSnapshotHash": "...",
    "intentBaselineHash": "...",
    "solutionBaselineHash": "...",
    "repository": {
      "identity": "...",
      "pathHandle": "repo_primary",
      "expectedBaseCommit": "..."
    },
    "taskContract": {},
    "adapterId": "codex-cli",
    "issuedAt": "...",
    "expiresAt": "...",
    "cancellationGeneration": 0
  },
  "signature": "base64url-hmac"
}
```

Repository paths are resolved from runner-local handles and never accepted directly from model
output.

## Lease Acknowledgement

### `POST /v1/runner/leases/{leaseId}/ack`

The runner echoes all hashes, its capability report hash, resolved base commit, and acknowledgement
time. A mismatch rejects the lease and leaves the task authorized but not running.

## Heartbeat and Cancellation

### `POST /v1/runner/leases/{leaseId}/heartbeat`

Carries attempt state and last redaction-safe progress event. It never extends beyond the lease’s
maximum wall-clock budget without a new owner authorization.

### `GET /v1/runner/leases/{leaseId}/control`

Returns cancellation generation and desired state. The runner terminates the process tree when the
generation advances and reports a cancelled result.

## Result

### `POST /v1/runner/leases/{leaseId}/result`

```json
{
  "result": {
    "resultId": "result_...",
    "leaseId": "lease_...",
    "idempotencyKey": "...",
    "taskId": "task_...",
    "attemptId": "task_...:1",
    "baseCommit": "...",
    "candidateCommit": "...",
    "producerInvocationId": "...",
    "outcome": "candidate | blocked | failed | cancelled",
    "changedPaths": [],
    "outputRefs": [],
    "evidenceRefs": [],
    "returnedAt": "..."
  },
  "signature": "base64url-hmac"
}
```

Duplicate identical results are idempotent. A duplicate with different content, expired lease,
wrong cancellation generation, stale baseline, wrong graph, wrong base commit, or invalid signature
is rejected and recorded as a security event.

## Evidence Upload

Evidence is uploaded before the result and referenced by content hash. Each record must validate
against the EvidenceRecord schema. Raw model streams, environment values, tokens, unrestricted
command output, and complete repository files are forbidden.

## Runner Write Boundary

The runner may write only:

- its task worktree;
- runner-private temporary directories;
- sanitized evidence staging before upload;
- candidate commits in the task branch.

It may not write Graphslop graph state, baselines, projections, decisions, project status, another
worktree, the connected repository’s primary checkout, or GitHub until separately authorized.
