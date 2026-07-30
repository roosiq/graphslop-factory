# Hosted workbench

Hosted mode supports many independent users and projects while keeping the model local.

## What runs where

Cloudflare runs:

- the Worker and static web application;
- anonymous browser sessions;
- the D1 user and project catalog;
- one SQLite-backed Durable Object per project;
- the model-job Queue;
- R2 build-pack storage.

Your machine runs:

- the OpenAI-compatible Qwen server;
- one small Queue pull consumer.

The browser never receives the Queue token, model-runner token, or Qwen address.
It receives an opaque, HttpOnly session cookie. Clearing that cookie starts a
new workspace; this first release has no account recovery.

## Cloudflare setup

From `apps/edge`:

```bash
npx wrangler deploy
npx wrangler d1 migrations apply graphslop-app --remote
npx wrangler queues consumer http add graphslop-model-jobs
```

Install the model-runner Worker secret interactively:

```bash
npx wrangler secret put MODEL_RUNNER_TOKEN
```

Run `npx wrangler deploy --keep-vars` once more after the secrets are installed.

Do not put secret values in `wrangler.jsonc`, `.env.example`, shell history, or source control.

## Local model worker

Create a Cloudflare API token limited to Queues read and write. Find the account ID and Queue ID, then set these values in the uncommitted root `.env`:

```text
CLOUDFLARE_ACCOUNT_ID=
GRAPHSLOP_QUEUE_ID=
GRAPHSLOP_QUEUE_TOKEN=
GRAPHSLOP_APP_ORIGIN=https://graphslop.com
GRAPHSLOP_MODEL_RUNNER_TOKEN=
GRAPHSLOP_QWEN_URL=http://127.0.0.1:8001/v1
GRAPHSLOP_QWEN_MODEL=
```

`GRAPHSLOP_MODEL_RUNNER_TOKEN` must exactly match the Worker’s `MODEL_RUNNER_TOKEN` secret.

Start the consumer:

```bash
npm run hosted:model-worker
```

The consumer pulls one job only when Qwen is ready. Successful jobs are acknowledged. Temporary failures retry, and the third failed attempt becomes a visible project error.

## Authority rules

- Every request is checked against `project_memberships`.
- Viewer access cannot mutate a graph.
- Only an owner can freeze Intent or Solution.
- Every mutation includes the current project revision.
- Stale commands and stale model results are rejected.
- A project can have only one active model interpretation job.
- Build packs are keyed by project and Execution graph hash.

The local/self-hosted mode uses the same graph engine with filesystem storage and remains available without Cloudflare.
