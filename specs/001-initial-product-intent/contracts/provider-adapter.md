# Contract: Execution Provider Adapter

**First implementation**: `codex-cli` only

## Capability Probe

```text
probe() -> {
  adapterId,
  adapterVersion,
  supportsEphemeralSessions,
  supportsJsonEvents,
  supportsFinalOutputSchema,
  supportsReadOnlyVerification,
  supportsTaskPathPermissions,
  supportsNetworkDefaultDeny,
  probeHash
}
```

Every required flag must be true before task authorization becomes dispatchable.

## Implementation Invocation

Input:

```text
task lease
bounded generated prompt
strict final-output JSON Schema
task worktree path
task-specific permission profile
allowlisted environment
wall-clock and output limits
```

Output:

```text
invocation ID
process exit
typed final result or schema failure
temporary raw event-stream path
duration and termination reason
```

The adapter cannot mark a task accepted, change graph state, create approval, expand permissions,
push, open a pull request, merge, or deploy.

## Verification Invocation

Verification uses:

- a fresh process and invocation ID;
- a fresh worktree at the candidate commit;
- read-only source permissions;
- task, Solution, and Intent traces;
- deterministic check evidence;
- a strict VerificationResult schema.

Verification result:

```json
{
  "outcome": "pass | fail | blocked",
  "requirementChecks": [
    {
      "intentRefs": [],
      "solutionRefs": [],
      "taskCheckId": "...",
      "outcome": "pass | fail | blocked",
      "evidenceRefs": [],
      "explanation": "..."
    }
  ],
  "driftFindings": [],
  "unresolvedIssues": []
}
```

The runner recalculates changed paths after verification. Any verifier-authored source change fails
the verification boundary rather than becoming a fix.

## Codex CLI Command Contract

The runner builds an argv array; it never builds a shell command string. Required semantic options:

```text
codex exec
--ephemeral
--json
--output-schema <generated-schema-file>
--output-last-message <temporary-result-file>
--cd <task-worktree>
--profile <generated-task-profile>
--ask-for-approval never
```

Implementation and verification profiles differ. The exact active CLI flags are detected by the
capability probe and recorded in evidence without credentials.

## Stream Handling

Raw JSONL events are:

1. written to a runner-private temporary directory;
2. parsed with size and schema limits;
3. redacted for secrets and repository content;
4. reduced to selected progress and evidence records;
5. deleted after result finalization.

Raw streams never enter `.factory`, logs, prompts, pull requests, or owner exports.
