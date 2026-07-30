import {
  scheduleExecutionTasks,
  type SchedulerBaselineRef,
  type SchedulerBlocker,
  type SchedulerIssue,
  type SchedulerResult,
  type SchedulerTask,
} from './scheduler.js';

/** Evidence can be supplied by an independent check or a named system check. */
export const completenessEvidenceProvenances = ['independent_verifier', 'system'] as const;
export type CompletenessEvidenceProvenance = (typeof completenessEvidenceProvenances)[number];

export const completenessEvidenceOutcomes = ['pass', 'fail'] as const;
export type CompletenessEvidenceOutcome = (typeof completenessEvidenceOutcomes)[number];

/** A compact durable observation used only for completion closure. */
export type EvidenceRecord = {
  readonly id: string;
  readonly taskId?: string;
  readonly successCriterionId?: string;
  /** The exact approved baseline pair the observation was made against. */
  readonly intentBaseline: SchedulerBaselineRef;
  readonly solutionBaseline: SchedulerBaselineRef;
  readonly outcome: CompletenessEvidenceOutcome;
  readonly provenance: CompletenessEvidenceProvenance;
  readonly provenanceId: string;
  readonly provenanceRole: 'Check' | 'System';
  /** Required for independent task verification and must differ from provenanceId. */
  readonly producerId?: string;
};

export const driftStatuses = ['open', 'resolved'] as const;
export type DriftStatus = (typeof driftStatuses)[number];

export const driftSeverities = ['blocking', 'important', 'advisory'] as const;
export type DriftSeverity = (typeof driftSeverities)[number];

export const repairAuthorizationStatuses = ['authorized', 'not_authorized', 'not_applicable'] as const;
export type RepairAuthorizationStatus = (typeof repairAuthorizationStatuses)[number];

/** The closure only needs an open/resolved severity, task, and repair authority binding. */
export type DriftRecord = {
  readonly id: string;
  readonly status: DriftStatus;
  readonly severity: DriftSeverity;
  readonly taskId: string;
  readonly repairTaskId: string | null;
  readonly repairAuthorization: RepairAuthorizationStatus;
};

export type SystemCheck = {
  readonly id: string;
  /** System checks may not be reused after either approved baseline changes. */
  readonly intentBaseline: SchedulerBaselineRef;
  readonly solutionBaseline: SchedulerBaselineRef;
  readonly outcome: CompletenessEvidenceOutcome;
};

export type BlockingDecisionOrQuestion = {
  readonly id: string;
  readonly kind: 'decision' | 'question';
  readonly status: 'resolved' | 'unresolved';
  readonly blocking: boolean;
};

/** A complete, explicit input to deterministic closure evaluation. */
export type CompletenessInput = {
  readonly tasks: readonly SchedulerTask[];
  readonly currentIntentBaseline: SchedulerBaselineRef;
  readonly currentSolutionBaseline: SchedulerBaselineRef;
  /** The exact approved pair used to compile this Execution graph. */
  readonly compiledIntentBaseline: SchedulerBaselineRef;
  readonly compiledSolutionBaseline: SchedulerBaselineRef;
  readonly requiredIntentNodeIds: readonly string[];
  readonly requiredSolutionNodeIds: readonly string[];
  readonly requiredTaskIds: readonly string[];
  readonly requiredSuccessCriterionIds: readonly string[];
  readonly requiredSystemCheckIds: readonly string[];
  readonly taskProducers: readonly TaskProducerBinding[];
  readonly solutionScopes: readonly SolutionScopeBinding[];
  readonly solutionSupports: readonly SolutionSupport[];
  readonly solutionToIntentTraces: readonly SolutionToIntentTrace[];
  readonly taskToSolutionTraces: readonly TaskToSolutionTrace[];
  readonly evidence: readonly EvidenceRecord[];
  readonly drift: readonly DriftRecord[];
  readonly systemChecks: readonly SystemCheck[];
  readonly decisions: readonly BlockingDecisionOrQuestion[];
  /** A proposed successor baseline pauses affected work before it can be dispatched. */
  readonly pendingBaselineChange: boolean;
};

export type SolutionToIntentTrace = {
  readonly solutionId: string;
  readonly intentId: string;
};

/** Scope belongs to the Solution node, never to a trace edge. */
export type SolutionScopeBinding = {
  readonly solutionId: string;
  readonly scope: 'product' | 'implementation_support';
};

/** An internal Solution may close through a transitive supports path. */
export type SolutionSupport = {
  readonly supportId: string;
  readonly supportedSolutionId: string;
};

export type TaskProducerBinding = {
  readonly taskId: string;
  readonly producerId: string;
};

export type TaskToSolutionTrace = {
  readonly taskId: string;
  readonly solutionId: string;
};

export type CompletenessIssue = {
  readonly code: string;
  readonly message: string;
  readonly refs: readonly string[];
};

/** Each collection is stable and names a single reason that closure is incomplete. */
export type CompletenessGaps = {
  readonly uncoveredRequiredIntentIds: readonly string[];
  /** Required Solution nodes that do not trace back to an approved Intent node. */
  readonly requiredSolutionIdsWithoutIntentTrace: readonly string[];
  /** Required Solution nodes that are not yet covered by an Execution task. */
  readonly requiredSolutionIdsWithoutExecutionTrace: readonly string[];
  readonly uncoveredRequiredTaskIds: readonly string[];
  readonly unacceptedRequiredTaskIds: readonly string[];
  readonly acceptedTaskIdsWithoutIndependentPassingEvidence: readonly string[];
  readonly successCriterionIdsWithoutPassingEvidence: readonly string[];
  readonly openBlockingDriftIds: readonly string[];
  readonly blockingDriftWithoutRepairIds: readonly string[];
  readonly blockingDriftAwaitingAuthorizationIds: readonly string[];
  readonly blockingDriftDispatchableRepairIds: readonly string[];
  readonly blockingDriftBlockedRepairIds: readonly string[];
  readonly staleTaskIds: readonly string[];
  readonly staleEvidenceIds: readonly string[];
  readonly staleSystemCheckIds: readonly string[];
  readonly compiledBaselineMismatchRefs: readonly string[];
  readonly failedOrMissingRequiredSystemCheckIds: readonly string[];
  readonly unresolvedBlockingDecisionOrQuestionIds: readonly string[];
  readonly pendingBaselineChangeRefs: readonly string[];
  readonly schedulerIssues: readonly SchedulerIssue[];
  readonly schedulerBlockers: readonly SchedulerBlocker[];
  readonly invalidInputIssues: readonly CompletenessIssue[];
};

export type CompletenessReport = {
  readonly valid: boolean;
  readonly complete: boolean;
  readonly gaps: CompletenessGaps;
};

export const factoryActions = [
  'block_invalid_state',
  'impact_analysis',
  'verify_task',
  'wait_for_active_task',
  'propose_repair',
  'request_repair_authorization',
  'execute_repair',
  'recompile_solution',
  'recompile_execution',
  'execute_task',
  'owner_decision',
  'run_system_check',
  'missing_work',
  'complete',
] as const;
export type FactoryAction = (typeof factoryActions)[number];

export type MissingWorkRoute = {
  readonly action: FactoryAction;
  readonly reason: string;
  readonly refs: readonly string[];
};

/** An incomplete project always retains every closure gap and proposed safe routes. */
export type MissingWorkReport = {
  readonly incomplete: true;
  readonly gaps: CompletenessGaps;
  readonly suggestedRoutes: readonly MissingWorkRoute[];
};

type ParsedCompletenessInput = CompletenessInput;

const identifierPattern = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const hashPattern = /^[a-f0-9]{64}$/;
const evidenceProvenanceSet = new Set<string>(completenessEvidenceProvenances);
const evidenceOutcomeSet = new Set<string>(completenessEvidenceOutcomes);
const driftStatusSet = new Set<string>(driftStatuses);
const driftSeveritySet = new Set<string>(driftSeverities);
const repairAuthorizationSet = new Set<string>(repairAuthorizationStatuses);

const completenessInputKeys = [
  'tasks',
  'currentIntentBaseline',
  'currentSolutionBaseline',
  'compiledIntentBaseline',
  'compiledSolutionBaseline',
  'requiredIntentNodeIds',
  'requiredSolutionNodeIds',
  'requiredTaskIds',
  'requiredSuccessCriterionIds',
  'requiredSystemCheckIds',
  'taskProducers',
  'solutionScopes',
  'solutionSupports',
  'solutionToIntentTraces',
  'taskToSolutionTraces',
  'evidence',
  'drift',
  'systemChecks',
  'decisions',
  'pendingBaselineChange',
] as const;

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

function sorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function issue(code: string, message: string, refs: readonly string[] = []): CompletenessIssue {
  return { code, message, refs: sorted(refs) };
}

function sortIssues(issues: readonly CompletenessIssue[]): readonly CompletenessIssue[] {
  return [...issues].sort((left, right) =>
    left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
    || left.refs.join('\u0000').localeCompare(right.refs.join('\u0000')),
  );
}

function parseIdentifierList(
  value: unknown,
  label: string,
  issues: CompletenessIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every(isIdentifier)) {
    issues.push(issue('malformed_identifier_list', `${label} must be an array of portable identifiers.`));
    return undefined;
  }
  const duplicates = value.filter((entry, index) => value.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    issues.push(issue('duplicate_identifier', `${label} must not repeat an identifier.`, duplicates));
    return undefined;
  }
  return [...value];
}

function parseBaseline(value: unknown, label: string, issues: CompletenessIssue[]): SchedulerBaselineRef | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['baselineId', 'contentHash'])
    || !isIdentifier(value.baselineId) || !isHash(value.contentHash)) {
    issues.push(issue('malformed_baseline_ref', `${label} must contain only a portable baselineId and SHA-256 contentHash.`));
    return undefined;
  }
  return { baselineId: value.baselineId, contentHash: value.contentHash };
}

function parseSolutionToIntentTraces(value: unknown, issues: CompletenessIssue[]): readonly SolutionToIntentTrace[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_solution_to_intent_traces', 'solutionToIntentTraces must be an array.'));
    return undefined;
  }
  const traces: SolutionToIntentTrace[] = [];
  const duplicateKeys: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['solutionId', 'intentId'])
      || !isIdentifier(entry.solutionId) || !isIdentifier(entry.intentId)) {
      issues.push(issue('malformed_solution_to_intent_trace', `solutionToIntentTraces[${index}] must contain solutionId and intentId.`, []));
      return;
    }
    const key = `${entry.solutionId}\u0000${entry.intentId}`;
    if (seen.has(key)) duplicateKeys.push(`${entry.solutionId}:${entry.intentId}`);
    seen.add(key);
    traces.push({ solutionId: entry.solutionId, intentId: entry.intentId });
  });
  if (duplicateKeys.length > 0) issues.push(issue('duplicate_solution_to_intent_trace', 'Solution-to-Intent traces must be unique.', duplicateKeys));
  return issues.some((entry) => entry.code === 'malformed_solution_to_intent_trace' || entry.code === 'duplicate_solution_to_intent_trace')
    ? undefined
    : traces;
}

function parseSolutionScopes(value: unknown, issues: CompletenessIssue[]): readonly SolutionScopeBinding[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_solution_scopes', 'solutionScopes must be an array.'));
    return undefined;
  }
  const bindings: SolutionScopeBinding[] = [];
  const seen = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['solutionId', 'scope']) || !isIdentifier(entry.solutionId)
      || (entry.scope !== 'product' && entry.scope !== 'implementation_support')) {
      issues.push(issue('malformed_solution_scope', `solutionScopes[${index}] must contain a Solution ID and approved scope.`));
      invalid = true;
      return;
    }
    if (seen.has(entry.solutionId)) {
      issues.push(issue('duplicate_solution_scope', 'Each required Solution needs exactly one scope binding.', [entry.solutionId]));
      invalid = true;
      return;
    }
    seen.add(entry.solutionId);
    bindings.push({ solutionId: entry.solutionId, scope: entry.scope });
  });
  return invalid ? undefined : bindings;
}

function parseSolutionSupports(value: unknown, issues: CompletenessIssue[]): readonly SolutionSupport[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_solution_supports', 'solutionSupports must be an array.'));
    return undefined;
  }
  const supports: SolutionSupport[] = [];
  const seen = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['supportId', 'supportedSolutionId'])
      || !isIdentifier(entry.supportId) || !isIdentifier(entry.supportedSolutionId)) {
      issues.push(issue('malformed_solution_support', `solutionSupports[${index}] must contain supportId and supportedSolutionId.`));
      invalid = true;
      return;
    }
    const key = `${entry.supportId}\u0000${entry.supportedSolutionId}`;
    if (seen.has(key)) {
      issues.push(issue('duplicate_solution_support', 'Solution supports edges must be unique.', [entry.supportId, entry.supportedSolutionId]));
      invalid = true;
      return;
    }
    seen.add(key);
    supports.push({ supportId: entry.supportId, supportedSolutionId: entry.supportedSolutionId });
  });
  return invalid ? undefined : supports;
}

function parseTaskProducers(value: unknown, issues: CompletenessIssue[]): readonly TaskProducerBinding[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_task_producers', 'taskProducers must be an array.'));
    return undefined;
  }
  const bindings: TaskProducerBinding[] = [];
  const seen = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['taskId', 'producerId'])
      || !isIdentifier(entry.taskId) || !isIdentifier(entry.producerId)) {
      issues.push(issue('malformed_task_producer', `taskProducers[${index}] must contain taskId and producerId.`));
      invalid = true;
      return;
    }
    if (seen.has(entry.taskId)) {
      issues.push(issue('duplicate_task_producer', 'Each task may have one authoritative producer.', [entry.taskId]));
      invalid = true;
      return;
    }
    seen.add(entry.taskId);
    bindings.push({ taskId: entry.taskId, producerId: entry.producerId });
  });
  return invalid ? undefined : bindings;
}

function parseTaskToSolutionTraces(value: unknown, issues: CompletenessIssue[]): readonly TaskToSolutionTrace[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_task_to_solution_traces', 'taskToSolutionTraces must be an array.'));
    return undefined;
  }
  const traces: TaskToSolutionTrace[] = [];
  const duplicateKeys: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['taskId', 'solutionId'])
      || !isIdentifier(entry.taskId) || !isIdentifier(entry.solutionId)) {
      issues.push(issue('malformed_task_to_solution_trace', `taskToSolutionTraces[${index}] must contain taskId and solutionId.`));
      return;
    }
    const key = `${entry.taskId}\u0000${entry.solutionId}`;
    if (seen.has(key)) duplicateKeys.push(`${entry.taskId}:${entry.solutionId}`);
    seen.add(key);
    traces.push({ taskId: entry.taskId, solutionId: entry.solutionId });
  });
  if (duplicateKeys.length > 0) issues.push(issue('duplicate_task_to_solution_trace', 'Task-to-Solution traces must be unique.', duplicateKeys));
  return issues.some((entry) => entry.code === 'malformed_task_to_solution_trace' || entry.code === 'duplicate_task_to_solution_trace')
    ? undefined
    : traces;
}

function parseEvidence(value: unknown, issues: CompletenessIssue[]): readonly EvidenceRecord[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_evidence', 'evidence must be an array.'));
    return undefined;
  }
  const evidence: EvidenceRecord[] = [];
  const ids = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    const candidateId = isRecord(entry) && isIdentifier(entry.id) ? [entry.id] : [];
    if (!isRecord(entry)) {
      issues.push(issue('malformed_evidence_record', `evidence[${index}] has an unknown or missing field.`, candidateId));
      invalid = true;
      return;
    }
    const requiredKeys = [
      'id',
      'intentBaseline',
      'solutionBaseline',
      'outcome',
      'provenance',
      'provenanceId',
      'provenanceRole',
    ];
    const optionalKeys = ['taskId', 'successCriterionId', 'producerId'];
    const allowedPresentKeys = [...requiredKeys, ...optionalKeys.filter((key) => Object.hasOwn(entry, key))];
    if (!hasOnlyKeys(entry, allowedPresentKeys)) {
      issues.push(issue('malformed_evidence_record', `evidence[${index}] has an unknown or missing field.`, candidateId));
      invalid = true;
      return;
    }
    const taskId = entry.taskId;
    const successCriterionId = entry.successCriterionId;
    const hasTask = taskId !== undefined;
    const hasSuccessCriterion = successCriterionId !== undefined;
    const independent = entry.provenance === 'independent_verifier';
    const system = entry.provenance === 'system';
    const intentBaseline = parseBaseline(entry.intentBaseline, `evidence[${index}].intentBaseline`, issues);
    const solutionBaseline = parseBaseline(entry.solutionBaseline, `evidence[${index}].solutionBaseline`, issues);
    const valid = isIdentifier(entry.id)
      && (!hasTask || isIdentifier(taskId))
      && (!hasSuccessCriterion || isIdentifier(successCriterionId))
      && hasTask !== hasSuccessCriterion
      && intentBaseline !== undefined
      && solutionBaseline !== undefined
      && typeof entry.outcome === 'string' && evidenceOutcomeSet.has(entry.outcome)
      && typeof entry.provenance === 'string' && evidenceProvenanceSet.has(entry.provenance)
      && isIdentifier(entry.provenanceId)
      && (independent ? entry.provenanceRole === 'Check' && isIdentifier(entry.producerId) : system && entry.provenanceRole === 'System' && entry.producerId === undefined);
    if (!valid) {
      issues.push(issue('malformed_evidence_record', `evidence[${index}] must identify exactly one task or success criterion and valid provenance.`, candidateId));
      invalid = true;
      return;
    }
    const evidenceId = entry.id as string;
    const provenanceId = entry.provenanceId as string;
    if (ids.has(evidenceId)) {
      issues.push(issue('duplicate_evidence_id', 'Evidence IDs must be unique.', [evidenceId]));
      invalid = true;
      return;
    }
    ids.add(evidenceId);
    evidence.push({
      id: evidenceId,
      ...(hasTask ? { taskId: taskId as string } : { successCriterionId: successCriterionId as string }),
      intentBaseline: intentBaseline as SchedulerBaselineRef,
      solutionBaseline: solutionBaseline as SchedulerBaselineRef,
      outcome: entry.outcome as CompletenessEvidenceOutcome,
      provenance: entry.provenance as CompletenessEvidenceProvenance,
      provenanceId,
      provenanceRole: entry.provenanceRole as 'Check' | 'System',
      ...(independent ? { producerId: entry.producerId as string } : {}),
    });
  });
  return invalid ? undefined : evidence;
}

function parseDrift(value: unknown, issues: CompletenessIssue[]): readonly DriftRecord[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_drift', 'drift must be an array.'));
    return undefined;
  }
  const drift: DriftRecord[] = [];
  const ids = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    const candidateId = isRecord(entry) && isIdentifier(entry.id) ? [entry.id] : [];
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['id', 'status', 'severity', 'taskId', 'repairTaskId', 'repairAuthorization'])) {
      issues.push(issue('malformed_drift_record', `drift[${index}] has an unknown or missing field.`, candidateId));
      invalid = true;
      return;
    }
    const valid = isIdentifier(entry.id)
      && typeof entry.status === 'string' && driftStatusSet.has(entry.status)
      && typeof entry.severity === 'string' && driftSeveritySet.has(entry.severity)
      && isIdentifier(entry.taskId)
      && (entry.repairTaskId === null || isIdentifier(entry.repairTaskId))
      && typeof entry.repairAuthorization === 'string' && repairAuthorizationSet.has(entry.repairAuthorization)
      && (entry.repairTaskId === null ? entry.repairAuthorization === 'not_applicable' : entry.repairAuthorization !== 'not_applicable');
    if (!valid) {
      issues.push(issue('malformed_drift_record', `drift[${index}] must include valid status, severity, task, and repair authority.`, candidateId));
      invalid = true;
      return;
    }
    const driftId = entry.id as string;
    const taskId = entry.taskId as string;
    if (ids.has(driftId)) {
      issues.push(issue('duplicate_drift_id', 'Drift IDs must be unique.', [driftId]));
      invalid = true;
      return;
    }
    ids.add(driftId);
    drift.push({
      id: driftId,
      status: entry.status as DriftStatus,
      severity: entry.severity as DriftSeverity,
      taskId,
      repairTaskId: entry.repairTaskId as string | null,
      repairAuthorization: entry.repairAuthorization as RepairAuthorizationStatus,
    });
  });
  return invalid ? undefined : drift;
}

function parseSystemChecks(value: unknown, issues: CompletenessIssue[]): readonly SystemCheck[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_system_checks', 'systemChecks must be an array.'));
    return undefined;
  }
  const systemChecks: SystemCheck[] = [];
  const ids = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    const candidateId = isRecord(entry) && isIdentifier(entry.id) ? [entry.id] : [];
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['id', 'intentBaseline', 'solutionBaseline', 'outcome'])
      || !isIdentifier(entry.id) || typeof entry.outcome !== 'string' || !evidenceOutcomeSet.has(entry.outcome)) {
      issues.push(issue('malformed_system_check', `systemChecks[${index}] must contain id and pass/fail outcome.`, candidateId));
      invalid = true;
      return;
    }
    const intentBaseline = parseBaseline(entry.intentBaseline, `systemChecks[${index}].intentBaseline`, issues);
    const solutionBaseline = parseBaseline(entry.solutionBaseline, `systemChecks[${index}].solutionBaseline`, issues);
    if (!intentBaseline || !solutionBaseline) {
      invalid = true;
      return;
    }
    if (ids.has(entry.id)) {
      issues.push(issue('duplicate_system_check_id', 'System-check IDs must be unique.', [entry.id]));
      invalid = true;
      return;
    }
    ids.add(entry.id);
    systemChecks.push({
      id: entry.id,
      intentBaseline,
      solutionBaseline,
      outcome: entry.outcome as CompletenessEvidenceOutcome,
    });
  });
  return invalid ? undefined : systemChecks;
}

function parseDecisions(value: unknown, issues: CompletenessIssue[]): readonly BlockingDecisionOrQuestion[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('malformed_decisions', 'decisions must be an array.'));
    return undefined;
  }
  const decisions: BlockingDecisionOrQuestion[] = [];
  const ids = new Set<string>();
  let invalid = false;
  value.forEach((entry, index) => {
    const candidateId = isRecord(entry) && isIdentifier(entry.id) ? [entry.id] : [];
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['id', 'kind', 'status', 'blocking'])
      || !isIdentifier(entry.id)
      || (entry.kind !== 'decision' && entry.kind !== 'question')
      || (entry.status !== 'resolved' && entry.status !== 'unresolved')
      || typeof entry.blocking !== 'boolean') {
      issues.push(issue('malformed_decision', `decisions[${index}] must contain id, decision/question, resolved state, and blocking flag.`, candidateId));
      invalid = true;
      return;
    }
    if (ids.has(entry.id)) {
      issues.push(issue('duplicate_decision_id', 'Decision and question IDs must be unique.', [entry.id]));
      invalid = true;
      return;
    }
    ids.add(entry.id);
    decisions.push({ id: entry.id, kind: entry.kind, status: entry.status, blocking: entry.blocking });
  });
  return invalid ? undefined : decisions;
}

function schedulerInputFrom(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    tasks: value.tasks,
    currentIntentBaseline: value.currentIntentBaseline,
    currentSolutionBaseline: value.currentSolutionBaseline,
  };
}

/** Shared extraction keeps the flywheel and evaluator on the exact scheduler subset. */
export function schedulerInputForCompleteness(value: unknown): unknown {
  return schedulerInputFrom(value);
}

function parseCompletenessInput(value: unknown, scheduler: SchedulerResult, issues: CompletenessIssue[]): ParsedCompletenessInput | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, completenessInputKeys)) {
    issues.push(issue('invalid_completeness_input', 'Completeness input must contain only the complete closure shape.'));
    return undefined;
  }
  if (!scheduler.valid) {
    for (const schedulerIssue of scheduler.issues) {
      issues.push(issue(`scheduler_${schedulerIssue.code}`, schedulerIssue.message, schedulerIssue.taskIds));
    }
  }

  const currentIntentBaseline = parseBaseline(value.currentIntentBaseline, 'currentIntentBaseline', issues);
  const currentSolutionBaseline = parseBaseline(value.currentSolutionBaseline, 'currentSolutionBaseline', issues);
  const compiledIntentBaseline = parseBaseline(value.compiledIntentBaseline, 'compiledIntentBaseline', issues);
  const compiledSolutionBaseline = parseBaseline(value.compiledSolutionBaseline, 'compiledSolutionBaseline', issues);
  const requiredIntentNodeIds = parseIdentifierList(value.requiredIntentNodeIds, 'requiredIntentNodeIds', issues);
  const requiredSolutionNodeIds = parseIdentifierList(value.requiredSolutionNodeIds, 'requiredSolutionNodeIds', issues);
  const requiredTaskIds = parseIdentifierList(value.requiredTaskIds, 'requiredTaskIds', issues);
  const requiredSuccessCriterionIds = parseIdentifierList(value.requiredSuccessCriterionIds, 'requiredSuccessCriterionIds', issues);
  const requiredSystemCheckIds = parseIdentifierList(value.requiredSystemCheckIds, 'requiredSystemCheckIds', issues);
  const taskProducers = parseTaskProducers(value.taskProducers, issues);
  const solutionScopes = parseSolutionScopes(value.solutionScopes, issues);
  const solutionSupports = parseSolutionSupports(value.solutionSupports, issues);
  const solutionToIntentTraces = parseSolutionToIntentTraces(value.solutionToIntentTraces, issues);
  const taskToSolutionTraces = parseTaskToSolutionTraces(value.taskToSolutionTraces, issues);
  const evidence = parseEvidence(value.evidence, issues);
  const drift = parseDrift(value.drift, issues);
  const systemChecks = parseSystemChecks(value.systemChecks, issues);
  const decisions = parseDecisions(value.decisions, issues);
  if (typeof value.pendingBaselineChange !== 'boolean') {
    issues.push(issue('malformed_pending_baseline_change', 'pendingBaselineChange must be a boolean.'));
  }

  if (issues.length > 0
    || !currentIntentBaseline || !currentSolutionBaseline || !compiledIntentBaseline || !compiledSolutionBaseline
    || !requiredIntentNodeIds || !requiredSolutionNodeIds || !requiredTaskIds || !requiredSuccessCriterionIds || !requiredSystemCheckIds || !taskProducers || !solutionScopes || !solutionSupports
    || !solutionToIntentTraces || !taskToSolutionTraces || !evidence || !drift || !systemChecks || !decisions
    || typeof value.pendingBaselineChange !== 'boolean' || !scheduler.valid) {
    return undefined;
  }

  const tasks = value.tasks as readonly SchedulerTask[];
  const taskIds = new Set(tasks.map((task) => task.id));
  const requiredIntentIds = new Set(requiredIntentNodeIds);
  const requiredSolutionIds = new Set(requiredSolutionNodeIds);
  const requiredTaskIdSet = new Set(requiredTaskIds);
  const requiredSuccessCriterionIdSet = new Set(requiredSuccessCriterionIds);
  const requiredSystemCheckIdSet = new Set(requiredSystemCheckIds);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const scopeBySolutionId = new Map(solutionScopes.map((binding) => [binding.solutionId, binding.scope]));
  const producerByTaskId = new Map(taskProducers.map((binding) => [binding.taskId, binding.producerId]));

  for (const taskId of requiredTaskIds) {
    if (!taskIds.has(taskId)) issues.push(issue('dangling_required_task', 'A required task ID does not resolve to a task.', [taskId]));
    if (!producerByTaskId.has(taskId)) issues.push(issue('missing_task_producer', 'Every required task needs an authoritative producer.', [taskId]));
  }
  for (const solutionId of requiredSolutionNodeIds) {
    if (!scopeBySolutionId.has(solutionId)) {
      issues.push(issue('missing_solution_scope', 'Every required Solution needs exactly one scope binding.', [solutionId]));
    }
  }
  for (const binding of solutionScopes) {
    if (!requiredSolutionIds.has(binding.solutionId)) {
      issues.push(issue('dangling_solution_scope', 'Solution scopes may name only required Solution nodes.', [binding.solutionId]));
    }
  }
  for (const support of solutionSupports) {
    if (!requiredSolutionIds.has(support.supportId) || !requiredSolutionIds.has(support.supportedSolutionId)) {
      issues.push(issue('dangling_solution_support', 'Solution supports edges require known required endpoints.', [support.supportId, support.supportedSolutionId]));
    } else if (scopeBySolutionId.get(support.supportId) !== 'implementation_support') {
      issues.push(issue('invalid_solution_support_source', 'Only implementation-support Solutions may support another Solution.', [support.supportId]));
    }
  }
  for (const binding of taskProducers) {
    if (!requiredTaskIdSet.has(binding.taskId)) issues.push(issue('dangling_task_producer', 'Producer bindings may name only required tasks.', [binding.taskId]));
  }
  for (const task of tasks) {
    if (task.status !== 'discarded' && !requiredTaskIdSet.has(task.id)) {
      issues.push(issue('non_discarded_task_not_required', 'Every non-discarded task must be required work.', [task.id]));
    }
  }
  for (const taskId of requiredTaskIds) {
    const task = tasksById.get(taskId);
    if (!task) continue;
    for (const dependencyId of task.dependencies) {
      if (!requiredTaskIdSet.has(dependencyId)) {
        issues.push(issue(
          'required_task_dependency_not_required',
          'Every dependency required by a required task must itself be named as required work.',
          [taskId, dependencyId],
        ));
      }
    }
  }
  for (const trace of solutionToIntentTraces) {
    if (!requiredSolutionIds.has(trace.solutionId) || !requiredIntentIds.has(trace.intentId)) {
      issues.push(issue('dangling_solution_to_intent_trace', 'A Solution-to-Intent trace must bind named required nodes.', [trace.solutionId, trace.intentId]));
    }
  }
  for (const trace of taskToSolutionTraces) {
    if (!requiredTaskIdSet.has(trace.taskId) || !requiredSolutionIds.has(trace.solutionId) || !taskIds.has(trace.taskId)) {
      issues.push(issue('dangling_task_to_solution_trace', 'A task-to-Solution trace must bind a named required task and Solution node.', [trace.taskId, trace.solutionId]));
    }
  }
  for (const record of evidence) {
    if (record.taskId !== undefined && (!taskIds.has(record.taskId) || !requiredTaskIdSet.has(record.taskId)
      || tasksById.get(record.taskId)?.status === 'discarded')) {
      issues.push(issue('dangling_evidence_task', 'Evidence may name only an extant required non-discarded task.', [record.id, record.taskId]));
    }
    if (record.successCriterionId !== undefined && !requiredSuccessCriterionIdSet.has(record.successCriterionId)) {
      issues.push(issue('dangling_evidence_success_criterion', 'Evidence references an unnamed success criterion.', [record.id, record.successCriterionId]));
    }
  }
  for (const record of drift) {
    if (!taskIds.has(record.taskId)) issues.push(issue('dangling_drift_task', 'Drift references a task that does not exist.', [record.id, record.taskId]));
    if (record.repairTaskId !== null) {
      const repairTask = tasks.find((task) => task.id === record.repairTaskId);
      if (!repairTask || repairTask.type !== 'Repair') {
        issues.push(issue('dangling_repair_task', 'Drift repairTaskId must resolve to a Repair task.', [record.id, record.repairTaskId]));
      } else if ((record.repairAuthorization === 'authorized' && repairTask.ownerAuthorization !== 'authorized')
        || (record.repairAuthorization === 'not_authorized' && repairTask.ownerAuthorization !== 'not_authorized')
        || (repairTask.status === 'repair_proposed' && record.repairAuthorization !== 'not_authorized')) {
        issues.push(issue('inconsistent_repair_authorization', 'Repair authorization must match the Repair task authority and lifecycle state.', [record.id, record.repairTaskId]));
      }
    }
  }
  for (const check of systemChecks) {
    if (!requiredSystemCheckIdSet.has(check.id)) {
      issues.push(issue('dangling_system_check', 'A system check is not named as required.', [check.id]));
    }
  }

  if (issues.length > 0) return undefined;
  return {
    tasks,
    currentIntentBaseline,
    currentSolutionBaseline,
    compiledIntentBaseline,
    compiledSolutionBaseline,
    requiredIntentNodeIds,
    requiredSolutionNodeIds,
    requiredTaskIds,
    requiredSuccessCriterionIds,
    requiredSystemCheckIds,
    taskProducers,
    solutionScopes,
    solutionSupports,
    solutionToIntentTraces,
    taskToSolutionTraces,
    evidence,
    drift,
    systemChecks,
    decisions,
    pendingBaselineChange: value.pendingBaselineChange,
  };
}

function emptyGaps(issues: readonly CompletenessIssue[] = []): CompletenessGaps {
  return {
    uncoveredRequiredIntentIds: [],
    requiredSolutionIdsWithoutIntentTrace: [],
    requiredSolutionIdsWithoutExecutionTrace: [],
    uncoveredRequiredTaskIds: [],
    unacceptedRequiredTaskIds: [],
    acceptedTaskIdsWithoutIndependentPassingEvidence: [],
    successCriterionIdsWithoutPassingEvidence: [],
    openBlockingDriftIds: [],
    blockingDriftWithoutRepairIds: [],
    blockingDriftAwaitingAuthorizationIds: [],
    blockingDriftDispatchableRepairIds: [],
    blockingDriftBlockedRepairIds: [],
    staleTaskIds: [],
    staleEvidenceIds: [],
    staleSystemCheckIds: [],
    compiledBaselineMismatchRefs: [],
    failedOrMissingRequiredSystemCheckIds: [],
    unresolvedBlockingDecisionOrQuestionIds: [],
    pendingBaselineChangeRefs: [],
    schedulerIssues: [],
    schedulerBlockers: [],
    invalidInputIssues: sortIssues(issues),
  };
}

function reportFor(gaps: CompletenessGaps): CompletenessReport {
  const complete = gaps.uncoveredRequiredIntentIds.length === 0
    && gaps.requiredSolutionIdsWithoutIntentTrace.length === 0
    && gaps.requiredSolutionIdsWithoutExecutionTrace.length === 0 && gaps.uncoveredRequiredTaskIds.length === 0
    && gaps.unacceptedRequiredTaskIds.length === 0 && gaps.acceptedTaskIdsWithoutIndependentPassingEvidence.length === 0
    && gaps.successCriterionIdsWithoutPassingEvidence.length === 0 && gaps.openBlockingDriftIds.length === 0
    && gaps.staleTaskIds.length === 0 && gaps.staleEvidenceIds.length === 0 && gaps.staleSystemCheckIds.length === 0
    && gaps.compiledBaselineMismatchRefs.length === 0 && gaps.failedOrMissingRequiredSystemCheckIds.length === 0
    && gaps.unresolvedBlockingDecisionOrQuestionIds.length === 0 && gaps.pendingBaselineChangeRefs.length === 0
    && gaps.invalidInputIssues.length === 0;
  return { valid: gaps.invalidInputIssues.length === 0, complete, gaps };
}

function sameBaseline(left: SchedulerBaselineRef, right: SchedulerBaselineRef): boolean {
  return left.baselineId === right.baselineId && left.contentHash === right.contentHash;
}

/**
 * Compute the complete Intent-to-Solution-to-Execution-to-evidence closure.
 * It is pure, names no inferred requirements, and rejects malformed state.
 */
export function evaluateCompleteness(input: unknown): CompletenessReport {
  const scheduler = scheduleExecutionTasks(schedulerInputFrom(input));
  const issues: CompletenessIssue[] = [];
  const parsed = parseCompletenessInput(input, scheduler, issues);
  if (!parsed) return reportFor(emptyGaps(issues));

  const requiredIntentIds = new Set(parsed.requiredIntentNodeIds);
  const requiredSolutionIds = new Set(parsed.requiredSolutionNodeIds);
  const requiredTaskIds = new Set(parsed.requiredTaskIds);
  const scopeBySolutionId = new Map(parsed.solutionScopes.map((binding) => [binding.solutionId, binding.scope]));
  const directProductTraces = parsed.solutionToIntentTraces.filter((trace) => scopeBySolutionId.get(trace.solutionId) === 'product');
  const intentIdsWithSolutionTrace = new Set(directProductTraces.map((trace) => trace.intentId));
  const productSolutionsWithIntentTrace = new Set(directProductTraces.map((trace) => trace.solutionId));
  const supportTargets = new Map<string, string[]>();
  for (const support of parsed.solutionSupports) {
    const targets = supportTargets.get(support.supportId) ?? [];
    targets.push(support.supportedSolutionId);
    supportTargets.set(support.supportId, targets.sort());
  }
  const closesToProduct = (solutionId: string, visiting = new Set<string>()): boolean => {
    if (scopeBySolutionId.get(solutionId) === 'product') return productSolutionsWithIntentTrace.has(solutionId);
    if (scopeBySolutionId.get(solutionId) !== 'implementation_support' || visiting.has(solutionId)) return false;
    const next = new Set(visiting);
    next.add(solutionId);
    return (supportTargets.get(solutionId) ?? []).some((target) => closesToProduct(target, next));
  };
  const solutionIdsWithTaskTrace = new Set(parsed.taskToSolutionTraces.map((trace) => trace.solutionId));
  const taskIdsWithSolutionTrace = new Set(parsed.taskToSolutionTraces.map((trace) => trace.taskId));
  const tasksById = new Map(parsed.tasks.map((task) => [task.id, task]));
  const producerByTaskId = new Map(parsed.taskProducers.map((binding) => [binding.taskId, binding.producerId]));
  const bindsExactBaselines = (record: Pick<EvidenceRecord | SystemCheck, 'intentBaseline' | 'solutionBaseline'>): boolean =>
    sameBaseline(record.intentBaseline, parsed.currentIntentBaseline)
    && sameBaseline(record.intentBaseline, parsed.compiledIntentBaseline)
    && sameBaseline(record.solutionBaseline, parsed.currentSolutionBaseline)
    && sameBaseline(record.solutionBaseline, parsed.compiledSolutionBaseline);
  const passedTaskEvidenceIds = new Set(
    parsed.evidence
      .filter((record) => record.taskId !== undefined
        && requiredTaskIds.has(record.taskId)
        && record.outcome === 'pass'
        && bindsExactBaselines(record)
        && record.provenance === 'independent_verifier'
        && record.provenanceRole === 'Check'
        && record.producerId !== undefined
        && producerByTaskId.get(record.taskId) === record.producerId
        && record.producerId !== record.provenanceId)
      .map((record) => record.taskId as string),
  );
  const passedSuccessCriterionIds = new Set(
    parsed.evidence
      .filter((record) => record.successCriterionId !== undefined
        && record.outcome === 'pass'
        && bindsExactBaselines(record))
      .map((record) => record.successCriterionId as string),
  );
  const systemChecksById = new Map(parsed.systemChecks.map((check) => [check.id, check]));

  const uncoveredRequiredIntentIds = [...requiredIntentIds]
    .filter((intentId) => !intentIdsWithSolutionTrace.has(intentId))
    .sort();
  const requiredSolutionIdsWithoutIntentTrace = [...requiredSolutionIds]
    .filter((solutionId) => !closesToProduct(solutionId))
    .sort();
  const requiredSolutionIdsWithoutExecutionTrace = [...requiredSolutionIds]
    .filter((solutionId) => !solutionIdsWithTaskTrace.has(solutionId))
    .sort();
  const uncoveredRequiredTaskIds = [...requiredTaskIds]
    .filter((taskId) => !taskIdsWithSolutionTrace.has(taskId))
    .sort();
  const unacceptedRequiredTaskIds = [...requiredTaskIds]
    .filter((taskId) => tasksById.get(taskId)?.status !== 'accepted')
    .sort();
  const acceptedTaskIdsWithoutIndependentPassingEvidence = parsed.tasks
    .filter((task) => requiredTaskIds.has(task.id) && task.status === 'accepted' && !passedTaskEvidenceIds.has(task.id))
    .map((task) => task.id)
    .sort();
  const successCriterionIdsWithoutPassingEvidence = parsed.requiredSuccessCriterionIds
    .filter((successCriterionId) => !passedSuccessCriterionIds.has(successCriterionId))
    .sort();
  const openBlockingDriftIds = parsed.drift
    .filter((record) => record.status === 'open' && record.severity === 'blocking')
    .map((record) => record.id)
    .sort();
  const openBlockingDrift = parsed.drift
    .filter((record) => record.status === 'open' && record.severity === 'blocking')
    .slice().sort((left, right) => left.id.localeCompare(right.id));
  const selectedRepairId = scheduler.selectedTaskId;
  const blockingDriftWithoutRepairIds = openBlockingDrift.filter((record) => record.repairTaskId === null)
    .map((record) => record.id);
  const blockingDriftAwaitingAuthorizationIds = openBlockingDrift
    .filter((record) => record.repairTaskId !== null && record.repairAuthorization === 'not_authorized')
    .map((record) => record.id);
  const blockingDriftDispatchableRepairIds = openBlockingDrift
    .filter((record) => record.repairAuthorization === 'authorized' && record.repairTaskId === selectedRepairId)
    .map((record) => record.id);
  const blockingDriftBlockedRepairIds = openBlockingDrift
    .filter((record) => record.repairTaskId !== null && record.repairAuthorization === 'authorized'
      && record.repairTaskId !== selectedRepairId)
    .map((record) => record.id);
  const staleTaskIds = parsed.tasks
    .filter((task) => requiredTaskIds.has(task.id) && task.status !== 'discarded'
      && (!sameBaseline(task.protectedIntentBaseline, parsed.currentIntentBaseline)
        || !sameBaseline(task.protectedIntentBaseline, parsed.compiledIntentBaseline)
        || !sameBaseline(task.protectedSolutionBaseline, parsed.currentSolutionBaseline)
        || !sameBaseline(task.protectedSolutionBaseline, parsed.compiledSolutionBaseline)))
    .map((task) => task.id)
    .sort();
  const staleEvidenceIds = parsed.evidence
    .filter((record) => !bindsExactBaselines(record))
    .map((record) => record.id)
    .sort();
  const staleSystemCheckIds = parsed.systemChecks
    .filter((check) => !bindsExactBaselines(check))
    .map((check) => check.id)
    .sort();
  const failedOrMissingRequiredSystemCheckIds = parsed.requiredSystemCheckIds
    .filter((checkId) => {
      const check = systemChecksById.get(checkId);
      return check === undefined || check.outcome !== 'pass' || !bindsExactBaselines(check);
    })
    .sort();
  const unresolvedBlockingDecisionOrQuestionIds = parsed.decisions
    .filter((decision) => decision.blocking && decision.status === 'unresolved')
    .map((decision) => decision.id)
    .sort();

  return reportFor({
    uncoveredRequiredIntentIds,
    requiredSolutionIdsWithoutIntentTrace,
    requiredSolutionIdsWithoutExecutionTrace,
    uncoveredRequiredTaskIds,
    unacceptedRequiredTaskIds,
    acceptedTaskIdsWithoutIndependentPassingEvidence,
    successCriterionIdsWithoutPassingEvidence,
    openBlockingDriftIds,
    blockingDriftWithoutRepairIds,
    blockingDriftAwaitingAuthorizationIds,
    blockingDriftDispatchableRepairIds,
    blockingDriftBlockedRepairIds,
    staleTaskIds,
    staleEvidenceIds,
    staleSystemCheckIds,
    compiledBaselineMismatchRefs: [
      ...(!sameBaseline(parsed.currentIntentBaseline, parsed.compiledIntentBaseline)
        ? [`intent:${parsed.compiledIntentBaseline.baselineId}`]
        : []),
      ...(!sameBaseline(parsed.currentSolutionBaseline, parsed.compiledSolutionBaseline)
        ? [`solution:${parsed.compiledSolutionBaseline.baselineId}`]
        : []),
    ].sort(),
    failedOrMissingRequiredSystemCheckIds,
    unresolvedBlockingDecisionOrQuestionIds,
    pendingBaselineChangeRefs: parsed.pendingBaselineChange ? ['pending_baseline_change'] : [],
    schedulerIssues: [...scheduler.issues].sort((left, right) => left.code.localeCompare(right.code)),
    schedulerBlockers: scheduler.blockers.filter((blocker) => blocker.code !== 'no_eligible_task')
      .slice().sort((left, right) => left.code.localeCompare(right.code)),
    invalidInputIssues: [],
  });
}

function route(action: FactoryAction, reason: string, refs: readonly string[]): MissingWorkRoute {
  return { action, reason, refs: sorted(refs) };
}

/** Build a deterministic full gap report without changing project state. */
export function createMissingWorkReport(report: CompletenessReport): MissingWorkReport | null {
  if (report.complete) return null;
  const { gaps } = report;
  const routes: MissingWorkRoute[] = [];
  if (gaps.invalidInputIssues.length > 0) {
    routes.push(route('missing_work', 'Correct invalid, duplicate, or dangling closure state.', gaps.invalidInputIssues.flatMap((entry) => entry.refs)));
  }
  if (gaps.pendingBaselineChangeRefs.length > 0
    || gaps.compiledBaselineMismatchRefs.length > 0
    || gaps.staleTaskIds.length > 0
    || gaps.staleEvidenceIds.length > 0
    || gaps.staleSystemCheckIds.length > 0) {
    routes.push(route(
      'impact_analysis',
      'Classify work and evidence against the pending, compiled, or changed baseline.',
      [
        ...gaps.pendingBaselineChangeRefs,
        ...gaps.compiledBaselineMismatchRefs,
        ...gaps.staleTaskIds,
        ...gaps.staleEvidenceIds,
        ...gaps.staleSystemCheckIds,
      ],
    ));
  }
  const solutionCompilationRefs = [...gaps.uncoveredRequiredIntentIds, ...gaps.requiredSolutionIdsWithoutIntentTrace];
  if (solutionCompilationRefs.length > 0) {
    routes.push(route('recompile_solution', 'Compile missing Intent-to-Solution traces.', solutionCompilationRefs));
  }
  const executionCompilationRefs = [
    ...gaps.requiredSolutionIdsWithoutExecutionTrace,
    ...gaps.uncoveredRequiredTaskIds,
  ];
  if (executionCompilationRefs.length > 0) {
    routes.push(route('recompile_execution', 'Compile missing Solution-to-Execution traces.', executionCompilationRefs));
  }
  if (gaps.unacceptedRequiredTaskIds.length > 0) {
    routes.push(route('missing_work', 'Required tasks remain unaccepted.', gaps.unacceptedRequiredTaskIds));
  }
  if (gaps.acceptedTaskIdsWithoutIndependentPassingEvidence.length > 0) {
    routes.push(route('verify_task', 'Accepted tasks require independent passing Check evidence.', gaps.acceptedTaskIdsWithoutIndependentPassingEvidence));
  }
  if (gaps.successCriterionIdsWithoutPassingEvidence.length > 0) {
    routes.push(route('missing_work', 'Required success criteria need passing evidence.', gaps.successCriterionIdsWithoutPassingEvidence));
  }
  if (gaps.blockingDriftWithoutRepairIds.length > 0) {
    routes.push(route('propose_repair', 'Blocking drift has no Repair task; propose one without authorizing it.', gaps.blockingDriftWithoutRepairIds));
  } else if (gaps.blockingDriftAwaitingAuthorizationIds.length > 0) {
    routes.push(route('request_repair_authorization', 'Blocking drift has an existing Repair awaiting explicit owner authorization.', gaps.blockingDriftAwaitingAuthorizationIds));
  } else if (gaps.blockingDriftDispatchableRepairIds.length > 0) {
    routes.push(route('execute_repair', 'The scheduler selected an authorized Repair task for blocking drift.', gaps.blockingDriftDispatchableRepairIds));
  } else if (gaps.blockingDriftBlockedRepairIds.length > 0) {
    routes.push(route('missing_work', 'An authorized Repair exists but is not scheduler-dispatchable.', [
      ...gaps.blockingDriftBlockedRepairIds,
      ...gaps.schedulerBlockers.flatMap((blocker) => blocker.taskIds),
    ]));
  }
  if (gaps.failedOrMissingRequiredSystemCheckIds.length > 0) {
    routes.push(route('run_system_check', 'Required system checks are missing or failed.', gaps.failedOrMissingRequiredSystemCheckIds));
  }
  if (gaps.unresolvedBlockingDecisionOrQuestionIds.length > 0) {
    routes.push(route('owner_decision', 'Blocking decisions or questions remain unresolved.', gaps.unresolvedBlockingDecisionOrQuestionIds));
  }
  return { incomplete: true, gaps, suggestedRoutes: routes };
}
