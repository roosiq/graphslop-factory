import {
  GraphBaselineRefSchema,
  GraphSnapshotSchema,
  type GraphBaselineRef,
  type GraphNode,
  type GraphSnapshot,
} from '@graphslop/contracts';

import { validateGraphSnapshots, type GraphValidationInput } from '../validate.js';
import {
  type CompletenessGaps,
  type CompletenessIssue,
  type CompletenessReport,
  type MissingWorkReport,
} from './completeness.js';
import { advanceProjection, type FactoryAdvance } from './flywheel.js';
import { type SchedulerResult } from './scheduler.js';

/**
 * The only public factory boundary. The current graphs are checked before the
 * normalized closure is allowed to choose a move.
 */
export type FactoryInput = {
  readonly graphValidation: GraphValidationInput;
  readonly closure: unknown;
};

type RecordValue = Record<string, unknown>;

type BindingIssue = {
  readonly code: string;
  readonly message: string;
  readonly refs: readonly string[];
};

type ExpectedClosure = {
  readonly currentIntentBaseline: { readonly baselineId: string; readonly contentHash: string };
  readonly currentSolutionBaseline: { readonly baselineId: string; readonly contentHash: string };
  readonly compiledIntentBaseline: { readonly baselineId: string; readonly contentHash: string };
  readonly compiledSolutionBaseline: { readonly baselineId: string; readonly contentHash: string };
  readonly requiredIntentNodeIds: readonly string[];
  readonly requiredSolutionNodeIds: readonly string[];
  readonly requiredTaskIds: readonly string[];
  readonly requiredSuccessCriterionIds: readonly string[];
  readonly requiredSystemCheckIds: readonly string[];
  readonly tasks: readonly unknown[];
  readonly taskProducers: readonly unknown[];
  readonly solutionScopes: readonly unknown[];
  readonly solutionSupports: readonly unknown[];
  readonly solutionToIntentTraces: readonly unknown[];
  readonly taskToSolutionTraces: readonly unknown[];
};

const closureBindingKeys = [
  'currentIntentBaseline',
  'currentSolutionBaseline',
  'compiledIntentBaseline',
  'compiledSolutionBaseline',
  'requiredIntentNodeIds',
  'requiredSolutionNodeIds',
  'requiredTaskIds',
  'requiredSuccessCriterionIds',
  'requiredSystemCheckIds',
  'tasks',
  'taskProducers',
  'solutionScopes',
  'solutionSupports',
  'solutionToIntentTraces',
  'taskToSolutionTraces',
] as const;

const factoryInputKeys = ['graphValidation', 'closure'] as const;
const graphValidationKeys = ['snapshots', 'approvedBaselines', 'currentSourceSnapshots'] as const;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
    && keys.filter((key) => key !== 'currentSourceSnapshots').every((key) => Object.hasOwn(value, key));
}

function sorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function factoryIssue(code: string, message: string, refs: readonly string[] = []): CompletenessIssue {
  return { code, message, refs: sorted(refs) };
}

function invalidGaps(issues: readonly CompletenessIssue[]): CompletenessGaps {
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
    invalidInputIssues: [...issues].sort((left, right) =>
      left.code.localeCompare(right.code) || left.refs.join('\u0000').localeCompare(right.refs.join('\u0000')),
    ),
  };
}

function invalidAdvance(reason: string, issues: readonly CompletenessIssue[]): FactoryAdvance {
  const gaps = invalidGaps(issues);
  const completeness: CompletenessReport = { valid: false, complete: false, gaps };
  const refs = sorted(issues.flatMap((entry) => entry.refs));
  const scheduler: SchedulerResult = {
    valid: false,
    issues: [{ code: 'invalid_factory_composition', message: reason, taskIds: refs }],
    order: [],
    dispatchableTaskIds: [],
    selectedTaskId: null,
    blockers: [],
    incompleteReason: { code: 'invalid_input', message: reason, taskIds: refs },
  };
  const missingWork: MissingWorkReport = {
    incomplete: true,
    gaps,
    suggestedRoutes: [{ action: 'missing_work', reason: 'Correct invalid graph or closure bindings.', refs }],
  };
  return {
    action: 'block_invalid_state',
    reason,
    refs,
    completeness,
    missingWork,
    scheduler,
  };
}

function canonicalJson(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  if (Array.isArray(value)) {
    const entries = value.map(canonicalJson);
    return entries.some((entry) => entry === undefined) ? undefined : `[${entries.join(',')}]`;
  }
  if (!isRecord(value)) return undefined;
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const child = canonicalJson(value[key]);
    if (child === undefined) return undefined;
    entries.push(`${JSON.stringify(key)}:${child}`);
  }
  return `{${entries.join(',')}}`;
}

function sameCollection(left: unknown, right: readonly unknown[]): boolean {
  if (!Array.isArray(left)) return false;
  const leftValues = left.map(canonicalJson);
  const rightValues = right.map(canonicalJson);
  if (leftValues.some((value) => value === undefined) || rightValues.some((value) => value === undefined)) return false;
  return [...leftValues as string[]].sort().join('\u0000') === [...rightValues as string[]].sort().join('\u0000');
}

function sameValue(left: unknown, right: unknown): boolean {
  const leftValue = canonicalJson(left);
  const rightValue = canonicalJson(right);
  return leftValue !== undefined && leftValue === rightValue;
}

function baselineFor(
  baselines: ReadonlyMap<GraphSnapshot['graphKind'], GraphBaselineRef>,
  kind: GraphSnapshot['graphKind'],
): { readonly baselineId: string; readonly contentHash: string } | undefined {
  const baseline = baselines.get(kind);
  return baseline === undefined
    ? undefined
    : { baselineId: baseline.baselineId, contentHash: baseline.snapshotContentHash };
}

function nodeIds(nodes: readonly GraphNode[]): readonly string[] {
  return nodes.map((node) => node.id).sort();
}

function executionDependencies(snapshot: GraphSnapshot, nodeId: string): readonly string[] {
  return snapshot.edges
    .filter((edge) => edge.type === 'DEPENDS_ON' && edge.sourceNodeRef.nodeId === nodeId)
    .map((edge) => edge.targetNodeRef.nodeId)
    .sort();
}

function expectedClosure(
  snapshots: ReadonlyMap<GraphSnapshot['graphKind'], GraphSnapshot>,
  baselines: ReadonlyMap<GraphSnapshot['graphKind'], GraphBaselineRef>,
): { readonly value?: ExpectedClosure; readonly issues: readonly BindingIssue[] } {
  const intent = snapshots.get('intent');
  const solution = snapshots.get('solution');
  const execution = snapshots.get('execution');
  const intentBaseline = baselineFor(baselines, 'intent');
  const solutionBaseline = baselineFor(baselines, 'solution');
  if (!intent || !solution || !execution || !intentBaseline || !solutionBaseline) {
    return {
      issues: [{
        code: 'missing_current_graph_binding',
        message: 'Intent, Solution, Execution, and their approved baselines are all required.',
        refs: [],
      }],
    };
  }

  const issues: BindingIssue[] = [];
  const tasks: unknown[] = [];
  const taskProducers: unknown[] = [];
  for (const node of execution.nodes) {
    const task = node.attributes.task;
    const producerId = node.attributes.producerId;
    const dependencies = executionDependencies(execution, node.id);
    if (!isRecord(task)) {
      issues.push({
        code: 'missing_execution_task_fact',
        message: 'Every Execution node must retain its scheduler task fact in attributes.task.',
        refs: [node.id],
      });
      continue;
    }
    if (task.id !== node.id || task.type !== node.type || !sameCollection(task.dependencies, dependencies)) {
      issues.push({
        code: 'execution_task_graph_mismatch',
        message: 'Execution task identity, type, and dependencies must match its graph node and DEPENDS_ON edges.',
        refs: [node.id, ...dependencies],
      });
      continue;
    }
    if (typeof producerId !== 'string') {
      issues.push({
        code: 'missing_execution_task_producer',
        message: 'Every Execution node must retain its authoritative producer ID.',
        refs: [node.id],
      });
      continue;
    }
    tasks.push(task);
    taskProducers.push({ taskId: node.id, producerId });
  }

  const solutionScopes: unknown[] = solution.nodes.map((node) => ({ solutionId: node.id, scope: node.scope }));
  const solutionSupports: unknown[] = solution.nodes.flatMap((node) =>
    (node.supports ?? []).map((support) => ({ supportId: node.id, supportedSolutionId: support.nodeId })),
  );
  const solutionToIntentTraces: unknown[] = solution.crossGraphLinks
    .filter((link) => link.type === 'SATISFIES_INTENT')
    .map((link) => ({ solutionId: link.source.nodeId, intentId: link.target.nodeId }));
  const taskToSolutionTraces: unknown[] = execution.crossGraphLinks
    .filter((link) => link.type === 'SATISFIES_SOLUTION')
    .map((link) => ({ taskId: link.source.nodeId, solutionId: link.target.nodeId }));

  return {
    issues,
    value: issues.length === 0
      ? {
        currentIntentBaseline: intentBaseline,
        currentSolutionBaseline: solutionBaseline,
        compiledIntentBaseline: intentBaseline,
        compiledSolutionBaseline: solutionBaseline,
        requiredIntentNodeIds: nodeIds(intent.nodes.filter((node) => node.status === 'confirmed')),
        requiredSolutionNodeIds: nodeIds(solution.nodes),
        requiredTaskIds: nodeIds(execution.nodes),
        requiredSuccessCriterionIds: nodeIds(intent.nodes.filter((node) =>
          node.status === 'confirmed' && node.type === 'SuccessCriterion',
        )),
        requiredSystemCheckIds: nodeIds(solution.nodes.filter((node) => node.type === 'TestableBehavior')),
        tasks,
        taskProducers,
        solutionScopes,
        solutionSupports,
        solutionToIntentTraces,
        taskToSolutionTraces,
      }
      : undefined,
  };
}

function bindClosure(closure: unknown, expected: ExpectedClosure): readonly CompletenessIssue[] {
  if (!isRecord(closure)) {
    return [factoryIssue('invalid_factory_closure', 'The composed factory input requires an explicit closure object.')];
  }
  const issues: CompletenessIssue[] = [];
  for (const key of closureBindingKeys) {
    const expectedValue = expected[key];
    const actualValue = closure[key];
    const matches = Array.isArray(expectedValue)
      ? sameCollection(actualValue, expectedValue)
      : sameValue(actualValue, expectedValue);
    if (!matches) {
      issues.push(factoryIssue(
        'closure_graph_binding_mismatch',
        `${key} must be derived exactly from the supplied current graph snapshots.`,
        [key],
      ));
    }
  }
  return issues;
}

function parseCurrentGraphs(
  validation: unknown,
): { readonly snapshots?: ReadonlyMap<GraphSnapshot['graphKind'], GraphSnapshot>; readonly baselines?: ReadonlyMap<GraphSnapshot['graphKind'], GraphBaselineRef>; readonly issues: readonly CompletenessIssue[] } {
  if (!isRecord(validation) || !hasOnlyKeys(validation, graphValidationKeys)
    || !Array.isArray(validation.snapshots) || !Array.isArray(validation.approvedBaselines)) {
    return { issues: [factoryIssue('invalid_factory_graph_input', 'graphValidation must contain only snapshots, approvedBaselines, and optional currentSourceSnapshots.')] };
  }
  const snapshots: GraphSnapshot[] = [];
  for (const candidate of validation.snapshots) {
    const result = GraphSnapshotSchema.safeParse(candidate);
    if (!result.success) {
      return { issues: [factoryIssue('invalid_factory_graph_input', 'Validated graph input could not be parsed as exact snapshots and baselines.')] };
    }
    snapshots.push(result.data);
  }
  const baselines: GraphBaselineRef[] = [];
  for (const candidate of validation.approvedBaselines) {
    const result = GraphBaselineRefSchema.safeParse(candidate);
    if (!result.success) {
      return { issues: [factoryIssue('invalid_factory_graph_input', 'Validated graph input could not be parsed as exact snapshots and baselines.')] };
    }
    baselines.push(result.data);
  }
  const snapshotMap = new Map<GraphSnapshot['graphKind'], GraphSnapshot>(
    snapshots.map((snapshot) => [snapshot.graphKind, snapshot]),
  );
  const baselineMap = new Map<GraphSnapshot['graphKind'], GraphBaselineRef>(
    baselines.map((baseline) => [baseline.graphKind, baseline]),
  );
  const expectedKinds: readonly GraphSnapshot['graphKind'][] = ['intent', 'solution', 'execution'];
  const hasExactKinds = validation.snapshots.length === expectedKinds.length
    && validation.approvedBaselines.length === expectedKinds.length
    && expectedKinds.every((kind) => snapshotMap.has(kind) && baselineMap.has(kind));
  if (!hasExactKinds) {
    return { issues: [factoryIssue('missing_current_graph_kind', 'Exactly one current Intent, Solution, and Execution snapshot and baseline are required.')] };
  }
  const baselineIssues: CompletenessIssue[] = [];
  for (const kind of expectedKinds) {
    const snapshot = snapshotMap.get(kind);
    const baseline = baselineMap.get(kind);
    if (!snapshot || !baseline) continue;
    if (baseline.graphId !== snapshot.graphId || baseline.snapshotId !== snapshot.snapshotId
      || baseline.snapshotContentHash !== snapshot.contentHash) {
      baselineIssues.push(factoryIssue(
        'current_baseline_snapshot_mismatch',
        'Each approved baseline must name the exact current snapshot and content hash.',
        [kind],
      ));
    }
  }
  return baselineIssues.length > 0
    ? { issues: baselineIssues }
    : { snapshots: snapshotMap, baselines: baselineMap, issues: [] };
}

/**
 * Advance the authoritative factory state. Graph grammar and exact snapshot
 * bindings are checked before the non-authoritative closure projection runs.
 */
export function advanceFactory(input: unknown): FactoryAdvance {
  const envelope = isRecord(input) ? input : undefined;
  const graphValidationInput = envelope?.graphValidation;
  const graphValidation = validateGraphSnapshots(graphValidationInput);
  if (!graphValidation.valid) {
    return invalidAdvance(
      'Current graph snapshots are invalid or missing; the factory is blocked before closure evaluation.',
      graphValidation.issues.map((entry) => factoryIssue(
        `graph_${entry.code}`,
        entry.message,
        entry.path.filter((part): part is string => typeof part === 'string'),
      )),
    );
  }
  if (!envelope || !hasOnlyKeys(envelope, factoryInputKeys)) {
    return invalidAdvance(
      'The authoritative factory input must contain only graphValidation and closure.',
      [factoryIssue('invalid_factory_input', 'The authoritative factory input must contain graphValidation and closure.')],
    );
  }

  const currentGraphs = parseCurrentGraphs(graphValidationInput);
  if (!currentGraphs.snapshots || !currentGraphs.baselines) {
    return invalidAdvance('Current graph snapshots do not form one exact authoritative set.', currentGraphs.issues);
  }
  const derived = expectedClosure(currentGraphs.snapshots, currentGraphs.baselines);
  if (!derived.value) {
    return invalidAdvance(
      'Execution task facts do not match the authoritative Execution graph.',
      derived.issues.map((entry) => factoryIssue(entry.code, entry.message, entry.refs)),
    );
  }
  const bindingIssues = bindClosure(envelope.closure, derived.value);
  if (bindingIssues.length > 0) {
    return invalidAdvance(
      'Closure facts do not match the validated Intent, Solution, and Execution snapshots.',
      bindingIssues,
    );
  }
  return advanceProjection(envelope.closure);
}
