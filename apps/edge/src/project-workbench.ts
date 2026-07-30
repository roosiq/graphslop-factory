import { DurableObject } from 'cloudflare:workers';

import {
  ProjectService,
  ProjectServiceError,
  type IntentGraphEdit,
  type ProjectOwnerActor,
} from '@graphslop/control-state';
import {
  ProjectConversationStateSchema,
  ProposalOutputSchema,
  SolutionProposalOutputSchema,
  type ApprovalRecord,
  type ProjectConversationState,
  type ProposalOutput,
  type SolutionProposalOutput,
} from '@graphslop/contracts';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type HostedCommand =
  | 'submit-message'
  | 'edit-intent-graph'
  | 'resolve-question'
  | 'review-intent'
  | 'approve-intent'
  | 'propose-solution'
  | 'review-solution'
  | 'approve-solution'
  | 'compile-execution';

export type ProjectView = Readonly<{
  state: ProjectConversationState;
  revision: number;
  nextBindings: readonly Readonly<{
    command: HostedCommand;
    bindings: Readonly<{ projectId: string; revision: string }>;
    capability: string;
  }>[];
  pendingJob: ModelJobSummary | null;
}>;

export type ModelJobSummary = Readonly<{
  jobId: string;
  kind: 'submit-message' | 'resolve-question' | 'propose-solution';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stale';
  createdAt: string;
  updatedAt: string;
  error: string | null;
}>;

type ModelJobRow = Readonly<{
  job_id: string;
  kind: 'submit-message' | 'resolve-question' | 'propose-solution';
  status: ModelJobSummary['status'];
  actor_id: string;
  expected_revision: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
  error: string | null;
}>;

export type ModelJobDetail = ModelJobSummary & Readonly<{
  projectId: string;
  expectedRevision: number;
  proposalContext?: Readonly<{
    message: Readonly<{
      messageId: string;
      projectId: string;
      actor: 'owner';
      content: string;
      createdAt: string;
    }>;
    priorIntentNodes: readonly Readonly<{ stableId: string; statement: string }>[];
    priorQuestions: readonly Readonly<{
      text: string;
      category: string;
      disposition: 'open' | 'answered' | 'deferred';
      ownerContent?: string;
    }>[];
  }>;
  solutionContext?: Readonly<{
    intentNodes: readonly Readonly<{ id: string; type: string; statement: string }>[];
  }>;
  resolution?: Readonly<{ questionId: string; content: string }>;
}>;

type CommandInput = Readonly<{
  actorId: string;
  role: ProjectRole;
  expectedRevision: number;
  command: HostedCommand;
  input: unknown;
}>;

type CreateProjectInput = Readonly<{
  projectId: string;
  displayName: string;
  actorId: string;
  createdAt: string;
}>;

type CreateJobResult = Readonly<{ job: ModelJobSummary; queueMessage: Readonly<{ jobId: string; projectId: string }> }>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectServiceError('invalid_trace', 'Command input must be an object.');
  }
  return value as Record<string, unknown>;
}

function ownerActor(actorId: string): ProjectOwnerActor {
  return { actorId, actorKind: 'authenticated_project_owner' };
}

function makeState(input: CreateProjectInput): ProjectConversationState {
  return ProjectConversationStateSchema.parse({
    project: {
      schemaVersion: '1.0.0',
      projectId: input.projectId,
      displayName: input.displayName,
      lifecycleState: 'CAPTURE',
      activeIntentBaselineId: null,
      activeSolutionBaselineId: null,
      activeExecutionSnapshotId: null,
      connectedRepository: null,
      integrationCommit: null,
      activeLeaseId: null,
      runnerEnrollmentId: null,
      currentQuestionId: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
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
  });
}

function summary(row: ModelJobRow): ModelJobSummary {
  return {
    jobId: row.job_id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
  };
}

function allowedCommands(state: ProjectConversationState, pending: ModelJobSummary | null): HostedCommand[] {
  const output: HostedCommand[] = [];
  const lifecycle = state.project.lifecycleState;
  if (!pending && (lifecycle === 'CAPTURE' || lifecycle === 'DISCOVERY')) output.push('submit-message');
  if (state.intentGraph && (lifecycle === 'DISCOVERY' || lifecycle === 'INTENT_REVIEW')) {
    output.push('edit-intent-graph');
    if (state.currentQuestion && !pending) output.push('resolve-question');
    if (!state.currentQuestion) output.push('review-intent');
  }
  const latestIntentProjection = [...state.projections].reverse().find((item) =>
    item.graphKind === 'intent' && item.snapshotId === state.intentGraph?.snapshotId);
  if (lifecycle === 'INTENT_REVIEW' && latestIntentProjection) output.push('approve-intent');
  if (lifecycle === 'INTENT_APPROVED' && !pending) output.push('propose-solution');
  if (lifecycle === 'SOLUTION_REVIEW' && state.solutionGraph) {
    output.push('review-solution');
    const latestSolutionProjection = [...state.projections].reverse().find((item) =>
      item.graphKind === 'solution' && item.snapshotId === state.solutionGraph?.snapshotId);
    if (latestSolutionProjection) output.push('approve-solution');
  }
  if (lifecycle === 'SOLUTION_APPROVED') output.push('compile-execution');
  return [...new Set(output)];
}

export class ProjectWorkbench extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS project_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workbench_migrations (
          migration_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS model_jobs (
          job_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('submit-message', 'resolve-question', 'propose-solution')),
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stale')),
          actor_id TEXT NOT NULL,
          expected_revision INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS model_jobs_status ON model_jobs(status, created_at);
      `);
      const modelJobsSchema = this.ctx.storage.sql.exec<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'model_jobs'`,
      ).toArray()[0]?.sql ?? '';
      if (!modelJobsSchema.includes('propose-solution')) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(`
            CREATE TABLE model_jobs_next (
              job_id TEXT PRIMARY KEY,
              kind TEXT NOT NULL CHECK (kind IN ('submit-message', 'resolve-question', 'propose-solution')),
              status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stale')),
              actor_id TEXT NOT NULL,
              expected_revision INTEGER NOT NULL,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              error TEXT
            );
            INSERT INTO model_jobs_next
              (job_id, kind, status, actor_id, expected_revision, payload_json, created_at, updated_at, error)
            SELECT job_id, kind, status, actor_id, expected_revision, payload_json, created_at, updated_at, error
            FROM model_jobs;
            DROP TABLE model_jobs;
            ALTER TABLE model_jobs_next RENAME TO model_jobs;
            CREATE INDEX model_jobs_status ON model_jobs(status, created_at);
          `);
        });
      }
      const rolesMigration = this.ctx.storage.sql.exec<{ migration_id: string }>(
        `SELECT migration_id FROM workbench_migrations WHERE migration_id = 'require-solution-roles-v1'`,
      ).toArray()[0];
      if (!rolesMigration) {
        this.ctx.storage.transactionSync(() => {
          const row = this.ctx.storage.sql.exec<{ revision: number; state_json: string }>(
            'SELECT revision, state_json FROM project_state WHERE singleton = 1',
          ).toArray()[0];
          if (row) {
            const state = ProjectConversationStateSchema.parse(JSON.parse(row.state_json));
            const legacySolution = state.solutionGraph
              && !state.solutionGraph.nodes.some((node) => node.type === 'Role');
            if (legacySolution && state.project.activeIntentBaselineId) {
              const updatedAt = new Date().toISOString();
              const migrated = ProjectConversationStateSchema.parse({
                ...state,
                project: {
                  ...state.project,
                  lifecycleState: 'INTENT_APPROVED',
                  activeSolutionBaselineId: null,
                  activeExecutionSnapshotId: null,
                  activeLeaseId: null,
                  currentQuestionId: null,
                  updatedAt,
                  closedAt: null,
                },
                solutionGraph: null,
                executionGraph: null,
                currentQuestion: null,
              });
              this.ctx.storage.sql.exec(`
                UPDATE project_state
                SET revision = ?, state_json = ?, updated_at = ?
                WHERE singleton = 1 AND revision = ?
              `, row.revision + 1, JSON.stringify(migrated), updatedAt, row.revision);
            }
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO workbench_migrations (migration_id, applied_at) VALUES (?, ?)`,
            'require-solution-roles-v1',
            new Date().toISOString(),
          );
        });
      }
    });
  }

  create(input: CreateProjectInput): string {
    const current = this.row();
    if (current) return JSON.stringify(this.viewFrom(current.state, current.revision));
    const state = makeState(input);
    this.ctx.storage.sql.exec(
      `INSERT INTO project_state (singleton, revision, state_json, updated_at) VALUES (1, 1, ?, ?)`,
      JSON.stringify(state),
      input.createdAt,
    );
    return JSON.stringify(this.viewFrom(state, 1));
  }

  read(): string {
    const current = this.requiredRow();
    return JSON.stringify(this.viewFrom(current.state, current.revision));
  }

  command(input: CommandInput): string {
    this.requireWriteRole(input.role);
    if (input.command === 'submit-message') {
      throw new ProjectServiceError('wrong_state', 'Message interpretation must use a model job.');
    }
    if (input.command === 'propose-solution') {
      throw new ProjectServiceError('wrong_state', 'Solution planning must use a model job.');
    }
    if (input.command === 'resolve-question') {
      const value = record(input.input);
      if (value.disposition === 'answered') {
        throw new ProjectServiceError('wrong_state', 'Answered questions must use a model job.');
      }
    }
    if ((input.command === 'approve-intent' || input.command === 'approve-solution') && input.role !== 'owner') {
      throw new ProjectServiceError('invalid_approval', 'Only a project owner can freeze a baseline.');
    }

    const current = this.requiredRow();
    if (current.revision !== input.expectedRevision) {
      throw new ProjectServiceError('wrong_state', 'The project changed before this command.');
    }
    const service = this.service(current.state, input.actorId);
    const value = record(input.input);
    switch (input.command) {
      case 'edit-intent-graph':
        service.editIntentGraph(input.input as IntentGraphEdit);
        break;
      case 'resolve-question':
        service.resolveCurrentQuestion(
          String(value.questionId ?? ''),
          'deferred',
          typeof value.content === 'string' ? value.content : 'Deferred by project owner.',
          false,
        );
        break;
      case 'review-intent':
        service.createReviewProjection('intent');
        break;
      case 'approve-intent':
        service.approve('intent', this.boundApproval(input.input, input.actorId));
        break;
      case 'review-solution':
        service.createReviewProjection('solution');
        break;
      case 'approve-solution':
        service.approve('solution', this.boundApproval(input.input, input.actorId));
        break;
      case 'compile-execution':
        service.compileExecution();
        break;
    }
    const next = service.state();
    const revision = this.persist(next, current.revision);
    return JSON.stringify(this.viewFrom(next, revision));
  }

  createModelJob(input: CommandInput): CreateJobResult {
    this.requireWriteRole(input.role);
    if (!['submit-message', 'resolve-question', 'propose-solution'].includes(input.command)) {
      throw new ProjectServiceError('wrong_state', 'This command does not use the model queue.');
    }
    const current = this.requiredRow();
    if (current.revision !== input.expectedRevision) {
      throw new ProjectServiceError('wrong_state', 'The project changed before this model job.');
    }
    if (this.pendingJob()) throw new ProjectServiceError('wrong_state', 'This project already has a model job running.');
    const value = record(input.input);
    if (input.command !== 'propose-solution' && (typeof value.content !== 'string' || !value.content.trim())) {
      throw new ProjectServiceError('invalid_trace', 'Message content is required.');
    }
    if (input.command === 'resolve-question') {
      const question = current.state.currentQuestion;
      if (
        value.disposition !== 'answered'
        || typeof value.questionId !== 'string'
        || value.questionId !== question?.questionId
      ) throw new ProjectServiceError('wrong_state', 'The exact current question must be answered.');
    }
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(`
      INSERT INTO model_jobs (
        job_id, kind, status, actor_id, expected_revision, payload_json, created_at, updated_at, error
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, NULL)
    `, jobId, input.command, input.actorId, current.revision, JSON.stringify(input.input), now, now);
    const job = this.jobRow(jobId)!;
    return {
      job: summary(job),
      queueMessage: { jobId, projectId: current.state.project.projectId },
    };
  }

  modelJob(jobId: string): ModelJobDetail | null {
    const job = this.jobRow(jobId);
    if (!job) return null;
    const current = this.requiredRow();
    const payload = record(JSON.parse(job.payload_json));
    const content = String(payload.content ?? '');
    const messageId = crypto.randomUUID();
    const priorQuestions = [
      ...current.state.questionResolutions.flatMap((resolution) => resolution.questionText ? [{
        text: resolution.questionText,
        category: resolution.category ?? 'Scope',
        disposition: resolution.disposition,
        ...(resolution.ownerContent ? { ownerContent: resolution.ownerContent } : {}),
      }] : []),
      ...(current.state.currentQuestion ? [{
        text: current.state.currentQuestion.text,
        category: current.state.currentQuestion.category,
        disposition: 'open' as const,
      }] : []),
    ];
    const base = {
      ...summary(job),
      projectId: current.state.project.projectId,
      expectedRevision: job.expected_revision,
    };
    if (job.kind === 'propose-solution') {
      return {
        ...base,
        solutionContext: {
          intentNodes: current.state.intentGraph?.nodes
            .filter((node) => node.type !== 'Question' && !['rejected', 'superseded'].includes(node.status))
            .map((node) => ({ id: node.id, type: node.type, statement: node.statementOrName })) ?? [],
        },
      };
    }
    return {
      ...base,
      proposalContext: {
        message: {
          messageId,
          projectId: current.state.project.projectId,
          actor: 'owner',
          content,
          createdAt: new Date().toISOString(),
        },
        priorIntentNodes: current.state.intentGraph?.nodes.map((node) => ({
          stableId: node.stableId,
          statement: node.statementOrName,
        })) ?? [],
        priorQuestions,
      },
      ...(job.kind === 'resolve-question' ? {
        resolution: { questionId: String(payload.questionId ?? ''), content },
      } : {}),
    };
  }

  markModelJobRunning(jobId: string): ModelJobSummary | null {
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE model_jobs SET status = 'running', updated_at = ? WHERE job_id = ? AND status = 'queued'`,
      now,
      jobId,
    );
    const job = this.jobRow(jobId);
    return job ? summary(job) : null;
  }

  async completeModelJob(jobId: string, proposalValue: unknown): Promise<number> {
    const job = this.jobRow(jobId);
    if (!job || !['queued', 'running'].includes(job.status)) {
      throw new ProjectServiceError('wrong_state', 'Model job is not active.');
    }
    const current = this.requiredRow();
    if (current.revision !== job.expected_revision) {
      this.finishJob(jobId, 'stale', 'Project changed while the model was working.');
      throw new ProjectServiceError('wrong_state', 'Model result is stale.');
    }
    const proposal = job.kind === 'propose-solution'
      ? SolutionProposalOutputSchema.parse(proposalValue)
      : ProposalOutputSchema.parse(proposalValue);
    const service = this.service(
      current.state,
      job.actor_id,
      job.kind === 'propose-solution' ? undefined : proposal as ProposalOutput,
    );
    const payload = record(JSON.parse(job.payload_json));
    if (job.kind === 'submit-message') {
      await service.submitMessage(String(payload.content ?? ''));
    } else if (job.kind === 'resolve-question') {
      await service.resolveCurrentQuestion(
        String(payload.questionId ?? ''),
        'answered',
        String(payload.content ?? ''),
        true,
      );
    } else {
      service.proposeSolution(proposal as SolutionProposalOutput);
    }
    const next = service.state();
    const revision = this.persist(next, current.revision);
    this.finishJob(jobId, 'completed', null);
    return revision;
  }

  failModelJob(jobId: string, reason: string): ModelJobSummary | null {
    this.finishJob(jobId, 'failed', reason.slice(0, 500));
    const job = this.jobRow(jobId);
    return job ? summary(job) : null;
  }

  private service(state: ProjectConversationState, actorId: string, proposal?: ProposalOutput): ProjectService {
    return new ProjectService(
      state,
      {
        propose: async () => {
          if (!proposal) throw new ProjectServiceError('provider_failed', 'No model proposal was supplied.');
          return proposal;
        },
      },
      {
        nextId: (kind) => `${kind}-${crypto.randomUUID()}`,
        now: () => new Date().toISOString(),
      },
      undefined,
      ownerActor(actorId),
    );
  }

  private boundApproval(value: unknown, actorId: string): ApprovalRecord {
    const input = record(value);
    return {
      ...input,
      actorId,
      actorKind: 'authenticated_project_owner',
    } as ApprovalRecord;
  }

  private row(): { revision: number; state: ProjectConversationState } | null {
    const row = this.ctx.storage.sql.exec<{ revision: number; state_json: string }>(
      'SELECT revision, state_json FROM project_state WHERE singleton = 1',
    ).toArray()[0];
    return row ? {
      revision: row.revision,
      state: ProjectConversationStateSchema.parse(JSON.parse(row.state_json)),
    } : null;
  }

  private requiredRow(): { revision: number; state: ProjectConversationState } {
    const row = this.row();
    if (!row) throw new ProjectServiceError('wrong_state', 'Project has not been initialized.');
    return row;
  }

  private persist(state: ProjectConversationState, priorRevision: number): number {
    const revision = priorRevision + 1;
    this.ctx.storage.sql.exec(`
      UPDATE project_state
      SET revision = ?, state_json = ?, updated_at = ?
      WHERE singleton = 1 AND revision = ?
    `, revision, JSON.stringify(state), new Date().toISOString(), priorRevision);
    const stored = this.ctx.storage.sql.exec<{ revision: number }>(
      'SELECT revision FROM project_state WHERE singleton = 1',
    ).toArray()[0];
    if (stored?.revision !== revision) throw new ProjectServiceError('wrong_state', 'Project revision changed.');
    return revision;
  }

  private pendingJob(): ModelJobSummary | null {
    const row = this.ctx.storage.sql.exec<ModelJobRow>(`
      SELECT * FROM model_jobs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).toArray()[0];
    return row ? summary(row) : null;
  }

  private jobRow(jobId: string): ModelJobRow | null {
    return this.ctx.storage.sql.exec<ModelJobRow>(
      'SELECT * FROM model_jobs WHERE job_id = ?',
      jobId,
    ).toArray()[0] ?? null;
  }

  private finishJob(jobId: string, status: 'completed' | 'failed' | 'stale', error: string | null): void {
    this.ctx.storage.sql.exec(
      `UPDATE model_jobs
       SET status = ?, updated_at = ?, error = ?
       WHERE job_id = ? AND status IN ('queued', 'running')`,
      status,
      new Date().toISOString(),
      error,
      jobId,
    );
  }

  private viewFrom(state: ProjectConversationState, revision: number): ProjectView {
    const pendingJob = this.pendingJob();
    return {
      state,
      revision,
      pendingJob,
      nextBindings: allowedCommands(state, pendingJob).map((command) => ({
        command,
        bindings: { projectId: state.project.projectId, revision: String(revision) },
        capability: `revision-${revision}`,
      })),
    };
  }

  private requireWriteRole(role: ProjectRole): void {
    if (role === 'viewer') throw new ProjectServiceError('wrong_state', 'Viewer access is read-only.');
  }
}
