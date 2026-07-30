import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

let port: number;
let origin: string;
let server: ChildProcess;
let stateRoot: string;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const selected = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (!selected) throw new Error('Could not reserve a test port.');
  return selected;
}

async function launchProduct() {
  const repository = process.cwd();
  server = spawn('node', ['dist/server/control-plane/src/server.js'], {
    cwd: join(repository, 'apps/control-plane'),
    env: {
      ...process.env,
      PORT: String(port),
      GRAPHSLOP_REPOSITORY: repository,
      GRAPHSLOP_PROJECT_STATE: stateRoot,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Product server exited ${server.exitCode}.`);
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch { /* server still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Product server did not become healthy.');
}

test.beforeAll(async () => {
  port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  stateRoot = await mkdtemp(join(tmpdir(), 'graphslop-product-e2e-'));
  await launchProduct();
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  await rm(stateRoot, { recursive: true, force: true });
});

test('recovers when the local server no longer recognizes the stored browser session', async ({ page }) => {
  await page.goto(`${origin}/workspace`);
  await expect(page.getByRole('heading', { name: 'Local project' })).toBeVisible();

  const rotated = await fetch(`${origin}/api/v1/auth/session`);
  expect(rotated.status).toBe(201);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Local project' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No project is open.' })).toHaveCount(0);
});

test('turns Q&A and direct graph edits into a downloadable build pack', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));

  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Bring the idea. Leave with a plan.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simple questions. Serious plan.' })).toBeVisible();
  await expect(page.getByRole('img', { name: /linked intent, solution, and execution graph/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your idea stays your idea.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'start a project' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator('.model-status')).toContainText('Qwen');
  await expect(page.getByRole('heading', { name: 'Local project' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project navigation' })).toBeVisible();

  await page.getByRole('link', { name: 'requirements', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/local-project\/intake$/);
  await expect(page.getByRole('heading', { name: 'Tell Drub what you’re building' })).toBeVisible();
  await page.getByLabel('What are you building?').fill('Need a small notes analyzer. No login.');
  await page.getByRole('button', { name: 'Send to Drub' }).click();
  await expect(page.locator('.ledger-list article')).toHaveCount(1);
  await expect(page.locator('.model-question p')).toHaveText('What result must the user get first?');

  await page.getByRole('link', { name: 'graph', exact: true }).click();
  await expect(page.locator('.graph-node-intent')).toHaveCount(1);
  await expect(page.locator('.graph-node-input')).toHaveCount(1);
  await expect(page.locator('.graph-node-question')).toHaveCount(1);

  await page.getByRole('link', { name: 'requirements', exact: true }).click();
  await page.getByLabel('Answer Drub').fill('Show a useful score with exact examples.');
  await page.getByRole('button', { name: 'Answer' }).click();
  await page.getByText('Add a requirement manually').click();
  await page.locator('.manual-add select').selectOption('Input');
  await page.getByPlaceholder('Describe the requirement…').fill('Accept pasted text.');
  await page.getByRole('button', { name: 'Add requirement' }).click();

  await page.getByRole('link', { name: 'graph', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/local-project\/graph$/);
  await expect(page.locator('.graph-node-intent')).toHaveCount(4);
  await expect(page.locator('.graph-node-question')).toHaveCount(1);
  await page.locator('.graph-node-intent').filter({ hasText: 'Accept pasted text.' }).click();
  await expect(page.getByRole('heading', { name: 'Accept pasted text.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Requirement', exact: true }).fill('Accept pasted notes as plain text.');
  await page.getByRole('button', { name: 'Save requirement' }).click();
  await expect(page.locator('.graph-node-intent').filter({ hasText: 'Accept pasted notes as plain text.' })).toBeVisible();

  await page.getByRole('link', { name: 'build pack', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/local-project\/build$/);
  await page.getByRole('button', { name: 'Review requirements' }).click();
  await page.getByRole('button', { name: 'Approve requirements' }).click();
  await page.getByRole('button', { name: 'Generate solution' }).click();
  await expect(page.locator('.roles-card')).not.toContainText('Not set');
  await expect(page.locator('.roles-card')).toContainText('Approved');
  await expect(page.locator('.roles-card')).toContainText('Completion');
  await page.getByRole('link', { name: 'graph', exact: true }).click();
  await expect(page.locator('.graph-node-solution')).toHaveCount(1);
  await expect(page.locator('.graph-node-role')).toHaveCount(2);
  await page.getByRole('link', { name: 'build pack', exact: true }).click();
  await page.getByRole('button', { name: 'Review solution' }).click();
  await page.getByRole('button', { name: 'Approve solution' }).click();
  await page.getByRole('button', { name: 'Generate build pack' }).click();
  await page.getByRole('link', { name: 'graph', exact: true }).click();
  await expect(page.locator('.graph-node-execution')).toHaveCount(3);
  await expect(page.getByLabel('Graph execution order')).toContainText('01source02requirements03solution04roles05decisions06implementation07verification');
  await expect(page.locator('.graph-edge-ownership')).not.toHaveCount(0);
  await expect(page.locator('.graph-edge-handoff')).not.toHaveCount(0);
  const taskX = await page.locator('.graph-node-execution').evaluateAll((elements) =>
    Object.fromEntries(elements.map((element) => {
      const node = element.closest('.react-flow__node') as HTMLElement;
      const phase = element.querySelector('.graph-node-meta small')?.textContent ?? '';
      return [phase, Number(node.style.transform.match(/translate\(([-\d.]+)px/)?.[1])];
    })));
  expect(taskX).toMatchObject({ Decision: 1360, Implementation: 1700, Verification: 2040 });
  await expect(page.locator('.graph-node-execution').filter({ hasText: 'Decide —' })).toHaveCount(1);
  await expect(page.locator('.graph-node-execution').filter({ hasText: 'Implement —' })).toHaveCount(1);
  await expect(page.locator('.graph-node-execution').filter({ hasText: 'Verify —' })).toHaveCount(1);

  await page.getByRole('link', { name: 'build pack', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .factory.zip' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('graphslop-build-pack.zip');
  const archivePath = await download.path();
  const header = archivePath ? await readFile(archivePath) : Buffer.alloc(0);
  expect([...header.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const files = unzipSync(new Uint8Array(header));
  expect(Object.keys(files)).toEqual(expect.arrayContaining([
    '.factory/execution.json',
    '.factory/factory.py',
    '.agents/skills/graphslop-build-pack/SKILL.md',
    '.claude/skills/graphslop-build-pack/SKILL.md',
    '.cursor/skills/graphslop-build-pack/SKILL.md',
  ]));
  expect(strFromU8(files['.factory/RUN.md'])).toContain('Each Role handoff gets a fresh invocation');
  expect(Object.keys(files).some((name) => name.startsWith('.codex/agents/'))).toBe(true);
  expect(Object.keys(files).some((name) => name.startsWith('.claude/agents/'))).toBe(true);
  expect(Object.keys(files).some((name) => name.startsWith('.cursor/agents/'))).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/projects\/local-project\/build$/);
  await page.getByRole('link', { name: 'graph', exact: true }).click();
  await expect(page.locator('.graph-node-intent')).toHaveCount(4);
  await expect(page.locator('.graph-node-question')).toHaveCount(1);
  await expect(page.locator('.graph-node-solution')).toHaveCount(1);
  await expect(page.locator('.graph-node-role')).toHaveCount(2);
  await expect(page.locator('.graph-node-execution')).toHaveCount(3);
  await page.getByRole('link', { name: 'build pack', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download .factory.zip' }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

for (const width of [320, 360, 768, 1280, 3840]) {
  test(`fits ${width}px with keyboard focus and no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(origin);
    const homeLink = page.getByRole('link', { name: 'Graphslop home' });
    await homeLink.focus();
    await expect(homeLink).toBeFocused();
    await page.getByRole('link', { name: 'start a project' }).focus();
    await expect(page.getByRole('link', { name: 'start a project' })).toBeFocused();
    const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(homeOverflow).toBeLessThanOrEqual(0);
    await page.goto(`${origin}/workspace`);
    await expect(page.getByRole('heading', { name: 'Local project' })).toBeVisible();
    const workspaceHome = page.getByRole('link', { name: 'Graphslop home' });
    await workspaceHome.focus();
    const workspaceNavHome = page.getByRole('link', { name: 'overview', exact: true });
    await workspaceNavHome.focus();
    await expect(workspaceNavHome).toBeFocused();
    const workspaceOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(workspaceOverflow).toBeLessThanOrEqual(0);
  });
}

test('keeps the hero character in frame on a 4K display', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto(origin);
  const hero = page.locator('.marketing-hero-visual > img');
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((image) => getComputedStyle(image).objectPosition)).toBe('70% 0%');
});
