import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ProjectConversationStateSchema, type ProjectConversationState } from '@graphslop/contracts';
import { CodexProposalProvider, LocalQwenClient } from '@graphslop/codex-adapter';
import { exportBuildPack } from '@graphslop/build-pack';
import { zipSync } from 'fflate';

import { createControlPlane } from './api/app.js';
import { SoleOwnerSessions } from './auth/session.js';
import { ProjectService } from '@graphslop/control-state';
import {
  FileDurableRunnerRegistry,
  GitWorktreeBoundary,
  HmacWorkerIdentityAuthority,
  CodexBuildWorker,
  CodexSemanticCheckWorker,
  LocalBuildWorker,
  LocalRunner,
  DeterministicSemanticCheckWorker,
  type BuildWorker,
  type CheckWorker,
  type RunnerTask,
  type DurableRunnerRegistry,
} from '../../runner/src/index.js';
import type { CommandResult, ControlAdapter, OwnerCommand, CommandEnvelope, ExactBindings, SafeEvent, StageBindings } from './services/control.js';
import {
  ProjectRunnerBridge,
  type ExecutionControlArtifact,
  type RepairAuthorityStore,
  type VerifierDriftStore,
} from './services/bridge.js';
import {
  FileExecutionArtifactStore,
  FileRepairAuthorityStore,
  HmacCheckDriftReceiptAuthority,
  FileVerifierDriftStore,
} from './services/durable-authority.js';
import {
  ProductionControlAdapter,
  type AcceptedAuthorityBoundary,
  type ProjectServiceBoundary,
  type RunnerControlBoundary,
} from './services/production.js';

export const LOOPBACK_HOST = '127.0.0.1';
const execFileAsync = promisify(execFile);

type AuthoritySecrets = {
  version: 1;
  lease: string;
  worker: string;
  drift: string;
  runner: string;
  claim: string;
};

function loadAuthoritySecrets(stateRoot: string, requestedClaim?: string): AuthoritySecrets {
  const path = resolve(stateRoot, 'authority-secrets.json');
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as AuthoritySecrets;
    if (value.version !== 1 || [value.lease, value.worker, value.drift, value.runner, value.claim]
      .some((secret) => typeof secret !== 'string' || secret.length < 32)) {
      throw new Error('Authority secret state is malformed.');
    }
    if (requestedClaim && requestedClaim !== value.claim) throw new Error('Configured claim token does not match durable authority.');
    chmodSync(path, 0o600);
    return value;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    const value: AuthoritySecrets = {
      version: 1,
      lease: randomBytes(32).toString('hex'),
      worker: randomBytes(32).toString('hex'),
      drift: randomBytes(32).toString('hex'),
      runner: randomBytes(32).toString('hex'),
      claim: requestedClaim ?? randomBytes(32).toString('base64url'),
    };
    mkdirSync(stateRoot, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return value;
  }
}

async function boundedCodexJsonCall(prompt: string): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('codex', [
      'exec', '--sandbox', 'read-only', '--skip-git-repo-check', prompt,
    ], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
    const trimmed = stdout.trim();
    const start = trimmed.lastIndexOf('\n{');
    return JSON.parse(start >= 0 ? trimmed.slice(start + 1) : trimmed);
  } catch (cause) {
    throw new Error(`Configured Codex worker required: ${cause instanceof Error ? cause.message : 'unavailable'}`);
  }
}

class AtomicProjectStateStore {
  private headHash: string | null = null;
  constructor(private readonly path: string) {}

  load(): ProjectConversationState | undefined {
    try {
      const envelope = JSON.parse(readFileSync(this.path, 'utf8')) as { hash: string; state: unknown };
      const canonical = JSON.stringify(envelope.state);
      if (createHash('sha256').update(canonical).digest('hex') !== envelope.hash) throw new Error('Project state hash is invalid.');
      const state = ProjectConversationStateSchema.parse(envelope.state);
      this.headHash = envelope.hash;
      return state;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  }

  persist(state: Readonly<ProjectConversationState>): void {
    const validated = ProjectConversationStateSchema.parse(state);
    const canonical = JSON.stringify(validated);
    const hash = createHash('sha256').update(canonical).digest('hex');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    mkdirSync(resolve(this.path, '..'), { recursive: true });
    writeFileSync(temporary, JSON.stringify({ parentHash: this.headHash, hash, state: validated }, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
    this.headHash = hash;
  }
}

export function startControlPlane(input: Readonly<{
  port?: number;
  sessions: SoleOwnerSessions;
  runnerToken: string;
  adapter: ControlAdapter;
  allowedHosts?: readonly string[];
  staticRoot?: string;
  modelInfo?: () => Promise<Readonly<{ connected: boolean; name: string }>>;
  buildPack?: () => Promise<Uint8Array>;
}>) {
  const app = createControlPlane(input);
  if (input.staticRoot) {
    app.use('*', serveStatic({ root: input.staticRoot }));
    app.get('*', serveStatic({ root: input.staticRoot, path: 'index.html' }));
  }
  return serve({
    fetch: app.fetch,
    hostname: LOOPBACK_HOST,
    port: input.port ?? 0,
  });
}

export function startProductionControlPlane(input: Readonly<{
  port?: number;
  sessions: SoleOwnerSessions;
  runnerToken: string;
  authority: AcceptedAuthorityBoundary;
  projectService: ProjectServiceBoundary;
  runner: RunnerControlBoundary;
  allowedHosts?: readonly string[];
  staticRoot?: string;
  modelInfo?: () => Promise<Readonly<{ connected: boolean; name: string }>>;
  buildPack?: () => Promise<Uint8Array>;
}>) {
  return startControlPlane({
    port: input.port,
    sessions: input.sessions,
    runnerToken: input.runnerToken,
    adapter: new ProductionControlAdapter(input.authority, input.projectService, input.runner),
    allowedHosts: input.allowedHosts,
    staticRoot: input.staticRoot,
    modelInfo: input.modelInfo,
    buildPack: input.buildPack,
  });
}

export function startProjectControlPlane(input: Readonly<{
  port?: number;
  sessions: SoleOwnerSessions;
  runnerToken: string;
  projectService: ProjectService;
  localRunner: LocalRunner;
  runnerRegistry: DurableRunnerRegistry;
  executionArtifact?: ExecutionControlArtifact;
  executionArtifactStore: FileExecutionArtifactStore;
  repairAuthorityStore: RepairAuthorityStore;
  verifierDriftStore: VerifierDriftStore;
  allowedHosts?: readonly string[];
  staticRoot?: string;
  modelInfo?: () => Promise<Readonly<{ connected: boolean; name: string }>>;
  buildPack?: () => Promise<Uint8Array>;
}>) {
  const bridge = new ProjectRunnerBridge(
    input.projectService,
    input.localRunner,
    input.runnerRegistry,
    input.executionArtifact,
    input.repairAuthorityStore,
    input.verifierDriftStore,
    input.executionArtifactStore,
  );
  return startProductionControlPlane({
    port: input.port,
    sessions: input.sessions,
    runnerToken: input.runnerToken,
    authority: bridge,
    projectService: bridge.projectBoundary(),
    runner: bridge,
    allowedHosts: input.allowedHosts,
    staticRoot: input.staticRoot,
    modelInfo: input.modelInfo,
    buildPack: input.buildPack,
  });
}

/**
 * Runnable local product assembly. Paths are mandatory and resolved before use.
 * It never contacts a remote provider, pushes Git, or grants release authority.
 */
export function startLocalProduct(input: Readonly<{
  repositoryRoot: string;
  projectStateRoot: string;
  staticRoot: string;
  port?: number;
  claimToken?: string;
  testMode?: boolean;
  modelCall?: (prompt: string) => Promise<unknown>;
  qwenBaseUrl?: string;
  qwenModel?: string;
  publicHost?: string;
  publicHosts?: readonly string[];
}>) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const stateRoot = resolve(input.projectStateRoot);
  const testMode = input.testMode === true || process.env.NODE_ENV === 'test';
  const secrets = loadAuthoritySecrets(stateRoot, input.claimToken);
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const now = () => new Date().toISOString();
  const initialState: ProjectConversationState = {
    project: {
      schemaVersion: '1.0.0', projectId: 'local-project', displayName: 'Local project',
      lifecycleState: 'CAPTURE', activeIntentBaselineId: null, activeSolutionBaselineId: null,
      activeExecutionSnapshotId: null, connectedRepository: repositoryRoot, integrationCommit: null,
      activeLeaseId: null, runnerEnrollmentId: null, currentQuestionId: null,
      createdAt: now(), updatedAt: now(), closedAt: null,
    },
    messages: [], intentGraph: null, solutionGraph: null, executionGraph: null,
    corrections: [], currentQuestion: null, questionResolutions: [], projections: [], approvedBaselines: [],
  };
  const projectStore = new AtomicProjectStateStore(resolve(stateRoot, 'project-state.json'));
  const ProjectServiceWithSink = ProjectService as unknown as new (
    initial: ProjectConversationState,
    provider: ConstructorParameters<typeof ProjectService>[1],
    authority: ConstructorParameters<typeof ProjectService>[2],
    sink: AtomicProjectStateStore,
  ) => ProjectService;
  const qwen = new LocalQwenClient(
    input.qwenBaseUrl ?? process.env.GRAPHSLOP_QWEN_URL ?? 'http://127.0.0.1:8001/v1',
    input.qwenModel ?? process.env.GRAPHSLOP_QWEN_MODEL,
  );
  const publicHosts = [...new Set([
    ...(input.publicHosts ?? []),
    ...(input.publicHost ? [input.publicHost] : []),
  ].map((host) => host.trim().toLowerCase()).filter(Boolean))];
  if (publicHosts.some((host) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))) {
    throw new Error('Public hosts must be exact DNS hostnames.');
  }
  const proposalProvider = testMode
    ? {
      propose: async ({ message }: { message: { content: string } }) => ({
        intentNodes: [{
          type: 'Goal' as const,
          statement: message.content.trim(),
          sourceQuote: message.content,
          normalizedInterpretation: message.content.trim(),
          confidence: 0.7,
          status: 'proposed' as const,
        }],
        corrections: [],
        questions: [{
          text: 'What result must the user get first?',
          category: 'Outcome' as const,
          uncertaintyReduction: 5, implementationImpact: 5, driftRisk: 5, dependencyCount: 5,
          blocking: true,
        }],
      }),
    }
    : new CodexProposalProvider(input.modelCall ?? ((prompt) => qwen.call(prompt)));
  const project = new ProjectServiceWithSink(
    projectStore.load() ?? initialState,
    proposalProvider,
    { nextId: (kind) => `${kind}-${randomUUID()}`, now },
    projectStore,
  );
  const registry = new FileDurableRunnerRegistry(resolve(stateRoot, 'runner.json'));
  const identities = new HmacWorkerIdentityAuthority(secrets.worker);
  const artifactStore = new FileExecutionArtifactStore(resolve(stateRoot, 'execution.json'));
  const receipts = new HmacCheckDriftReceiptAuthority(identities, secrets.drift);
  const driftStore = new FileVerifierDriftStore(resolve(stateRoot, 'drift.json'), receipts);
  const repairStore = new FileRepairAuthorityStore(resolve(stateRoot, 'repairs.json'));
  const fixtureBuild: BuildWorker = {
    run: async ({ task, candidate }) => {
      if (task.taskType === 'Decide') {
        await candidate.write(`docs/plans/${task.taskId}.md`, `# ${task.taskId}\n\nBounded plan from approved graphs.\n`);
        for (const command of task.acceptanceCommands) await candidate.execute(command);
        return;
      }
      if (task.taskType === 'Implement' || task.taskType === 'Repair') {
        const path = task.repair
          ? String(task.acceptanceCommands[0]?.argv[2] ?? `tests/generated/${task.taskId}.test.mjs`)
          : `tests/generated/${task.taskId}.test.mjs`;
        await candidate.execute(task.acceptanceCommands[0]!);
        await candidate.write(path, task.repair
          ? "import test from 'node:test'; import assert from 'node:assert/strict'; test('repair is bounded',()=>assert.equal('fixed','fixed'));\n"
          : "/* unrequested feature: deterministic drift fixture */\nimport test from 'node:test'; import assert from 'node:assert/strict'; test('approved work is bounded',()=>assert.equal(2+2,4));\n");
        await candidate.execute(task.acceptanceCommands[1]!);
        return;
      }
      for (const command of task.acceptanceCommands) await candidate.execute(command);
    },
  };
  const modelCall = input.modelCall ?? boundedCodexJsonCall;
  const buildWorker = testMode ? fixtureBuild : new CodexBuildWorker(modelCall);
  const checkWorker: CheckWorker = testMode
    ? new DeterministicSemanticCheckWorker()
    : new CodexSemanticCheckWorker(modelCall);
  const runner = new LocalRunner({
    leaseSecret: secrets.lease,
    authority: {
      resolveAuthorizedTask: async (request) => {
        const installed = await artifactStore.load();
        if (installed?.repairTask?.taskId === request.taskId && installed.graphContentHash === request.executionHash) {
          const repairTask = installed.repairTask;
          if (!repairTask.allowedPaths.length || !repairTask.acceptanceCommands.length) {
            throw new Error('Durable repair task contract is incomplete.');
          }
          return {
            authorizationId: `owner-${repairTask.taskId}`,
            executionSnapshotHash: request.executionHash,
            task: repairTask,
          };
        }
        const state = project.state();
        const effectiveBaseCommit = installed?.integrationCommit ?? baseCommit;
        const task = state.executionGraph?.nodes.find((item) => item.id === request.taskId);
        const intent = state.approvedBaselines.find((item) => item.graphKind === 'intent');
        const solution = state.approvedBaselines.find((item) => item.graphKind === 'solution');
        if (!task || !intent || !solution || state.executionGraph?.contentHash !== request.executionHash) throw new Error('Stale local task.');
        const roleRef = String(task.attributes.roleRef ?? '');
        const taskType = task.type as RunnerTask['taskType'];
        const generatedTest = `tests/generated/${task.id}.test.mjs`;
        const acceptanceCommands = taskType === 'Implement'
          ? [{ argv: ['node', '--test', generatedTest] as ['node', '--test', string] },
            { argv: ['node', '--test', generatedTest] as ['node', '--test', string] }]
          : [{ argv: ['node', '--test'] as ['node', '--test'] }];
        return {
          authorizationId: `owner-${task.id}`,
          executionSnapshotHash: request.executionHash,
          task: {
            taskId: task.id, taskType, projectId: state.project.projectId, status: 'ready' as const, baseCommit: effectiveBaseCommit,
            intentBaseline: { baselineId: intent.baselineId, contentHash: intent.snapshotContentHash },
            solutionBaseline: { baselineId: solution.baselineId, contentHash: solution.snapshotContentHash },
            executionHash: request.executionHash,
            allowedPaths: taskType === 'Decide' ? ['docs/plans/**'] : ['apps/**', 'packages/**', 'tests/**'],
            acceptanceCommands,
            brief: {
              job: String(task.attributes.objective ?? task.statementOrName),
              use: `Approved Intent and Solution. Role ${roleRef}.`,
              touch: taskType === 'Verify' ? 'Read only.' : 'Only declared allowed paths.',
              dont: 'Change intent. Add scope. Push or deploy.',
              done: `Complete ${task.id} and return independent evidence.`,
            },
            solutionNodeIds: [String(task.attributes.solutionNodeId)],
            dependencies: state.executionGraph?.edges.filter((edge) =>
              edge.type === 'DEPENDS_ON' && edge.sourceNodeRef.nodeId === task.id)
              .map((edge) => edge.targetNodeRef.nodeId) ?? [],
            relevantIntentNodes: state.intentGraph?.nodes.filter((node) => node.status === 'confirmed')
              .map((node) => ({ id: node.id, statement: node.statementOrName })) ?? [],
            relevantSolutionNodes: state.solutionGraph?.nodes.filter((node) => node.id === task.attributes.solutionNodeId)
              .map((node) => ({ id: node.id, name: node.statementOrName })) ?? [],
            protectedAssertions: state.intentGraph?.nodes.filter((node) => node.type === 'Constraint' && node.status === 'confirmed')
              .map((node) => node.statementOrName) ?? [],
            exclusions: state.intentGraph?.nodes.filter((node) => node.type === 'Exclusion' && node.status === 'confirmed')
              .map((node) => node.statementOrName) ?? [],
            acceptanceChecks: [String((task.attributes.acceptanceChecks as string[] | undefined)?.[0] ?? 'Exact graph trace remains satisfied.')],
          },
        };
      },
    },
    registry, identities,
    buildWorker,
    checkWorker,
    worktrees: new GitWorktreeBoundary(stateRoot),
    trustedRepositories: [repositoryRoot],
    verifiedDriftSink: async ({ identity, leaseId, terminal }) => {
      if (!terminal.drift) return;
      const sourceLease = await registry.readLease(leaseId);
      const record = {
        driftId: terminal.drift.driftId,
        evidenceHash: terminal.evidenceHash,
        sourceTaskId: terminal.taskId,
        intentBaselineId: terminal.drift.intentBaseline.baselineId,
        intentBaselineHash: terminal.drift.intentBaseline.contentHash,
        solutionBaselineId: terminal.drift.solutionBaseline.baselineId,
        solutionBaselineHash: terminal.drift.solutionBaseline.contentHash,
        executionHash: terminal.evidence.executionHash,
        repairId: terminal.drift.repair.repairId,
        instruction: terminal.drift.instruction,
        status: 'idle' as const,
        report: terminal.drift,
        baseCommit: terminal.status === 'rejected' ? terminal.candidateCommit : terminal.evidence.baseCommit,
        sourceTask: sourceLease?.task,
        rejectedCandidateCommit: terminal.status === 'rejected' ? terminal.candidateCommit : undefined,
        rejectedTreeHash: terminal.status === 'rejected' ? terminal.treeHash : undefined,
      };
      await driftStore.persistVerified(record, await receipts.issue(record, identity, leaseId));
    },
  });
  const sessions = new SoleOwnerSessions(secrets.claim);
  let executionArtifact: ExecutionControlArtifact | undefined;
  try { executionArtifact = JSON.parse(readFileSync(resolve(stateRoot, 'execution.json'), 'utf8')) as ExecutionControlArtifact; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  const server = startProjectControlPlane({
    port: input.port, sessions, runnerToken: secrets.runner,
    projectService: project, localRunner: runner, runnerRegistry: registry,
    executionArtifact,
    executionArtifactStore: artifactStore,
    repairAuthorityStore: repairStore,
    verifierDriftStore: driftStore,
    allowedHosts: publicHosts.length ? [LOOPBACK_HOST, 'localhost', '[::1]', ...publicHosts] : undefined,
    staticRoot: resolve(input.staticRoot),
    modelInfo: () => qwen.info(),
    buildPack: () => buildPackArchive(project.state()),
  });
  return { server, claimToken: sessions.claimToken };
}

async function buildPackArchive(state: Readonly<ProjectConversationState>): Promise<Uint8Array> {
  const temporary = await mkdtemp(resolve(tmpdir(), 'graphslop-pack-'));
  const output = resolve(temporary, '.factory');
  try {
    await exportBuildPack(state, output);
    const files: Record<string, Uint8Array> = {};
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) await visit(path, `${name}/`);
        else files[`.factory/${name}`] = new Uint8Array(await readFile(path));
      }
    };
    await visit(output, '');
    return zipSync(files, { level: 6 });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repositoryRoot = process.env.GRAPHSLOP_REPOSITORY;
  const projectStateRoot = process.env.GRAPHSLOP_PROJECT_STATE;
  if (!repositoryRoot || !projectStateRoot) {
    throw new Error('Set GRAPHSLOP_REPOSITORY and GRAPHSLOP_PROJECT_STATE to explicit local paths.');
  }
  const running = startLocalProduct({
    repositoryRoot,
    projectStateRoot,
    staticRoot: resolve(process.cwd(), 'dist/web'),
    port: Number(process.env.PORT ?? 4173),
    claimToken: process.env.GRAPHSLOP_CLAIM_TOKEN,
    publicHost: process.env.GRAPHSLOP_PUBLIC_HOST,
    publicHosts: process.env.GRAPHSLOP_PUBLIC_HOSTS?.split(','),
  });
  process.stdout.write(`Graphslop: http://${LOOPBACK_HOST}:${process.env.PORT ?? 4173}\nClaim token: ${running.claimToken}\n`);
}

/** Test helper. Production assembly uses ProductionControlAdapter above. */
export class MemoryControlAdapter implements ControlAdapter {
  readonly events: SafeEvent[] = [];
  readonly commands: Readonly<{ command: OwnerCommand; envelope: CommandEnvelope }>[] = [];

  constructor(
    private readonly project: unknown = null,
    private readonly acceptedBindings?: StageBindings,
  ) {}

  async readProject(): Promise<unknown> {
    return structuredClone(this.project);
  }

  async commandAtomic(command: OwnerCommand, envelope: CommandEnvelope): Promise<CommandResult> {
    if (!await this.authorize(command, envelope.bindings)) {
      return { ok: false, code: 'stale_binding' };
    }
    (this.commands as { command: OwnerCommand; envelope: CommandEnvelope }[]).push({ command, envelope: structuredClone(envelope) });
    return { ok: true, result: { command, bindings: envelope.bindings } };
  }

  async authorize(_command: OwnerCommand, bindings: StageBindings): Promise<boolean> {
    const target = bindings as Readonly<Record<string, string>>;
    return Boolean(this.acceptedBindings
      && Object.keys(this.acceptedBindings).length === Object.keys(bindings).length
      && Object.entries(this.acceptedBindings).every(([key, value]) => target[key] === value));
  }

  async runnerEvent(event: SafeEvent): Promise<unknown> {
    if (!this.acceptedBindings || event.taskId !== this.acceptedBindings.taskId) {
      throw new Error('Unknown task event rejected.');
    }
    this.events.push(structuredClone(event));
    return { eventId: event.eventId };
  }

  async readEvents(after?: string): Promise<readonly SafeEvent[]> {
    const index = after ? this.events.findIndex((event) => event.eventId === after) : -1;
    return structuredClone(this.events.slice(index + 1));
  }
}
