import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ProjectService } from '@graphslop/control-state';
import { GraphSnapshotSchema } from '@graphslop/contracts';
import { hashGraphSnapshot, scheduleExecutionTasks } from '@graphslop/graph-kernel';
import {
  createPullRequestPreview,
  resolveAuthorizedRepair,
  validateCheckpointChain,
  type DurableCheckpointArtifact,
  type DurableLeaseRecord,
  type DurableRunnerRegistry,
  type RepairAuthorization,
  type DriftReport,
  type LocalRunner,
  type RunnerTask,
  type VerifiedArtifact,
} from '../../../runner/src/index.js';

import type { ExactBindings, OwnerCommand, SafeEvent, StageBindings } from './control.js';
import type {
  AcceptedAuthorityBoundary,
  ProjectServiceBoundary,
  RunnerControlBoundary,
} from './production.js';
import type { FileExecutionArtifactStore } from './durable-authority.js';

const execFileAsync = promisify(execFile);

export type ExecutionControlArtifact = {
  version: number;
  graphSnapshotId: string;
  graphContentHash: string;
  taskId: string;
  leaseId: string;
  leaseHash: string;
  status?: 'ready' | 'running' | 'accepted' | 'rejected';
  acceptedTaskIds?: string[];
  acceptedArtifacts?: readonly (VerifiedArtifact & Readonly<{ taskId: string }>)[];
  evidenceHashes?: string[];
  driftId?: string;
  repairTask?: RunnerTask;
  baseCommit?: string;
  integrationCommit?: string;
  candidateCommit?: string;
  treeHash?: string;
  changedFiles?: string[];
  checkpoints?: DurableCheckpointArtifact[];
  terminalLeaseIds?: string[];
};

export type VerifierDriftRecord = {
  driftId: string;
  evidenceHash: string;
  sourceTaskId: string;
  intentBaselineId: string;
  intentBaselineHash: string;
  solutionBaselineId: string;
  solutionBaselineHash: string;
  executionHash: string;
  repairId: string;
  instruction: string;
  status: 'idle';
  report?: DriftReport;
  baseCommit?: string;
  sourceTask?: RunnerTask;
  rejectedCandidateCommit?: string;
  rejectedTreeHash?: string;
};

export interface RepairAuthorityStore {
  persist(record: RepairAuthorization): Promise<void>;
  resolve(ownerAuthorizationId: string): Promise<RepairAuthorization | undefined>;
}

export interface VerifierDriftStore {
  resolve(driftId: string): Promise<VerifierDriftRecord | undefined>;
  all?(): Promise<readonly VerifierDriftRecord[]>;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Command input is invalid.');
  return value as Record<string, unknown>;
}

function sameRecord(left: Readonly<Record<string, string>>, right: StageBindings): boolean {
  const target = right as Readonly<Record<string, string>>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(target).length && keys.every((key) => left[key] === target[key]);
}

export function dependencyHandoffIsSatisfied(
  edge: Readonly<{ targetNodeRef: Readonly<{ nodeId: string }>; attributes: Readonly<Record<string, unknown>> }>,
  acceptedTaskIds: ReadonlySet<string>,
  acceptedArtifacts: readonly (VerifiedArtifact & Readonly<{ taskId: string }>)[],
): boolean {
  if (!acceptedTaskIds.has(edge.targetNodeRef.nodeId)) return false;
  const contracts = Array.isArray(edge.attributes.artifacts)
    ? edge.attributes.artifacts as Array<{ key?: unknown; paths?: unknown; requiredEvidence?: unknown }>
    : [];
  return contracts.every((contract) => {
    if (typeof contract.key !== 'string') return false;
    const artifact = acceptedArtifacts.find((candidate) =>
      candidate.taskId === edge.targetNodeRef.nodeId && candidate.contract.key === contract.key);
    if (!artifact?.evidenceHash) return false;
    const requirements = Array.isArray(contract.requiredEvidence) ? contract.requiredEvidence : [];
    return requirements.every((requirement) => artifact.evidenceRefs.some((ref) => {
      if (ref.requirement !== requirement) return false;
      if (requirement === 'file_hash') {
        return ref.kind === 'file_hash'
          && typeof ref.path === 'string'
          && Array.isArray(contract.paths)
          && contract.paths.includes(ref.path)
          && typeof ref.sha256 === 'string'
          && /^[a-f0-9]{64}$/.test(ref.sha256);
      }
      return requirement === 'independent_check'
        && ref.kind === 'independent_check'
        && ref.exitCode === 0
        && Number.isInteger(ref.receiptIndex)
        && Array.isArray(ref.argv);
    }));
  });
}

export function effectiveArtifactTaskId(task: Pick<RunnerTask, 'taskId' | 'repair'>): string {
  return task.repair?.sourceTaskId ?? task.taskId;
}

/**
 * Concrete local bridge over the accepted ProjectService and LocalRunner.
 * The execution artifact is explicit because it is versioned outside ProjectService.
 */
export class ProjectRunnerBridge implements AcceptedAuthorityBoundary, RunnerControlBoundary {
  readonly #events: SafeEvent[] = [];

  constructor(
    readonly project: ProjectService,
    private readonly runner: LocalRunner,
    private readonly registry: DurableRunnerRegistry,
    private execution: ExecutionControlArtifact | undefined,
    private readonly repairs?: RepairAuthorityStore,
    private readonly drifts?: VerifierDriftStore,
    private readonly executionStore?: FileExecutionArtifactStore,
  ) {}

  private async validateDurableExecution(): Promise<readonly DurableLeaseRecord[]> {
    if (!this.execution) return [];
    const ids = this.execution.terminalLeaseIds ?? [];
    const terminals = await Promise.all(ids.map(async (id) => {
      const lease = await this.registry.readLease(id);
      if (!lease?.terminalResult || !['accepted', 'rejected'].includes(lease.status)) {
        throw new Error('Durable terminal execution evidence is unavailable.');
      }
      return lease;
    }));
    if (new Set(ids).size !== ids.length) throw new Error('Durable terminal lease chain contains duplicates.');
    const checkpoints = this.execution.checkpoints ?? [];
    if (checkpoints.length) {
      const repositories = new Set(terminals.map((item) => item.sourceRepositoryRoot));
      if (repositories.size !== 1) throw new Error('Checkpoint chain repository authority is ambiguous.');
      await validateCheckpointChain([...repositories][0]!, checkpoints);
    }
    for (const checkpoint of checkpoints) {
      const lease = terminals.find((item) =>
        item.task.taskId === checkpoint.taskId
        && item.terminalResult?.candidateCommit === checkpoint.candidateCommit);
      const terminal = lease?.terminalResult;
      if (
        !terminal || terminal.status !== checkpoint.status
        || terminal.evidenceHash !== checkpoint.evidenceHash
        || terminal.treeHash !== checkpoint.treeHash
        || terminal.checkpointRef !== checkpoint.checkpointRef
        || terminal.parentCommit !== checkpoint.parentCommit
        || terminal.evidence.baseCommit !== checkpoint.baseCommit
        || (checkpoint.status === 'rejected' && terminal.drift?.driftId !== checkpoint.driftId)
      ) throw new Error('Checkpoint does not match durable terminal evidence.');
    }
    const expectedAccepted = [...new Set(terminals.flatMap((lease) =>
      lease.terminalResult?.status === 'accepted'
        ? [lease.task.taskId, ...(lease.task.repair ? [lease.task.repair.sourceTaskId] : [])]
        : []))].sort();
    const durableAccepted = [...(this.execution.acceptedTaskIds ?? [])].sort();
    const expectedEvidence = [...new Set(terminals.map((lease) => lease.terminalResult!.evidenceHash))].sort();
    const durableEvidence = [...(this.execution.evidenceHashes ?? [])].sort();
    const expectedArtifacts = terminals.flatMap((lease) =>
      lease.terminalResult?.status === 'accepted'
        ? (lease.terminalResult.verifiedArtifacts ?? []).map((artifact) => ({
          taskId: effectiveArtifactTaskId(lease.task),
          ...artifact,
        }))
        : [])
      .sort((left, right) =>
        `${left.taskId}:${left.contract.key}`.localeCompare(`${right.taskId}:${right.contract.key}`));
    const durableArtifacts = [...(this.execution.acceptedArtifacts ?? [])]
      .sort((left, right) =>
        `${left.taskId}:${left.contract.key}`.localeCompare(`${right.taskId}:${right.contract.key}`));
    if (
      JSON.stringify(expectedAccepted) !== JSON.stringify(durableAccepted)
      || JSON.stringify(expectedEvidence) !== JSON.stringify(durableEvidence)
      || JSON.stringify(expectedArtifacts) !== JSON.stringify(durableArtifacts)
    ) throw new Error('Execution acceptance projection does not match durable terminal evidence.');
    const acceptedCheckpoint = [...checkpoints].reverse().find((item) => item.status === 'accepted');
    if ((acceptedCheckpoint?.candidateCommit ?? undefined) !== this.execution.integrationCommit) {
      throw new Error('Integration commit does not match the latest accepted checkpoint.');
    }
    return terminals;
  }

  projectBoundary(): ProjectServiceBoundary {
    return {
      state: async () => {
        let executionHealthy = true;
        try { await this.validateDurableExecution(); } catch { executionHealthy = false; }
        return {
        ...this.project.state(),
        drifts: await this.drifts?.all?.() ?? [],
        executionControl: this.execution && executionHealthy ? {
          taskId: this.execution.taskId,
          status: this.execution.status ?? 'ready',
          acceptedTaskIds: this.execution.acceptedTaskIds ?? [],
          evidenceHashes: this.execution.evidenceHashes ?? [],
          driftId: this.execution.driftId,
          integrationCommit: this.execution.integrationCommit,
          candidateCommit: this.execution.candidateCommit,
          treeHash: this.execution.treeHash,
        } : null,
      };
      },
      submitMessage: (content) => this.project.submitMessage(content),
      editIntentGraph: (edit) => this.project.editIntentGraph(edit),
      resolveCurrentQuestion: (id: string, disposition: 'answered' | 'deferred', content: string) =>
        this.project.resolveCurrentQuestion(id, disposition, content, true),
      createReviewProjection: (kind) => this.project.createReviewProjection(kind),
      approve: (kind, approval) => this.project.approve(kind, approval),
      generateSolution: () => this.project.generateSolution(),
      compileExecution: async () => {
        const graph = GraphSnapshotSchema.parse(this.project.compileExecution());
        if (graph.graphKind !== 'execution' || hashGraphSnapshot(graph) !== graph.contentHash) {
          throw new Error('Compiled Execution graph failed kernel hash validation.');
        }
        const state = this.project.state();
        const intent = state.approvedBaselines.find((item) => item.graphKind === 'intent'
          && item.baselineId === state.project.activeIntentBaselineId);
        const solution = state.approvedBaselines.find((item) => item.graphKind === 'solution'
          && item.baselineId === state.project.activeSolutionBaselineId);
        if (!intent || !solution) throw new Error('Compiled Execution graph lost its approved baselines.');
        const scheduler = scheduleExecutionTasks({
          tasks: graph.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            status: 'ready',
            dependencies: graph.edges.filter((edge) =>
              edge.type === 'DEPENDS_ON' && edge.sourceNodeRef.nodeId === node.id)
              .map((edge) => edge.targetNodeRef.nodeId),
            protectedIntentBaseline: { baselineId: intent.baselineId, contentHash: intent.snapshotContentHash },
            protectedSolutionBaseline: { baselineId: solution.baselineId, contentHash: solution.snapshotContentHash },
            ownerAuthorization: 'authorized',
          })),
          currentIntentBaseline: { baselineId: intent.baselineId, contentHash: intent.snapshotContentHash },
          currentSolutionBaseline: { baselineId: solution.baselineId, contentHash: solution.snapshotContentHash },
        });
        const selected = graph.nodes.find((node) => node.id === scheduler.selectedTaskId);
        if (!scheduler.valid || !selected) throw new Error('Compiled Execution graph has no exact ready owner-authorized task.');
        const durableCurrent = this.executionStore ? await this.executionStore.load() : this.execution;
        const next = unleasedArtifact({
          graphSnapshotId: graph.snapshotId,
          graphContentHash: graph.contentHash,
          taskId: selected.id,
          version: (durableCurrent?.version ?? 0) + 1,
        });
        if (this.executionStore) {
          await this.executionStore.install(next, durableCurrent ? {
            version: durableCurrent.version,
            graphSnapshotId: durableCurrent.graphSnapshotId,
            graphContentHash: durableCurrent.graphContentHash,
          } : null);
        }
        this.execution = next;
        return graph;
      },
    } as ProjectServiceBoundary;
  }

  async currentBindings(): Promise<ExactBindings | undefined> {
    const state = this.project.state();
    if (!this.execution && this.executionStore) this.execution = await this.executionStore.load();
    if (!this.execution) return undefined;
    try { await this.validateDurableExecution(); }
    catch { return undefined; }
    const execution = this.execution;
    const graph = state.executionGraph;
    if (
      !graph
      || graph.snapshotId !== execution.graphSnapshotId
      || graph.contentHash !== execution.graphContentHash
      || (!graph.nodes.some((node) => node.id === execution.taskId) && execution.repairTask?.taskId !== execution.taskId)
    ) return undefined;
    const intent = state.approvedBaselines.find((item) =>
      item.graphKind === 'intent' && item.baselineId === state.project.activeIntentBaselineId);
    const solution = state.approvedBaselines.find((item) =>
      item.graphKind === 'solution' && item.baselineId === state.project.activeSolutionBaselineId);
    const projection = state.projections.find((item) =>
      item.projectionId === solution?.projectionId
      && item.contentHash === solution?.projectionContentHash);
    if (!intent || !solution || !projection) return undefined;
    if (execution.leaseId !== 'unleased') {
      const lease = await this.registry.readLease(execution.leaseId);
      if (!lease || lease.tokenHash !== execution.leaseHash || lease.task.taskId !== execution.taskId) {
        return undefined;
      }
    }
    return {
      stage: 'execution',
      projectId: state.project.projectId,
      lifecycleState: state.project.lifecycleState,
      graphSnapshotId: graph.snapshotId,
      graphContentHash: graph.contentHash,
      intentBaselineId: intent.baselineId,
      intentBaselineHash: intent.snapshotContentHash,
      solutionBaselineId: solution.baselineId,
      solutionBaselineHash: solution.snapshotContentHash,
      projectionId: projection.projectionId,
      projectionHash: projection.contentHash,
      taskId: execution.taskId,
      leaseId: execution.leaseId,
      leaseHash: execution.leaseHash,
    };
  }

  async bindingFor(command: OwnerCommand): Promise<StageBindings | undefined> {
    const state = this.project.state();
    const project = state.project;
    const intent = state.approvedBaselines.find((item) =>
      item.graphKind === 'intent' && item.baselineId === project.activeIntentBaselineId);
    const solution = state.approvedBaselines.find((item) =>
      item.graphKind === 'solution' && item.baselineId === project.activeSolutionBaselineId);
    const latestIntentProjection = [...state.projections].reverse().find((item) =>
      item.graphKind === 'intent' && item.snapshotId === state.intentGraph?.snapshotId);
    const latestSolutionProjection = [...state.projections].reverse().find((item) =>
      item.graphKind === 'solution' && item.snapshotId === state.solutionGraph?.snapshotId);
    const approvedSolutionProjection = state.projections.find((item) =>
      item.projectionId === solution?.projectionId && item.contentHash === solution?.projectionContentHash);
    const common = { projectId: project.projectId, lifecycleState: project.lifecycleState };
    let expected: Readonly<Record<string, string>> | undefined;
    switch (command) {
      case 'submit-message': {
        if (!['CAPTURE', 'DISCOVERY'].includes(project.lifecycleState)) return undefined;
        const head = state.messages.at(-1);
        expected = {
          stage: 'conversation',
          ...common,
          messageHeadHash: digest(head ? JSON.stringify(head) : 'empty'),
        };
        break;
      }
      case 'edit-intent-graph':
      case 'resolve-question':
      case 'review-intent':
        if (!state.intentGraph || !['DISCOVERY', 'INTENT_REVIEW'].includes(project.lifecycleState)) return undefined;
        if (command === 'review-intent' && (state.currentQuestion?.blocking || this.project.intentReadinessGaps().length)) {
          return undefined;
        }
        expected = {
          stage: 'intent-discovery',
          ...common,
          intentSnapshotId: state.intentGraph.snapshotId,
          intentHash: state.intentGraph.contentHash,
          questionId: state.currentQuestion?.questionId ?? 'none',
        };
        break;
      case 'approve-intent':
        if (!state.intentGraph || !latestIntentProjection || project.lifecycleState !== 'INTENT_REVIEW') return undefined;
        expected = {
          stage: 'intent-review',
          ...common,
          intentSnapshotId: state.intentGraph.snapshotId,
          intentHash: state.intentGraph.contentHash,
          projectionId: latestIntentProjection.projectionId,
          projectionHash: latestIntentProjection.contentHash,
        };
        break;
      case 'propose-solution':
        if (!intent || project.lifecycleState !== 'INTENT_APPROVED') return undefined;
        expected = {
          stage: 'intent-approved',
          ...common,
          intentBaselineId: intent.baselineId,
          intentBaselineHash: intent.snapshotContentHash,
        };
        break;
      case 'review-solution':
        if (!intent || !state.solutionGraph || project.lifecycleState !== 'SOLUTION_REVIEW') return undefined;
        expected = {
          stage: 'solution-review',
          ...common,
          intentBaselineId: intent.baselineId,
          intentBaselineHash: intent.snapshotContentHash,
          solutionSnapshotId: state.solutionGraph.snapshotId,
          solutionHash: state.solutionGraph.contentHash,
        };
        break;
      case 'approve-solution':
        if (!intent || !state.solutionGraph || !latestSolutionProjection || project.lifecycleState !== 'SOLUTION_REVIEW') return undefined;
        expected = {
          stage: 'solution-review',
          ...common,
          intentBaselineId: intent.baselineId,
          intentBaselineHash: intent.snapshotContentHash,
          solutionSnapshotId: state.solutionGraph.snapshotId,
          solutionHash: state.solutionGraph.contentHash,
          projectionId: latestSolutionProjection.projectionId,
          projectionHash: latestSolutionProjection.contentHash,
        };
        break;
      case 'compile-execution':
        if (!intent || !solution || !approvedSolutionProjection || project.lifecycleState !== 'SOLUTION_APPROVED') return undefined;
        expected = {
          stage: 'solution-approved',
          ...common,
          intentBaselineId: intent.baselineId,
          intentBaselineHash: intent.snapshotContentHash,
          solutionBaselineId: solution.baselineId,
          solutionBaselineHash: solution.snapshotContentHash,
          projectionId: approvedSolutionProjection.projectionId,
          projectionHash: approvedSolutionProjection.contentHash,
        };
        break;
      case 'dispatch-task':
        if (this.execution?.status === 'accepted' || this.execution?.status === 'rejected') return undefined;
        expected = await this.currentBindings();
        break;
      case 'authorize-repair':
        if (this.execution?.status !== 'rejected') return undefined;
        expected = await this.currentBindings();
        break;
      case 'preview-pull-request':
        if (this.execution?.status !== 'accepted') return undefined;
        expected = await this.currentBindings();
        break;
      default:
        expected = await this.currentBindings();
    }
    return expected;
  }

  async authorize(command: OwnerCommand, bindings: StageBindings): Promise<boolean> {
    const expected = await this.bindingFor(command);
    return Boolean(expected && sameRecord(expected, bindings));
  }

  async dispatch(input: unknown): Promise<unknown> {
    const value = object(input);
    if (!this.execution) throw new Error('Execution authority is not installed.');
    await this.validateDurableExecution();
    if (typeof value.trustedRepository !== 'string') throw new Error('Trusted repository is required.');
    const lease = await this.runner.lease({
      taskId: this.execution.taskId,
      executionHash: this.execution.graphContentHash,
      trustedRepository: value.trustedRepository,
    });
    const durable = await this.registry.readLease(lease.leaseId);
    if (!durable || durable.task.taskId !== this.execution.taskId) throw new Error('Durable lease was not recorded.');
    const priorLeaseId = this.execution.leaseId;
    const next = { ...this.execution, leaseId: lease.leaseId, leaseHash: durable.tokenHash };
    if (this.executionStore) await this.executionStore.updateLease(priorLeaseId, next);
    this.execution = next;
    this.pushEvent('task', 'running', 'task_started', lease.taskId, 'Work started.');
    const produced = await this.runner.run(lease.token);
    this.pushEvent('task', 'running', 'task_finished', lease.taskId, 'Work finished.');
    this.pushEvent('verification', 'running', 'check_started', lease.taskId, 'Check started.');
    const terminal = await this.runner.verify(produced);
    this.pushEvent(
      terminal.status === 'accepted' ? 'verification' : 'drift',
      terminal.status,
      terminal.status === 'accepted' ? 'check_passed' : 'drift_found',
      lease.taskId,
      terminal.status === 'accepted' ? 'Check passed.' : 'Drift found.',
    );
    this.execution = {
      ...this.execution,
      status: terminal.status,
      baseCommit: this.execution.baseCommit ?? terminal.evidence.baseCommit,
      terminalLeaseIds: [...new Set([...(this.execution.terminalLeaseIds ?? []), lease.leaseId])],
      acceptedTaskIds: terminal.status === 'accepted'
        ? [...new Set([
          ...(this.execution.acceptedTaskIds ?? []),
          terminal.taskId,
          ...(this.execution.repairTask?.repair ? [this.execution.repairTask.repair.sourceTaskId] : []),
        ])]
        : this.execution.acceptedTaskIds ?? [],
      acceptedArtifacts: terminal.status === 'accepted'
        ? [
          ...(this.execution.acceptedArtifacts ?? []),
          ...terminal.verifiedArtifacts.map((artifact) => ({
            taskId: effectiveArtifactTaskId(durable.task),
            ...artifact,
          })),
        ]
        : this.execution.acceptedArtifacts ?? [],
      evidenceHashes: [...new Set([...(this.execution.evidenceHashes ?? []), terminal.evidenceHash])],
      ...(terminal.drift ? { driftId: terminal.drift.driftId } : { driftId: undefined }),
      ...(terminal.candidateCommit ? { candidateCommit: terminal.candidateCommit } : {}),
      ...(terminal.treeHash ? { treeHash: terminal.treeHash } : {}),
      ...(terminal.status === 'accepted' && terminal.candidateCommit
        ? { integrationCommit: terminal.candidateCommit } : {}),
      checkpoints: terminal.candidateCommit && terminal.treeHash && terminal.checkpointRef && terminal.parentCommit
        ? [...(this.execution.checkpoints ?? []), {
          taskId: terminal.taskId,
          status: terminal.status,
          baseCommit: terminal.evidence.baseCommit,
          parentCommit: terminal.parentCommit,
          candidateCommit: terminal.candidateCommit,
          treeHash: terminal.treeHash,
          checkpointRef: terminal.checkpointRef,
          evidenceHash: terminal.evidenceHash,
          ...(terminal.drift ? { driftId: terminal.drift.driftId } : {}),
        }]
        : this.execution.checkpoints ?? [],
      changedFiles: terminal.status === 'accepted'
        ? [...new Set([
          ...(this.execution.changedFiles ?? []),
          ...terminal.evidence.changes.map((change) => change.path),
        ])].sort()
        : this.execution.changedFiles ?? [],
    };
    if (this.executionStore) await this.executionStore.updateLease(lease.leaseId, this.execution);
    if (terminal.status === 'accepted') {
      const state = this.project.state();
      const graph = state.executionGraph!;
      const intent = state.approvedBaselines.find((item) => item.graphKind === 'intent'
        && item.baselineId === state.project.activeIntentBaselineId)!;
      const solution = state.approvedBaselines.find((item) => item.graphKind === 'solution'
        && item.baselineId === state.project.activeSolutionBaselineId)!;
      const accepted = new Set(this.execution.acceptedTaskIds ?? []);
      const acceptedArtifacts = this.execution.acceptedArtifacts ?? [];
      const selectedTaskId = graph.nodes.filter((node) => !accepted.has(node.id))
        .filter((node) => graph.edges.filter((edge) =>
          edge.type === 'DEPENDS_ON' && edge.sourceNodeRef.nodeId === node.id)
          .every((edge) => dependencyHandoffIsSatisfied(edge, accepted, acceptedArtifacts)))
        .map((node) => node.id).sort()[0];
      if (selectedTaskId) {
        const current = this.execution;
        const next = unleasedArtifact({
          version: current.version + 1,
          graphSnapshotId: current.graphSnapshotId,
          graphContentHash: current.graphContentHash,
          taskId: selectedTaskId,
        });
        const carried = {
          ...next, status: 'ready' as const,
          acceptedTaskIds: [...accepted],
          acceptedArtifacts: [...acceptedArtifacts],
          evidenceHashes: current.evidenceHashes ?? [],
          baseCommit: current.baseCommit,
          integrationCommit: current.integrationCommit,
          changedFiles: current.changedFiles ?? [],
          checkpoints: current.checkpoints ?? [],
          terminalLeaseIds: current.terminalLeaseIds ?? [],
        };
        if (this.executionStore) await this.executionStore.install(carried, {
          version: current.version,
          graphSnapshotId: current.graphSnapshotId,
          graphContentHash: current.graphContentHash,
        });
        this.execution = carried;
        this.pushEvent('progress', 'pending', 'task_ready', carried.taskId, 'Work is ready.');
      }
    }
    return {
      leaseId: lease.leaseId, taskId: terminal.taskId,
      issuedAt: lease.issuedAt, expiresAt: lease.expiresAt,
      status: terminal.status, evidenceHash: terminal.evidenceHash,
      ...(terminal.drift ? { drift: terminal.drift } : {}),
    };
  }

  private pushEvent(
    type: SafeEvent['type'],
    status: SafeEvent['status'],
    reasonCode: SafeEvent['reasonCode'],
    taskId: string,
    summary: SafeEvent['summary'],
  ) {
    this.#events.push({
      eventId: `event-${Date.now()}-${this.#events.length + 1}`,
      type, status, taskId, reasonCode, timestamp: new Date().toISOString(), summary,
    });
  }

  async authorizeRepair(input: unknown): Promise<unknown> {
    if (!this.repairs || !this.drifts) throw new Error('Repair authorization is not ready.');
    if (!this.execution) throw new Error('Execution authority is not installed.');
    const value = object(input);
    const authorization = value.authorization as RepairAuthorization | undefined;
    const drift = value.drift as DriftReport | undefined;
    const current = await this.currentBindings();
    const registered = drift ? await this.drifts.resolve(drift.driftId) : undefined;
    if (
      !current || !authorization || !drift || !registered || typeof value.baseCommit !== 'string'
      || registered.evidenceHash !== drift.evidenceHash
      || registered.sourceTaskId !== drift.taskId
      || registered.intentBaselineId !== drift.intentBaseline.baselineId
      || registered.intentBaselineHash !== drift.intentBaseline.contentHash
      || registered.solutionBaselineId !== drift.solutionBaseline.baselineId
      || registered.solutionBaselineHash !== drift.solutionBaseline.contentHash
      || registered.executionHash !== current.graphContentHash
      || registered.repairId !== drift.repair.repairId
      || registered.instruction !== drift.instruction
      || registered.status !== drift.repair.status
      || !registered.rejectedCandidateCommit
      || value.baseCommit !== registered.rejectedCandidateCommit
      || drift.taskId !== current.taskId
      || !/^[a-f0-9]{64}$/.test(drift.evidenceHash)
      || drift.intentBaseline.baselineId !== current.intentBaselineId
      || drift.intentBaseline.contentHash !== current.intentBaselineHash
      || drift.solutionBaseline.baselineId !== current.solutionBaselineId
      || drift.solutionBaseline.contentHash !== current.solutionBaselineHash
      || authorization.intentHash !== drift.intentBaseline.contentHash
      || authorization.solutionHash !== drift.solutionBaseline.contentHash
      || authorization.executionHash !== current.graphContentHash
      || authorization.repairId !== drift.repair.repairId
    ) throw new Error('Exact drift and baseline repair authority is required.');
    await resolveAuthorizedRepair({
      drift,
      authorizationId: authorization.ownerAuthorizationId,
      resolve: async (id) => id === authorization.ownerAuthorizationId ? authorization : undefined,
      baseCommit: value.baseCommit,
    });
    await this.repairs.persist(structuredClone(authorization));
    const authorized = await resolveAuthorizedRepair({
      drift,
      authorizationId: authorization.ownerAuthorizationId,
      resolve: (id) => this.repairs!.resolve(id),
      baseCommit: value.baseCommit,
    });
    if (!registered.sourceTask) throw new Error('Verified source task contract is required for repair.');
    const task: RunnerTask = {
      ...registered.sourceTask,
      taskId: authorized.taskId,
      taskType: 'Repair',
      status: 'ready',
      baseCommit: value.baseCommit,
      brief: authorized.brief,
      repair: authorized.repair,
      allowedPaths: [...(registered.report?.files ?? [])],
      acceptanceCommands: registered.sourceTask.acceptanceCommands.length
        ? [...registered.sourceTask.acceptanceCommands]
        : [{ argv: ['node', '--test'] }],
      acceptanceChecks: [...registered.sourceTask.acceptanceChecks, authorized.acceptanceChecks[0]!],
    };
    const currentExecution = this.execution;
    const next: ExecutionControlArtifact = {
      ...currentExecution,
      version: currentExecution.version + 1,
      taskId: task.taskId,
      leaseId: 'unleased',
      leaseHash: '0'.repeat(64),
      status: 'ready',
      repairTask: task,
    };
    if (this.executionStore) await this.executionStore.install(next, {
      version: currentExecution.version,
      graphSnapshotId: currentExecution.graphSnapshotId,
      graphContentHash: currentExecution.graphContentHash,
    });
    this.execution = next;
    this.pushEvent('progress', 'pending', 'task_ready', task.taskId, 'Work is ready.');
    return { taskId: task.taskId, status: task.status, repairId: task.repair?.repairId };
  }

  async previewPullRequest(input: unknown): Promise<unknown> {
    const value = object(input);
    if (
      typeof value.title !== 'string' || typeof value.baseBranch !== 'string'
      || typeof value.headBranch !== 'string'
    ) throw new Error('Pull-request preview input is invalid.');
    if (!this.execution?.baseCommit || !this.execution.integrationCommit) {
      throw new Error('Validated integration commits are required for pull-request preview.');
    }
    const terminals = await this.validateDurableExecution();
    const accepted = terminals.filter((lease) => lease.terminalResult?.status === 'accepted');
    const acceptedTaskIds = accepted.map((lease) => lease.task.taskId);
    const evidenceHashes = accepted.map((lease) => lease.terminalResult!.evidenceHash);
    const repositories = new Set(terminals.map((lease) => lease.sourceRepositoryRoot));
    if (repositories.size !== 1) throw new Error('Pull-request repository authority is ambiguous.');
    const repository = [...repositories][0]!;
    const baseCommit = this.execution.baseCommit;
    const integrationCommit = this.execution.integrationCommit;
    try {
      await execFileAsync('git', ['merge-base', '--is-ancestor', baseCommit, integrationCommit], { cwd: repository });
    } catch {
      throw new Error('Integration commit is not descended from the durable base.');
    }
    const [diff, names, stat, baseTree, integrationTree] = await Promise.all([
      execFileAsync('git', ['diff', '--binary', '--no-ext-diff', `${baseCommit}..${integrationCommit}`], {
        cwd: repository, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024,
      }),
      execFileAsync('git', ['diff', '--name-only', '--no-ext-diff', `${baseCommit}..${integrationCommit}`], {
        cwd: repository, encoding: 'utf8', maxBuffer: 1024 * 1024,
      }),
      execFileAsync('git', ['diff', '--stat', '--no-ext-diff', `${baseCommit}..${integrationCommit}`], {
        cwd: repository, encoding: 'utf8', maxBuffer: 1024 * 1024,
      }),
      execFileAsync('git', ['rev-parse', `${baseCommit}^{tree}`], { cwd: repository, encoding: 'utf8' }),
      execFileAsync('git', ['rev-parse', `${integrationCommit}^{tree}`], { cwd: repository, encoding: 'utf8' }),
    ]);
    const diffBytes = diff.stdout as Buffer;
    if (diffBytes.byteLength > 4 * 1024 * 1024) throw new Error('Pull-request diff exceeds the local preview limit.');
    const changedFiles = names.stdout.split('\n').filter(Boolean).sort();
    const evidenceFiles = [...new Set(accepted.flatMap((lease) =>
      lease.terminalResult!.evidence.changes.map((change) => change.path)))].sort();
    if (JSON.stringify(changedFiles) !== JSON.stringify(evidenceFiles)) {
      throw new Error('Git diff files do not match accepted durable evidence.');
    }
    return createPullRequestPreview({
      title: value.title,
      baseBranch: value.baseBranch,
      headBranch: value.headBranch,
      acceptedTaskIds,
      evidenceHashes,
      baseCommit,
      integrationCommit,
      baseTree: baseTree.stdout.trim(),
      integrationTree: integrationTree.stdout.trim(),
      changedFiles,
      diffStat: stat.stdout.trim(),
      diffHash: createHash('sha256').update(diffBytes).digest('hex'),
    });
  }

  async appendEvent(event: SafeEvent): Promise<unknown> {
    const bindings = await this.currentBindings();
    if (!bindings || event.taskId !== bindings.taskId) throw new Error('Unknown task event rejected.');
    this.#events.push(structuredClone(event));
    return { eventId: event.eventId };
  }

  async events(after?: string): Promise<readonly SafeEvent[]> {
    if (!this.execution && this.executionStore) this.execution = await this.executionStore.load();
    const terminalStatus = this.execution?.status === 'accepted' || this.execution?.status === 'rejected'
      ? this.execution.status : undefined;
    const durable: SafeEvent[] = this.execution && terminalStatus
      && this.execution.leaseId.startsWith('lease-')
      ? [{
        eventId: `event-${this.execution.leaseId.slice('lease-'.length)}`,
        type: terminalStatus === 'accepted' ? 'verification' as const : 'drift' as const,
        status: terminalStatus,
        taskId: this.execution.taskId,
        reasonCode: terminalStatus === 'accepted' ? 'check_passed' as const : 'drift_found' as const,
        timestamp: new Date(0).toISOString(),
        summary: terminalStatus === 'accepted' ? 'Check passed.' as const : 'Drift found.' as const,
      }] : [];
    const merged = [...this.#events, ...durable.filter((event) =>
      !this.#events.some((current) => current.eventId === event.eventId))];
    const index = after ? merged.findIndex((event) => event.eventId === after) : -1;
    return structuredClone(merged.slice(index + 1));
  }
}

export function unleasedArtifact(input: Readonly<{
  version?: number;
  graphSnapshotId: string;
  graphContentHash: string;
  taskId: string;
}>): ExecutionControlArtifact {
  return {
    version: input.version ?? 1,
    ...input,
    leaseId: 'unleased',
    leaseHash: digest(`${input.graphContentHash}:${input.taskId}:unleased`),
  };
}
