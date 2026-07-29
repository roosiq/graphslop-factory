# Graphslop

Graphslop is a small agent skill that turns rough software ideas into an
executable project graph.

It does not build the app. It creates the files that tell your coding harness
what to build, in what order, and without quietly changing what you approved.

```text
rough words
    ↓
Intent Graph       what you want
    ↓
Solution Graph     what the product means
    ↓
Execution Graph    small jobs, dependencies, paths, checks
    ↓
your harness       Codex, Claude Code, Hermes, or a human team
```

## What is here

- one installable skill: [`skills/graphslop`](skills/graphslop);
- four plain-language agent modes: intent, solution, execution, verification;
- one dependency-free Python script for graph validation, immutable baselines,
  dependency cycles, and ready-job selection;
- tests for the deterministic guardrails.

There is no web app, hosted model, account, database, or required agent runtime.
The earlier experimental SaaS implementation remains preserved in the
[`v0.1.0`](https://github.com/roosiq/graphslop-factory/releases/tag/v0.1.0)
release.

## Use it

Clone the repository and make the skill visible to your harness. For Codex:

```bash
git clone https://github.com/roosiq/graphslop-factory.git
mkdir -p ~/.codex/skills
cp -R graphslop-factory/skills/graphslop ~/.codex/skills/graphslop
```

Then say:

```text
Use $graphslop to turn this into a build pack:
Make site where paste writing and tell if AI. Keep simple. No login.
```

A harness without skill discovery can read
[`skills/graphslop/SKILL.md`](skills/graphslop/SKILL.md) as its operating
instructions.

## What it creates

Graphslop maintains a human-readable `.factory/` directory in the target
project:

```text
.factory/
  project.json
  status.json
  messages.jsonl
  decisions.jsonl
  intent/
    graph.json
    baselines/intent-v1.json
  solution/
    graph.json
    baselines/solution-v1.json
  execution/
    graph.json
  evidence/
  drift/
```

Questions are not hard-coded. The intent mode asks about unresolved,
contradictory, or missing high-impact nodes in the live graph. Corrections
supersede earlier interpretations without deleting history.

The build pack stops at executable work definitions. Running those jobs is a
separate choice owned by your harness.

## Deterministic guardrails

The model handles meaning. The script handles authority and structure:

```bash
python3 skills/graphslop/scripts/graphslop.py init \
  --root /path/to/project \
  --name "My project"

python3 skills/graphslop/scripts/graphslop.py validate \
  --root /path/to/project

python3 skills/graphslop/scripts/graphslop.py freeze \
  --root /path/to/project \
  --graph intent \
  --message-id msg-approval

python3 skills/graphslop/scripts/graphslop.py next \
  --root /path/to/project
```

`freeze` writes a versioned snapshot with a SHA-256 hash. `validate` rejects
broken trace links, missing protected baselines, invalid node types, missing
dependencies, and dependency cycles.

## Test

Python 3.10 or newer is enough:

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile skills/graphslop/scripts/graphslop.py
```

## License

MIT. See [LICENSE](LICENSE).
