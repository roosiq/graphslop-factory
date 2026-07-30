# Graphslop

Graphslop turns rough software ideas into a portable build pack.

You describe the product in ordinary language. Graphslop asks only questions that resolve important gaps, records the answers in a connected graph, freezes approved requirements, and compiles bounded work for the coding harness you already use.

It does not require a hosted model, a Graphslop account, or Graphslop infrastructure.

![Graphslop cinematic caveman interface](apps/control-plane/public/brand/caveman-neanderthal-confused-hero.webp)

## What comes out

A project ends as a `.factory/` directory or ZIP containing:

- approved Intent and Solution baselines;
- the dependency-ordered Execution graph;
- one bounded file per task;
- protected decisions and exclusions;
- acceptance checks and traceability;
- plain `JOB / USE / TOUCH / DON'T / DONE` worker instructions;
- a small Python controller;
- automatically discovered skills and Role agents for Codex, Claude Code, and Cursor.

Unzip the pack at the target repository root and use the generated
`graphslop-build-pack` skill. Codex, Claude Code, and Cursor receive native,
generated Role adapters while `.factory/` remains the only authority. Other
harnesses and human teams can run the same controller directly.

## Run it entirely on your machine

Requirements:

- Git;
- Node.js 24 and npm 11;
- an OpenAI-compatible model server reachable on loopback.

The model server must implement:

- `GET /v1/models`;
- `POST /v1/chat/completions`;
- JSON-object responses.

Then:

```bash
git clone https://github.com/roosiq/graphslop-factory.git
cd graphslop
npm ci
npm run self-host -- --repo /absolute/path/to/your/project
```

Graphslop prints the local URL, normally `http://127.0.0.1:4173`. Opening it
creates a browser session automatically; there is no owner key or account setup.

By default it expects the model at `http://127.0.0.1:8001/v1`. Point it at another local endpoint when needed:

```bash
npm run self-host -- \
  --repo /absolute/path/to/your/project \
  --model-url http://127.0.0.1:11434/v1 \
  --model your-model-name
```

You can also copy [`.env.example`](.env.example) to `.env` and run the shorter command:

```bash
npm run self-host
```

Private state and generated authority keys are kept outside Git under `.local/state` unless you provide another `--state` path.

## Model choice

Graphslop is model-portable. The current prompt contract is tested with a local Qwen-class model, but any sufficiently capable OpenAI-compatible local model can be used.

The model may propose meaning and the next question. Deterministic code owns IDs, graph mutations, status transitions, approvals, baseline hashes, dependency readiness, and protected-decision checks.

## Optional coding workers

Creating and downloading the build pack does not require a coding-agent CLI.

If you dispatch implementation or verification work from the local runner, install the `codex` CLI or replace the worker adapter with another harness. Execution workers receive one bounded task and cannot rewrite approved project intent.

The hardened Linux runner also requires `bubblewrap`. It is not needed to create, edit, or download a build pack.

## Optional hosted workbench

The same product can run as a small multi-user SaaS:

- an anonymous browser session keeps each visitor's projects separate;
- D1 stores users, projects, and membership;
- one Durable Object owns each project graph and serializes changes;
- Cloudflare Queues feeds bounded interpretation jobs to the local Qwen machine;
- R2 stores immutable build-pack archives;
- the Worker serves the product and project-scoped API.

The graph contracts and generated build pack are unchanged. Local mode still
uses the filesystem and opens directly.

See [Hosted mode](docs/HOSTED_MODE.md) for setup. See [Self-hosting](docs/SELF_HOSTING.md) for the entirely local version.

## Architecture

```text
rough words
    ↓
Intent Graph → approved Intent baseline
    ↓
Solution Graph → approved Solution baseline
    ↓
Execution Graph → .factory authority + harness adapters
    ↓
Codex, Claude Code, Cursor, or another worker
```

Hosted state is partitioned by project:

```text
browser session
    ↓ membership check
project Durable Object
    ├── ordered graph revisions
    ├── immutable approvals
    └── model job → Queue → local Qwen
                              ↓
                         checked result
                              ↓
                         next revision
```

Every product-facing Solution node traces to Intent. Every Execution task traces to Solution. Verification walks the chain in reverse and creates bounded repair work when implementation drifts.

See [Architecture](docs/ARCHITECTURE.md) for the component boundaries.

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run test:ui
npm run test:e2e
npm run ci
```

The repository is a private-package npm workspace. “Private” prevents accidental npm publication; it does not restrict the MIT-licensed source.

## Security

Graphslop binds the control plane to loopback by default, generates local authority keys with restrictive file permissions, and does not send project text to a hosted provider unless you deliberately replace the local model adapter.

Read [SECURITY.md](SECURITY.md) before exposing the control plane through a tunnel.

## License

MIT. See [LICENSE](LICENSE).
