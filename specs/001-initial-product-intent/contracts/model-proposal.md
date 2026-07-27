# Contract: Schema-Bound Model Proposals

**First provider**: Codex CLI through the single provider adapter  
**Authority**: proposal only; no direct graph, baseline, repository, approval, or lifecycle writes

## Capabilities

Each invocation names exactly one capability:

```text
extract_intent_delta
rank_next_question
detect_contradictions
propose_solution_graph
propose_execution_graph
semantic_verify
```

Capabilities receive only the relevant graph slice, protected assertions, source messages, output
schema, and role contract. Execution capabilities do not receive open-ended project prompts.

## Proposal Envelope

```json
{
  "proposalId": "temporary-model-handle",
  "capability": "extract_intent_delta",
  "expectedInputHashes": {
    "graphSnapshot": "...",
    "intentBaseline": null,
    "solutionBaseline": null
  },
  "proposal": {},
  "assumptions": [],
  "blockingDecisionRequests": [],
  "optionalSuggestions": []
}
```

The output must validate against a capability-specific JSON Schema. Unknown fields, unknown enums,
malformed references, missing hashes, or prose outside the envelope reject the entire proposal.

## Intent Extraction

The proposal includes:

- answer classifications from NC-005;
- typed proposed node versions and edges;
- exact source-message and quote references;
- original and normalized interpretations;
- confidence values;
- proposed contradiction and supersession relationships;
- candidate unresolved questions;
- no approval flag or authoritative metadata.

The control plane supplies stable IDs, versions, timestamps, actors, statuses, and approval state.

## Question Ranking

For each candidate question the proposal supplies normalized factors in `[0,1]`:

```text
uncertaintyReduction
implementationImpact
driftRisk
dependencyCount
```

Deterministic code calculates the product, applies blocking precedence, and selects the highest
value using stable question ID as the final tie-breaker. The model cannot select a lower-ranked
question without returning a rejected proposal and explicit reason for owner review.

## Solution and Execution Proposals

- Every product Solution node contains exact proposed Intent traces.
- Every support-only node declares `implementation_support` plus supported Solution refs.
- Every Execution task contains the complete NC-016 contract and exact Solution traces.
- A proposal cannot grant approval, mark a baseline approved, mark a task ready, authorize work, or
  change protected assertions.

## Failure Contract

| Failure | Required result |
|---|---|
| Provider timeout or process termination | Preserve raw owner message; append operation failure; no graph delta |
| Authentication or quota failure | Typed blocked operation; no retry without owner-visible status |
| Refusal | Typed refusal with no graph mutation |
| Invalid JSON or schema mismatch | Reject complete proposal; retain redaction-safe validation evidence |
| Stale expected hash | Reject proposal and allow regeneration from current head |
| Unknown enum or reference | Reject complete proposal |
| Secret-pattern finding | Quarantine raw temporary output, emit non-secret security failure, delete raw stream |

Retries are bounded and create new invocation IDs. A retry never reuses or partially applies the
failed proposal.

## Prompt and Retention Boundary

- Prompts contain no credentials, raw environment, unrelated conversation, or repository contents
  outside the task’s relevant slices.
- Raw invocation streams remain runner-private temporary data.
- Persistent metadata is limited to provider/adapter version, capability, invocation ID, input and
  output hashes, duration, outcome, and redaction-safe errors.
