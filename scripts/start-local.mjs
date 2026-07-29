#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  process.stdout.write(`
Graphslop self-host

Usage:
  npm run self-host -- --repo /path/to/project

Options:
  --repo PATH          Git repository Graphslop should prepare
  --state PATH         Private durable state directory
  --model-url URL      OpenAI-compatible local API base URL
  --model NAME         Loaded model name
  --port NUMBER        Local web port (default: 4173)
  --claim-token VALUE  Optional owner key, at least 24 characters
  --public-host HOST   Optional exact hostname used by a tunnel
  --help               Show this help

The same values can be set with the variables in .env.example.
`);
}

if (process.argv.includes('--help')) {
  usage();
  process.exit(0);
}

const repository = resolve(option('--repo') ?? process.env.GRAPHSLOP_REPOSITORY ?? process.cwd());
const state = resolve(option('--state') ?? process.env.GRAPHSLOP_PROJECT_STATE ?? resolve(root, '.local/state'));
const modelUrl = option('--model-url') ?? process.env.GRAPHSLOP_QWEN_URL ?? 'http://127.0.0.1:8001/v1';
const model = option('--model') ?? process.env.GRAPHSLOP_QWEN_MODEL;
const port = option('--port') ?? process.env.PORT ?? '4173';
const claimToken = option('--claim-token') ?? process.env.GRAPHSLOP_CLAIM_TOKEN;
const publicHost = option('--public-host') ?? process.env.GRAPHSLOP_PUBLIC_HOST;
const server = resolve(root, 'apps/control-plane/dist/server/control-plane/src/server.js');

if (!existsSync(server)) {
  throw new Error('Graphslop is not built. Run `npm run self-host -- --repo /path/to/project` first.');
}
if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65_535) {
  throw new Error('Port must be an integer from 1 to 65535.');
}
if (claimToken && claimToken.length < 24) {
  throw new Error('Owner key must contain at least 24 characters.');
}

try {
  const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (inside !== 'true') throw new Error();
} catch {
  throw new Error(`Target is not a Git repository: ${repository}`);
}

mkdirSync(state, { recursive: true });

process.stdout.write([
  'Starting private Graphslop factory',
  `Project: ${repository}`,
  `State: ${state}`,
  `Model API: ${modelUrl}`,
  '',
].join('\n'));

const child = spawn(process.execPath, [server], {
  cwd: resolve(root, 'apps/control-plane'),
  env: {
    ...process.env,
    PORT: String(port),
    GRAPHSLOP_REPOSITORY: repository,
    GRAPHSLOP_PROJECT_STATE: state,
    GRAPHSLOP_QWEN_URL: modelUrl,
    ...(model ? { GRAPHSLOP_QWEN_MODEL: model } : {}),
    ...(claimToken ? { GRAPHSLOP_CLAIM_TOKEN: claimToken } : {}),
    ...(publicHost ? { GRAPHSLOP_PUBLIC_HOST: publicHost } : {}),
  },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
