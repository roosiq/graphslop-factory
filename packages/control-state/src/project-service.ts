import { createHash } from 'node:crypto';

import {
  ApprovalRecordSchema,
  ProposalOutputSchema,
  ProjectConversationStateSchema,
  SolutionArtifactHandoffDraftSchema,
  SolutionProposalOutputSchema,
  type ApprovalRecord,
  type ApprovedBaseline,
  type GraphNode,
  type GraphSnapshot,
  type IntentNodeDraft,
  type ProjectConversationState,
  type ProjectionRecord,
  type QuestionDraft,
  type RankedQuestion,
  type SolutionArtifactHandoffDraft,
  type SolutionProposalOutput,
  type SolutionTaskType,
} from '@graphslop/contracts';
import { hashGraphSnapshot } from '@graphslop/graph-kernel';

import { appendCorrection, approveBaseline } from './index.js';

export type AuthorityServices = {
  readonly nextId: (kind: string) => string;
  readonly now: () => string;
};

export type ProposalProviderBoundary = {
  propose(context: {
    readonly message: import('@graphslop/contracts').MessageRecord;
    readonly priorIntentNodes: readonly {
      readonly stableId: string;
      readonly statement: string;
      readonly type?: string;
      readonly status?: string;
    }[];
    readonly priorQuestions?: readonly {
      readonly text: string;
      readonly category: string;
      readonly disposition: 'open' | 'answered' | 'deferred';
      readonly ownerContent?: string;
    }[];
    readonly readinessGaps?: readonly string[];
  }): Promise<import('@graphslop/contracts').ProposalOutput>;
  planSolution?(context: {
    readonly intentNodes: readonly {
      readonly id: string;
      readonly type: string;
      readonly statement: string;
    }[];
  }): Promise<SolutionProposalOutput>;
};

export type ProjectStateSink = {
  persist(state: Readonly<ProjectConversationState>): void;
};

export type ProjectOwnerActor = Readonly<{
  actorId: string;
  actorKind: 'authenticated_project_owner';
}>;

export type IntentGraphEdit =
  | Readonly<{
    action: 'add-node';
    type: string;
    statement: string;
  }>
  | Readonly<{
    action: 'update-node';
    nodeId: string;
    type: string;
    statement: string;
  }>
  | Readonly<{
    action: 'connect';
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
  }>
  | Readonly<{
    action: 'delete-edge';
    edgeId: string;
  }>;

type ResolutionContext = Readonly<{
  question: RankedQuestion;
  disposition: 'answered';
  ownerContent: string;
}>;

export class ProjectServiceError extends Error {
  constructor(
    readonly code: 'provider_failed' | 'wrong_state' | 'missing_graph' | 'missing_baseline' | 'invalid_approval' | 'invalid_trace',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectServiceError';
  }
}

const actor = { actorId: 'graphslop-system', actorKind: 'deterministic_service' } as const;

const executionStageOrder: readonly SolutionTaskType[] = [
  'Inspect', 'Decide', 'Implement', 'Test', 'Integrate', 'Document', 'Release', 'Verify',
];

function cloneHandoffArtifacts(
  artifacts: readonly SolutionArtifactHandoffDraft[],
): SolutionArtifactHandoffDraft[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    paths: [...artifact.paths],
    requiredEvidence: [...artifact.requiredEvidence],
  }));
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshotWithHash(value: Omit<GraphSnapshot, 'contentHash'>): GraphSnapshot {
  const draft = { ...value, contentHash: '0'.repeat(64) };
  return { ...draft, contentHash: hashGraphSnapshot(draft) };
}

function bindLocalTraceHashes(snapshot: GraphSnapshot): GraphSnapshot {
  const contentHash = hashGraphSnapshot(snapshot);
  return {
    ...snapshot,
    contentHash,
    crossGraphLinks: snapshot.crossGraphLinks.map((link) => ({
      ...link,
      source: { ...link.source, snapshotContentHash: contentHash },
    })),
  };
}

function bindLocalEdgeHashes(snapshot: GraphSnapshot): GraphSnapshot {
  const contentHash = hashGraphSnapshot(snapshot);
  const bind = (ref: GraphSnapshot['edges'][number]['sourceNodeRef']) =>
    ref.graphKind === snapshot.graphKind
      && ref.graphId === snapshot.graphId
      && ref.snapshotId === snapshot.snapshotId
      ? { ...ref, snapshotContentHash: contentHash }
      : ref;
  return {
    ...snapshot,
    contentHash,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      ...(node.supports ? { supports: node.supports.map(bind) } : {}),
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      sourceNodeRef: bind(edge.sourceNodeRef),
      targetNodeRef: bind(edge.targetNodeRef),
    })),
  };
}

function rebindLocalEdges(
  edges: GraphSnapshot['edges'],
  nodes: readonly GraphNode[],
  graphId: string,
  snapshotId: string,
): GraphSnapshot['edges'] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rebind = (ref: GraphSnapshot['edges'][number]['sourceNodeRef']) => {
    const node = nodeById.get(ref.nodeId);
    return ref.graphKind === 'intent' && ref.graphId === graphId && node
      ? {
        ...ref,
        nodeVersion: node.version,
        snapshotId,
        snapshotContentHash: '0'.repeat(64),
      }
      : ref;
  };
  return edges.map((edge) => ({
    ...edge,
    sourceNodeRef: rebind(edge.sourceNodeRef),
    targetNodeRef: rebind(edge.targetNodeRef),
  }));
}

function rankQuestion(question: QuestionDraft): number {
  return question.uncertaintyReduction
    * question.implementationImpact
    * question.driftRisk
    * question.dependencyCount;
}

function canonicalStatement(value: string): string {
  return value.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
}

const questionStopWords = new Set([
  'a', 'an', 'and', 'are', 'be', 'by', 'do', 'does', 'for', 'how', 'in', 'is',
  'it', 'of', 'on', 'or', 'should', 'the', 'this', 'to', 'what', 'which', 'who', 'will', 'would',
]);

function questionTerms(value: string): Set<string> {
  const aliases: Record<string, string> = {
    assigned: 'assign',
    assignment: 'assign',
    audience: 'user',
    users: 'user',
    goal: 'outcome',
    purpose: 'outcome',
    result: 'outcome',
    save: 'persist',
    saved: 'persist',
    storage: 'persist',
    store: 'persist',
    stored: 'persist',
    sees: 'see',
    seen: 'see',
    volunteers: 'volunteer',
  };
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !questionStopWords.has(word))
    .map((word) => aliases[word] ?? word));
}

function questionAlreadyAnswered(question: QuestionDraft, nodes: readonly GraphNode[]): boolean {
  const terms = questionTerms(question.text);
  if (terms.size < 2) return false;
  return nodes.some((node) => {
    if (node.status !== 'confirmed' || !node.approvedByUser || node.type === 'Question') return false;
    const statementTerms = questionTerms(node.statementOrName);
    const shared = [...terms].filter((term) => statementTerms.has(term)).length;
    return shared / terms.size >= 0.6;
  });
}

function sameQuestion(
  left: { text: string; category: string },
  right: { text: string; category: string },
): boolean {
  if (canonicalStatement(left.text) === canonicalStatement(right.text)) return true;
  if (left.category !== right.category) return false;
  const a = questionTerms(left.text);
  const b = questionTerms(right.text);
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((term) => b.has(term)).length;
  return shared / Math.min(a.size, b.size) >= 0.75;
}

function questionTarget(nodes: readonly GraphNode[], category: string, text: string): GraphNode | undefined {
  const preferences: Record<string, readonly string[]> = {
    Outcome: ['Goal', 'Problem'],
    User: ['UserType', 'UseCase', 'Goal'],
    Input: ['Input', 'Behavior', 'UseCase', 'Goal'],
    Behavior: ['Behavior', 'UseCase', 'Goal'],
    Output: ['Output', 'Behavior', 'Goal'],
    Scope: ['Goal', 'UseCase', 'Behavior'],
    Exclusions: ['Exclusion', 'Constraint', 'Goal'],
    Experience: ['Preference', 'UseCase', 'Goal'],
    Data: ['Input', 'Output', 'Constraint', 'Behavior'],
    Constraints: ['Constraint', 'Behavior', 'Goal'],
    Success: ['SuccessCriterion', 'Output', 'Goal'],
  };
  const types = preferences[category] ?? ['Goal', 'UseCase', 'Behavior'];
  const terms = questionTerms(`${category} ${text}`);
  const candidates = nodes.filter((node) => !['Question', 'Decision'].includes(node.type));
  return candidates.map((node, index) => {
    const statementTerms = questionTerms(node.statementOrName);
    const sharedTerms = [...terms].filter((term) => statementTerms.has(term)).length;
    const typePreference = types.indexOf(node.type);
    return {
      node,
      // Matching the actual stated requirement is more important than recency;
      // category ordering resolves otherwise equal candidates predictably.
      score: sharedTerms * 10_000 + (typePreference >= 0 ? (types.length - typePreference) * 100 : 0) + index,
    };
  }).sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))[0]?.node;
}

const readinessCategories: readonly Readonly<{
  name: string;
  types: readonly string[];
  every?: boolean;
}>[] = [
  { name: 'scope', types: ['Goal', 'Problem', 'UseCase'] },
  { name: 'users or usage context', types: ['UserType', 'UseCase'] },
  { name: 'behavior', types: ['Behavior', 'UseCase'] },
  { name: 'input and output', types: ['Input', 'Output'], every: true },
  { name: 'constraints and exclusions', types: ['Constraint', 'Exclusion'] },
  { name: 'success criteria', types: ['SuccessCriterion'] },
];

function isActiveIntentRequirement(node: Pick<GraphNode, 'type' | 'status'>): boolean {
  return node.type !== 'Question' && !['rejected', 'superseded'].includes(node.status);
}

export function intentReadinessGaps(nodes: readonly Pick<GraphNode, 'type' | 'status'>[]): string[] {
  const active = nodes.filter(isActiveIntentRequirement);
  return readinessCategories.flatMap(({ name, types, every }) => {
    const ready = every
      ? types.every((type) => active.some((node) => node.type === type))
      : types.some((type) => active.some((node) => node.type === type));
    return ready ? [] : [name];
  });
}

function groundedInOwnerAnswer(sourceQuote: string, ownerContent: string): boolean {
  const quote = canonicalStatement(sourceQuote);
  const answer = canonicalStatement(ownerContent);
  if (!quote || !answer) return false;
  if (answer.includes(quote)) return true;
  const quoteTerms = questionTerms(quote);
  const answerTerms = questionTerms(answer);
  if (quoteTerms.size < 2) return false;
  const shared = [...quoteTerms].filter((term) => answerTerms.has(term)).length;
  return shared / quoteTerms.size >= 0.6;
}

function relatedCandidate(
  node: GraphNode,
  candidates: readonly GraphNode[],
  types: readonly string[],
): GraphNode | undefined {
  const compatible = candidates.filter((candidate) => candidate.id !== node.id && types.includes(candidate.type));
  if (compatible.length === 0) return undefined;
  if (compatible.length === 1) return compatible[0];
  const sourceTerms = questionTerms(node.statementOrName);
  const ranked = compatible.map((candidate, index) => ({
    candidate,
    shared: [...sourceTerms].filter((term) => questionTerms(candidate.statementOrName).has(term)).length,
    index,
  })).sort((left, right) =>
    right.shared - left.shared || right.index - left.index || left.candidate.id.localeCompare(right.candidate.id));
  return ranked[0]!.shared > 0 ? ranked[0]!.candidate : undefined;
}

function attachmentFor(node: GraphNode, candidates: readonly GraphNode[]):
  Readonly<{ type: string; source: GraphNode; target: GraphNode }> | undefined {
  const byType: Record<string, readonly [string, string[]]> = {
    Constraint: ['CONSTRAINT_LIMITS', ['Goal', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output']],
    Exclusion: ['EXCLUSION_PROHIBITS', ['Goal', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output']],
    Preference: ['PREFERENCE_INFLUENCES', ['Goal', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output']],
    Assumption: ['ASSUMPTION_SUPPORTS', ['Goal', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output']],
    Example: ['EXAMPLE_CLARIFIES', ['Goal', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output']],
  };
  const specific = byType[node.type];
  if (specific) {
    const preferred = relatedCandidate(node, candidates, specific[1]);
    if (preferred) return { type: specific[0], source: node, target: preferred };
  }
  if (node.type === 'Problem') {
    const goal = relatedCandidate(node, candidates, ['Goal']);
    if (goal) return { type: 'GOAL_SOLVES_PROBLEM', source: goal, target: node };
  }
  if (node.type === 'UseCase') {
    const user = relatedCandidate(node, candidates, ['UserType']);
    if (user) return { type: 'USER_PERFORMS_USE_CASE', source: user, target: node };
  }
  if (node.type === 'Behavior') {
    const useCase = relatedCandidate(node, candidates, ['UseCase']);
    if (useCase) return { type: 'USE_CASE_REQUIRES_BEHAVIOR', source: useCase, target: node };
  }
  if (node.type === 'Input') {
    const behavior = relatedCandidate(node, candidates, ['Behavior']);
    if (behavior) return { type: 'BEHAVIOR_ACCEPTS_INPUT', source: behavior, target: node };
  }
  if (node.type === 'Output') {
    const behavior = relatedCandidate(node, candidates, ['Behavior']);
    if (behavior) return { type: 'BEHAVIOR_PRODUCES_OUTPUT', source: behavior, target: node };
  }
  if (node.type === 'SuccessCriterion') {
    const validated = relatedCandidate(node, candidates, ['Goal', 'UseCase', 'Behavior', 'Output']);
    if (validated) return { type: 'SUCCESS_VALIDATES', source: node, target: validated };
  }
  return undefined;
}

function makeIntentNode(
  draft: IntentNodeDraft,
  messageId: string,
  id: string,
  now: string,
): GraphNode {
  return {
    id,
    stableId: id,
    version: 1,
    type: draft.type,
    status: draft.status,
    statementOrName: draft.statement,
    createdAt: now,
    updatedAt: now,
    sourceRefs: [{ sourceId: messageId }],
    actorRef: actor,
    attributes: {},
    sourceQuote: draft.sourceQuote,
    originalInterpretation: draft.sourceQuote,
    normalizedInterpretation: draft.normalizedInterpretation,
    confidence: draft.confidence,
    approvedByUser: false,
  };
}

export class ProjectService {
  private value: ProjectConversationState;

  constructor(
    initial: ProjectConversationState,
    private readonly provider: ProposalProviderBoundary,
    private readonly authority: AuthorityServices,
    private readonly sink?: ProjectStateSink,
    private readonly ownerActor: ProjectOwnerActor = {
      actorId: 'local-owner',
      actorKind: 'authenticated_project_owner',
    },
  ) {
    this.value = ProjectConversationStateSchema.parse(initial);
  }

  private replace(next: unknown): void {
    this.value = ProjectConversationStateSchema.parse(next);
    this.sink?.persist(this.state());
  }

  state(): Readonly<ProjectConversationState> {
    return freeze(structuredClone(this.value));
  }

  intentReadinessGaps(): readonly string[] {
    return freeze([...intentReadinessGaps(this.value.intentGraph?.nodes ?? [])]);
  }

  private approvedIntentNodes(): readonly GraphNode[] {
    const graph = this.value.intentGraph;
    const baseline = this.value.approvedBaselines.find((item) =>
      item.graphKind === 'intent'
      && item.baselineId === this.value.project.activeIntentBaselineId
      && item.snapshotId === graph?.snapshotId
      && item.snapshotContentHash === graph?.contentHash);
    if (!graph || !baseline) throw new ProjectServiceError('missing_baseline', 'The active Intent baseline is missing.');
    const memberIds = new Set(baseline.nodeVersions.map((node) => node.nodeId));
    return graph.nodes.filter((node) => memberIds.has(node.id));
  }

  async submitMessage(
    content: string,
    suppliedMessageId?: string,
    resolutionContext?: ResolutionContext,
  ): Promise<Readonly<ProjectConversationState>> {
    const now = this.authority.now();
    const message = {
      messageId: suppliedMessageId ?? this.authority.nextId('message'),
      projectId: this.value.project.projectId,
      actor: 'owner' as const,
      content,
      createdAt: now,
    };
    const messages = [...this.value.messages, message];
    const proposalContext = {
      message,
      priorIntentNodes: this.value.intentGraph?.nodes.map((node) => ({
        stableId: node.stableId,
        statement: node.statementOrName,
        type: node.type,
        status: node.status,
      })) ?? [],
      priorQuestions: [
        ...this.value.questionResolutions.flatMap((resolution) => resolution.questionText ? [{
          text: resolution.questionText,
          category: resolution.category ?? 'Scope',
          disposition: resolution.disposition,
          ownerContent: resolution.ownerContent,
        }] : []),
        ...(this.value.currentQuestion ? [{
          text: this.value.currentQuestion.text,
          category: this.value.currentQuestion.category,
          disposition: 'open' as const,
        }] : []),
      ],
    };
    let proposal;
    try {
      proposal = ProposalOutputSchema.parse(await this.provider.propose(proposalContext));
      const readinessGaps = proposal.questions.length === 0 && !this.value.currentQuestion
        ? intentReadinessGaps([
          ...(this.value.intentGraph?.nodes ?? []),
          ...proposal.intentNodes,
        ])
        : [];
      if (readinessGaps.length) {
        const retry = ProposalOutputSchema.parse(await this.provider.propose({
          ...proposalContext,
          readinessGaps,
        }));
        proposal = { ...proposal, questions: retry.questions };
      }
    } catch (cause) {
      this.replace({ ...this.value, messages });
      throw new ProjectServiceError('provider_failed', cause instanceof Error ? cause.message : 'Proposal provider failed.');
    }

    const previous = this.value.intentGraph;
    if (proposal.intentNodes.length === 0 && proposal.corrections.length === 0) {
      this.replace({ ...this.value, messages });
      throw new ProjectServiceError('provider_failed', 'The proposal contained no Intent change.');
    }
    const unknownCorrection = proposal.corrections.find((correction) =>
      !previous?.nodes.some((node) => node.stableId === correction.targetStableId),
    );
    if (unknownCorrection) {
      this.replace({ ...this.value, messages });
      throw new ProjectServiceError('invalid_trace', 'A correction target does not exist in the current Intent graph.');
    }
    let nodes = previous?.nodes.map((node) => ({ ...node })) ?? [];
    let edges = previous?.edges.map((edge) => ({ ...edge })) ?? [];
    let corrections = [...this.value.corrections];
    for (const correction of proposal.corrections) {
      const index = nodes.findIndex((node) => node.stableId === correction.targetStableId);
      if (index < 0) throw new ProjectServiceError('invalid_trace', 'A correction target disappeared.');
      const prior = nodes[index]!;
      const nextVersion = prior.version + 1;
      const baseCorrection = {
        correctionId: this.authority.nextId('correction'),
        nodeId: prior.stableId,
        priorVersion: prior.version,
        nextVersion,
        sourceMessageId: message.messageId,
        rawContent: correction.sourceQuote,
        normalizedContent: correction.statement,
        createdAt: now,
      };
      appendCorrection(corrections.map((entry) => ({
        correctionId: entry.correctionId,
        nodeId: entry.nodeId,
        priorVersion: entry.priorVersion,
        nextVersion: entry.nextVersion,
        sourceMessageId: entry.sourceMessageId,
        rawContent: entry.rawContent,
        normalizedContent: entry.normalizedContent,
        createdAt: entry.createdAt,
      })), baseCorrection);
      corrections.push({
        ...baseCorrection,
        priorStatement: prior.statementOrName,
        nextStatement: correction.statement,
        priorInterpretation: prior.normalizedInterpretation ?? prior.statementOrName,
        nextInterpretation: correction.statement,
      });
      nodes[index] = {
        ...prior,
        id: `${prior.stableId}:v${nextVersion}`,
        version: nextVersion,
        status: resolutionContext && groundedInOwnerAnswer(correction.sourceQuote, resolutionContext.ownerContent)
          ? 'confirmed'
          : 'proposed',
        statementOrName: correction.statement,
        updatedAt: now,
        sourceRefs: [...prior.sourceRefs, { sourceId: message.messageId }],
        sourceQuote: correction.sourceQuote,
        originalInterpretation: correction.sourceQuote,
        normalizedInterpretation: correction.statement,
        confidence: resolutionContext && groundedInOwnerAnswer(correction.sourceQuote, resolutionContext.ownerContent)
          ? 1
          : prior.confidence,
        approvedByUser: Boolean(
          resolutionContext && groundedInOwnerAnswer(correction.sourceQuote, resolutionContext.ownerContent),
        ),
        actorRef: resolutionContext && groundedInOwnerAnswer(correction.sourceQuote, resolutionContext.ownerContent)
          ? this.ownerActor
          : prior.actorRef,
      };
    }
    const addedIntentNodes: GraphNode[] = [];
    for (const draft of proposal.intentNodes) {
      const normalized = canonicalStatement(draft.normalizedInterpretation || draft.statement);
      if (nodes.some((node) =>
        canonicalStatement(node.normalizedInterpretation ?? node.statementOrName) === normalized
      )) continue;
      const node = makeIntentNode(draft, message.messageId, this.authority.nextId('intent-node'), now);
      const ownerConfirmed = Boolean(
        resolutionContext && groundedInOwnerAnswer(draft.sourceQuote, resolutionContext.ownerContent),
      );
      const nextNode = ownerConfirmed ? {
        ...node,
        status: 'confirmed' as const,
        confidence: 1,
        approvedByUser: true,
        actorRef: this.ownerActor,
      } : node;
      nodes.push(nextNode);
      addedIntentNodes.push(nextNode);
    }

    let resolvedQuestionNode: GraphNode | undefined;
    let decisionNode: GraphNode | undefined;
    if (resolutionContext) {
      const questionIndex = nodes.findIndex((node) =>
        node.stableId === resolutionContext.question.questionId && node.type === 'Question');
      if (questionIndex < 0) {
        throw new ProjectServiceError('invalid_trace', 'The resolved question is missing from the Intent graph.');
      }
      const prior = nodes[questionIndex]!;
      const nextVersion = prior.version + 1;
      resolvedQuestionNode = {
        ...prior,
        id: `${prior.stableId}:v${nextVersion}`,
        version: nextVersion,
        status: 'confirmed',
        updatedAt: now,
        sourceRefs: [...prior.sourceRefs, { sourceId: message.messageId }],
        approvedByUser: true,
      };
      nodes[questionIndex] = resolvedQuestionNode;
      edges = edges.map((edge) => ({
        ...edge,
        sourceNodeRef: edge.sourceNodeRef.nodeId === prior.id
          ? { ...edge.sourceNodeRef, nodeId: resolvedQuestionNode!.id, nodeVersion: nextVersion }
          : edge.sourceNodeRef,
        targetNodeRef: edge.targetNodeRef.nodeId === prior.id
          ? { ...edge.targetNodeRef, nodeId: resolvedQuestionNode!.id, nodeVersion: nextVersion }
          : edge.targetNodeRef,
      }));
      const existingDecisionIndex = nodes.findIndex((node) =>
        node.type === 'Decision'
        && canonicalStatement(node.statementOrName) === canonicalStatement(resolutionContext.ownerContent));
      if (existingDecisionIndex >= 0) {
        const existing = nodes[existingDecisionIndex]!;
        decisionNode = {
          ...existing,
          status: 'confirmed',
          approvedByUser: true,
          confidence: 1,
          actorRef: this.ownerActor,
        };
        nodes[existingDecisionIndex] = decisionNode;
      } else {
        const id = this.authority.nextId('intent-decision');
        decisionNode = {
          id,
          stableId: id,
          version: 1,
          type: 'Decision',
          status: 'confirmed',
          statementOrName: resolutionContext.ownerContent,
          createdAt: now,
          updatedAt: now,
          sourceRefs: [{ sourceId: message.messageId }],
          actorRef: this.ownerActor,
          attributes: {},
          sourceQuote: resolutionContext.ownerContent,
          originalInterpretation: resolutionContext.ownerContent,
          normalizedInterpretation: resolutionContext.ownerContent,
          confidence: 1,
          approvedByUser: true,
        };
        nodes.push(decisionNode);
      }
    }

    const questionHistory = this.value.questionResolutions.flatMap((resolution) =>
      resolution.questionText ? [{
        text: resolution.questionText,
        category: resolution.category ?? 'Scope',
      }] : []);
    const best = proposal.questions
      .filter((question) => !questionHistory.some((prior) => sameQuestion(question, prior)))
      .filter((question) => !questionAlreadyAnswered(question, nodes))
      .sort((a, b) => rankQuestion(b) - rankQuestion(a) || a.text.localeCompare(b.text))[0];
    const currentQuestion = this.value.currentQuestion ?? (best ? {
      ...best,
      questionId: this.authority.nextId('question'),
      score: rankQuestion(best),
      sourceMessageId: message.messageId,
    } : null);
    const questionAlreadyExists = currentQuestion
      ? nodes.some((node) => node.stableId === currentQuestion.questionId && node.type === 'Question')
      : false;
    if (currentQuestion && !questionAlreadyExists) {
      nodes.push({
        id: currentQuestion.questionId,
        stableId: currentQuestion.questionId,
        version: 1,
        type: 'Question',
        status: 'unresolved',
        statementOrName: currentQuestion.text,
        createdAt: now,
        updatedAt: now,
        sourceRefs: [{ sourceId: currentQuestion.sourceMessageId }],
        actorRef: actor,
        attributes: {
          category: currentQuestion.category,
          blocking: currentQuestion.blocking,
          score: currentQuestion.score,
        },
        sourceQuote: currentQuestion.text,
        originalInterpretation: currentQuestion.text,
        normalizedInterpretation: currentQuestion.text,
        confidence: 0.89,
        approvedByUser: false,
      });
    }

    const snapshotId = this.authority.nextId('intent-snapshot');
    const graphId = previous?.graphId ?? this.authority.nextId('intent-graph');
    const localRef = (node: GraphNode) => ({
      graphKind: 'intent' as const,
      graphId,
      nodeId: node.id,
      nodeVersion: node.version,
      snapshotId,
      snapshotContentHash: '0'.repeat(64),
    });
    if (currentQuestion && !questionAlreadyExists) {
      const questionNode = nodes.find((node) => node.stableId === currentQuestion.questionId)!;
      const target = questionTarget(nodes, currentQuestion.category, currentQuestion.text);
      if (target && target.id !== questionNode.id) {
        edges.push({
          id: this.authority.nextId('intent-edge'),
          version: 1,
          type: 'QUESTION_RESOLVES',
          sourceNodeRef: localRef(questionNode),
          targetNodeRef: localRef(target),
          status: 'confirmed',
          createdAt: now,
          updatedAt: now,
          sourceRefs: [{ sourceId: currentQuestion.sourceMessageId }],
          attributes: {},
        });
      }
    }
    if (decisionNode && resolvedQuestionNode) {
      edges.push({
        id: this.authority.nextId('intent-edge'),
        version: 1,
        type: 'DECISION_RESOLVES',
        sourceNodeRef: localRef(decisionNode),
        targetNodeRef: localRef(resolvedQuestionNode),
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
        sourceRefs: [{ sourceId: message.messageId }],
        attributes: {},
      });
    }
    for (const node of addedIntentNodes) {
      const attachment = attachmentFor(node, nodes);
      if (!attachment || edges.some((edge) =>
        edge.type === attachment.type
        && edge.sourceNodeRef.nodeId === attachment.source.id
        && edge.targetNodeRef.nodeId === attachment.target.id,
      )) continue;
      edges.push({
        id: this.authority.nextId('intent-edge'),
        version: 1,
        type: attachment.type,
        sourceNodeRef: localRef(attachment.source),
        targetNodeRef: localRef(attachment.target),
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
        sourceRefs: [{ sourceId: message.messageId }],
        attributes: {},
      });
    }
    edges = rebindLocalEdges(edges, nodes, graphId, snapshotId);
    const graph = bindLocalEdgeHashes(snapshotWithHash({
      schemaVersion: '1.0.0',
      graphKind: 'intent',
      graphId,
      snapshotId,
      revision: (previous?.revision ?? 0) + 1,
      parentSnapshotId: previous?.snapshotId ?? null,
      parentSnapshotContentHash: previous?.contentHash ?? null,
      createdAt: now,
      createdBy: actor,
      nodes,
      edges,
      crossGraphLinks: [],
    }));
    this.replace({
      ...this.value,
      project: {
        ...this.value.project,
        lifecycleState: 'DISCOVERY',
        currentQuestionId: currentQuestion?.questionId ?? null,
        updatedAt: now,
      },
      messages,
      intentGraph: graph,
      corrections,
      currentQuestion,
    });
    return this.state();
  }

  createReviewProjection(graphKind: 'intent' | 'solution'): Readonly<ProjectionRecord> {
    const graph = graphKind === 'intent' ? this.value.intentGraph : this.value.solutionGraph;
    if (!graph) throw new ProjectServiceError('missing_graph', `No ${graphKind} graph exists.`);
    if (graphKind === 'intent') {
      if (this.value.currentQuestion?.blocking) {
        throw new ProjectServiceError('wrong_state', 'A blocking question must be resolved before Intent review.');
      }
      const gaps = intentReadinessGaps(graph.nodes);
      if (gaps.length) {
        throw new ProjectServiceError('wrong_state', `Intent review needs: ${gaps.join(', ')}.`);
      }
    }
    const now = this.authority.now();
    const data = {
      graphKind,
      snapshotId: graph.snapshotId,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        version: node.version,
        type: node.type,
        status: node.status,
        statement: node.statementOrName,
        ...(graphKind === 'solution' ? {
          scope: node.scope,
          attributes: node.attributes,
          supports: node.supports ?? [],
        } : {}),
      })),
      ...(graphKind === 'solution' ? {
        edges: graph.edges.map((edge) => ({
          id: edge.id,
          version: edge.version,
          type: edge.type,
          status: edge.status,
          sourceNodeId: edge.sourceNodeRef.nodeId,
          targetNodeId: edge.targetNodeRef.nodeId,
          attributes: edge.attributes,
        })),
        traces: graph.crossGraphLinks.map((link) => ({
          id: link.id,
          type: link.type,
          sourceNodeId: link.source.nodeId,
          targetNodeId: link.target.nodeId,
        })),
      } : {}),
    };
    const projection = {
      projectionId: this.authority.nextId(`${graphKind}-projection`),
      graphKind,
      snapshotId: graph.snapshotId,
      contentHash: hashJson(data),
      data,
      generatedAt: now,
    };
    this.replace({
      ...this.value,
      project: {
        ...this.value.project,
        lifecycleState: graphKind === 'intent' ? 'INTENT_REVIEW' : 'SOLUTION_REVIEW',
        updatedAt: now,
      },
      projections: [...this.value.projections, projection],
    });
    return freeze(projection);
  }

  resolveCurrentQuestion(
    expectedQuestionId: string,
    disposition: 'answered' | 'deferred',
    ownerContent: string,
    interpretAnswer = false,
  ): Readonly<ProjectConversationState> | Promise<Readonly<ProjectConversationState>> {
    const question = this.value.currentQuestion;
    if (
      !question
      || question.questionId !== expectedQuestionId
      || this.value.project.currentQuestionId !== expectedQuestionId
    ) {
      throw new ProjectServiceError('wrong_state', 'The expected question is not the exact current question.');
    }
    const now = this.authority.now();
    const messageId = this.authority.nextId('message');
    const message = {
      messageId,
      projectId: this.value.project.projectId,
      actor: 'owner' as const,
      content: ownerContent,
      createdAt: now,
    };
    const resolution = {
      resolutionId: this.authority.nextId('question-resolution'),
      questionId: question.questionId,
      questionText: question.text,
      category: question.category,
      disposition,
      ownerMessageId: messageId,
      ownerContent,
      resolvedAt: now,
    };
    if (disposition === 'answered' && interpretAnswer) {
      this.replace({
        ...this.value,
        project: {
          ...this.value.project,
          lifecycleState: 'DISCOVERY',
          currentQuestionId: null,
          updatedAt: now,
        },
        currentQuestion: null,
        questionResolutions: [...this.value.questionResolutions, resolution],
      });
      return this.submitMessage(ownerContent, messageId, {
        question,
        disposition: 'answered',
        ownerContent,
      });
    }
    let intentGraph = this.value.intentGraph;
    if (intentGraph) {
      const index = intentGraph.nodes.findIndex((node) =>
        node.stableId === question.questionId && node.type === 'Question');
      if (index >= 0) {
        const nodes = intentGraph.nodes.map((node) => ({ ...node }));
        const prior = nodes[index]!;
        const nextVersion = prior.version + 1;
        const nextId = `${prior.stableId}:v${nextVersion}`;
        nodes[index] = {
          ...prior,
          id: nextId,
          version: nextVersion,
          status: disposition === 'deferred' ? 'deferred' : 'confirmed',
          updatedAt: now,
          sourceRefs: [...prior.sourceRefs, { sourceId: messageId }],
          approvedByUser: disposition === 'answered',
        };
        let edges = intentGraph.edges.map((edge) => ({
          ...edge,
          sourceNodeRef: edge.sourceNodeRef.nodeId === prior.id
            ? { ...edge.sourceNodeRef, nodeId: nextId, nodeVersion: nextVersion }
            : edge.sourceNodeRef,
          targetNodeRef: edge.targetNodeRef.nodeId === prior.id
            ? { ...edge.targetNodeRef, nodeId: nextId, nodeVersion: nextVersion }
            : edge.targetNodeRef,
        }));
        const nextSnapshotId = this.authority.nextId('intent-snapshot');
        edges = rebindLocalEdges(edges, nodes, intentGraph.graphId, nextSnapshotId);
        intentGraph = bindLocalEdgeHashes(snapshotWithHash({
          ...intentGraph,
          snapshotId: nextSnapshotId,
          revision: intentGraph.revision + 1,
          parentSnapshotId: intentGraph.snapshotId,
          parentSnapshotContentHash: intentGraph.contentHash,
          createdAt: now,
          nodes,
          edges,
          crossGraphLinks: [],
        }));
      }
    }
    this.replace({
      ...this.value,
      project: {
        ...this.value.project,
        lifecycleState: 'DISCOVERY',
        currentQuestionId: null,
        updatedAt: now,
      },
      messages: [...this.value.messages, message],
      intentGraph,
      currentQuestion: null,
      questionResolutions: [...this.value.questionResolutions, resolution],
    });
    return this.state();
  }

  editIntentGraph(edit: IntentGraphEdit): Readonly<ProjectConversationState> {
    const graph = this.value.intentGraph;
    if (!graph || !['DISCOVERY', 'INTENT_REVIEW'].includes(this.value.project.lifecycleState)) {
      throw new ProjectServiceError('wrong_state', 'Intent graph edits require an unfrozen Intent graph.');
    }
    const now = this.authority.now();
    const messageId = this.authority.nextId('message');
    const message = {
      messageId,
      projectId: this.value.project.projectId,
      actor: 'owner' as const,
      content: edit.action === 'add-node' || edit.action === 'update-node'
        ? edit.statement.trim()
        : edit.action === 'connect'
          ? `Connect ${edit.sourceNodeId} to ${edit.targetNodeId} as ${edit.edgeType}.`
          : `Remove relationship ${edit.edgeId}.`,
      createdAt: now,
    };
    let nodes = graph.nodes.map((node) => ({ ...node }));
    let edges = graph.edges.map((edge) => ({ ...edge }));
    let corrections = [...this.value.corrections];

    if (edit.action === 'add-node') {
      const statement = edit.statement.trim();
      if (!statement || !edit.type.trim()) throw new ProjectServiceError('invalid_trace', 'Node type and statement are required.');
      const id = this.authority.nextId('intent-node');
      nodes.push({
        id,
        stableId: id,
        version: 1,
        type: edit.type.trim(),
        status: 'confirmed',
        statementOrName: statement,
        createdAt: now,
        updatedAt: now,
        sourceRefs: [{ sourceId: messageId }],
        actorRef: this.ownerActor,
        attributes: {},
        sourceQuote: statement,
        originalInterpretation: statement,
        normalizedInterpretation: statement,
        confidence: 1,
        approvedByUser: true,
      });
    } else if (edit.action === 'update-node') {
      const index = nodes.findIndex((node) => node.id === edit.nodeId || node.stableId === edit.nodeId);
      if (index < 0) throw new ProjectServiceError('invalid_trace', 'The edited Intent node does not exist.');
      const prior = nodes[index]!;
      const statement = edit.statement.trim();
      if (!statement || !edit.type.trim()) throw new ProjectServiceError('invalid_trace', 'Node type and statement are required.');
      const nextVersion = prior.version + 1;
      const nextId = `${prior.stableId}:v${nextVersion}`;
      const correction = {
        correctionId: this.authority.nextId('correction'),
        nodeId: prior.stableId,
        priorVersion: prior.version,
        nextVersion,
        sourceMessageId: messageId,
        rawContent: statement,
        normalizedContent: statement,
        createdAt: now,
      };
      appendCorrection(corrections, correction);
      corrections.push({
        ...correction,
        priorStatement: prior.statementOrName,
        nextStatement: statement,
        priorInterpretation: prior.normalizedInterpretation ?? prior.statementOrName,
        nextInterpretation: statement,
      });
      nodes[index] = {
        ...prior,
        id: nextId,
        version: nextVersion,
        type: edit.type.trim(),
        status: 'confirmed',
        statementOrName: statement,
        updatedAt: now,
        sourceRefs: [...prior.sourceRefs, { sourceId: messageId }],
        sourceQuote: statement,
        originalInterpretation: statement,
        normalizedInterpretation: statement,
        confidence: 1,
        approvedByUser: true,
      };
      edges = edges.map((edge) => ({
        ...edge,
        sourceNodeRef: edge.sourceNodeRef.nodeId === prior.id
          ? { ...edge.sourceNodeRef, nodeId: nextId, nodeVersion: nextVersion }
          : edge.sourceNodeRef,
        targetNodeRef: edge.targetNodeRef.nodeId === prior.id
          ? { ...edge.targetNodeRef, nodeId: nextId, nodeVersion: nextVersion }
          : edge.targetNodeRef,
      }));
    } else if (edit.action === 'connect') {
      const source = nodes.find((node) => node.id === edit.sourceNodeId);
      const target = nodes.find((node) => node.id === edit.targetNodeId);
      if (!source || !target || source.id === target.id) {
        throw new ProjectServiceError('invalid_trace', 'A relationship needs two different current Intent nodes.');
      }
      if (!edit.edgeType.trim()) throw new ProjectServiceError('invalid_trace', 'Relationship type is required.');
      const ref = (node: GraphNode) => ({
        graphKind: 'intent' as const,
        graphId: graph.graphId,
        nodeId: node.id,
        nodeVersion: node.version,
        snapshotId: graph.snapshotId,
        snapshotContentHash: graph.contentHash,
      });
      edges.push({
        id: this.authority.nextId('intent-edge'),
        version: 1,
        type: edit.edgeType.trim(),
        sourceNodeRef: ref(source),
        targetNodeRef: ref(target),
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
        sourceRefs: [{ sourceId: messageId }],
        attributes: {},
      });
    } else {
      if (!edges.some((edge) => edge.id === edit.edgeId)) {
        throw new ProjectServiceError('invalid_trace', 'The relationship does not exist.');
      }
      edges = edges.filter((edge) => edge.id !== edit.edgeId);
    }

    const nextGraph = snapshotWithHash({
      ...graph,
      snapshotId: this.authority.nextId('intent-snapshot'),
      revision: graph.revision + 1,
      parentSnapshotId: graph.snapshotId,
      parentSnapshotContentHash: graph.contentHash,
      createdAt: now,
      nodes,
      edges,
      crossGraphLinks: [],
    });
    this.replace({
      ...this.value,
      project: {
        ...this.value.project,
        lifecycleState: 'DISCOVERY',
        updatedAt: now,
      },
      messages: [...this.value.messages, message],
      intentGraph: nextGraph,
      corrections,
    });
    return this.state();
  }

  approve(graphKind: 'intent' | 'solution', approvalValue: ApprovalRecord): Readonly<ApprovedBaseline> {
    const approval = ApprovalRecordSchema.safeParse(approvalValue);
    if (!approval.success) throw new ProjectServiceError('invalid_approval', 'Owner approval is invalid.');
    if (this.value.approvedBaselines.some((item) =>
      item.baselineId === approval.data.artifactId
      || item.approvalRecord.approvalId === approval.data.approvalId,
    )) {
      throw new ProjectServiceError('invalid_approval', 'A baseline ID cannot be approved or replayed twice.');
    }
    const graph = graphKind === 'intent' ? this.value.intentGraph : this.value.solutionGraph;
    if (!graph) throw new ProjectServiceError('missing_graph', `No ${graphKind} graph exists.`);
    if (graphKind === 'intent') {
      if (this.value.currentQuestion?.blocking || intentReadinessGaps(graph.nodes).length) {
        throw new ProjectServiceError('wrong_state', 'Intent readiness is incomplete.');
      }
    }
    if (graphKind === 'solution') {
      const intent = this.value.intentGraph;
      const exactIntentBaseline = this.value.approvedBaselines.find((item) =>
        item.graphKind === 'intent'
        && item.baselineId === this.value.project.activeIntentBaselineId
        && item.snapshotId === intent?.snapshotId
        && item.snapshotContentHash === intent?.contentHash,
      );
      if (!exactIntentBaseline) {
        throw new ProjectServiceError('invalid_approval', 'Solution approval requires the exact active Intent snapshot.');
      }
    }
    const projection = [...this.value.projections].reverse().find(
      (item) => item.graphKind === graphKind && item.snapshotId === graph.snapshotId,
    );
    if (!projection) throw new ProjectServiceError('invalid_approval', 'The exact review projection is missing.');
    const baselineId = approval.data.artifactId;
    const result = approveBaseline({
      project: this.value.project,
      graphKind,
      baselineId,
      snapshotId: graph.snapshotId,
      snapshotContentHash: graph.contentHash,
      projectionId: projection.projectionId,
      projectionContentHash: projection.contentHash,
      displayedProjectionHash: approval.data.displayedProjectionHash,
      unresolvedBlockingQuestionIds: this.value.currentQuestion?.blocking ? [this.value.currentQuestion.questionId] : [],
      approval: approval.data,
      nodeVersions: graph.nodes.map((node) => ({ nodeId: node.id, version: node.version })),
      protectedAssertions: [],
      unresolvedNonBlocking: [],
      createdAt: approval.data.approvedAt,
      approvedBaselines: this.value.approvedBaselines,
    });
    this.replace({
      ...this.value,
      project: { ...result.project, currentQuestionId: null },
      currentQuestion: null,
      approvedBaselines: [...this.value.approvedBaselines, result.baseline],
    });
    return result.baseline;
  }

  async generateSolution(): Promise<Readonly<GraphSnapshot>> {
    if (!this.provider.planSolution) {
      throw new ProjectServiceError('provider_failed', 'No Solution planner is connected.');
    }
    if (this.value.project.lifecycleState !== 'INTENT_APPROVED' || !this.value.intentGraph) {
      throw new ProjectServiceError('wrong_state', 'An approved Intent baseline is required.');
    }
    let proposal: SolutionProposalOutput;
    try {
      proposal = SolutionProposalOutputSchema.parse(await this.provider.planSolution({
        intentNodes: this.approvedIntentNodes()
          .filter((node) => node.type !== 'Question' && !['rejected', 'superseded'].includes(node.status))
          .map((node) => ({ id: node.id, type: node.type, statement: node.statementOrName })),
      }));
    } catch (cause) {
      throw new ProjectServiceError(
        'provider_failed',
        cause instanceof Error ? cause.message : 'Solution planner failed.',
      );
    }
    return this.proposeSolution(proposal);
  }

  proposeSolution(
    proposal: SolutionProposalOutput,
    proposedBaselineId = 'solution-v1',
  ): Readonly<GraphSnapshot> {
    if (this.value.project.lifecycleState !== 'INTENT_APPROVED' || !this.value.intentGraph) {
      throw new ProjectServiceError('wrong_state', 'An approved Intent baseline is required.');
    }
    const intentBaseline = this.value.approvedBaselines.find((item) => item.graphKind === 'intent'
      && item.baselineId === this.value.project.activeIntentBaselineId
      && item.snapshotId === this.value.intentGraph!.snapshotId
      && item.snapshotContentHash === this.value.intentGraph!.contentHash);
    if (!intentBaseline) throw new ProjectServiceError('missing_baseline', 'The active Intent baseline is missing.');
    let parsed: SolutionProposalOutput;
    try {
      parsed = SolutionProposalOutputSchema.parse(proposal);
    } catch (cause) {
      throw new ProjectServiceError(
        'invalid_trace',
        cause instanceof Error ? cause.message : 'Solution proposal is invalid.',
      );
    }
    const now = this.authority.now();
    const knownFeatureKeys = new Set(parsed.features.map((feature) => feature.key));
    const knownRoleKeys = new Set(parsed.roles.map((role) => role.key));
    if (
      knownFeatureKeys.size !== parsed.features.length
      || knownRoleKeys.size !== parsed.roles.length
    ) throw new ProjectServiceError('invalid_trace', 'Solution feature and role keys must be unique.');
    const dependencyPairs = new Set<string>();
    const artifactKeysByProducer = new Map<string, Set<string>>();
    const prerequisitesByFeature = new Map<string, string[]>(
      parsed.features.map((feature) => [feature.key, []]),
    );
    for (const dependency of parsed.dependencies) {
      if (!knownFeatureKeys.has(dependency.featureKey) || !knownFeatureKeys.has(dependency.dependsOnFeatureKey)) {
        throw new ProjectServiceError('invalid_trace', 'Every feature dependency must name proposed features.');
      }
      if (dependency.featureKey === dependency.dependsOnFeatureKey) {
        throw new ProjectServiceError('invalid_trace', 'A feature cannot depend on itself.');
      }
      const pair = `${dependency.featureKey}\u0000${dependency.dependsOnFeatureKey}`;
      if (dependencyPairs.has(pair)) {
        throw new ProjectServiceError('invalid_trace', 'Feature dependencies must be unique.');
      }
      dependencyPairs.add(pair);
      if (new Set(dependency.artifacts.map((artifact) => artifact.key)).size !== dependency.artifacts.length) {
        throw new ProjectServiceError('invalid_trace', 'Artifact handoff keys must be unique per feature dependency.');
      }
      const producerKeys = artifactKeysByProducer.get(dependency.dependsOnFeatureKey) ?? new Set<string>();
      if (dependency.artifacts.some((artifact) => producerKeys.has(artifact.key))) {
        throw new ProjectServiceError('invalid_trace', 'Artifact handoff keys must be unique per producing feature.');
      }
      dependency.artifacts.forEach((artifact) => producerKeys.add(artifact.key));
      artifactKeysByProducer.set(dependency.dependsOnFeatureKey, producerKeys);
      prerequisitesByFeature.get(dependency.featureKey)!.push(dependency.dependsOnFeatureKey);
    }
    const visitingFeatures = new Set<string>();
    const visitedFeatures = new Set<string>();
    const visitFeature = (featureKey: string): void => {
      if (visitingFeatures.has(featureKey)) {
        throw new ProjectServiceError('invalid_trace', 'Feature dependencies must be acyclic.');
      }
      if (visitedFeatures.has(featureKey)) return;
      visitingFeatures.add(featureKey);
      prerequisitesByFeature.get(featureKey)!.forEach(visitFeature);
      visitingFeatures.delete(featureKey);
      visitedFeatures.add(featureKey);
    };
    parsed.features.forEach((feature) => visitFeature(feature.key));
    const approvedIntentNodes = this.approvedIntentNodes();
    for (const item of [...parsed.features, ...parsed.roles]) {
      if (item.intentNodeIds.length === 0 || item.intentNodeIds.some(
        (nodeId) => !approvedIntentNodes.some((node) => node.id === nodeId),
      )) {
        throw new ProjectServiceError('invalid_trace', 'Every Solution node must name existing Intent nodes.');
      }
    }
    const assignedTaskTypes = new Map<string, Set<SolutionTaskType>>();
    const roleTasksByFeature = new Map<string, Map<SolutionTaskType, Set<string>>>();
    const usedRoleKeys = new Set<string>();
    for (const assignment of parsed.assignments) {
      if (!knownFeatureKeys.has(assignment.featureKey) || !knownRoleKeys.has(assignment.roleKey)) {
        throw new ProjectServiceError('invalid_trace', 'Every assignment must name a proposed feature and role.');
      }
      usedRoleKeys.add(assignment.roleKey);
      const taskTypes = assignedTaskTypes.get(assignment.featureKey) ?? new Set<SolutionTaskType>();
      assignment.taskTypes.forEach((taskType) => {
        taskTypes.add(taskType);
        const rolesByTask = roleTasksByFeature.get(assignment.featureKey) ?? new Map<SolutionTaskType, Set<string>>();
        const roleKeys = rolesByTask.get(taskType) ?? new Set<string>();
        roleKeys.add(assignment.roleKey);
        rolesByTask.set(taskType, roleKeys);
        roleTasksByFeature.set(assignment.featureKey, rolesByTask);
      });
      assignedTaskTypes.set(assignment.featureKey, taskTypes);
    }
    if (parsed.roles.some((role) => !usedRoleKeys.has(role.key))) {
      throw new ProjectServiceError('invalid_trace', 'Every role must be assigned to work.');
    }
    if (parsed.features.some((feature) =>
      !['Implement', 'Verify'].every((taskType) =>
        assignedTaskTypes.get(feature.key)?.has(taskType as SolutionTaskType)))) {
      throw new ProjectServiceError('invalid_trace', 'Every feature needs Implement and Verify work.');
    }
    if (parsed.features.some((feature) => {
      const roleTasks = roleTasksByFeature.get(feature.key);
      const implementRoles = roleTasks?.get('Implement') ?? new Set<string>();
      const verifyRoles = roleTasks?.get('Verify') ?? new Set<string>();
      return ![...verifyRoles].some((roleKey) => !implementRoles.has(roleKey));
    })) {
      throw new ProjectServiceError('invalid_trace', 'Every feature needs an independent verification role.');
    }
    const snapshotId = this.authority.nextId('solution-snapshot');
    const graphId = this.authority.nextId('solution-graph');
    const featureNodes = parsed.features.map((feature) => ({
      id: this.authority.nextId('solution-node'),
      stableId: this.authority.nextId('solution-stable'),
      version: 1,
      type: 'Feature',
      status: 'proposed',
      statementOrName: feature.name,
      createdAt: now,
      updatedAt: now,
      sourceRefs: [],
      actorRef: actor,
      attributes: { intentNodeIds: [...feature.intentNodeIds] },
      scope: 'product' as const,
    }));
    const featureByKey = new Map(parsed.features.map((feature, index) => [feature.key, featureNodes[index]!]));
    const roleNodes = parsed.roles.map((role) => ({
      id: this.authority.nextId('solution-role'),
      stableId: this.authority.nextId('solution-role-stable'),
      version: 1,
      type: 'Role',
      status: 'proposed',
      statementOrName: role.name,
      createdAt: now,
      updatedAt: now,
      sourceRefs: [],
      actorRef: actor,
      attributes: {
        intentNodeIds: [...role.intentNodeIds],
        roleKey: role.key,
        job: role.job,
        use: [...role.use],
        touch: [...role.touch],
        dont: [...role.dont],
        done: [...role.done],
      },
      scope: 'implementation_support' as const,
      supports: [...new Set(parsed.assignments
        .filter((assignment) => assignment.roleKey === role.key)
        .map((assignment) => assignment.featureKey))]
        .map((featureKey) => {
          const feature = featureByKey.get(featureKey)!;
          return {
            graphKind: 'solution' as const,
            graphId,
            nodeId: feature.id,
            nodeVersion: feature.version,
            snapshotId,
            snapshotContentHash: '0'.repeat(64),
          };
        }),
    }));
    const nodes = [...featureNodes, ...roleNodes];
    const roleByKey = new Map(parsed.roles.map((role, index) => [role.key, roleNodes[index]!]));
    const solutionRef = (node: GraphNode) => ({
      graphKind: 'solution' as const,
      graphId,
      nodeId: node.id,
      nodeVersion: node.version,
      snapshotId,
      snapshotContentHash: '0'.repeat(64),
    });
    const assignmentEdges = parsed.assignments.map((assignment, index) => ({
      id: this.authority.nextId('solution-assignment'),
      version: 1,
      type: 'USES',
      sourceNodeRef: solutionRef(featureByKey.get(assignment.featureKey)!),
      targetNodeRef: solutionRef(roleByKey.get(assignment.roleKey)!),
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      sourceRefs: [],
      attributes: {
        assignmentIndex: index,
        taskTypes: [...new Set(assignment.taskTypes)],
      },
    }));
    const dependencyEdges = parsed.dependencies.map((dependency) => ({
      id: this.authority.nextId('solution-dependency'),
      version: 1,
      type: 'DEPENDS_ON',
      sourceNodeRef: solutionRef(featureByKey.get(dependency.featureKey)!),
      targetNodeRef: solutionRef(featureByKey.get(dependency.dependsOnFeatureKey)!),
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      sourceRefs: [],
      attributes: {
        kind: 'feature_handoff',
        artifacts: cloneHandoffArtifacts(dependency.artifacts),
      },
    }));
    const edges = [...assignmentEdges, ...dependencyEdges];
    const intentIdsByNode = new Map<string, readonly string[]>([
      ...parsed.features.map((feature, index) => [featureNodes[index]!.id, feature.intentNodeIds] as const),
      ...parsed.roles.map((role, index) => [roleNodes[index]!.id, role.intentNodeIds] as const),
    ]);
    let draft = snapshotWithHash({
      schemaVersion: '1.0.0',
      graphKind: 'solution',
      graphId,
      snapshotId,
      revision: 1,
      parentSnapshotId: null,
      parentSnapshotContentHash: null,
      createdAt: now,
      createdBy: actor,
      nodes,
      edges,
      crossGraphLinks: [],
    });
    const crossGraphLinks = nodes.flatMap((node, nodeIndex) =>
      [...(intentIdsByNode.get(node.id) ?? [])].map((nodeId, targetIndex) => ({
        id: `trace-solution-${nodeIndex + 1}-${targetIndex + 1}`,
        type: 'SATISFIES_INTENT' as const,
        source: {
          graphKind: 'solution',
          graphId,
          nodeId: node.id,
          nodeVersion: node.version,
          snapshotId,
          snapshotContentHash: draft.contentHash,
        },
        target: {
          graphKind: 'intent',
          graphId: this.value.intentGraph!.graphId,
          nodeId,
          nodeVersion: this.value.intentGraph!.nodes.find((candidate) => candidate.id === nodeId)?.version ?? 1,
          snapshotId: this.value.intentGraph!.snapshotId,
          snapshotContentHash: this.value.intentGraph!.contentHash,
        },
        sourceBaselineId: proposedBaselineId,
        targetBaselineId: intentBaseline.baselineId,
        createdAt: now,
        transformationId: 'solution-planner-v1',
      })));
    draft = { ...draft, crossGraphLinks };
    const graph = bindLocalTraceHashes(bindLocalEdgeHashes(draft));
    this.replace({
      ...this.value,
      project: { ...this.value.project, lifecycleState: 'SOLUTION_REVIEW', updatedAt: now },
      solutionGraph: graph,
    });
    return freeze(graph);
  }

  compileExecution(): Readonly<GraphSnapshot> {
    const solution = this.value.solutionGraph;
    const solutionBaseline = this.value.approvedBaselines.find((item) => item.graphKind === 'solution'
      && item.baselineId === this.value.project.activeSolutionBaselineId
      && item.snapshotId === solution?.snapshotId
      && item.snapshotContentHash === solution?.contentHash);
    if (this.value.project.lifecycleState !== 'SOLUTION_APPROVED' || !solution || !solutionBaseline) {
      throw new ProjectServiceError('wrong_state', 'An approved Solution baseline is required.');
    }
    const now = this.authority.now();
    const snapshotId = this.authority.nextId('execution-snapshot');
    const graphId = this.authority.nextId('execution-graph');
    const features = solution.nodes.filter((node) => node.type === 'Feature');
    const roles = new Map(solution.nodes.filter((node) => node.type === 'Role').map((node) => [node.id, node]));
    const assignments = solution.edges.filter((edge) => edge.type === 'USES'
      && features.some((feature) => feature.id === edge.sourceNodeRef.nodeId)
      && roles.has(edge.targetNodeRef.nodeId));
    if (features.length === 0 || roles.size === 0 || assignments.length === 0) {
      throw new ProjectServiceError('invalid_trace', 'Approved Solution needs traced features and assigned roles.');
    }
    const work = assignments.flatMap((assignment) => {
      const feature = features.find((node) => node.id === assignment.sourceNodeRef.nodeId)!;
      const role = roles.get(assignment.targetNodeRef.nodeId)!;
      const taskTypes = [...new Set(
        Array.isArray(assignment.attributes.taskTypes)
          ? assignment.attributes.taskTypes.filter((value): value is SolutionTaskType =>
            executionStageOrder.includes(String(value) as SolutionTaskType))
          : [],
      )];
      return taskTypes.map((type) => ({ feature, role, type }));
    });
    if (features.some((feature) =>
      !['Implement', 'Verify'].every((type) =>
        work.some((item) => item.feature.id === feature.id && item.type === type)))) {
      throw new ProjectServiceError('invalid_trace', 'Approved role assignments require Implement and Verify work.');
    }
    if (features.some((feature) => {
      const implementRoleIds = new Set(work
        .filter((item) => item.feature.id === feature.id && item.type === 'Implement')
        .map((item) => item.role.id));
      return !work.some((item) =>
        item.feature.id === feature.id
        && item.type === 'Verify'
        && !implementRoleIds.has(item.role.id));
    })) {
      throw new ProjectServiceError('invalid_trace', 'Approved work has no independent verification role.');
    }
    const allowedPathsByStage: Readonly<Record<SolutionTaskType, readonly string[]>> = {
      Inspect: [],
      Decide: ['docs/plans/**', 'specs/**'],
      Implement: ['apps/**', 'packages/**', 'tests/**'],
      Test: ['tests/**'],
      Integrate: ['apps/**', 'packages/**', 'tests/**'],
      Verify: [],
      Document: ['docs/**', 'specs/**', 'README.md'],
      Release: ['.github/**', 'wrangler*.jsonc', 'package.json', 'package-lock.json'],
    };
    let nodes: GraphNode[] = work.map(({ feature, role, type }) => {
      const featureName = feature.statementOrName.replace(/[.!?]+$/, '');
      const roleName = role.statementOrName.replace(/[.!?]+$/, '');
      const roleJob = typeof role.attributes.job === 'string' && role.attributes.job.trim()
        ? role.attributes.job.trim()
        : `Apply the ${roleName} lens.`;
      const roleTouches = Array.isArray(role.attributes.touch)
        ? role.attributes.touch.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        : [];
      const roleDone = Array.isArray(role.attributes.done)
        ? role.attributes.done.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        : [];
      const taskWork = type === 'Implement' && roleTouches.length > 0
        ? roleTouches.join('; ')
        : roleJob;
      const taskLabel = type === 'Implement' ? taskWork : featureName;
      const allowedPaths = [...allowedPathsByStage[type]];
      return {
        id: this.authority.nextId('task'),
        stableId: this.authority.nextId('task-stable'),
        version: 1,
        type,
        status: 'blocked',
        statementOrName: `${type} — ${roleName}: ${taskLabel.replace(/[.!?]+$/, '')}`,
        createdAt: now,
        updatedAt: now,
        sourceRefs: [],
        actorRef: actor,
        attributes: {
          solutionNodeId: feature.id,
          roleRef: role.id,
          roleName,
          objective: `${taskWork.replace(/[.!?]+$/, '')} for ${featureName}.`,
          allowedPaths,
          acceptanceCommands: [{ argv: ['node', '--test'] }],
          acceptanceChecks: roleDone.length > 0
            ? roleDone
            : [`${roleName} work remains traced to ${featureName}.`],
        },
      };
    });
    const nodeRef = (node: GraphNode) => ({
      graphKind: 'execution' as const, graphId, nodeId: node.id, nodeVersion: 1,
      snapshotId, snapshotContentHash: '0'.repeat(64),
    });
    const stageRank = new Map(executionStageOrder.map((stage, index) => [stage, index]));
    const edges: GraphSnapshot['edges'] = [];
    const edgeKeys = new Set<string>();
    const addDependencyEdge = (
      source: GraphNode,
      target: GraphNode,
      attributes: GraphSnapshot['edges'][number]['attributes'],
    ): void => {
      const key = `${source.id}\u0000${target.id}\u0000DEPENDS_ON`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({
        id: this.authority.nextId('dependency'), version: 1, type: 'DEPENDS_ON',
        sourceNodeRef: nodeRef(source), targetNodeRef: nodeRef(target), status: 'confirmed',
        createdAt: now, updatedAt: now, sourceRefs: [], attributes,
      });
    };
    features.forEach((feature) => {
      const featureTasks = nodes.filter((node) => node.attributes.solutionNodeId === feature.id);
      const presentStages = executionStageOrder.filter((stage) =>
        featureTasks.some((task) => task.type === stage));
      presentStages.slice(1).forEach((stage, stageIndex) => {
        const current = featureTasks.filter((task) => task.type === stage);
        const prior = featureTasks.filter((task) => task.type === presentStages[stageIndex]);
        current.forEach((task) => prior.forEach((dependency, dependencyIndex) => {
          addDependencyEdge(task, dependency, { order: dependencyIndex + 1 });
        }));
      });
    });
    const featureIds = new Set(features.map((feature) => feature.id));
    const featureDependencies = solution.edges.filter((edge) => edge.type === 'DEPENDS_ON'
      && featureIds.has(edge.sourceNodeRef.nodeId)
      && featureIds.has(edge.targetNodeRef.nodeId));
    const solutionDependencyPairs = new Set<string>();
    const solutionArtifactKeysByProducer = new Map<string, Set<string>>();
    const solutionPrerequisites = new Map<string, string[]>(features.map((feature) => [feature.id, []]));
    const validatedFeatureDependencies = featureDependencies.map((dependency) => {
      const dependentId = dependency.sourceNodeRef.nodeId;
      const prerequisiteId = dependency.targetNodeRef.nodeId;
      if (dependentId === prerequisiteId) {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution contains a self-dependency.');
      }
      const pair = `${dependentId}\u0000${prerequisiteId}`;
      if (solutionDependencyPairs.has(pair)) {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution contains duplicate feature dependencies.');
      }
      solutionDependencyPairs.add(pair);
      if (dependency.attributes.kind !== 'feature_handoff' || !Array.isArray(dependency.attributes.artifacts)) {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution dependency is missing its feature handoff contract.');
      }
      let artifacts: SolutionArtifactHandoffDraft[];
      try {
        artifacts = dependency.attributes.artifacts.map((artifact) =>
          SolutionArtifactHandoffDraftSchema.parse(artifact));
      } catch {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution dependency has malformed handoff artifacts.');
      }
      if (artifacts.length === 0 || new Set(artifacts.map((artifact) => artifact.key)).size !== artifacts.length) {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution dependency has invalid handoff artifacts.');
      }
      const producerKeys = solutionArtifactKeysByProducer.get(prerequisiteId) ?? new Set<string>();
      if (artifacts.some((artifact) => producerKeys.has(artifact.key))) {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution reuses an artifact key for one producing feature.');
      }
      artifacts.forEach((artifact) => producerKeys.add(artifact.key));
      solutionArtifactKeysByProducer.set(prerequisiteId, producerKeys);
      solutionPrerequisites.get(dependentId)!.push(prerequisiteId);
      return { dependentId, prerequisiteId, artifacts: cloneHandoffArtifacts(artifacts) };
    });
    const visitingSolutionFeatures = new Set<string>();
    const visitedSolutionFeatures = new Set<string>();
    const visitSolutionFeature = (featureId: string): void => {
      if (visitingSolutionFeatures.has(featureId)) {
        throw new ProjectServiceError('invalid_trace', 'Approved Solution feature dependencies must be acyclic.');
      }
      if (visitedSolutionFeatures.has(featureId)) return;
      visitingSolutionFeatures.add(featureId);
      solutionPrerequisites.get(featureId)!.forEach(visitSolutionFeature);
      visitingSolutionFeatures.delete(featureId);
      visitedSolutionFeatures.add(featureId);
    };
    features.forEach((feature) => visitSolutionFeature(feature.id));
    const requiresArtifacts = new Map<string, SolutionArtifactHandoffDraft[]>();
    const producesArtifacts = new Map<string, SolutionArtifactHandoffDraft[]>();
    const addArtifacts = (
      target: Map<string, SolutionArtifactHandoffDraft[]>,
      task: GraphNode,
      artifacts: readonly SolutionArtifactHandoffDraft[],
    ): void => {
      const current = target.get(task.id) ?? [];
      const keys = new Set(current.map((artifact) => JSON.stringify(artifact)));
      artifacts.forEach((artifact) => {
        const key = JSON.stringify(artifact);
        if (!keys.has(key)) current.push({
          ...artifact,
          paths: [...artifact.paths],
          requiredEvidence: [...artifact.requiredEvidence],
        });
      });
      target.set(task.id, current);
    };
    validatedFeatureDependencies.forEach(({ dependentId, prerequisiteId, artifacts }) => {
      const dependentTasks = nodes.filter((task) => task.attributes.solutionNodeId === dependentId);
      const prerequisiteTasks = nodes.filter((task) => task.attributes.solutionNodeId === prerequisiteId);
      const entryRank = Math.min(...dependentTasks.map((task) => stageRank.get(task.type as SolutionTaskType)!));
      const terminalRank = Math.max(...prerequisiteTasks.map((task) => stageRank.get(task.type as SolutionTaskType)!));
      const entryTasks = dependentTasks.filter((task) => stageRank.get(task.type as SolutionTaskType) === entryRank);
      const terminalTasks = prerequisiteTasks.filter((task) => stageRank.get(task.type as SolutionTaskType) === terminalRank);
      entryTasks.forEach((entry) => {
        addArtifacts(requiresArtifacts, entry, artifacts);
        terminalTasks.forEach((terminal) => {
          addArtifacts(producesArtifacts, terminal, artifacts);
          addDependencyEdge(entry, terminal, {
            kind: 'feature_handoff',
            artifacts: cloneHandoffArtifacts(artifacts),
          });
        });
      });
    });
    nodes = nodes.map((node) => {
      const requires = requiresArtifacts.get(node.id);
      const produces = producesArtifacts.get(node.id);
      return !requires && !produces
        ? node
        : {
          ...node,
          attributes: {
            ...node.attributes,
            ...(requires ? { requiresArtifacts: requires } : {}),
            ...(produces ? { producesArtifacts: produces } : {}),
          },
        };
    });
    const draft = snapshotWithHash({
      schemaVersion: '1.0.0',
      graphKind: 'execution',
      graphId,
      snapshotId,
      revision: 1,
      parentSnapshotId: null,
      parentSnapshotContentHash: null,
      createdAt: now,
      createdBy: actor,
      nodes,
      edges,
      crossGraphLinks: [],
    });
    const crossGraphLinks = nodes.flatMap((node, index) => {
      const targets = [
        solution.nodes.find((candidate) => candidate.id === node.attributes.solutionNodeId),
        solution.nodes.find((candidate) => candidate.id === node.attributes.roleRef),
      ].filter((candidate): candidate is GraphNode => Boolean(candidate));
      return targets.map((target, targetIndex) => ({
        id: `trace-execution-${index + 1}-${targetIndex + 1}`,
        type: 'SATISFIES_SOLUTION' as const,
        source: {
          graphKind: 'execution',
          graphId,
          nodeId: node.id,
          nodeVersion: 1,
          snapshotId,
          snapshotContentHash: draft.contentHash,
        },
        target: {
          graphKind: 'solution',
          graphId: solution.graphId,
          nodeId: target.id,
          nodeVersion: target.version,
          snapshotId: solution.snapshotId,
          snapshotContentHash: solution.contentHash,
        },
        sourceBaselineId: 'execution-proposal',
        targetBaselineId: solutionBaseline.baselineId,
        createdAt: now,
        transformationId: 'execution-compiler-v2',
      }));
    });
    const graph = bindLocalTraceHashes(bindLocalEdgeHashes({ ...draft, crossGraphLinks }));
    this.replace({
      ...this.value,
      project: { ...this.value.project, activeExecutionSnapshotId: graph.snapshotId, updatedAt: now },
      executionGraph: graph,
    });
    return freeze(graph);
  }
}
