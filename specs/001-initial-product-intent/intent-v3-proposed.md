# Proposed Intent Change: Caveman Role Briefs

**Project**: Graphslop

**Proposed Baseline**: `intent-v3`

**Would supersede**: approved `intent-v2` without modifying it

**Status**: Awaiting owner approval

## Why This Change Exists

The first team proposal is too big and too wordy. It turns a small safety boundary into a fake
company with many titles, biographies, and repeated contracts.

Keep the safety. Cut the ceremony.

## Proposed Meaning

- The machine keeps exact paths, permissions, baselines, dependencies, and review separation.
- A worker gets a short plain-language brief.
- A Role says only what the worker needs to do the job.
- A Persona is optional advice, not a character.
- Graphslop makes the smallest team that can safely do the approved work.
- Similar jobs are merged. A new Role must earn its place.
- “Caveman language” means short, ordinary sentences. It does not mean broken grammar.

## Proposed Intent Changes

### Superseded Nodes

- **INT-025 v2 — Smallest useful team**: Graphslop proposes only the Roles needed to complete and
  independently check the approved work. It merges overlapping Roles and rejects a Role that adds
  no distinct job, permission boundary, handoff, or independence boundary.
- **INT-026 v2 — Plain Role brief**: Every Role is shown to a worker with five headings:
  `JOB`, `USE`, `TOUCH`, `DON'T`, and `DONE`. Exact machine policy remains structured and
  enforceable behind the brief. The brief cannot add permission.
- **INT-027 v2 — Tiny optional Persona**: A Persona is optional. When useful, it contains only
  `CARE` and `WATCH` notes tied to a real project need. It has no biography, personality script,
  fictional identity, or authority.
- **INT-029 v2 — Simple team trace**: The owner can see why a Role exists, what task uses it, what
  it may touch, what it must not do, and who checks the result without reading graph syntax or a
  long contract.

### New Node

- **INT-030 — Caveman worker instructions**: All generated instructions for agents and Roles use
  short, direct, ordinary language. System jargon is kept out of the worker brief unless the exact
  term is needed to name a file, command, graph node, or protected baseline.

### Superseded Exclusion

- **EXC-007 v3**: Exclude fake org charts, biographies, role-play, decorative Personas, duplicate
  Roles, personality-based authority, and long agent prompts that restate machine policy.

### Proposed Decision

- **DEC-004 — Safety inside, caveman outside**: Keep rich machine validation. Show workers and the
  owner only the smallest plain-language brief needed to act and review safely.

## Worker Brief

```text
JOB: Build the graph store.
USE: Approved task. Current baselines.
TOUCH: packages/graph-kernel/** and its tests.
DON'T: Add features. Change intent. Push or deploy.
DONE: Tests pass. Show files, tests, and problems.
```

Machine-readable task data remains authoritative. If the brief and machine policy disagree, the
narrower machine policy wins and dispatch stops.

## Acceptance Scenarios

1. **Plain brief**: A worker receives the five-heading brief, exact allowed paths, checks, and
   baseline references without receiving a biography or long role essay.
2. **Same safety**: Shortening the brief does not broaden file, tool, network, approval, release,
   or verification authority.
3. **No duplicate jobs**: Two proposed Roles with the same work and authority boundary are merged.
4. **Role earns its place**: A proposed Role with no distinct job, permission boundary, handoff, or
   independence need fails validation.
5. **Persona can be absent**: A project compiles and executes safely with no Persona nodes.
6. **Tiny Persona**: When advice is useful, `CARE` and `WATCH` explain it without creating a
   character or permission.
7. **Independent check remains**: The worker that makes a result cannot accept that result.

## Measurable Success

- 100% of worker-facing Role briefs use `JOB`, `USE`, `TOUCH`, `DON'T`, and `DONE`.
- 100% of Persona notes, when present, use only `CARE` and `WATCH`.
- 0 worker briefs derive authority from prose, Persona text, model identity, or Role title.
- 0 generated Roles lack a distinct job, permission boundary, handoff, or independence reason.
- 100% of task permissions, protected baselines, and producer-checker separation remain
  deterministically enforced.
- Representative worker briefs fit in one compact view without hiding the exact task checks.

## Unchanged Intent

- Intent, Solution, and Execution remain the three authoritative graphs.
- Roles remain bounded responsibility attached to approved work.
- Workers remain replaceable.
- Personas remain advisory and never grant authority.
- The owner still approves Intent and Solution before execution.
- Every task still traces through Solution to Intent.
- No worker may broaden scope or approve its own result.
- No push, pull request, merge, deploy, domain, or traffic action is authorized.

## Gate

This is a proposed correction to approved `intent-v2`. It does not freeze `intent-v3`, approve a
new Solution, compile work, or authorize execution. One explicit owner approval is required.
