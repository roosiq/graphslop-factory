# Contributing

Graphslop is deliberately small. Changes should preserve the separation between what the owner wants, what the approved solution means, and what a worker is allowed to do.

## Before opening a pull request

```bash
npm ci
npm run ci
```

Include:

- the behavior being changed;
- the graph or authority boundary it affects;
- tests proving the approved behavior;
- confirmation that no product scope was added silently.

## Design rules

- Model output is an untrusted proposal.
- Deterministic code owns authority and state transitions.
- Inferred requirements are never treated as approved.
- Product-facing Solution nodes trace to Intent.
- Execution tasks trace to Solution.
- Workers receive bounded paths and acceptance checks.
- Worker instructions stay short: `JOB / USE / TOUCH / DON'T / DONE`.

Open an issue before making a breaking graph-schema or build-pack-format change.
