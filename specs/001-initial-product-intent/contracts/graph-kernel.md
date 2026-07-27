# Contract: Immutable Graph Kernel

## Authority

The kernel is the only module allowed to create a valid GraphSnapshot, GraphDelta application,
Baseline, GraphTransformation, or Projection. Filesystem, UI, model, runner, and provider modules
must call its pure interfaces and cannot mutate graph objects in place.

## Core Operations

```text
validateSnapshot(snapshot) -> ValidationReport
validateDelta(snapshot, delta) -> ValidationReport
applyDelta(snapshot, delta, controlMetadata) -> GraphSnapshot
buildIndexes(snapshot) -> DerivedGraphIndexes
traceToIntent(solutionOrExecutionRef, graphs) -> NodeRef[]
impactSet(changedIntentRefs, graphs) -> ImpactClassification
readyTasks(executionSnapshot, acceptedTaskRefs) -> TaskRef[]
compileIntentToSolution(intentBaseline, proposal) -> TransformationResult
compileSolutionToExecution(solutionBaseline, proposal) -> TransformationResult
projectGraph(snapshot, queryVersion, templateVersion) -> Projection
freezeBaseline(snapshot, projection, approval) -> Baseline
```

All operations are deterministic for identical validated inputs. Traversal uses explicit edge
filters, visited sets, maximum depth and result bounds, and stable lexical ID ordering.

## Delta Atomicity

- A delta names exact expected base snapshot ID and content hash.
- Every operation is validated before any operation is applied.
- Application returns a new immutable value and never mutates the input.
- One invalid operation rejects the complete delta.
- Control metadata supplies authoritative IDs, versions, actors, and timestamps.
- Models may propose temporary handles only.

## Snapshot Rules

- Snapshots retain all historical node versions and relationship history required for review.
- Active-version indexes are derived, not persisted.
- Node deletion is not a product operation; rejection and supersession preserve history.
- Edge endpoint and compatibility validation is mandatory.
- Execution `DEPENDS_ON` must remain acyclic.
- Cross-graph traces name exact node versions and approved snapshot hashes.

## Graph-Type Rules

### Intent

- Exactly the node, edge, status, confidence, answer-classification, readiness, and blocking rules
  in NC-001 through NC-011.
- Corrections append a node version plus `SUPERSEDES(new, old)`.
- Contradictions stay visible until an exact Decision resolves them.

### Solution

- Exactly the node types in NC-013.
- `scope=product` requires at least one `SATISFIES_INTENT` link.
- `scope=implementation_support` requires at least one internal `supports` link and may not introduce
  observable behavior.

### Execution

- Exactly the task types and task contract in NC-015 and NC-016.
- Every task requires at least one `SATISFIES_SOLUTION` link and protected baseline hashes.
- Dependencies form a DAG and stable topological order.
- Only one task may be active in the first release.

## Hash Contract

1. Validate the object with `contentHash` omitted.
2. Sort set-like collections by documented stable keys.
3. RFC 8785 canonicalize.
4. SHA-256 hash UTF-8 bytes.
5. Add lowercase hexadecimal `contentHash`.
6. Re-validate the complete stored object.

Approval, transformation, lease, projection, evidence, and baseline records always name exact
content hashes.

## Projection Contract

Projection data is deterministic and version-bound. Owner approval is valid only when:

- source snapshot ID/hash equals the displayed snapshot;
- query and template versions are supported;
- included node and edge refs resolve;
- recalculated rendered-data hash equals the displayed projection hash.

Optional model-authored prose is stored as commentary and cannot add, remove, or change projected
facts.

## Compatibility and Migration

- Schema versions are explicit.
- Readers validate before migration.
- Migration creates a new artifact and never overwrites approved bytes.
- Unsupported future schema versions fail read-only with an exportable error.
- Every migration has before/after fixtures and preserved content-hash evidence.
