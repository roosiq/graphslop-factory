import type {
  CommandEnvelope,
  CommandResult,
  ControlAdapter,
  ExactBindings,
  OwnerCommand,
  SafeEvent,
  StageBindings,
} from './control.js';
import { ownerCommands, parseSafeEvent } from './control.js';
import { redactBoundedSummary } from './control.js';
import { randomBytes } from 'node:crypto';

export interface AcceptedAuthorityBoundary {
  currentBindings(): Promise<ExactBindings | undefined>;
  authorize(command: OwnerCommand, bindings: StageBindings): Promise<boolean>;
  bindingFor?(command: OwnerCommand): Promise<StageBindings | undefined>;
}

export interface ProjectServiceBoundary {
  state(): unknown | Promise<unknown>;
  submitMessage(content: string): Promise<unknown>;
  editIntentGraph(edit: import('@graphslop/control-state').IntentGraphEdit): unknown;
  createReviewProjection(kind: 'intent' | 'solution'): unknown;
  approve(kind: 'intent' | 'solution', approval: never): unknown;
  generateSolution(): Promise<unknown>;
  compileExecution(): unknown;
}

export interface RunnerControlBoundary {
  dispatch(input: unknown): Promise<unknown>;
  authorizeRepair(input: unknown): Promise<unknown>;
  previewPullRequest(input: unknown): Promise<unknown>;
  appendEvent(event: SafeEvent): Promise<unknown>;
  events(after?: string): Promise<readonly SafeEvent[]>;
}

function exact(left: ExactBindings | undefined, right: ExactBindings): boolean {
  return Boolean(left && Object.keys(right).every(
    (key) => left[key as keyof ExactBindings] === right[key as keyof ExactBindings],
  ));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Command input is invalid.');
  return value as Record<string, unknown>;
}

const safeKeys = new Set([
  'project', 'projectId', 'displayName', 'lifecycleState', 'activeIntentBaselineId',
  'activeSolutionBaselineId', 'activeExecutionSnapshotId', 'activeLeaseId',
  'currentQuestionId', 'createdAt', 'updatedAt', 'closedAt', 'currentQuestion',
  'questionId', 'text', 'category', 'score', 'blocking', 'graphKind', 'graphId',
  'snapshotId', 'contentHash', 'revision', 'parentSnapshotId', 'parentSnapshotContentHash',
  'nodes', 'edges', 'crossGraphLinks', 'id', 'stableId', 'version', 'type', 'status',
  'statementOrName', 'sourceRefs', 'sourceId', 'actorRef', 'actorId', 'actorKind',
  'sourceQuote', 'originalInterpretation', 'normalizedInterpretation', 'confidence',
  'approvedByUser', 'scope', 'from', 'to', 'source', 'target', 'nodeId', 'nodeVersion',
  'snapshotContentHash', 'sourceBaselineId', 'targetBaselineId', 'transformationId',
  'projectionId', 'projectionContentHash', 'generatedAt', 'data', 'baselineId',
  'approvedAt', 'nodeVersions', 'protectedAssertions', 'unresolvedNonBlocking',
  'supersedesBaselineId', 'leaseId', 'taskId', 'issuedAt', 'expiresAt', 'title',
  'baseBranch', 'headBranch', 'body', 'remoteAction', 'acceptedTaskIds', 'evidenceHashes',
  'eventId', 'reasonCode', 'timestamp', 'summary',
  'repairId',
  'intentGraph', 'solutionGraph', 'executionGraph', 'projections', 'approvedBaselines',
  'messages', 'messageId', 'actor', 'content', 'questionResolutions', 'resolutionId',
  'ownerMessageId', 'ownerContent', 'disposition', 'corrections', 'correctionId',
  'priorVersion', 'nextVersion', 'priorStatement', 'nextStatement',
  'attributes', 'intentNodeIds', 'solutionNodeId', 'dependencies', 'blockedReasons',
  'sourceNodeRef', 'targetNodeRef', 'objective', 'allowedPaths', 'acceptanceCommands', 'acceptanceChecks', 'argv',
  'roleKey', 'roleName', 'job', 'use', 'touch', 'dont', 'done', 'taskTypes', 'assignmentIndex',
  'evidence', 'evidenceHash', 'checks', 'drift', 'drifts', 'severity', 'expected',
  'observed', 'instruction', 'nextAction', 'completenessGaps', 'roleRef',
  'impact', 'unaffectedTasks', 'tasksRequiringModification', 'discardedTasks', 'newTasks',
  'executionControl',
  'report', 'repair', 'driftId', 'files', 'attemptLimit', 'sourceTaskId',
  'intentBaseline', 'solutionBaseline', 'baseCommit',
  'integrationCommit', 'candidateCommit', 'treeHash', 'checkpointRef', 'changedFiles', 'diffHash',
  'baseTree', 'integrationTree', 'diffStat',
]);

const sensitiveKey = /(?:api.?key|session|cookie|csrf|auth(?:orization)?|token|secret|password|private.?key|client.?secret|database.?url|stdout|stderr|raw.?stream|connectedRepository|worktree|(?:^|_)path$)/i;

function safeLeaf(value: string): string {
  const redacted = redactBoundedSummary(value);
  return redacted === value ? value : '[redacted]';
}

function allowlisted(value: unknown, keys = safeKeys): unknown {
  if (Array.isArray(value)) return value.map((item) => allowlisted(item, keys));
  if (typeof value === 'string') return safeLeaf(value);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!keys.has(key) || sensitiveKey.test(key)) continue;
    output[key] = allowlisted(child, keys);
  }
  return output;
}

function commandDto(command: OwnerCommand, value: unknown): unknown {
  const topKeys: Readonly<Record<OwnerCommand, ReadonlySet<string>>> = {
    'submit-message': new Set(['project', 'currentQuestion', 'intentGraph']),
    'edit-intent-graph': new Set(['project', 'currentQuestion', 'intentGraph']),
    'resolve-question': new Set(['project', 'currentQuestion', 'intentGraph']),
    'review-intent': new Set(['projectionId', 'graphKind', 'snapshotId', 'contentHash', 'data', 'generatedAt']),
    'approve-intent': new Set(['baselineId', 'graphKind', 'projectId', 'status', 'snapshotId', 'snapshotContentHash', 'projectionId', 'projectionContentHash', 'nodeVersions', 'protectedAssertions', 'unresolvedNonBlocking', 'createdAt', 'supersedesBaselineId']),
    'propose-solution': new Set(['graphKind', 'graphId', 'snapshotId', 'contentHash', 'revision', 'parentSnapshotId', 'parentSnapshotContentHash', 'createdAt', 'nodes', 'edges', 'crossGraphLinks']),
    'review-solution': new Set(['projectionId', 'graphKind', 'snapshotId', 'contentHash', 'data', 'generatedAt']),
    'approve-solution': new Set(['baselineId', 'graphKind', 'projectId', 'status', 'snapshotId', 'snapshotContentHash', 'projectionId', 'projectionContentHash', 'nodeVersions', 'protectedAssertions', 'unresolvedNonBlocking', 'createdAt', 'supersedesBaselineId']),
    'compile-execution': new Set(['graphKind', 'graphId', 'snapshotId', 'contentHash', 'revision', 'parentSnapshotId', 'parentSnapshotContentHash', 'createdAt', 'nodes', 'edges', 'crossGraphLinks']),
    'dispatch-task': new Set(['leaseId', 'taskId', 'issuedAt', 'expiresAt', 'status', 'evidenceHash', 'drift']),
    'authorize-repair': new Set(['taskId', 'status', 'repairId']),
    'preview-pull-request': new Set(['title', 'baseBranch', 'headBranch', 'body', 'remoteAction']),
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return allowlisted(value);
  const selected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (topKeys[command].has(key) && !sensitiveKey.test(key)) selected[key] = allowlisted(child);
  }
  return selected;
}

/**
 * The one production assembly point. All authority reads and mutations pass through
 * this instance, so a stale command cannot win a race under a different idempotency key.
 */
export class ProductionControlAdapter implements ControlAdapter {
  #tail: Promise<void> = Promise.resolve();
  readonly #capabilities = new Map<string, Readonly<{ command: OwnerCommand; bindings: StageBindings }>>();

  constructor(
    private readonly authority: AcceptedAuthorityBoundary,
    private readonly project: ProjectServiceBoundary,
    private readonly runner: RunnerControlBoundary,
  ) {}

  async readProject(): Promise<unknown> {
    return allowlisted(structuredClone(await this.project.state()));
  }

  async readNextBindings() {
    return this.serial(() => this.issueNext());
  }

  commandAtomic(command: OwnerCommand, envelope: CommandEnvelope): Promise<CommandResult> {
    return this.serial(async () => {
      if (envelope.capability) {
        const capability = this.#capabilities.get(envelope.capability);
        if (!capability || capability.command !== command || !sameBindings(capability.bindings, envelope.bindings)) {
          return { ok: false, code: 'stale_binding' };
        }
      }
      if (!await this.authority.authorize(command, envelope.bindings)) {
        return { ok: false, code: 'stale_binding' };
      }
      const result = commandDto(command, await this.execute(command, envelope.input));
      const nextBindings = await this.issueNext();
      return { ok: true, result, nextBindings };
    });
  }

  async runnerEvent(event: SafeEvent): Promise<unknown> {
    const safe = parseSafeEvent(event);
    if (!safe) throw new Error('Unsafe event rejected.');
    const current = await this.authority.currentBindings();
    if (!current || safe.taskId !== current.taskId) throw new Error('Unknown task event rejected.');
    return allowlisted(await this.runner.appendEvent(safe));
  }

  async readEvents(after?: string): Promise<readonly SafeEvent[]> {
    return this.runner.events(after);
  }

  private async execute(command: OwnerCommand, input: unknown): Promise<unknown> {
    const value = record(input);
    switch (command) {
      case 'submit-message':
        if (typeof value.content !== 'string') throw new Error('Message content is required.');
        return this.project.submitMessage(value.content);
      case 'edit-intent-graph':
        if (typeof value.action !== 'string') throw new Error('Graph edit action is required.');
        return this.project.editIntentGraph(input as import('@graphslop/control-state').IntentGraphEdit);
      case 'resolve-question':
        if (typeof value.questionId !== 'string' || !['answered', 'deferred'].includes(String(value.disposition))
          || typeof value.content !== 'string') throw new Error('Question resolution is invalid.');
        return (this.project as ProjectServiceBoundary & {
          resolveCurrentQuestion(id: string, disposition: 'answered' | 'deferred', content: string): unknown;
        }).resolveCurrentQuestion(value.questionId, value.disposition as 'answered' | 'deferred', value.content);
      case 'review-intent':
        return this.project.createReviewProjection('intent');
      case 'approve-intent':
        return this.project.approve('intent', input as never);
      case 'propose-solution':
        return this.project.generateSolution();
      case 'review-solution':
        return this.project.createReviewProjection('solution');
      case 'approve-solution':
        return this.project.approve('solution', input as never);
      case 'compile-execution':
        return this.project.compileExecution();
      case 'dispatch-task':
        return this.runner.dispatch(input);
      case 'authorize-repair':
        return this.runner.authorizeRepair(input);
      case 'preview-pull-request':
        return this.runner.previewPullRequest(input);
    }
  }

  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async issueNext() {
    if (!this.authority.bindingFor) return [];
    const output = [];
    for (const command of ownerCommands) {
      const bindings = await this.authority.bindingFor(command);
      if (!bindings) continue;
      const capability = randomBytes(24).toString('base64url');
      this.#capabilities.set(capability, { command, bindings });
      output.push({ command, bindings, capability });
    }
    return output;
  }
}

function sameBindings(left: StageBindings, right: StageBindings): boolean {
  const a = left as Readonly<Record<string, string>>;
  const b = right as Readonly<Record<string, string>>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.entries(a).every(([key, value]) => b[key] === value);
}
