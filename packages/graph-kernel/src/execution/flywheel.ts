import {
  createMissingWorkReport,
  evaluateCompleteness,
  schedulerInputForCompleteness,
  type CompletenessReport,
  type FactoryAction,
  type MissingWorkReport,
} from './completeness.js';
import { scheduleExecutionTasks, type SchedulerResult, type SchedulerTask } from './scheduler.js';

export type FactoryAdvance = {
  /** Exactly one pure next move; this function performs none of them. */
  readonly action: FactoryAction;
  readonly reason: string;
  readonly refs: readonly string[];
  readonly completeness: CompletenessReport;
  readonly missingWork: MissingWorkReport | null;
  readonly scheduler: SchedulerResult;
};

function sorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function decision(
  action: FactoryAction,
  reason: string,
  refs: readonly string[],
  completeness: CompletenessReport,
  missingWork: MissingWorkReport | null,
  scheduler: SchedulerResult,
): FactoryAdvance {
  return { action, reason, refs: sorted(refs), completeness, missingWork, scheduler };
}

function taskMap(input: unknown): ReadonlyMap<string, SchedulerTask> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return new Map();
  const tasks = (input as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) return new Map();
  return new Map(tasks.filter((task): task is SchedulerTask => task !== null && typeof task === 'object' && !Array.isArray(task)
    && typeof (task as Record<string, unknown>).id === 'string').map((task) => [task.id, task]));
}

function openBlockingDrift(input: unknown): readonly Record<string, unknown>[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return [];
  const drift = (input as Record<string, unknown>).drift;
  if (!Array.isArray(drift)) return [];
  return drift.filter((record): record is Record<string, unknown> => record !== null && typeof record === 'object' && !Array.isArray(record)
    && record.status === 'open' && record.severity === 'blocking').sort((left, right) =>
      String(left.id).localeCompare(String(right.id)),
    );
}

/**
 * Evaluate a normalized closure projection only. This helper is pure, but it
 * is not the factory authority: it does not receive or validate graph
 * snapshots. External callers must use advanceFactory from factory.ts.
 */
export function advanceProjection(input: unknown): FactoryAdvance {
  const completeness = evaluateCompleteness(input);
  const missingWork = createMissingWorkReport(completeness);
  const scheduler = scheduleExecutionTasks(schedulerInputForCompleteness(input));
  if (!completeness.valid || !scheduler.valid) {
    const refs = [
      ...completeness.gaps.invalidInputIssues.flatMap((entry) => entry.refs),
      ...scheduler.issues.flatMap((entry) => entry.taskIds),
    ];
    return decision('block_invalid_state', 'Closure state is invalid, duplicate, dangling, or cyclic and is blocked.', refs, completeness, missingWork, scheduler);
  }

  const tasks = taskMap(input);
  if (completeness.gaps.pendingBaselineChangeRefs.length > 0
    || completeness.gaps.compiledBaselineMismatchRefs.length > 0
    || completeness.gaps.staleTaskIds.length > 0
    || completeness.gaps.staleEvidenceIds.length > 0
    || completeness.gaps.staleSystemCheckIds.length > 0) {
    return decision(
      'impact_analysis',
      'A baseline change is pending or compiled work, evidence, or checks are stale.',
      [
        ...completeness.gaps.pendingBaselineChangeRefs,
        ...completeness.gaps.compiledBaselineMismatchRefs,
        ...completeness.gaps.staleTaskIds,
        ...completeness.gaps.staleEvidenceIds,
        ...completeness.gaps.staleSystemCheckIds,
      ],
      completeness,
      missingWork,
      scheduler,
    );
  }

  const producedTaskIds = [...tasks.values()]
    .filter((task) => task.status === 'produced')
    .map((task) => task.id)
    .sort();
  if (producedTaskIds.length > 0) {
    return decision(
      'verify_task',
      'Produced work must receive an independent Check-role verification before acceptance.',
      producedTaskIds,
      completeness,
      missingWork,
      scheduler,
    );
  }

  const activeTaskIds = [...tasks.values()]
    .filter((task) => task.status === 'leased' || task.status === 'running' || task.status === 'verifying')
    .map((task) => task.id)
    .sort();
  if (activeTaskIds.length > 0) {
    return decision(
      'wait_for_active_task',
      'One task is leased, running, or verifying; wait for its bounded lifecycle result.',
      activeTaskIds,
      completeness,
      missingWork,
      scheduler,
    );
  }

  const blockingDrift = openBlockingDrift(input);
  if (blockingDrift.length > 0) {
    const driftWithoutRepair = blockingDrift.find((record) => record.repairTaskId === null);
    if (driftWithoutRepair) {
      return decision(
        'propose_repair',
        'Blocking drift has no bounded Repair task yet.',
        [String(driftWithoutRepair.id)],
        completeness,
        missingWork,
        scheduler,
      );
    }
    const proposedRepair = blockingDrift.find((record) => {
      const repairTaskId = typeof record.repairTaskId === 'string' ? record.repairTaskId : null;
      const repairTask = repairTaskId === null ? undefined : tasks.get(repairTaskId);
      return repairTask?.type === 'Repair'
        && (repairTask.status === 'repair_proposed' || repairTask.ownerAuthorization === 'not_authorized')
        && record.repairAuthorization === 'not_authorized';
    });
    if (proposedRepair) {
      return decision(
        'request_repair_authorization',
        'Blocking drift has a proposed Repair task that remains non-dispatchable without owner authorization.',
        [String(proposedRepair.id), String(proposedRepair.repairTaskId)],
        completeness,
        missingWork,
        scheduler,
      );
    }

    const selectedTask = scheduler.selectedTaskId === null ? undefined : tasks.get(scheduler.selectedTaskId);
    const matchingSelectedRepair = blockingDrift.find((record) => record.repairTaskId === selectedTask?.id);
    if (matchingSelectedRepair && selectedTask?.type === 'Repair' && selectedTask.ownerAuthorization === 'authorized') {
      return decision(
        'execute_repair',
        'The scheduler selected an explicitly owner-authorized ready Repair task for blocking drift.',
        [String(matchingSelectedRepair.id), selectedTask.id],
        completeness,
        missingWork,
        scheduler,
      );
    }

    return decision(
      'missing_work',
      'Blocking drift has an authorized Repair task, but that task is not safely dispatchable yet.',
      blockingDrift.map((record) => String(record.id)),
      completeness,
      missingWork,
      scheduler,
    );
  }

  const solutionCompilationRefs = [
    ...completeness.gaps.uncoveredRequiredIntentIds,
    ...completeness.gaps.requiredSolutionIdsWithoutIntentTrace,
  ];
  if (solutionCompilationRefs.length > 0) {
    return decision(
      'recompile_solution',
      'Required Intent-to-Solution traces are missing.',
      solutionCompilationRefs,
      completeness,
      missingWork,
      scheduler,
    );
  }
  const executionCompilationRefs = [
    ...completeness.gaps.requiredSolutionIdsWithoutExecutionTrace,
    ...completeness.gaps.uncoveredRequiredTaskIds,
  ];
  if (executionCompilationRefs.length > 0) {
    return decision(
      'recompile_execution',
      'Required Solution-to-Execution traces are missing.',
      executionCompilationRefs,
      completeness,
      missingWork,
      scheduler,
    );
  }

  if (scheduler.selectedTaskId !== null) {
    return decision(
      'execute_task',
      'The scheduler selected one safe task by stable topological order and task ID.',
      [scheduler.selectedTaskId],
      completeness,
      missingWork,
      scheduler,
    );
  }

  if (completeness.gaps.failedOrMissingRequiredSystemCheckIds.length > 0) {
    return decision(
      'run_system_check',
      'Required system checks are missing or failed.',
      completeness.gaps.failedOrMissingRequiredSystemCheckIds,
      completeness,
      missingWork,
      scheduler,
    );
  }
  if (completeness.gaps.unresolvedBlockingDecisionOrQuestionIds.length > 0) {
    return decision(
      'owner_decision',
      'A blocking decision or question remains unresolved.',
      completeness.gaps.unresolvedBlockingDecisionOrQuestionIds,
      completeness,
      missingWork,
      scheduler,
    );
  }
  if (completeness.complete) {
    return decision('complete', 'Every required closure gap is empty.', [], completeness, null, scheduler);
  }
  return decision(
    'missing_work',
    'The project is incomplete and has no safe next action.',
    [],
    completeness,
    missingWork,
    scheduler,
  );
}
