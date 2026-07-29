import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

let port: number;
let origin: string;
const claimToken = 'real-owner-claim-token-that-is-long-enough';
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
      GRAPHSLOP_CLAIM_TOKEN: claimToken,
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

test('turns Q&A and direct graph edits into a downloadable build pack', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));

  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'From rough idea to build-ready spec.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep intent connected to the work.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'Enter workspace' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator('.model-status')).toContainText('Qwen');
  await page.getByLabel('Owner key').fill(claimToken);
  await page.getByRole('button', { name: 'Enter cave' }).click();
  await expect(page.getByRole('heading', { name: 'Local project' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project navigation' })).toBeVisible();

  await page.getByRole('link', { name: 'Intake', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/local-project\/intake$/);
  await expect(page.getByRole('heading', { name: 'Tell us what to build' })).toBeVisible();
  await page.getByLabel('What should we build?').fill('Need a small notes analyzer. No login.');
  await page.getByRole('button', { name: 'Tell caveman' }).click();
  await expect(page.locator('.ledger-list article')).toHaveCount(1);
  await expect(page.locator('.model-question p')).toHaveText('What result must the user get first?');

  await page.getByRole('link', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node-intent')).toHaveCount(1);
  await expect(page.locator('.graph-node-input')).toHaveCount(1);
  await expect(page.locator('.graph-node-question')).toHaveCount(1);

  await page.getByRole('link', { name: 'Intake', exact: true }).click();
  await page.getByLabel('Answer Qwen').fill('Show a useful score with exact examples.');
  await page.getByRole('button', { name: 'Answer' }).click();
  await page.getByText('Add requirement by hand').click();
  await page.locator('.manual-add select').selectOption('Input');
  await page.getByPlaceholder('Exact requirement…').fill('Accept pasted text.');
  await page.getByRole('button', { name: 'Add node' }).click();

  await page.getByRole('link', { name: 'Graph', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/local-project\/graph$/);
  await expect(page.locator('.graph-node-intent')).toHaveCount(4);
  await expect(page.locator('.graph-node-question')).toHaveCount(1);
  await page.locator('.graph-node-intent').filter({ hasText: 'Accept pasted text.' }).click();
  await expect(page.getByRole('heading', { name: 'Accept pasted text.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Requirement', exact: true }).fill('Accept pasted notes as plain text.');
  await page.getByRole('button', { name: 'Save requirement' }).click();
  await expect(page.locator('.graph-node-intent').filter({ hasText: 'Accept pasted notes as plain text.' })).toBeVisible();

  await page.getByRole('link', { name: 'Build pack', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/local-project\/build$/);
  await page.getByRole('button', { name: 'Review requirements' }).click();
  await page.getByRole('button', { name: 'Freeze requirements' }).click();
  await page.getByRole('button', { name: 'Shape build plan' }).click();
  await page.getByRole('link', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node-solution')).toHaveCount(3);
  await page.getByRole('link', { name: 'Build pack', exact: true }).click();
  await page.getByRole('button', { name: 'Review build plan' }).click();
  await page.getByRole('button', { name: 'Freeze build plan' }).click();
  await page.getByRole('button', { name: 'Compile build pack' }).click();
  await page.getByRole('link', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node-execution')).toHaveCount(9);

  await page.getByRole('link', { name: 'Build pack', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .factory.zip' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('graphslop-build-pack.zip');
  const archivePath = await download.path();
  const header = archivePath ? await readFile(archivePath) : Buffer.alloc(0);
  expect([...header.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  await page.reload();
  await expect(page).toHaveURL(/\/projects\/local-project\/build$/);
  await page.getByRole('link', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node-intent')).toHaveCount(4);
  await expect(page.locator('.graph-node-question')).toHaveCount(1);
  await expect(page.locator('.graph-node-solution')).toHaveCount(3);
  await expect(page.locator('.graph-node-execution')).toHaveCount(9);
  await page.getByRole('link', { name: 'Build pack', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download .factory.zip' }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

for (const width of [320, 360, 768, 1280]) {
  test(`fits ${width}px with keyboard focus and no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(origin);
    const homeLink = page.getByRole('link', { name: 'Graphslop home' });
    await homeLink.focus();
    await expect(homeLink).toBeFocused();
    await page.getByRole('link', { name: 'Enter workspace' }).focus();
    await expect(page.getByRole('link', { name: 'Enter workspace' })).toBeFocused();
    const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(homeOverflow).toBeLessThanOrEqual(0);
    await page.goto(`${origin}/workspace`);
    const workspaceHome = page.getByRole('link', { name: 'Graphslop home' });
    await workspaceHome.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Owner key')).toBeFocused();
    const workspaceOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(workspaceOverflow).toBeLessThanOrEqual(0);
  });
}
