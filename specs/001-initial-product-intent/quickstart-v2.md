# Successor Quickstart: Generated Team Acceptance

This guide supplements [quickstart.md](quickstart.md). It is a proposed Gate 2 validation guide and
does not authorize implementation or task dispatch.

## Static and Contract Checks

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:contract -- tests/contract/team
npm run test:integration -- tests/integration/assignments
npm run build
```

Expected:

- every valid Persona, Role, Capability, TeamPlan, task extension, Assignment, lease, evidence, and
  drift fixture passes;
- malformed, orphan, stale, over-privileged, unsupported, self-verifying, and Persona-authority
  fixtures fail closed;
- build and test commands fail when the expected test roots are absent or empty.

## Scenario G: Generate a Project-Specific Team

Use two approved fixture Solutions: a static marketing site and a repository-executing software
factory.

Expected:

- the Role and Persona sets differ;
- every team node has Solution traces and selection rationale;
- no universal fictional cast is injected;
- no Role lacks inputs, outputs, capability, permissions, exclusions, or acceptance obligations;
- the Team view is a projection over Solution and Execution, not a fourth baseline.

## Scenario H: Persona Cannot Grant Authority

Seed a Persona suggesting database access while its Role and task allow only UI files.

Expected:

- the permission profile contains only approved UI paths and commands;
- changing Persona text does not change the effective permission hash;
- any proposal that treats Persona text as authority fails with
  `PERSONA_AUTHORITY_FORBIDDEN`.

## Scenario I: Role-Bound Task Assignment

Compile a task, select its approved Role, and authorize it with a fixture worker.

Expected:

- task, Role, optional Personas, worker, repository, baselines, permission hash, and expiry are
  bound into one signed lease;
- a stale Role, wrong worker, or broader permission fails before process invocation;
- the runner recomputes the same effective permission hash;
- evidence records exact assignment and worker invocation references.

## Scenario J: Independent Verification

Attempt verification with:

1. the producer assignment;
2. the producer worker invocation under a renamed Role;
3. a fresh independent verifier Role and invocation.

Expected:

- cases 1 and 2 fail with `VERIFIER_NOT_INDEPENDENT`;
- case 3 may proceed to substantive verification;
- a different Persona alone never satisfies independence.

## Scenario K: Team Change Impact

After accepted work, submit:

```text
Drop the security persona; make security a required reviewer role.
```

Expected:

- approved Intent and Solution history remains unchanged;
- a successor team proposal explains the Persona removal and Role addition;
- impact traversal identifies affected Solution nodes, tasks, assignments, tests, and evidence;
- stale affected leases are cancelled;
- unaffected accepted evidence remains attributable and reusable only with trace proof.

## Browser Acceptance

```bash
npm run test:e2e -- tests/e2e/team-review.spec.ts
npm run test:accessibility -- tests/e2e/team-review.spec.ts
```

Test at 360, 736, and 1440 pixels:

- proposed and approved Team projections;
- Role detail, Persona detail, Solution trace, dependency, permission, and assignment views;
- loading, empty, validation failure, stale, blocked, and superseded states;
- keyboard-only review and correction;
- states distinguishable without color alone;
- no console errors or failed requests.
