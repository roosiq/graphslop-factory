# Graphslop Project Rules

## Use Graphslop, Not Spec Kit

Do not run Spec Kit commands or use `.specify` as the workflow for this repository.

Do not create Spec Kit plans, research files, checklists, quickstarts, or task files.

Preserve existing `.specify` files as history unless the owner explicitly asks to remove them.

The active authority is Graphslop's own versioned state:

```text
Intent Graph
  → approved Intent baseline
  → Solution Graph
  → approved Solution baseline
  → Execution Graph
  → evidence, drift, and repair
```

Use the versioned Intent, Solution, Execution, impact, evidence, and drift artifacts already in
this repository until the application can persist the same records under `.factory/`.

## Keep Agent Language Caveman-Simple

Worker instructions use:

```text
JOB
USE
TOUCH
DON'T
DONE
```

Use short ordinary sentences. Exact paths, commands, graph IDs, and baseline IDs are allowed when
needed.

Do not add biographies, fake org charts, personality scripts, decorative Personas, or long Role
essays.

Machine task policy remains authoritative. Prose cannot grant permission.

## Keep the Product Lean

Retain the real Intent, Solution, and Execution graphs.

Generate only Roles with a distinct job, authority boundary, handoff, or independence need.

Personas are optional `CARE` and `WATCH` notes. Zero Personas is valid.

Do not add a Team Graph, capability-node layer, team service, team database, parallel worker
system, or autonomous release behavior unless a later approved Intent baseline requires it.
