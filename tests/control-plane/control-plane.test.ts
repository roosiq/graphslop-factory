import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { ProjectService } from '../../packages/control-state/src/index.js';
import {
  HmacWorkerIdentityAuthority,
  LocalRunner,
  type DurableLeaseRecord,
} from '../../apps/runner/src/index.js';
import { createControlPlane } from '../../apps/control-plane/src/api/app.js';
import { SoleOwnerSessions } from '../../apps/control-plane/src/auth/session.js';
import { redactBoundedSummary } from '../../apps/control-plane/src/services/control.js';
import { ProjectRunnerBridge, unleasedArtifact } from '../../apps/control-plane/src/services/bridge.js';
import {
  FileExecutionArtifactStore,
  FileRepairAuthorityStore,
  FileVerifierDriftStore,
  HmacCheckDriftReceiptAuthority,
} from '../../apps/control-plane/src/services/durable-authority.js';
import { ProductionControlAdapter } from '../../apps/control-plane/src/services/production.js';
import { LOOPBACK_HOST, MemoryControlAdapter, startControlPlane } from '../../apps/control-plane/src/server.js';

const hash = 'a'.repeat(64);
const runnerToken = 'runner-secret-that-is-long-enough';
const repositoryRoot = process.cwd();
const envelope = {
  bindings: {
    stage: 'execution' as const,
    projectId: 'project-1',
    lifecycleState: 'EXECUTION',
    graphSnapshotId: 'graph-1',
    graphContentHash: hash,
    intentBaselineId: 'intent-v1',
    intentBaselineHash: hash,
    solutionBaselineId: 'solution-v1',
    solutionBaselineHash: hash,
    projectionId: 'projection-1',
    projectionHash: hash,
    taskId: 'task-1',
    leaseId: 'lease-1',
    leaseHash: hash,
  },
  input: { content: 'Need app.' },
};
const conversationEnvelope = {
  bindings: {
    stage: 'conversation',
    projectId: 'project-1',
    lifecycleState: 'CAPTURE',
    messageHeadHash: hash,
  },
  input: { content: 'Need app.' },
} as const;

function cookies(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
}

describe('control plane boundary', () => {
  test('reports the local model and downloads the owner build pack as a zip', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const app = createControlPlane({
      sessions,
      adapter: new MemoryControlAdapter(null, envelope.bindings),
      runnerToken,
      modelInfo: async () => ({ connected: true, name: 'Qwen3.6-27B-MTP' }),
      buildPack: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    const info = await app.request('http://127.0.0.1/api/v1/model', { headers: { host: '127.0.0.1' } });
    expect(await info.json()).toEqual({ connected: true, name: 'Qwen3.6-27B-MTP' });
    const claim = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    const pack = await app.request('http://127.0.0.1/api/v1/owner/build-pack', {
      headers: { host: '127.0.0.1', cookie: cookies(claim) },
    });
    expect(pack.status).toBe(200);
    expect(pack.headers.get('content-type')).toBe('application/zip');
    expect(pack.headers.get('content-disposition')).toContain('graphslop-build-pack.zip');
    expect([...new Uint8Array(await pack.arrayBuffer())]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  test('one-time owner claim sets strict cookies and cannot replay', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const app = createControlPlane({ sessions, adapter: new MemoryControlAdapter(null, envelope.bindings), runnerToken });
    const first = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    expect(first.status).toBe(201);
    expect(first.headers.getSetCookie().join(' ')).toContain('HttpOnly');
    expect(first.headers.getSetCookie().join(' ')).toContain('SameSite=Strict');
    const replay = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    expect(replay.status).toBe(409);
  });

  test('owner mutations require session, CSRF, exact bindings, and replay exact responses', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const adapter = new MemoryControlAdapter(null, conversationEnvelope.bindings);
    const app = createControlPlane({ sessions, adapter, runnerToken });
    const claim = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    const csrf = (await claim.json() as { csrfToken: string }).csrfToken;
    const headers = {
      host: '127.0.0.1',
      cookie: cookies(claim),
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      'idempotency-key': 'owner-key-0001',
    };
    const first = await app.request('http://127.0.0.1/api/v1/owner/commands/submit-message', {
      method: 'POST', headers, body: JSON.stringify(conversationEnvelope),
    });
    const replay = await app.request('http://127.0.0.1/api/v1/owner/commands/submit-message', {
      method: 'POST', headers, body: JSON.stringify(conversationEnvelope),
    });
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.clone().json());
    expect(adapter.commands).toHaveLength(1);
    const conflict = await app.request('http://127.0.0.1/api/v1/owner/commands/submit-message', {
      method: 'POST', headers, body: JSON.stringify({ ...conversationEnvelope, input: { content: 'different' } }),
    });
    expect(conflict.status).toBe(409);
  });

  test('coalesces simultaneous idempotent commands into one mutation', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const adapter = new MemoryControlAdapter(null, conversationEnvelope.bindings);
    const app = createControlPlane({ sessions, adapter, runnerToken });
    const claim = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    const csrf = (await claim.json() as { csrfToken: string }).csrfToken;
    const request = () => app.request('http://127.0.0.1/api/v1/owner/commands/submit-message', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        cookie: cookies(claim),
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'idempotency-key': 'owner-key-concurrent',
      },
      body: JSON.stringify(conversationEnvelope),
    });
    const [first, second] = await Promise.all([request(), request()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(adapter.commands).toHaveLength(1);
  });

  test('rejects well-formed but stale authority bindings', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const accepted = { ...envelope.bindings, leaseHash: 'b'.repeat(64) };
    const app = createControlPlane({
      sessions,
      adapter: new MemoryControlAdapter(null, accepted),
      runnerToken,
    });
    const claim = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    const csrf = (await claim.json() as { csrfToken: string }).csrfToken;
    const response = await app.request('http://127.0.0.1/api/v1/owner/commands/dispatch-task', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        cookie: cookies(claim),
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'idempotency-key': 'owner-key-stale',
      },
      body: JSON.stringify(envelope),
    });
    expect(response.status).toBe(409);
  });

  test('owner and runner identities cannot impersonate each other and events are redacted', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const adapter = new MemoryControlAdapter(null, envelope.bindings);
    const app = createControlPlane({ sessions, adapter, runnerToken });
    const ownerAtRunner = await app.request('http://127.0.0.1/api/v1/runner/events', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json', 'idempotency-key': 'runner-key-001' },
      body: '{}',
    });
    expect(ownerAtRunner.status).toBe(401);
    const runnerAtOwner = await app.request('http://127.0.0.1/api/v1/owner/project', {
      headers: { host: '127.0.0.1', authorization: `Bearer ${runnerToken}` },
    });
    expect(runnerAtOwner.status).toBe(401);
    const validEventPayload = {
      type: 'progress',
      status: 'running',
      taskId: 'task-1',
      reasonCode: 'task_started',
      timestamp: '2026-07-28T12:00:00.000Z',
      summary: 'Work started.',
    };
    const accepted = await app.request('http://127.0.0.1/api/v1/runner/events', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${runnerToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runner-key-001',
      },
      body: JSON.stringify(validEventPayload),
    });
    expect(accepted.status).toBe(202);
    const acceptedBody = await accepted.clone().json();
    expect(adapter.events[0]?.summary).toBe('Work started.');
    expect(adapter.events[0]?.eventId).toMatch(/^event-[0-9a-f-]{36}$/);
    const replayEvent = await app.request('http://127.0.0.1/api/v1/runner/events', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${runnerToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runner-key-001',
      },
      body: JSON.stringify(validEventPayload),
    });
    expect(await replayEvent.json()).toEqual(acceptedBody);
    expect(adapter.events).toHaveLength(1);
    const eventConflict = await app.request('http://127.0.0.1/api/v1/runner/events', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${runnerToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runner-key-001',
      },
      body: JSON.stringify({ ...validEventPayload, status: 'blocked' }),
    });
    expect(eventConflict.status).toBe(409);

    const chosenEventId = await app.request('http://127.0.0.1/api/v1/runner/events', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${runnerToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runner-key-chosen-id',
      },
      body: JSON.stringify({
        eventId: runnerToken,
        type: 'progress',
        status: 'running',
        taskId: 'task-1',
        reasonCode: 'task_started',
        timestamp: '2026-07-28T12:00:00.000Z',
        summary: 'Work started.',
      }),
    });
    expect(chosenEventId.status).toBe(422);
    expect(await chosenEventId.text()).not.toContain(runnerToken);

    const chosenTaskId = await app.request('http://127.0.0.1/api/v1/runner/events', {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${runnerToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runner-key-chosen-task',
      },
      body: JSON.stringify({
        type: 'progress',
        status: 'running',
        taskId: runnerToken,
        reasonCode: 'task_started',
        timestamp: '2026-07-28T12:00:00.000Z',
        summary: 'Work started.',
      }),
    });
    expect(chosenTaskId.status).toBe(500);
    expect(await chosenTaskId.text()).not.toContain(runnerToken);
  });

  test('rejects public host and mismatched origin', async () => {
    const app = createControlPlane({
      sessions: new SoleOwnerSessions('claim-token-that-is-long-enough'),
      adapter: new MemoryControlAdapter(null, envelope.bindings),
      runnerToken,
    });
    expect((await app.request('http://example.com/health', { headers: { host: 'example.com' } })).status).toBe(403);
    expect((await app.request('http://127.0.0.1/health', {
      headers: { host: '127.0.0.1', origin: 'https://evil.example' },
    })).status).toBe(403);
  });

  test('allows only an explicitly configured tunnel host with forwarded HTTPS and secure cookies', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const app = createControlPlane({
      sessions,
      adapter: new MemoryControlAdapter(null, envelope.bindings),
      runnerToken,
      allowedHosts: ['127.0.0.1', 'localhost', '[::1]', 'factory.graphslop.com'],
    });
    const forwarded = {
      host: 'factory.graphslop.com',
      origin: 'https://factory.graphslop.com',
      'x-forwarded-proto': 'https',
    };
    const health = await app.request('http://factory.graphslop.com/health', { headers: forwarded });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', exposure: 'loopback+tunnel' });

    const claim = await app.request('http://factory.graphslop.com/api/v1/auth/claim', {
      method: 'POST',
      headers: { ...forwarded, 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    expect(claim.status).toBe(201);
    expect(claim.headers.getSetCookie().every((cookie) => cookie.includes('Secure'))).toBe(true);

    expect((await app.request('http://factory.graphslop.com/health', {
      headers: { ...forwarded, origin: 'https://evil.example' },
    })).status).toBe(403);
    expect((await app.request('http://other.graphslop.com/health', {
      headers: { host: 'other.graphslop.com', 'x-forwarded-proto': 'https' },
    })).status).toBe(403);
  });

  test('serves only the explicit v1 API contract', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const app = createControlPlane({
      sessions,
      adapter: new MemoryControlAdapter(null, envelope.bindings),
      runnerToken,
    });
    const old = await app.request('http://127.0.0.1/api/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    expect(old.status).toBe(404);
    const current = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    expect(current.status).toBe(201);
  });

  test('rejects adversarial events and redacts every supported secret shape', async () => {
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const adapter = new MemoryControlAdapter(null, envelope.bindings);
    const app = createControlPlane({ sessions, adapter, runnerToken });
    const adversarial = [
      'Authorization: Bearer abc123',
      'Basic Zm9vOmJhcg==',
      'sk_live_123456789',
      'ghp_123456789',
      'https://user:pass@example.test/x?token=abc',
      '{"private_key":"very secret"}',
      'DATABASE_URL=postgres://user:pass@host/db',
      '/workspace/private/key',
      'C:\\Users\\Ryan\\private\\key',
    ];
    for (const [index, summary] of adversarial.entries()) {
      const response = await app.request('http://127.0.0.1/api/v1/runner/events', {
        method: 'POST',
        headers: {
          host: '127.0.0.1',
          authorization: `Bearer ${runnerToken}`,
          'content-type': 'application/json',
          'idempotency-key': `adversarial-${index}`,
        },
        body: JSON.stringify({
          type: 'progress',
          status: 'running',
          taskId: 'task-1',
          reasonCode: 'task_started',
          timestamp: '2026-07-28T12:00:00.000Z',
          summary,
        }),
      });
      expect(response.status).toBe(422);
      expect(redactBoundedSummary(summary)).not.toMatch(
        /abc123|Zm9vOmJhcg|sk_live|ghp_|user:pass|very secret|postgres:\/\/|\/home\/ryan|C:\\Users/i,
      );
    }
    expect(adapter.events).toHaveLength(0);
  });
});

describe('production adapter', () => {
  function boundaries() {
    let current: Readonly<Record<string, string>> = conversationEnvelope.bindings;
    let mutations = 0;
    const project = {
      state: () => ({ projectId: 'project-1' }),
      submitMessage: async (content: string) => {
        mutations += 1;
        current = { ...current, messageHeadHash: 'b'.repeat(64) };
        return { content };
      },
      createReviewProjection: () => null,
      approve: () => null,
      proposeSolution: () => null,
      compileExecution: () => null,
    };
    const runner = {
      dispatch: async () => null,
      authorizeRepair: async () => null,
      previewPullRequest: async () => null,
      appendEvent: async () => null,
      events: async () => [],
    };
    return {
      authority: {
        currentBindings: async () => undefined,
        authorize: async (_command: unknown, bindings: Readonly<Record<string, string>>) =>
          Object.keys(current).length === Object.keys(bindings).length
          && Object.entries(current).every(([key, value]) => bindings[key] === value),
      },
      project,
      runner,
      mutations: () => mutations,
    };
  }

  test('fails closed when production authority has no accepted binding', async () => {
    const values = boundaries();
    const adapter = new ProductionControlAdapter(
      { currentBindings: async () => undefined, authorize: async () => false },
      values.project,
      values.runner,
    );
    expect(await adapter.commandAtomic('submit-message', conversationEnvelope)).toEqual({ ok: false, code: 'stale_binding' });
    expect(values.mutations()).toBe(0);
  });

  test('production adapter strips credentials, command streams, and local paths from output', async () => {
    const values = boundaries();
    const project = {
      ...values.project,
      state: () => ({
        projectId: 'project-1',
        displayName: 'Bearer should-never-leak',
        connectedRepository: '/workspace/private',
        nested: { token: 'secret', displayName: 'Safe' },
      }),
      submitMessage: async () => ({
        project: {
          projectId: 'project-1',
          displayName: 'Safe',
          connectedRepository: '/workspace/private',
          apiKey: 'hidden',
        },
        token: 'lease-secret',
        stdout: 'raw command output',
        worktreeRoot: '/tmp/worktree',
      }),
    };
    const adapter = new ProductionControlAdapter(values.authority, project, values.runner);
    expect(await adapter.readProject()).toEqual({ projectId: 'project-1', displayName: '[redacted]' });
    expect(await adapter.commandAtomic('submit-message', conversationEnvelope)).toMatchObject({
      ok: true,
      result: { project: { projectId: 'project-1', displayName: 'Safe' } },
    });
  });

  test('serializes authority revalidation so two keys on stale authority yield one mutation', async () => {
    const values = boundaries();
    const adapter = new ProductionControlAdapter(values.authority, values.project, values.runner);
    const [first, second] = await Promise.all([
      adapter.commandAtomic('submit-message', conversationEnvelope),
      adapter.commandAtomic('submit-message', conversationEnvelope),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(values.mutations()).toBe(1);
  });

  test('normal workspace test routing includes the focused control-plane suite', async () => {
    const manifest = JSON.parse(await readFile(
      new URL('../../apps/control-plane/package.json', import.meta.url),
      'utf8',
    )) as { scripts?: { test?: string } };
    expect(manifest.scripts?.test).toContain('tests/control-plane/control-plane.test.ts');
  });

  test('actual ProjectService authority dispatches through actual LocalRunner and then rejects stale binding', async () => {
    let sequence = 0;
    const project = new ProjectService({
      project: {
        schemaVersion: '1.0.0',
        projectId: 'project-one',
        displayName: 'One',
        lifecycleState: 'CAPTURE',
        activeIntentBaselineId: null,
        activeSolutionBaselineId: null,
        activeExecutionSnapshotId: null,
        connectedRepository: null,
        integrationCommit: null,
        activeLeaseId: null,
        runnerEnrollmentId: null,
        currentQuestionId: null,
        createdAt: '2026-07-28T12:00:00Z',
        updatedAt: '2026-07-28T12:00:00Z',
        closedAt: null,
      },
      messages: [],
      intentGraph: null,
      solutionGraph: null,
      executionGraph: null,
      corrections: [],
      currentQuestion: null,
      questionResolutions: [],
      projections: [],
      approvedBaselines: [],
    }, {
      propose: async (context) => context.priorIntentNodes.length ? ({
        intentNodes: [],
        corrections: [{
          targetStableId: context.priorIntentNodes[0]!.stableId,
          statement: 'Build the corrected flow',
          sourceQuote: 'Actually corrected flow',
        }],
        questions: [{
          text: 'Defer this?', category: 'Scope' as const, uncertaintyReduction: 1,
          implementationImpact: 1, driftRisk: 1, dependencyCount: 1, blocking: false,
        }],
      }) : ({
        intentNodes: [{
          type: 'Goal' as const,
          statement: 'Build the thing',
          sourceQuote: 'Build thing',
          normalizedInterpretation: 'Build the thing',
          confidence: 0.8,
          status: 'proposed' as const,
        }],
        corrections: [],
        questions: [{
          text: 'Anything else?',
          category: 'Scope' as const,
          uncertaintyReduction: 1,
          implementationImpact: 1,
          driftRisk: 1,
          dependencyCount: 1,
          blocking: false,
        }],
      }),
    }, {
      nextId: (kind) => `${kind}-${++sequence}`,
      now: () => '2026-07-28T12:01:00Z',
    });
    await project.submitMessage('Build thing');
    const intentProjection = project.createReviewProjection('intent');
    const intentState = project.state();
    project.approve('intent', {
      approvalId: 'approval-intent',
      actorId: 'owner-one',
      actorKind: 'authenticated_project_owner',
      artifactType: 'intent_baseline',
      artifactId: 'intent-v1',
      artifactVersion: 1,
      artifactContentHash: intentState.intentGraph!.contentHash,
      displayedProjectionHash: intentProjection.contentHash,
      sourceMessageId: intentState.messages[0]!.messageId,
      sourceQuote: 'Approved',
      approvedAt: '2026-07-28T12:02:00Z',
      includedEdgeRefs: [],
      renderedDataHash: intentProjection.contentHash,
      generatedAt: intentProjection.generatedAt,
    });
    project.proposeSolution([{ name: 'Feature one', intentNodeIds: [project.state().intentGraph!.nodes[0]!.id] }]);
    const solutionProjection = project.createReviewProjection('solution');
    const solutionState = project.state();
    project.approve('solution', {
      approvalId: 'approval-solution',
      actorId: 'owner-one',
      actorKind: 'authenticated_project_owner',
      artifactType: 'solution_baseline',
      artifactId: 'solution-v1',
      artifactVersion: 1,
      artifactContentHash: solutionState.solutionGraph!.contentHash,
      displayedProjectionHash: solutionProjection.contentHash,
      sourceMessageId: solutionState.messages[0]!.messageId,
      sourceQuote: 'Approved',
      approvedAt: '2026-07-28T12:03:00Z',
      includedEdgeRefs: [],
      renderedDataHash: solutionProjection.contentHash,
      generatedAt: solutionProjection.generatedAt,
    });
    const execution = project.compileExecution();
    const state = project.state();
    const intent = state.approvedBaselines.find((item) => item.graphKind === 'intent')!;
    const solution = state.approvedBaselines.find((item) => item.graphKind === 'solution')!;
    const taskId = execution.nodes[0]!.id;
    const task = {
      taskId,
      status: 'ready' as const,
      baseCommit: 'c'.repeat(40),
      intentBaseline: { baselineId: intent.baselineId, contentHash: intent.snapshotContentHash },
      solutionBaseline: { baselineId: solution.baselineId, contentHash: solution.snapshotContentHash },
      executionHash: execution.contentHash,
      allowedPaths: ['src/**'],
      acceptanceCommands: [{ argv: ['node', '--version'] as ['node', '--version'] }],
      brief: { job: 'Build.', use: 'Graph.', touch: 'src.', dont: 'Drift.', done: 'Prove.' },
      relevantIntentNodes: [],
      relevantSolutionNodes: [],
      protectedAssertions: [],
      exclusions: [],
      acceptanceChecks: [],
    };
    let durable: DurableLeaseRecord | undefined;
    const registry = {
      claimLease: async (record: DurableLeaseRecord) => {
        if (durable) return false;
        durable = structuredClone(record);
        return true;
      },
      readLease: async (leaseId: string) => durable?.leaseId === leaseId ? structuredClone(durable) : undefined,
      updateLease: async (_id: string, expected: DurableLeaseRecord['status'], next: DurableLeaseRecord['status']) => {
        if (!durable || durable.status !== expected) return false;
        durable = { ...durable, status: next };
        return true;
      },
      finish: async (_id: string, expected: DurableLeaseRecord['status'], terminalResult: any) => {
        if (!durable || durable.status !== expected) return false;
        durable = { ...durable, status: terminalResult.status, terminalResult };
        return true;
      },
      recordCleanupError: async () => {},
      consumeRepairAttempt: async () => true,
    };
    const runner = new LocalRunner({
      leaseSecret: 'lease-secret-that-is-at-least-32-bytes',
      authority: {
        resolveAuthorizedTask: async () => ({
          task,
          authorizationId: 'authorization-1',
          executionSnapshotHash: execution.contentHash,
        }),
      },
      registry,
      identities: new HmacWorkerIdentityAuthority('identity-secret-that-is-at-least-32-bytes'),
      buildWorker: { run: async ({ task, candidate }) => { for (const item of task.acceptanceCommands) await candidate.execute(item); } },
      checkWorker: { run: async ({ task, candidate }) => {
        for (const item of task.acceptanceCommands) await candidate.execute(item);
        return { accepted: true as const };
      } },
      worktrees: {
        create: async () => ({
          sourceRepositoryRoot: repositoryRoot,
          worktreeRoot: repositoryRoot,
        }),
        changes: async () => [],
        cleanup: async () => {},
      },
      trustedRepositories: [repositoryRoot],
      now: () => Date.parse('2026-07-28T12:04:00Z'),
    });
    const artifact = unleasedArtifact({
      graphSnapshotId: execution.snapshotId,
      graphContentHash: execution.contentHash,
      taskId,
    });
    const repairs = new Map<string, any>();
    const repairStore = {
      persist: async (record: any) => {
        if (repairs.has(record.ownerAuthorizationId)) throw new Error('Repair authorization already exists.');
        repairs.set(record.ownerAuthorizationId, structuredClone(record));
      },
      resolve: async (id: string) => repairs.get(id),
    };
    const verifierDrifts = new Map<string, any>();
    const driftStore = { resolve: async (id: string) => verifierDrifts.get(id) };
    const bridge = new ProjectRunnerBridge(project, runner, registry, artifact, repairStore, driftStore);
    const adapter = new ProductionControlAdapter(bridge, bridge.projectBoundary(), bridge);
    const exact = await bridge.currentBindings();
    expect(exact).toBeDefined();
    const dispatched = await adapter.commandAtomic('dispatch-task', {
      bindings: exact!,
      input: { trustedRepository: repositoryRoot },
    });
    expect(dispatched).toMatchObject({ ok: true, result: { taskId } });
    expect(durable?.task.taskId).toBe(taskId);
    expect(await adapter.commandAtomic('dispatch-task', {
      bindings: exact!,
      input: { trustedRepository: repositoryRoot },
    })).toEqual({ ok: false, code: 'stale_binding' });
    const repairBindings = await bridge.currentBindings();
    const drift = {
      driftId: 'drift-1',
      taskId,
      type: 'constraint_drift',
      severity: 'blocking',
      expected: 'Keep the baseline.',
      observed: 'Baseline drifted.',
      files: ['src/fix.ts'],
      instruction: 'Fix exact drift.',
      intentBaseline: task.intentBaseline,
      solutionBaseline: task.solutionBaseline,
      evidenceHash: 'e'.repeat(64),
      repair: { repairId: 'repair-1', status: 'idle', attemptLimit: 1 },
    };
    const authorization = {
      repairId: 'repair-1',
      ownerAuthorizationId: 'repair-authorization-1',
      intentHash: task.intentBaseline.contentHash,
      solutionHash: task.solutionBaseline.contentHash,
      executionHash: execution.contentHash,
    };
    verifierDrifts.set(drift.driftId, {
      driftId: drift.driftId,
      evidenceHash: drift.evidenceHash,
      sourceTaskId: drift.taskId,
      intentBaselineId: drift.intentBaseline.baselineId,
      intentBaselineHash: drift.intentBaseline.contentHash,
      solutionBaselineId: drift.solutionBaseline.baselineId,
      solutionBaselineHash: drift.solutionBaseline.contentHash,
      executionHash: execution.contentHash,
      repairId: drift.repair.repairId,
      instruction: drift.instruction,
      status: 'idle',
    });
    expect(await adapter.commandAtomic('authorize-repair', {
      bindings: { ...repairBindings!, taskId: 'stale-task' },
      input: { authorization, drift, baseCommit: 'd'.repeat(40) },
    })).toEqual({ ok: false, code: 'stale_binding' });
    await expect(bridge.authorizeRepair({
      authorization: { ...authorization, intentHash: 'f'.repeat(64), ownerAuthorizationId: 'wrong-authorization' },
      drift,
      baseCommit: 'd'.repeat(40),
    })).rejects.toThrow('Exact drift');
    await expect(bridge.authorizeRepair({
      authorization: { ...authorization, ownerAuthorizationId: 'missing-drift-authorization' },
      drift: { ...drift, driftId: 'drift-does-not-exist', evidenceHash: '9'.repeat(64) },
      baseCommit: 'd'.repeat(40),
    })).rejects.toThrow('Exact drift');
    expect(await adapter.commandAtomic('authorize-repair', {
      bindings: exact!,
      input: { authorization, drift, baseCommit: 'd'.repeat(40) },
    })).toEqual({ ok: false, code: 'stale_binding' });
    const approvedProjectionId = solution.projectionId;
    const injectedProjection = project.createReviewProjection('solution');
    expect(injectedProjection.projectionId).not.toBe(approvedProjectionId);
    expect((await bridge.currentBindings())?.projectionId).toBe(approvedProjectionId);
  });

  test('real HTTP commands drive CAPTURE through Execution compilation without out-of-band lifecycle calls', async () => {
    let sequence = 0;
    const project = new ProjectService({
      project: {
        schemaVersion: '1.0.0', projectId: 'flow-project', displayName: 'Flow',
        lifecycleState: 'CAPTURE', activeIntentBaselineId: null, activeSolutionBaselineId: null,
        activeExecutionSnapshotId: null, connectedRepository: null, integrationCommit: null,
        activeLeaseId: null, runnerEnrollmentId: null, currentQuestionId: null,
        createdAt: '2026-07-28T12:00:00Z', updatedAt: '2026-07-28T12:00:00Z', closedAt: null,
      },
      messages: [], intentGraph: null, solutionGraph: null, executionGraph: null,
      corrections: [], currentQuestion: null, questionResolutions: [], projections: [], approvedBaselines: [],
    }, {
      propose: async () => ({
        intentNodes: [{
          type: 'Goal' as const, statement: 'Build flow', sourceQuote: 'Build flow',
          normalizedInterpretation: 'Build flow', confidence: 0.8, status: 'proposed' as const,
        }],
        corrections: [],
        questions: [{
          text: 'Defer this?', category: 'Scope' as const, uncertaintyReduction: 1,
          implementationImpact: 1, driftRisk: 1, dependencyCount: 1, blocking: false,
        }],
      }),
    }, {
      nextId: (kind) => `${kind}-${++sequence}`,
      now: () => '2026-07-28T12:01:00Z',
    });
    let flowLease: DurableLeaseRecord | undefined;
    const registry = {
      claimLease: async (record: DurableLeaseRecord) => {
        if (flowLease) return false;
        flowLease = structuredClone(record);
        return true;
      },
      readLease: async (id: string) => flowLease?.leaseId === id ? structuredClone(flowLease) : undefined,
      updateLease: async (_id: string, expected: DurableLeaseRecord['status'], next: DurableLeaseRecord['status']) => {
        if (!flowLease || flowLease.status !== expected) return false;
        flowLease = { ...flowLease, status: next };
        return true;
      },
      finish: async (_id: string, expected: DurableLeaseRecord['status'], terminalResult: any) => {
        if (!flowLease || flowLease.status !== expected) return false;
        flowLease = { ...flowLease, status: terminalResult.status, terminalResult };
        return true;
      }, recordCleanupError: async () => {}, consumeRepairAttempt: async () => false,
    };
    const flowRunner = new LocalRunner({
      leaseSecret: 'flow-lease-secret-that-is-at-least-32-bytes',
      authority: {
        resolveAuthorizedTask: async (request) => {
          const state = project.state();
          const node = state.executionGraph?.nodes.find((item) => item.id === request.taskId);
          const intent = state.approvedBaselines.find((item) => item.graphKind === 'intent')!;
          const solution = state.approvedBaselines.find((item) => item.graphKind === 'solution')!;
          if (!node || state.executionGraph?.contentHash !== request.executionHash) throw new Error('stale');
          return {
            authorizationId: 'flow-task-authorization',
            executionSnapshotHash: request.executionHash,
            task: {
              taskId: node.id, status: 'ready' as const, baseCommit: 'c'.repeat(40),
              intentBaseline: { baselineId: intent.baselineId, contentHash: intent.snapshotContentHash },
              solutionBaseline: { baselineId: solution.baselineId, contentHash: solution.snapshotContentHash },
              executionHash: request.executionHash, allowedPaths: ['src/**'],
              acceptanceCommands: [{ argv: ['node', '--version'] as ['node', '--version'] }],
              brief: { job: 'Build.', use: 'Graph.', touch: 'src.', dont: 'Drift.', done: 'Prove.' },
              relevantIntentNodes: [], relevantSolutionNodes: [], protectedAssertions: [],
              exclusions: [], acceptanceChecks: [],
            },
          };
        },
      },
      registry,
      identities: new HmacWorkerIdentityAuthority('flow-identity-secret-that-is-at-least-32-bytes'),
      buildWorker: { run: async ({ task, candidate }) => { for (const item of task.acceptanceCommands) await candidate.execute(item); } },
      checkWorker: { run: async ({ task, candidate }) => {
        for (const item of task.acceptanceCommands) await candidate.execute(item);
        return { accepted: true as const };
      } },
      worktrees: {
        create: async () => ({ sourceRepositoryRoot: repositoryRoot, worktreeRoot: repositoryRoot }),
        changes: async () => [], cleanup: async () => {},
      },
      trustedRepositories: [repositoryRoot],
    });
    const bridge = new ProjectRunnerBridge(
      project,
      flowRunner,
      registry,
      unleasedArtifact({ graphSnapshotId: 'pending', graphContentHash: hash, taskId: 'pending' }),
    );
    const sessions = new SoleOwnerSessions('claim-token-that-is-long-enough');
    const app = createControlPlane({
      sessions,
      runnerToken,
      adapter: new ProductionControlAdapter(bridge, bridge.projectBoundary(), bridge),
    });
    const claim = await app.request('http://127.0.0.1/api/v1/auth/claim', {
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON.stringify({ claimToken: sessions.claimToken }),
    });
    const csrf = (await claim.json() as { csrfToken: string }).csrfToken;
    let requestNumber = 0;
    let lastNext: any[] = [];
    const command = async (name: string, bindings: Record<string, string>, input: unknown, capability?: string) => {
      const response = await app.request(`http://127.0.0.1/api/v1/owner/commands/${name}`, {
        method: 'POST',
        headers: {
          host: '127.0.0.1', cookie: cookies(claim), 'content-type': 'application/json',
          'x-csrf-token': csrf, 'idempotency-key': `flow-command-${++requestNumber}`,
        },
        body: JSON.stringify({ bindings, input, ...(capability ? { capability } : {}) }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json() as { result: any; nextBindings: any[] };
      lastNext = body.nextBindings;
      return body.result;
    };
    const submitted = await command('submit-message', {
      stage: 'conversation', projectId: 'flow-project', lifecycleState: 'CAPTURE',
      messageHeadHash: createHash('sha256').update('empty').digest('hex'),
    }, { content: 'Build flow' });
    const firstCorrectionCapability = lastNext.find((item) => item.command === 'submit-message');
    const corrected = await command(
      'submit-message',
      firstCorrectionCapability.bindings,
      { content: 'Actually corrected flow' },
      firstCorrectionCapability.capability,
    );
    const staleCorrection = await app.request('http://127.0.0.1/api/v1/owner/commands/submit-message', {
      method: 'POST',
      headers: {
        host: '127.0.0.1', cookie: cookies(claim), 'content-type': 'application/json',
        'x-csrf-token': csrf, 'idempotency-key': 'flow-stale-correction',
      },
      body: JSON.stringify({
        bindings: firstCorrectionCapability.bindings,
        capability: firstCorrectionCapability.capability,
        input: { content: 'stale' },
      }),
    });
    expect(staleCorrection.status).toBe(409);
    let intent = corrected.intentGraph;
    const question = corrected.currentQuestion;
    const deferred = await command('resolve-question', {
      stage: 'intent-discovery', projectId: 'flow-project', lifecycleState: 'DISCOVERY',
      intentSnapshotId: intent.snapshotId, intentHash: intent.contentHash, questionId: question.questionId,
    }, { questionId: question.questionId, disposition: 'deferred', content: 'Defer.' });
    intent = deferred.intentGraph;
    const intentProjection = await command('review-intent', {
      stage: 'intent-discovery', projectId: 'flow-project', lifecycleState: 'DISCOVERY',
      intentSnapshotId: intent.snapshotId, intentHash: intent.contentHash, questionId: 'none',
    }, {});
    const intentBaseline = await command('approve-intent', {
      stage: 'intent-review', projectId: 'flow-project', lifecycleState: 'INTENT_REVIEW',
      intentSnapshotId: intent.snapshotId, intentHash: intent.contentHash,
      projectionId: intentProjection.projectionId, projectionHash: intentProjection.contentHash,
    }, {
      approvalId: 'flow-intent-approval', actorId: 'flow-owner', actorKind: 'authenticated_project_owner',
      artifactType: 'intent_baseline', artifactId: 'flow-intent-v1', artifactVersion: 1,
      artifactContentHash: intent.contentHash, displayedProjectionHash: intentProjection.contentHash,
      sourceMessageId: 'message-1', sourceQuote: 'Approved', approvedAt: '2026-07-28T12:02:00Z',
      includedEdgeRefs: [], renderedDataHash: intentProjection.contentHash, generatedAt: intentProjection.generatedAt,
    });
    const solution = await command('propose-solution', {
      stage: 'intent-approved', projectId: 'flow-project', lifecycleState: 'INTENT_APPROVED',
      intentBaselineId: intentBaseline.baselineId, intentBaselineHash: intentBaseline.snapshotContentHash,
    }, { features: [{ name: 'Feature', intentNodeIds: [intent.nodes[0].id] }] });
    const solutionProjection = await command('review-solution', {
      stage: 'solution-review', projectId: 'flow-project', lifecycleState: 'SOLUTION_REVIEW',
      intentBaselineId: intentBaseline.baselineId, intentBaselineHash: intentBaseline.snapshotContentHash,
      solutionSnapshotId: solution.snapshotId, solutionHash: solution.contentHash,
    }, {});
    const solutionBaseline = await command('approve-solution', {
      stage: 'solution-review', projectId: 'flow-project', lifecycleState: 'SOLUTION_REVIEW',
      intentBaselineId: intentBaseline.baselineId, intentBaselineHash: intentBaseline.snapshotContentHash,
      solutionSnapshotId: solution.snapshotId, solutionHash: solution.contentHash,
      projectionId: solutionProjection.projectionId, projectionHash: solutionProjection.contentHash,
    }, {
      approvalId: 'flow-solution-approval', actorId: 'flow-owner', actorKind: 'authenticated_project_owner',
      artifactType: 'solution_baseline', artifactId: 'flow-solution-v1', artifactVersion: 1,
      artifactContentHash: solution.contentHash, displayedProjectionHash: solutionProjection.contentHash,
      sourceMessageId: 'message-1', sourceQuote: 'Approved', approvedAt: '2026-07-28T12:03:00Z',
      includedEdgeRefs: [], renderedDataHash: solutionProjection.contentHash, generatedAt: solutionProjection.generatedAt,
    });
    const execution = await command('compile-execution', {
      stage: 'solution-approved', projectId: 'flow-project', lifecycleState: 'SOLUTION_APPROVED',
      intentBaselineId: intentBaseline.baselineId, intentBaselineHash: intentBaseline.snapshotContentHash,
      solutionBaselineId: solutionBaseline.baselineId, solutionBaselineHash: solutionBaseline.snapshotContentHash,
      projectionId: solutionProjection.projectionId, projectionHash: solutionProjection.contentHash,
    }, {});
    expect(execution.graphKind).toBe('execution');
    expect(execution.nodes).toHaveLength(3);
    const dispatchCapability = lastNext.find((item) => item.command === 'dispatch-task');
    expect(dispatchCapability).toBeDefined();
    const lease = await command(
      'dispatch-task',
      dispatchCapability.bindings,
      { trustedRepository: repositoryRoot },
      dispatchCapability.capability,
    );
    expect(lease.taskId).toBe(execution.nodes[0].id);
    expect(flowLease?.task.taskId).toBe(execution.nodes[0].id);
    const staleDispatch = await app.request('http://127.0.0.1/api/v1/owner/commands/dispatch-task', {
      method: 'POST',
      headers: {
        host: '127.0.0.1', cookie: cookies(claim), 'content-type': 'application/json',
        'x-csrf-token': csrf, 'idempotency-key': 'flow-stale-dispatch',
      },
      body: JSON.stringify({
        bindings: dispatchCapability.bindings,
        capability: dispatchCapability.capability,
        input: { trustedRepository: repositoryRoot },
      }),
    });
    expect(staleDispatch.status).toBe(409);
  });
});

describe('durable authority stores', () => {
  test('authenticated verifier drift survives fresh instance and rejects fabrication and replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphslop-drift-'));
    try {
      const path = join(root, 'drift.json');
      const record = {
        driftId: 'drift-1', evidenceHash: 'a'.repeat(64), sourceTaskId: 'task-1',
        intentBaselineId: 'intent-v1', intentBaselineHash: 'b'.repeat(64),
        solutionBaselineId: 'solution-v1', solutionBaselineHash: 'c'.repeat(64),
        executionHash: 'd'.repeat(64), repairId: 'repair-1',
        instruction: 'Fix exact drift.', status: 'idle' as const,
      };
      const now = () => Date.parse('2026-07-28T12:00:00Z');
      const identities = new HmacWorkerIdentityAuthority('drift-identity-secret-that-is-at-least-32-bytes');
      const receipts = new HmacCheckDriftReceiptAuthority(
        identities, 'drift-receipt-secret-that-is-at-least-32-bytes', now,
      );
      const check = await identities.issue('Check', record.sourceTaskId, 'lease-1');
      const receipt = await receipts.issue(record, check, 'lease-1');
      const store = new FileVerifierDriftStore(path, receipts);
      await expect(store.persistVerified(record, {
        ...receipt, signature: 'forged-literal',
      })).rejects.toThrow('verifier');
      const build = await identities.issue('Build', record.sourceTaskId, 'lease-1');
      await expect(receipts.issue(record, build, 'lease-1')).rejects.toThrow('Check');
      await store.persistVerified(record, receipt);
      const freshReceipts = new HmacCheckDriftReceiptAuthority(
        new HmacWorkerIdentityAuthority('drift-identity-secret-that-is-at-least-32-bytes'),
        'drift-receipt-secret-that-is-at-least-32-bytes',
        now,
      );
      expect(await new FileVerifierDriftStore(path, freshReceipts).resolve(record.driftId)).toEqual(record);
      const afterTtlReceipts = new HmacCheckDriftReceiptAuthority(
        new HmacWorkerIdentityAuthority('drift-identity-secret-that-is-at-least-32-bytes'),
        'drift-receipt-secret-that-is-at-least-32-bytes',
        () => now() + 120_000,
      );
      expect(await new FileVerifierDriftStore(path, afterTtlReceipts).resolve(record.driftId)).toEqual(record);
      await expect(new FileVerifierDriftStore(path, freshReceipts).persistVerified(record, receipt)).rejects.toThrow('replay');
      await expect(new FileVerifierDriftStore(join(root, 'altered.json'), freshReceipts).persistVerified({
        ...record, instruction: 'Altered drift.',
      }, receipt)).rejects.toThrow('verifier');
      const shortReceipt = await receipts.issue({ ...record, driftId: 'drift-expired' }, check, 'lease-1', 1);
      const expiredAuthority = new HmacCheckDriftReceiptAuthority(
        new HmacWorkerIdentityAuthority('drift-identity-secret-that-is-at-least-32-bytes'),
        'drift-receipt-secret-that-is-at-least-32-bytes',
        () => now() + 2,
      );
      await expect(new FileVerifierDriftStore(join(root, 'expired.json'), expiredAuthority).persistVerified({
        ...record, driftId: 'drift-expired',
      }, shortReceipt)).rejects.toThrow('verifier');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('repair authority survives a fresh instance and rejects authorization and repair replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphslop-control-'));
    try {
      const path = join(root, 'repairs.json');
      const record = {
        repairId: 'repair-1',
        ownerAuthorizationId: 'owner-authorization-1',
        intentHash: 'a'.repeat(64),
        solutionHash: 'b'.repeat(64),
        executionHash: 'c'.repeat(64),
      };
      await new FileRepairAuthorityStore(path).persist(record);
      expect(await new FileRepairAuthorityStore(path).resolve(record.ownerAuthorizationId)).toEqual(record);
      await expect(new FileRepairAuthorityStore(path).persist(record)).rejects.toThrow('replay');
      await expect(new FileRepairAuthorityStore(path).persist({
        ...record,
        ownerAuthorizationId: 'owner-authorization-2',
      })).rejects.toThrow('replay');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('execution install and lease CAS survive a fresh store instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphslop-execution-'));
    try {
      const path = join(root, 'execution.json');
      const first = unleasedArtifact({
        graphSnapshotId: 'execution-1',
        graphContentHash: 'd'.repeat(64),
        taskId: 'task-1',
      });
      await new FileExecutionArtifactStore(path).install(first, null);
      expect(await new FileExecutionArtifactStore(path).load()).toEqual(first);
      const leased = { ...first, leaseId: 'lease-1', leaseHash: 'e'.repeat(64) };
      await new FileExecutionArtifactStore(path).updateLease('unleased', leased);
      expect(await new FileExecutionArtifactStore(path).load()).toEqual(leased);
      await expect(new FileExecutionArtifactStore(path).updateLease('unleased', leased)).rejects.toThrow('CAS');
      const replacementA = unleasedArtifact({
        version: 2, graphSnapshotId: 'execution-2a', graphContentHash: 'f'.repeat(64), taskId: 'task-2a',
      });
      const replacementB = unleasedArtifact({
        version: 2, graphSnapshotId: 'execution-2b', graphContentHash: '1'.repeat(64), taskId: 'task-2b',
      });
      const expected = {
        version: leased.version,
        graphSnapshotId: leased.graphSnapshotId,
        graphContentHash: leased.graphContentHash,
      };
      const outcomes = await Promise.allSettled([
        new FileExecutionArtifactStore(path).install(replacementA, expected),
        new FileExecutionArtifactStore(path).install(replacementB, expected),
      ]);
      expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1);
      await expect(new FileExecutionArtifactStore(path).install(replacementB, expected)).rejects.toThrow('CAS');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('real server', () => {
  const servers: ReturnType<typeof startControlPlane>[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  test('binds a real HTTP server only to IPv4 loopback', async () => {
    const server = startControlPlane({
      sessions: new SoleOwnerSessions('claim-token-that-is-long-enough'),
      runnerToken,
      adapter: new MemoryControlAdapter(null, envelope.bindings),
    });
    servers.push(server);
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    expect(typeof address).toBe('object');
    expect(address && typeof address === 'object' && address.address).toBe(LOOPBACK_HOST);
    const response = await fetch(`http://${LOOPBACK_HOST}:${address && typeof address === 'object' ? address.port : 0}/health`);
    expect(response.status).toBe(200);
  });
});
