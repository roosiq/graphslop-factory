#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { exportBuildPack } from './index.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const statePath = option('--state');
const outputPath = option('--out');
if (!statePath || !outputPath) {
  process.stderr.write('Usage: graphslop-pack --state PROJECT_STATE.json --out PATH/.factory\n');
  process.exitCode = 1;
} else {
  const state = JSON.parse(await readFile(resolve(statePath), 'utf8')) as unknown;
  const manifest = await exportBuildPack(state, resolve(outputPath));
  process.stdout.write(`${JSON.stringify({
    projectId: manifest.projectId,
    output: resolve(outputPath),
    tasks: manifest.tasks.length,
  }, null, 2)}\n`);
}
