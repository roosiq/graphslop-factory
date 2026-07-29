---
name: graphslop
description: Turn incomplete, informal, or contradictory project requests into a persistent intent graph, approved solution graph, and dependency-ordered execution graph. Use when a user wants to clarify software requirements, create an editable build pack, freeze approved intent, generate bounded implementation tasks, or check graph traceability before handing work to a coding harness.
---

# Graphslop

Make the build pack. Do not build the product.

The pack lives in `.factory/`. The user's words become an intent graph. Approved
intent becomes a solution graph. Approved solution becomes an execution graph.
Never let a later graph quietly change an earlier one.

## Start

Find the target project directory. Then run:

```bash
python3 <skill-dir>/scripts/graphslop.py init --root <project-dir> --name "<project name>"
```

If `.factory/` already exists, read it before changing anything. Do not
regenerate settled work from scratch.

## Choose the mode

Use one mode at a time. Read its complete contract before acting:

- Discovery or corrections: `references/intent-agent.md`
- Product and technical interpretation after intent approval:
  `references/solution-agent.md`
- Work breakdown after solution approval: `references/execution-agent.md`
- Traceability, dependency, and completeness checks:
  `references/verification-agent.md`

Read `references/graph-contract.md` whenever creating or editing graph files.

## Flow

1. Intent mode records the user's message, updates `intent/graph.json`, and asks
   one useful question about the highest-impact unresolved graph item.
2. Show a short understanding: confirmed, assumed, unresolved, excluded.
3. When the user approves, freeze intent:

   ```bash
   python3 <skill-dir>/scripts/graphslop.py freeze --root <project-dir> --graph intent
   ```

4. Solution mode creates `solution/graph.json`. Every product-facing node must
   name the approved intent nodes it satisfies.
5. Show the proposed product in normal language. When approved, freeze solution:

   ```bash
   python3 <skill-dir>/scripts/graphslop.py freeze --root <project-dir> --graph solution
   ```

6. Execution mode creates small jobs in `execution/graph.json`. Each job must
   name solution nodes, dependencies, allowed paths, acceptance checks, and
   protected baseline IDs.
7. Verification mode checks the pack:

   ```bash
   python3 <skill-dir>/scripts/graphslop.py validate --root <project-dir>
   python3 <skill-dir>/scripts/graphslop.py next --root <project-dir>
   ```

8. Stop after producing the build pack unless the user separately asks the
   current harness to execute it.

## Hard rules

- Ask no canned questionnaire. Questions come from unresolved graph nodes,
  contradictions, or missing high-impact links.
- Ask one focused question per turn by default.
- Inferred and proposed intent are not requirements.
- Corrections supersede old nodes; keep the history.
- Never freeze a graph with a blocking unresolved node.
- Never create solution before intent is frozen.
- Never create execution before solution is frozen.
- Never add product scope merely to make implementation easier.
- Keep role instructions short and plain. No personalities.
- Use deterministic script checks for schemas, links, cycles, baselines, and
  ready work. Use the model for meaning.

## Handoff

Give the user:

- the `.factory/` directory;
- active intent and solution baseline IDs;
- the next dependency-ready execution jobs;
- unresolved or deferred decisions;
- validation output.

The build pack must be usable by the user's chosen coding harness. Do not require
Graphslop's web interface, a particular model, a database, or a hosted service.
