import { graphMetamodelRegistry } from '@graphslop/contracts';

/** The exact task types allowed by the approved Execution graph metamodel. */
export const schedulerTaskTypes = [...graphMetamodelRegistry.graphs.execution.nodeTypes] as const;
export type SchedulerTaskType = (typeof schedulerTaskTypes)[number];

/** The complete TaskContract lifecycle, including the explicit repair state. */
export const schedulerTaskStatuses = [
  'proposed',
  'blocked',
  'ready',
  'authorized',
  'leased',
  'running',
  'produced',
  'verifying',
  'accepted',
  'failed',
  'repair_proposed',
  'discarded',
] as const;
export type SchedulerTaskStatus = (typeof schedulerTaskStatuses)[number];

/** A baseline identity and its exact approved content hash. */
export type SchedulerBaselineRef = {
  readonly baselineId: string;
  readonly contentHash: string;
};

/** Authorization is explicit; a ready status by itself grants no authority. */
export type SchedulerOwnerAuthorization = 'authorized' | 'not_authorized';

/** The scheduling subset of a portable Execution TaskContract. */
export type SchedulerTask = {
  readonly id: string;
  readonly type: SchedulerTaskType;
  readonly status: SchedulerTaskStatus;
  readonly dependencies: readonly string[];
  readonly protectedIntentBaseline: SchedulerBaselineRef;
  readonly protectedSolutionBaseline: SchedulerBaselineRef;
  readonly ownerAuthorization: SchedulerOwnerAuthorization;
};

/** All information needed for a deterministic, side-effect-free scheduling pass. */
export type SchedulerInput = {
  readonly tasks: readonly SchedulerTask[];
  readonly currentIntentBaseline: SchedulerBaselineRef;
  readonly currentSolutionBaseline: SchedulerBaselineRef;
};

export type SchedulerIssue = {
  readonly code: string;
  readonly message: string;
  readonly taskIds: readonly string[];
};

export type SchedulerIncompleteReason = {
  readonly code:
    | 'invalid_input'
    | 'cycle'
    | 'active_task_in_progress'
    | 'stale_baseline'
    | 'unauthorized'
    | 'failed_dependency'
    | 'dependency_blocked'
    | 'no_eligible_task';
  readonly message: string;
  readonly taskIds: readonly string[];
};

/** A current scheduling condition that blocks one or more tasks. */
export type SchedulerBlocker = SchedulerIncompleteReason;

export type SchedulerResult = {
  readonly valid: boolean;
  readonly issues: readonly SchedulerIssue[];
  readonly order: readonly string[];
  readonly dispatchableTaskIds: readonly string[];
  readonly selectedTaskId: string | null;
  /** Every material blocker, in a stable priority order, for completeness checks. */
  readonly blockers: readonly SchedulerBlocker[];
  /** The highest-priority blocker when nothing can dispatch; retained for compatibility. */
  readonly incompleteReason: SchedulerIncompleteReason | null;
};

type ParsedInput = {
  readonly tasks: readonly SchedulerTask[];
  readonly currentIntentBaseline: SchedulerBaselineRef;
  readonly currentSolutionBaseline: SchedulerBaselineRef;
};

const identifierPattern = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const hashPattern = /^[a-f0-9]{64}$/;
const activeStatuses = new Set<SchedulerTaskStatus>(['leased', 'running', 'produced', 'verifying']);
const dispatchStatuses = new Set<SchedulerTaskStatus>(['ready', 'authorized']);
const ownerAuthorizedLifecycleStatuses = new Set<SchedulerTaskStatus>([
  'authorized',
  'leased',
  'running',
  'produced',
  'verifying',
  'accepted',
]);
const schedulerTaskTypeSet = new Set<string>(schedulerTaskTypes);
const schedulerTaskStatusSet = new Set<string>(schedulerTaskStatuses);
const authorizationSet = new Set<string>(['authorized', 'not_authorized']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && identifierPattern.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && hashPattern.test(value);
}

function schedulerIssue(code: string, message: string, taskIds: readonly string[] = []): SchedulerIssue {
  return { code, message, taskIds: [...taskIds].sort() };
}

function parseBaseline(value: unknown, label: string, issues: SchedulerIssue[], taskIds: readonly string[]): SchedulerBaselineRef | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['baselineId', 'contentHash'])) {
    issues.push(schedulerIssue('malformed_baseline_ref', `${label} must contain only baselineId and contentHash.`, taskIds));
    return undefined;
  }
  if (!isIdentifier(value.baselineId) || !isHash(value.contentHash)) {
    issues.push(schedulerIssue('malformed_baseline_ref', `${label} must use a portable baseline ID and SHA-256 hash.`, taskIds));
    return undefined;
  }
  return { baselineId: value.baselineId, contentHash: value.contentHash };
}

function parseTask(value: unknown, index: number, issues: SchedulerIssue[]): SchedulerTask | undefined {
  const candidateId = isRecord(value) && isIdentifier(value.id) ? [value.id] : [];
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id',
    'type',
    'status',
    'dependencies',
    'protectedIntentBaseline',
    'protectedSolutionBaseline',
    'ownerAuthorization',
  ])) {
    issues.push(schedulerIssue('malformed_task', `tasks[${index}] must contain the complete scheduler task shape.`, candidateId));
    return undefined;
  }
  if (!isIdentifier(value.id)) {
    issues.push(schedulerIssue('malformed_task_id', `tasks[${index}].id must be a portable identifier.`, candidateId));
  }
  if (typeof value.type !== 'string' || !schedulerTaskTypeSet.has(value.type)) {
    issues.push(schedulerIssue('unknown_task_type', `tasks[${index}].type is not an approved Execution task type.`, candidateId));
  }
  if (typeof value.status !== 'string' || !schedulerTaskStatusSet.has(value.status)) {
    issues.push(schedulerIssue('unknown_task_status', `tasks[${index}].status is not a TaskContract status.`, candidateId));
  }
  if (!Array.isArray(value.dependencies) || !value.dependencies.every(isIdentifier)) {
    issues.push(schedulerIssue('malformed_dependencies', `tasks[${index}].dependencies must be portable task IDs.`, candidateId));
  }
  if (typeof value.ownerAuthorization !== 'string' || !authorizationSet.has(value.ownerAuthorization)) {
    issues.push(schedulerIssue('malformed_owner_authorization', `tasks[${index}].ownerAuthorization must be explicit.`, candidateId));
  }

  const intent = parseBaseline(value.protectedIntentBaseline, `tasks[${index}].protectedIntentBaseline`, issues, candidateId);
  const solution = parseBaseline(value.protectedSolutionBaseline, `tasks[${index}].protectedSolutionBaseline`, issues, candidateId);
  if (!isIdentifier(value.id)
    || typeof value.type !== 'string' || !schedulerTaskTypeSet.has(value.type)
    || typeof value.status !== 'string' || !schedulerTaskStatusSet.has(value.status)
    || !Array.isArray(value.dependencies) || !value.dependencies.every(isIdentifier)
    || typeof value.ownerAuthorization !== 'string' || !authorizationSet.has(value.ownerAuthorization)
    || !intent || !solution) {
    return undefined;
  }

  return {
    id: value.id,
    type: value.type as SchedulerTaskType,
    status: value.status as SchedulerTaskStatus,
    dependencies: [...value.dependencies],
    protectedIntentBaseline: intent,
    protectedSolutionBaseline: solution,
    ownerAuthorization: value.ownerAuthorization as SchedulerOwnerAuthorization,
  };
}

function parseInput(value: unknown, issues: SchedulerIssue[]): ParsedInput | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['tasks', 'currentIntentBaseline', 'currentSolutionBaseline'])) {
    issues.push(schedulerIssue('invalid_scheduler_input', 'Scheduler input must contain only tasks and current baseline references.'));
    return undefined;
  }
  if (!Array.isArray(value.tasks)) {
    issues.push(schedulerIssue('invalid_scheduler_input', 'tasks must be an array.', []));
    return undefined;
  }
  const currentIntentBaseline = parseBaseline(value.currentIntentBaseline, 'currentIntentBaseline', issues, []);
  const currentSolutionBaseline = parseBaseline(value.currentSolutionBaseline, 'currentSolutionBaseline', issues, []);
  const tasks = value.tasks.map((task, index) => parseTask(task, index, issues)).filter((task): task is SchedulerTask => task !== undefined);
  if (!currentIntentBaseline || !currentSolutionBaseline || tasks.length !== value.tasks.length) return undefined;
  return { tasks, currentIntentBaseline, currentSolutionBaseline };
}

function sameBaseline(left: SchedulerBaselineRef, right: SchedulerBaselineRef): boolean {
  return left.baselineId === right.baselineId && left.contentHash === right.contentHash;
}

function bindsCurrentBaselines(task: SchedulerTask, input: ParsedInput): boolean {
  return sameBaseline(task.protectedIntentBaseline, input.currentIntentBaseline)
    && sameBaseline(task.protectedSolutionBaseline, input.currentSolutionBaseline);
}

type DependencyClosureState = {
  readonly staleAcceptedIds: readonly string[];
  readonly failedOrDiscardedIds: readonly string[];
  readonly unfinishedIds: readonly string[];
};

/** The graph is already acyclic here; walk every upstream dependency once. */
function dependencyClosureState(
  task: SchedulerTask,
  tasksById: ReadonlyMap<string, SchedulerTask>,
  input: ParsedInput,
): DependencyClosureState {
  const staleAcceptedIds = new Set<string>();
  const failedOrDiscardedIds = new Set<string>();
  const unfinishedIds = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    const dependency = tasksById.get(taskId);
    if (!dependency) return;
    if (dependency.status === 'accepted') {
      if (!bindsCurrentBaselines(dependency, input)) staleAcceptedIds.add(dependency.id);
    } else if (dependency.status === 'failed' || dependency.status === 'discarded') {
      failedOrDiscardedIds.add(dependency.id);
    } else {
      unfinishedIds.add(dependency.id);
    }
    for (const dependencyId of dependency.dependencies) visit(dependencyId);
  };
  for (const dependencyId of task.dependencies) visit(dependencyId);
  return {
    staleAcceptedIds: [...staleAcceptedIds].sort(),
    failedOrDiscardedIds: [...failedOrDiscardedIds].sort(),
    unfinishedIds: [...unfinishedIds].sort(),
  };
}

function validateDependencies(tasks: readonly SchedulerTask[], issues: SchedulerIssue[]): void {
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      issues.push(schedulerIssue('duplicate_task_id', 'Task IDs must be unique.', [task.id]));
    }
    taskIds.add(task.id);
    if (task.ownerAuthorization === 'not_authorized' && ownerAuthorizedLifecycleStatuses.has(task.status)) {
      issues.push(schedulerIssue(
        'unauthorized_lifecycle_claim',
        'A task without owner authorization cannot claim an authorized, active, or accepted lifecycle state.',
        [task.id],
      ));
    }
  }
  for (const task of tasks) {
    const dependencyIds = new Set<string>();
    for (const dependencyId of task.dependencies) {
      if (dependencyIds.has(dependencyId)) {
        issues.push(schedulerIssue(
          'duplicate_dependency',
          `Task ${task.id} lists dependency ${dependencyId} more than once.`,
          [task.id, dependencyId],
        ));
        continue;
      }
      dependencyIds.add(dependencyId);
      if (dependencyId === task.id) {
        issues.push(schedulerIssue('self_dependency', 'A task may not depend on itself.', [task.id]));
      } else if (!taskIds.has(dependencyId)) {
        issues.push(schedulerIssue('missing_dependency', 'A task dependency does not exist.', [task.id, dependencyId]));
      }
    }
  }
  const activeTaskIds = tasks.filter((task) => activeStatuses.has(task.status)).map((task) => task.id);
  if (activeTaskIds.length > 1) {
    issues.push(schedulerIssue('multiple_active_tasks', 'Only one task may be leased, running, produced, or verifying.', activeTaskIds));
  }
}

function stableTopologicalOrder(tasks: readonly SchedulerTask[]): { readonly order: readonly string[]; readonly cycleTaskIds: readonly string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map(tasks.map((task) => [task.id, task.dependencies.length]));
  const dependants = new Map(tasks.map((task) => [task.id, [] as string[]]));
  for (const task of tasks) {
    for (const dependencyId of task.dependencies) dependants.get(dependencyId)?.push(task.id);
  }

  const ready = tasks.filter((task) => incoming.get(task.id) === 0).map((task) => task.id).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const taskId = ready.shift();
    if (taskId === undefined) break;
    order.push(taskId);
    for (const dependantId of dependants.get(taskId) ?? []) {
      const remaining = (incoming.get(dependantId) ?? 0) - 1;
      incoming.set(dependantId, remaining);
      if (remaining === 0) {
        ready.push(dependantId);
        ready.sort();
      }
    }
  }
  if (order.length === tasks.length) return { order, cycleTaskIds: [] };
  return { order, cycleTaskIds: findCycleTaskIds(tasks) };
}

/** Report actual cycle members, not merely their downstream blocked dependants. */
function findCycleTaskIds(tasks: readonly SchedulerTask[]): readonly string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const cycleTaskIds = new Set<string>();

  const visit = (taskId: string): void => {
    const current = state.get(taskId);
    if (current === 'visiting') {
      for (const cycleTaskId of stack.slice(stack.indexOf(taskId))) cycleTaskIds.add(cycleTaskId);
      return;
    }
    if (current === 'visited') return;
    state.set(taskId, 'visiting');
    stack.push(taskId);
    for (const dependencyId of byId.get(taskId)?.dependencies ?? []) visit(dependencyId);
    stack.pop();
    state.set(taskId, 'visited');
  };

  for (const taskId of [...byId.keys()].sort()) visit(taskId);
  return [...cycleTaskIds].sort();
}

function incompleteReason(
  code: SchedulerIncompleteReason['code'],
  message: string,
  taskIds: readonly string[] = [],
): SchedulerIncompleteReason {
  return { code, message, taskIds: [...taskIds].sort() };
}

function invalidInputBlocker(issues: readonly SchedulerIssue[]): SchedulerBlocker {
  return incompleteReason(
    'invalid_input',
    'Scheduler input is invalid and cannot be dispatched.',
    [...new Set(issues.flatMap((issue) => issue.taskIds))],
  );
}

/**
 * Validate and select at most one safe Execution task. This function is pure:
 * it executes nothing, changes no task lifecycle state, and does not mutate input.
 */
export function scheduleExecutionTasks(input: unknown): SchedulerResult {
  const issues: SchedulerIssue[] = [];
  const parsed = parseInput(input, issues);
  if (!parsed) {
    const blockers = [invalidInputBlocker(issues)];
    return {
      valid: false,
      issues,
      order: [],
      dispatchableTaskIds: [],
      selectedTaskId: null,
      blockers,
      incompleteReason: blockers[0],
    };
  }

  validateDependencies(parsed.tasks, issues);
  if (issues.length > 0) {
    const blockers = [invalidInputBlocker(issues)];
    return {
      valid: false,
      issues,
      order: [],
      dispatchableTaskIds: [],
      selectedTaskId: null,
      blockers,
      incompleteReason: blockers[0],
    };
  }

  const topology = stableTopologicalOrder(parsed.tasks);
  if (topology.cycleTaskIds.length > 0) {
    const cycleIssue = schedulerIssue('dependency_cycle', 'Execution dependencies must form an acyclic graph.', topology.cycleTaskIds);
    const blockers = [incompleteReason('cycle', cycleIssue.message, topology.cycleTaskIds)];
    return {
      valid: false,
      issues: [cycleIssue],
      order: [],
      dispatchableTaskIds: [],
      selectedTaskId: null,
      blockers,
      incompleteReason: blockers[0],
    };
  }

  const activeTaskIds = parsed.tasks.filter((task) => activeStatuses.has(task.status)).map((task) => task.id).sort();
  const byId = new Map(parsed.tasks.map((task) => [task.id, task]));
  const eligible = topology.order.map((taskId) => byId.get(taskId)).filter((task): task is SchedulerTask => task !== undefined)
    .filter((task) => dispatchStatuses.has(task.status));
  const staleTaskIds = eligible.filter((task) => !bindsCurrentBaselines(task, parsed)).map((task) => task.id);
  const dependencyStateByTaskId = new Map(
    eligible.map((task) => [task.id, dependencyClosureState(task, byId, parsed)]),
  );
  const staleDependencySourceIds = [...new Set(
    [...dependencyStateByTaskId.values()].flatMap((state) => state.staleAcceptedIds),
  )].sort();
  const staleDependencyTaskIds = eligible
    .filter((task) => (dependencyStateByTaskId.get(task.id)?.staleAcceptedIds.length ?? 0) > 0)
    .map((task) => task.id);
  const staleBaselineTaskIds = [...new Set([...staleTaskIds, ...staleDependencySourceIds])].sort();
  const unauthorizedTaskIds = eligible.filter((task) => task.ownerAuthorization !== 'authorized').map((task) => task.id);
  const failedDependencyTaskIds = eligible
    .filter((task) => (dependencyStateByTaskId.get(task.id)?.failedOrDiscardedIds.length ?? 0) > 0)
    .map((task) => task.id);
  const unfinishedDependencyTaskIds = eligible
    .filter((task) => (dependencyStateByTaskId.get(task.id)?.unfinishedIds.length ?? 0) > 0)
    .map((task) => task.id);
  const dependencyBlockedTaskIds = [...new Set([...unfinishedDependencyTaskIds, ...staleDependencyTaskIds])].sort();

  const blockers = [
    activeTaskIds.length > 0
      ? incompleteReason('active_task_in_progress', 'A task is already active, so no additional task can be dispatched.', activeTaskIds)
      : null,
    staleBaselineTaskIds.length > 0
      ? incompleteReason('stale_baseline', 'Eligible tasks or accepted dependencies do not bind the exact current baselines.', staleBaselineTaskIds)
      : null,
    unauthorizedTaskIds.length > 0
      ? incompleteReason('unauthorized', 'Eligible tasks require explicit owner authorization.', unauthorizedTaskIds)
      : null,
    failedDependencyTaskIds.length > 0
      ? incompleteReason('failed_dependency', 'Eligible tasks depend on failed or discarded work.', failedDependencyTaskIds)
      : null,
    dependencyBlockedTaskIds.length > 0
      ? incompleteReason('dependency_blocked', 'Eligible tasks are waiting for fresh accepted dependencies.', dependencyBlockedTaskIds)
      : null,
    eligible.length === 0
      ? incompleteReason('no_eligible_task', 'No task is in a pre-dispatch status.')
      : null,
  ].filter((reason): reason is SchedulerBlocker => reason !== null);

  const readyTaskIds = eligible.filter((task) =>
    !staleTaskIds.includes(task.id)
    && !unauthorizedTaskIds.includes(task.id)
    && !failedDependencyTaskIds.includes(task.id)
    && !dependencyBlockedTaskIds.includes(task.id),
  ).map((task) => task.id);
  const dispatchableTaskIds = activeTaskIds.length === 0 ? readyTaskIds : [];
  if (dispatchableTaskIds.length > 0) {
    return {
      valid: true,
      issues: [],
      order: topology.order,
      dispatchableTaskIds,
      selectedTaskId: dispatchableTaskIds[0] ?? null,
      blockers,
      incompleteReason: null,
    };
  }

  const reason = blockers[0]
    ?? incompleteReason('no_eligible_task', 'No task is in a pre-dispatch status.');
  return {
    valid: true,
    issues: [],
    order: topology.order,
    dispatchableTaskIds: [],
    selectedTaskId: null,
    blockers: blockers.length > 0 ? blockers : [reason],
    incompleteReason: reason,
  };
}

/** Compatibility alias for callers that use the shorter scheduler name. */
export const scheduleExecution = scheduleExecutionTasks;
