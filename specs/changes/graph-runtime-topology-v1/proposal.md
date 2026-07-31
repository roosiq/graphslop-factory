# Graph runtime topology v1

## Goal

Make the approved graph carry meaningful work relationships from requirements
through the portable build pack, then record the work that actually happened.

## Approved scope

1. Let the solution planner declare dependencies between features.
2. Require every cross-feature dependency to declare typed artifact handoffs and
   exact repository files plus file-hash and independent-check evidence that
   proves each handoff.
3. Generate only the work types required by a feature instead of forcing the
   same Decide, Implement, Verify chain everywhere.
4. Compile solution dependencies into execution dependencies without losing
   traceability.
5. Export task input/output contracts in the build pack.
6. Persist a visible realized run graph in `.factory/runtime.json` as a harness
   claims, checks, accepts, or reports drift for work, with controller authority
   held outside the worker-writable repository.

## Non-goals

- Parallel task execution.
- A graph database.
- Permanent fictional personas or a fixed organization chart.
- Model-controlled scheduling.
- Arbitrary runtime graph rewriting.
- Hosted execution of exported build packs.

## Invariants

- Intent and Solution baselines remain immutable authority.
- Product-facing Solution nodes still trace to approved Intent nodes.
- Every generated feature has implementation work and independent verification.
- Optional Inspect, Decide, Test, Integrate, Document, and Release work is
  generated only when selected by the planner.
- Repair remains verifier-created work, not planner-created scope.
- Dependencies must form an acyclic graph.
- A dependent task cannot become ready until its dependencies are accepted and
  every required artifact file exists, is content-hashed, and has passed the
  declared independent check.
- Existing proposals that omit dependencies remain valid.

## Acceptance criteria

- A solution proposal can contain feature dependencies with one or more typed
  artifacts and evidence requirements.
- Invalid feature references, self-dependencies, duplicate dependencies, or
  dependency cycles fail before Solution review.
- The Solution graph contains `DEPENDS_ON` edges carrying the approved handoff
  contract.
- The Execution graph connects the first task of a dependent feature to the last
  task of its prerequisite and preserves the handoff contract.
- Task stages are ordered according to the stages actually present; omitted
  stages do not break the chain.
- Build-pack task files state required and produced artifacts.
- Local Qwen generation schemas omit constraints that llama.cpp cannot compile
  as grammar while authoritative Zod validation still enforces them after
  generation.
- Local Qwen request failures preserve a concise server error so deterministic
  schema failures can be distinguished from capacity or queue failures.
- The portable controller records run nodes, traversed dependency edges, events,
  workers, timestamps, and evidence references in `.factory/runtime.json`.
- The portable controller refuses to release a downstream task when required
  artifact evidence is absent.
- Editing the visible runtime mirror cannot grant acceptance or release work.
- A passing but unrelated command cannot be relabeled as artifact proof.
- Contract, project-service, build-pack, and end-to-end regression tests pass.

## Affected paths

- `packages/contracts/src/proposal.ts`
- `packages/codex-adapter/src/index.ts`
- `packages/control-state/src/project-service.ts`
- `packages/build-pack/src/index.ts`
- relevant tests and concise UI graph labels

## Must not change

- Existing approved Intent and Solution baseline semantics.
- Owner authorization gates.
- Independent verification rules.
- File-scope enforcement.
- Repair authorization.
- Deployment configuration or production state.
