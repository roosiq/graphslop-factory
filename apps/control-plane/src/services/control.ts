const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const ownerCommands = [
  'submit-message',
  'edit-intent-graph',
  'resolve-question',
  'review-intent',
  'approve-intent',
  'propose-solution',
  'review-solution',
  'approve-solution',
  'compile-execution',
  'dispatch-task',
  'authorize-repair',
  'preview-pull-request',
] as const;

export type OwnerCommand = typeof ownerCommands[number];

export type ExactBindings = Readonly<{
  stage: 'execution';
  projectId: string;
  lifecycleState: string;
  graphSnapshotId: string;
  graphContentHash: string;
  intentBaselineId: string;
  intentBaselineHash: string;
  solutionBaselineId: string;
  solutionBaselineHash: string;
  projectionId: string;
  projectionHash: string;
  taskId: string;
  leaseId: string;
  leaseHash: string;
}>;

export type StageBindings = ExactBindings | Readonly<Record<string, string>>;

export type CommandEnvelope = Readonly<{
  bindings: StageBindings;
  input: unknown;
  capability?: string;
}>;

export const eventTypes = ['progress', 'task', 'verification', 'drift'] as const;
export const eventStatuses = ['pending', 'running', 'accepted', 'rejected', 'blocked'] as const;
export const eventReasons = [
  'task_ready',
  'task_started',
  'task_finished',
  'check_started',
  'check_passed',
  'check_failed',
  'drift_found',
  'owner_decision_required',
] as const;
export const eventSummaries = [
  'Work is ready.',
  'Work started.',
  'Work finished.',
  'Check started.',
  'Check passed.',
  'Check failed.',
  'Drift found.',
  'Waiting for owner.',
] as const;

export type SafeEvent = Readonly<{
  eventId: string;
  type: typeof eventTypes[number];
  status: typeof eventStatuses[number];
  taskId: string;
  reasonCode: typeof eventReasons[number];
  timestamp: string;
  summary: typeof eventSummaries[number];
}>;
export type RunnerEventInput = Omit<SafeEvent, 'eventId'>;

export type CommandResult =
  | Readonly<{ ok: true; result: unknown; nextBindings?: readonly Readonly<{ command: OwnerCommand; bindings: StageBindings; capability: string }>[] }>
  | Readonly<{ ok: false; code: 'stale_binding' }>;

export interface ControlAdapter {
  readProject(): Promise<unknown>;
  readNextBindings?(): Promise<readonly Readonly<{ command: OwnerCommand; bindings: StageBindings; capability: string }>[]>;
  commandAtomic(command: OwnerCommand, envelope: CommandEnvelope): Promise<CommandResult>;
  runnerEvent(event: SafeEvent): Promise<unknown>;
  readEvents(after?: string): Promise<readonly SafeEvent[]>;
}

export function isOwnerCommand(value: string): value is OwnerCommand {
  return ownerCommands.includes(value as OwnerCommand);
}

const stageFields: Readonly<Record<OwnerCommand, readonly string[]>> = {
  'submit-message': ['stage', 'projectId', 'lifecycleState', 'messageHeadHash'],
  'edit-intent-graph': ['stage', 'projectId', 'lifecycleState', 'intentSnapshotId', 'intentHash', 'questionId'],
  'resolve-question': ['stage', 'projectId', 'lifecycleState', 'intentSnapshotId', 'intentHash', 'questionId'],
  'review-intent': ['stage', 'projectId', 'lifecycleState', 'intentSnapshotId', 'intentHash', 'questionId'],
  'approve-intent': ['stage', 'projectId', 'lifecycleState', 'intentSnapshotId', 'intentHash', 'projectionId', 'projectionHash'],
  'propose-solution': ['stage', 'projectId', 'lifecycleState', 'intentBaselineId', 'intentBaselineHash'],
  'review-solution': ['stage', 'projectId', 'lifecycleState', 'intentBaselineId', 'intentBaselineHash', 'solutionSnapshotId', 'solutionHash'],
  'approve-solution': ['stage', 'projectId', 'lifecycleState', 'intentBaselineId', 'intentBaselineHash', 'solutionSnapshotId', 'solutionHash', 'projectionId', 'projectionHash'],
  'compile-execution': ['stage', 'projectId', 'lifecycleState', 'intentBaselineId', 'intentBaselineHash', 'solutionBaselineId', 'solutionBaselineHash', 'projectionId', 'projectionHash'],
  'dispatch-task': ['stage', 'projectId', 'lifecycleState', 'graphSnapshotId', 'graphContentHash', 'intentBaselineId', 'intentBaselineHash', 'solutionBaselineId', 'solutionBaselineHash', 'projectionId', 'projectionHash', 'taskId', 'leaseId', 'leaseHash'],
  'authorize-repair': ['stage', 'projectId', 'lifecycleState', 'graphSnapshotId', 'graphContentHash', 'intentBaselineId', 'intentBaselineHash', 'solutionBaselineId', 'solutionBaselineHash', 'projectionId', 'projectionHash', 'taskId', 'leaseId', 'leaseHash'],
  'preview-pull-request': ['stage', 'projectId', 'lifecycleState', 'graphSnapshotId', 'graphContentHash', 'intentBaselineId', 'intentBaselineHash', 'solutionBaselineId', 'solutionBaselineHash', 'projectionId', 'projectionHash', 'taskId', 'leaseId', 'leaseHash'],
};

const stageName: Readonly<Record<OwnerCommand, string>> = {
  'submit-message': 'conversation',
  'edit-intent-graph': 'intent-discovery',
  'resolve-question': 'intent-discovery',
  'review-intent': 'intent-discovery',
  'approve-intent': 'intent-review',
  'propose-solution': 'intent-approved',
  'review-solution': 'solution-review',
  'approve-solution': 'solution-review',
  'compile-execution': 'solution-approved',
  'dispatch-task': 'execution',
  'authorize-repair': 'execution',
  'preview-pull-request': 'execution',
};

export function parseEnvelope(value: unknown, command: OwnerCommand): CommandEnvelope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const bindings = record.bindings;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return undefined;
  const item = bindings as Record<string, unknown>;
  const fields = stageFields[command];
  if (Object.keys(item).length !== fields.length || fields.some((key) => typeof item[key] !== 'string')) return undefined;
  if (item.stage !== stageName[command]) return undefined;
  for (const [key, field] of Object.entries(item)) {
    if (key.endsWith('Hash') && !HASH.test(field as string)) return undefined;
    if (!key.endsWith('Hash') && key !== 'lifecycleState' && key !== 'stage' && !ID.test(field as string)) return undefined;
  }
  if (record.capability !== undefined && (typeof record.capability !== 'string' || record.capability.length < 24)) return undefined;
  return {
    bindings: item as StageBindings,
    input: record.input,
    ...(typeof record.capability === 'string' ? { capability: record.capability } : {}),
  };
}

export function parseSafeEvent(value: unknown): SafeEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const exactKeys = ['eventId', 'type', 'status', 'taskId', 'reasonCode', 'timestamp', 'summary'];
  if (Object.keys(item).length !== exactKeys.length || Object.keys(item).some((key) => !exactKeys.includes(key))) {
    return undefined;
  }
  const summary = typeof item.summary === 'string' ? redactBoundedSummary(item.summary) : '';
  if (
    typeof item.eventId !== 'string' || !ID.test(item.eventId)
    || !eventTypes.includes(item.type as typeof eventTypes[number])
    || !eventStatuses.includes(item.status as typeof eventStatuses[number])
    || typeof item.taskId !== 'string' || !ID.test(item.taskId)
    || !eventReasons.includes(item.reasonCode as typeof eventReasons[number])
    || typeof item.timestamp !== 'string' || Number.isNaN(Date.parse(item.timestamp))
    || !eventSummaries.includes(summary as typeof eventSummaries[number])
  ) return undefined;
  return {
    eventId: item.eventId,
    type: item.type as SafeEvent['type'],
    status: item.status as SafeEvent['status'],
    taskId: item.taskId,
    reasonCode: item.reasonCode as SafeEvent['reasonCode'],
    timestamp: item.timestamp,
    summary: summary as SafeEvent['summary'],
  };
}

export function parseRunnerEvent(value: unknown, eventId: string): SafeEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if ('eventId' in value) return undefined;
  return parseSafeEvent({ ...value, eventId });
}

export function redactBoundedSummary(value: string): string {
  return value
    .slice(0, 2_000)
    .replace(/\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+\S+/gi, '[redacted]')
    .replace(/\b(?:sk[-_]|ghp_)[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|access_token|key|api_key|secret|password|client_secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/"(?:token|secret|password|private_key|client_secret|DATABASE_URL)"\s*:\s*"[^"]*"/gi, '"secret":"[redacted]"')
    .replace(/\b(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/g, 'SECRET=[redacted]')
    .replace(/(?<![:/])\/(?:[^/\s"',]+\/)+[^/\s"',]*/g, '[local-path]')
    .replace(/[A-Za-z]:\\[^\s"',]*/g, '[local-path]');
}
