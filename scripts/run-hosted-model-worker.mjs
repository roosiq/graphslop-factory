#!/usr/bin/env node
import {
  CodexProposalProvider,
  LocalQwenClient,
} from '@graphslop/codex-adapter';
import { createHash } from 'node:crypto';

const required = [
  'CLOUDFLARE_ACCOUNT_ID',
  'GRAPHSLOP_QUEUE_ID',
  'GRAPHSLOP_APP_ORIGIN',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const queueId = process.env.GRAPHSLOP_QUEUE_ID;
const queueToken = process.env.GRAPHSLOP_QUEUE_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
if (!queueToken) throw new Error('GRAPHSLOP_QUEUE_TOKEN or CLOUDFLARE_API_TOKEN is required.');
const appOrigin = process.env.GRAPHSLOP_APP_ORIGIN.replace(/\/$/, '');
const runnerToken = process.env.GRAPHSLOP_MODEL_RUNNER_TOKEN
  ?? (process.env.CLOUDFLARE_API_TOKEN
    ? createHash('sha256')
      .update(`graphslop-model-runner:${process.env.CLOUDFLARE_API_TOKEN}`)
      .digest('base64url')
    : '');
if (!runnerToken) throw new Error('GRAPHSLOP_MODEL_RUNNER_TOKEN or CLOUDFLARE_API_TOKEN is required.');
const queueOrigin = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages`;
const qwen = new LocalQwenClient(
  process.env.GRAPHSLOP_QWEN_URL ?? 'http://127.0.0.1:8001/v1',
  process.env.GRAPHSLOP_QWEN_MODEL,
);
const provider = new CodexProposalProvider((prompt, output) => qwen.call(prompt, output));
let stopping = false;

process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

async function queueRequest(path, body) {
  const response = await fetch(`${queueOrigin}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${queueToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.success === false) {
    throw new Error(`Cloudflare Queue request failed (${response.status}).`);
  }
  return value.result ?? value;
}

function messageBody(message) {
  if (message.body && typeof message.body === 'object') return message.body;
  if (typeof message.body !== 'string') throw new Error('Queue message body is missing.');
  try {
    return JSON.parse(message.body);
  } catch {
    return JSON.parse(Buffer.from(message.body, 'base64').toString('utf8'));
  }
}

async function appRequest(path, init = {}) {
  const response = await fetch(`${appOrigin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${runnerToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `Graphslop request failed (${response.status}).`);
  return body;
}

async function handle(message) {
  const body = messageBody(message);
  if (typeof body.projectId !== 'string' || typeof body.jobId !== 'string') {
    throw new Error('Queue message does not identify a project model job.');
  }
  const path = `/api/v1/internal/projects/${encodeURIComponent(body.projectId)}/model-jobs/${encodeURIComponent(body.jobId)}`;
  const claimed = await appRequest(path);
  if (['completed', 'failed', 'stale'].includes(claimed.job.status)) return;
  const proposal = claimed.job.kind === 'propose-solution'
    ? await provider.planSolution(claimed.job.solutionContext)
    : await provider.propose(claimed.job.proposalContext);
  await appRequest(`${path}/complete`, {
    method: 'POST',
    body: JSON.stringify({ proposal }),
  });
}

async function settle(acks, retries) {
  if (acks.length === 0 && retries.length === 0) return;
  await queueRequest('/ack', {
    acks: acks.map((leaseId) => ({ lease_id: leaseId })),
    retries: retries.map((leaseId) => ({ lease_id: leaseId })),
  });
}

async function runBatch() {
  const pulled = await queueRequest('/pull', {
    batch_size: 1,
    visibility_timeout_ms: 300_000,
  });
  const messages = Array.isArray(pulled.messages) ? pulled.messages : [];
  const acks = [];
  const retries = [];
  for (const message of messages) {
    try {
      await handle(message);
      acks.push(message.lease_id);
      process.stdout.write(`${new Date().toISOString()} completed one graph proposal\n`);
    } catch (cause) {
      const attempts = Number(message.attempts ?? 1);
      const failure = cause instanceof Error ? cause.message : 'Local model job failed.';
      if (attempts < 3) {
        retries.push(message.lease_id);
      } else {
        try {
          const body = messageBody(message);
          await appRequest(
            `/api/v1/internal/projects/${encodeURIComponent(body.projectId)}/model-jobs/${encodeURIComponent(body.jobId)}/fail`,
            {
              method: 'POST',
              body: JSON.stringify({
                error: failure,
              }),
            },
          );
        } finally {
          acks.push(message.lease_id);
        }
      }
      process.stderr.write(
        `${new Date().toISOString()} model job failed; attempt ${attempts}; ${failure.slice(0, 500)}\n`,
      );
    }
  }
  await settle(acks, retries);
  return messages.length;
}

const model = await qwen.info();
if (!model.connected) throw new Error('Local Qwen is not reachable.');
process.stdout.write(`Graphslop model worker ready with ${model.name}\n`);

while (!stopping) {
  try {
    const handled = await runBatch();
    if (handled === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
  } catch (cause) {
    process.stderr.write(`${new Date().toISOString()} queue poll failed\n`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
