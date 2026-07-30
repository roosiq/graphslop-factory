import {
  ApprovalRecordSchema,
  ApprovedBaselineSchema,
  CorrectionRecordSchema,
  ProjectStateSchema,
  type ApprovalRecord,
  type ApprovedBaseline,
  type CorrectionRecord,
  type ProjectLifecycleState,
  type ProjectState,
} from '@graphslop/contracts';

export class ControlStateError extends Error {
  constructor(
    readonly code:
      | 'invalid_state'
      | 'stale_state'
      | 'illegal_transition'
      | 'wrong_approval_state'
      | 'owner_required'
      | 'artifact_mismatch'
      | 'projection_mismatch'
      | 'blocking_questions'
      | 'broken_correction_chain'
      | 'missing_prerequisite',
    message: string,
  ) {
    super(message);
    this.name = 'ControlStateError';
  }
}

const allowedTransitions: Readonly<Record<ProjectLifecycleState, readonly ProjectLifecycleState[]>> = deepFreeze({
  CAPTURE: ['DISCOVERY'],
  DISCOVERY: ['INTENT_REVIEW'],
  INTENT_REVIEW: ['INTENT_APPROVED'],
  INTENT_APPROVED: ['SOLUTION_GENERATION'],
  SOLUTION_GENERATION: ['SOLUTION_REVIEW'],
  SOLUTION_REVIEW: ['SOLUTION_APPROVED'],
  SOLUTION_APPROVED: ['EXECUTION'],
  EXECUTION: ['VERIFICATION'],
  VERIFICATION: ['REPAIR', 'COMPLETE'],
  REPAIR: ['VERIFICATION'],
  COMPLETE: [],
});

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseProject(project: unknown): ProjectState {
  const parsed = ProjectStateSchema.safeParse(project);
  if (!parsed.success) throw new ControlStateError('invalid_state', 'Project state is invalid.');
  return parsed.data;
}

export type LifecycleTransition = {
  readonly expectedState: ProjectLifecycleState;
  readonly nextState: ProjectLifecycleState;
  readonly changedAt: string;
  readonly approvedBaselines?: readonly ApprovedBaseline[];
};

export function transitionLifecycle(projectValue: unknown, change: LifecycleTransition): Readonly<ProjectState> {
  const project = parseProject(projectValue);
  if (project.lifecycleState !== change.expectedState) {
    throw new ControlStateError('stale_state', 'The lifecycle state changed before this command.');
  }
  if (!allowedTransitions[project.lifecycleState].includes(change.nextState)) {
    throw new ControlStateError(
      'illegal_transition',
      `${project.lifecycleState} cannot advance directly to ${change.nextState}.`,
    );
  }
  if (change.nextState === 'EXECUTION') {
    requireApprovedBaselines(project, change.approvedBaselines, ['intent', 'solution']);
  }
  const parsed = ProjectStateSchema.safeParse({
    ...project,
    lifecycleState: change.nextState,
    updatedAt: change.changedAt,
    closedAt: change.nextState === 'COMPLETE' ? change.changedAt : project.closedAt,
  });
  if (!parsed.success) throw new ControlStateError('invalid_state', 'The lifecycle change is invalid.');
  return deepFreeze(parsed.data);
}

export type BaselineApprovalInput = {
  readonly project: ProjectState;
  readonly graphKind: 'intent' | 'solution';
  readonly baselineId: string;
  readonly snapshotId: string;
  readonly snapshotContentHash: string;
  readonly projectionId: string;
  readonly projectionContentHash: string;
  readonly displayedProjectionHash: string;
  readonly unresolvedBlockingQuestionIds: readonly string[];
  readonly approval: ApprovalRecord;
  readonly nodeVersions: ApprovedBaseline['nodeVersions'];
  readonly protectedAssertions: ApprovedBaseline['protectedAssertions'];
  readonly unresolvedNonBlocking: readonly string[];
  readonly createdAt: string;
  readonly supersedesBaselineId?: string | null;
  readonly approvedBaselines?: readonly ApprovedBaseline[];
};

export type BaselineApprovalResult = {
  readonly input: BaselineApprovalInput;
  readonly project: Readonly<ProjectState>;
  readonly baseline: Readonly<ApprovedBaseline>;
};

export function approveBaseline(input: BaselineApprovalInput): BaselineApprovalResult {
  const project = parseProject(input.project);
  const expectedState = input.graphKind === 'intent' ? 'INTENT_REVIEW' : 'SOLUTION_REVIEW';
  const nextState = input.graphKind === 'intent' ? 'INTENT_APPROVED' : 'SOLUTION_APPROVED';
  if (project.lifecycleState !== expectedState) {
    throw new ControlStateError('wrong_approval_state', `${input.graphKind} approval is not allowed from ${project.lifecycleState}.`);
  }
  if (input.graphKind === 'solution') {
    requireApprovedBaselines(project, input.approvedBaselines, ['intent']);
  }
  const approval = ApprovalRecordSchema.safeParse(input.approval);
  if (!approval.success) {
    const wrongActor = typeof input.approval === 'object'
      && input.approval !== null
      && 'actorKind' in input.approval
      && input.approval.actorKind !== 'authenticated_project_owner';
    throw new ControlStateError(wrongActor ? 'owner_required' : 'artifact_mismatch', 'The approval record is invalid.');
  }
  const expectedArtifactType = input.graphKind === 'intent' ? 'intent_baseline' : 'solution_baseline';
  if (
    approval.data.artifactType !== expectedArtifactType
    || approval.data.artifactId !== input.baselineId
    || approval.data.artifactContentHash !== input.snapshotContentHash
  ) {
    throw new ControlStateError('artifact_mismatch', 'Approval does not name the exact proposed baseline snapshot.');
  }
  if (
    input.displayedProjectionHash !== input.projectionContentHash
    || approval.data.displayedProjectionHash !== input.projectionContentHash
    || approval.data.renderedDataHash !== input.projectionContentHash
  ) {
    throw new ControlStateError('projection_mismatch', 'Approval does not name the exact displayed projection.');
  }
  if (input.unresolvedBlockingQuestionIds.length > 0) {
    throw new ControlStateError('blocking_questions', 'Blocking questions prevent baseline approval.');
  }

  const baselineResult = ApprovedBaselineSchema.safeParse({
    schemaVersion: '1.0.0',
    baselineId: input.baselineId,
    graphKind: input.graphKind,
    projectId: project.projectId,
    status: 'approved',
    snapshotId: input.snapshotId,
    snapshotContentHash: input.snapshotContentHash,
    projectionId: input.projectionId,
    projectionContentHash: input.projectionContentHash,
    nodeVersions: input.nodeVersions,
    protectedAssertions: input.protectedAssertions,
    unresolvedNonBlocking: input.unresolvedNonBlocking,
    approvalRecord: approval.data,
    createdAt: input.createdAt,
    supersedesBaselineId: input.supersedesBaselineId ?? null,
  });
  if (!baselineResult.success) {
    throw new ControlStateError('artifact_mismatch', 'The approved baseline is invalid.');
  }
  const nextProject = transitionLifecycle(project, {
    expectedState,
    nextState,
    changedAt: approval.data.approvedAt,
  });
  const boundProject = ProjectStateSchema.parse({
    ...nextProject,
    ...(input.graphKind === 'intent'
      ? { activeIntentBaselineId: input.baselineId }
      : { activeSolutionBaselineId: input.baselineId }),
  });
  return deepFreeze({
    input,
    project: deepFreeze(boundProject),
    baseline: deepFreeze(baselineResult.data),
  });
}

export function appendCorrection(
  historyValues: readonly CorrectionRecord[],
  correctionValue: CorrectionRecord,
): readonly Readonly<CorrectionRecord>[] {
  const history = historyValues.map((entry) => {
    const parsed = CorrectionRecordSchema.safeParse(entry);
    if (!parsed.success) throw new ControlStateError('broken_correction_chain', 'Correction history is invalid.');
    return parsed.data;
  });
  const parsed = CorrectionRecordSchema.safeParse(correctionValue);
  if (!parsed.success || parsed.data.nextVersion !== parsed.data.priorVersion + 1) {
    throw new ControlStateError('broken_correction_chain', 'A correction must advance exactly one node version.');
  }
  const priorForNode = [...history].reverse().find((entry) => entry.nodeId === parsed.data.nodeId);
  if (priorForNode && priorForNode.nextVersion !== parsed.data.priorVersion) {
    throw new ControlStateError('broken_correction_chain', 'A correction must extend the latest retained version.');
  }
  if (!priorForNode && parsed.data.priorVersion !== 1) {
    throw new ControlStateError('broken_correction_chain', 'The first retained correction must supersede version 1.');
  }
  if (history.some((entry) => entry.correctionId === parsed.data.correctionId)) {
    throw new ControlStateError('broken_correction_chain', 'Correction IDs cannot be reused.');
  }
  return deepFreeze([...history, parsed.data]);
}

export function lifecycleTransitions(): Readonly<Record<ProjectLifecycleState, readonly ProjectLifecycleState[]>> {
  return allowedTransitions;
}

function requireApprovedBaselines(
  project: ProjectState,
  baselineValues: readonly ApprovedBaseline[] | undefined,
  graphKinds: readonly ('intent' | 'solution')[],
): void {
  const baselines = (baselineValues ?? []).map((value) => ApprovedBaselineSchema.safeParse(value));
  for (const graphKind of graphKinds) {
    const activeId = graphKind === 'intent'
      ? project.activeIntentBaselineId
      : project.activeSolutionBaselineId;
    const exact = baselines.find((result) =>
      result.success
      && result.data.graphKind === graphKind
      && result.data.projectId === project.projectId
      && result.data.baselineId === activeId,
    );
    if (!activeId || !exact?.success) {
      throw new ControlStateError(
        'missing_prerequisite',
        `${graphKind} requires its exact active approved baseline record.`,
      );
    }
  }
}

export * from './project-service.js';
