import { createHash } from 'node:crypto';

import {
  ApprovalRecordSchema,
  ProposalOutputSchema,
  ProjectConversationStateSchema,
  type ApprovalRecord,
  type ApprovedBaseline,
  type GraphNode,
  type GraphSnapshot,
  type IntentNodeDraft,
  type ProjectConversationState,
  type ProjectionRecord,
  type QuestionDraft,
  type RankedQuestion,
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
    }[];
    readonly priorQuestions?: readonly {
      readonly text: string;
      readonly category: string;
      readonly disposition: 'open' | 'answered' | 'deferred';
      readonly ownerContent?: string;
    }[];
  }): Promise<import('@graphslop/contracts').ProposalOutput>;
};

export type ProjectStateSink = {
  persist(state: Readonly<ProjectConversationState>): void;
};

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
  'it', 'of', 'on', 'or', 'should', 'the', 'this', 'to', 'what', 'which', 'will', 'would',
]);

function questionTerms(value: string): Set<string> {
  const aliases: Record<string, string> = {
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
  };
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !questionStopWords.has(word))
    .map((word) => aliases[word] ?? word));
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

function questionTarget(nodes: readonly GraphNode[], category: string): GraphNode | undefined {
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
  return types.flatMap((type) => nodes.filter((node) => node.type === type)).at(-1)
    ?? nodes.find((node) => !['Question', 'Decision'].includes(node.type));
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
    let proposal;
    try {
      proposal = ProposalOutputSchema.parse(await this.provider.propose({
        message,
        priorIntentNodes: this.value.intentGraph?.nodes.map((node) => ({
          stableId: node.stableId,
          statement: node.statementOrName,
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
      }));
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
        status: 'proposed',
        statementOrName: correction.statement,
        updatedAt: now,
        sourceRefs: [...prior.sourceRefs, { sourceId: message.messageId }],
        sourceQuote: correction.sourceQuote,
        originalInterpretation: correction.sourceQuote,
        normalizedInterpretation: correction.statement,
        approvedByUser: false,
      };
    }
    for (const draft of proposal.intentNodes) {
      const normalized = canonicalStatement(draft.normalizedInterpretation || draft.statement);
      if (nodes.some((node) =>
        canonicalStatement(node.normalizedInterpretation ?? node.statementOrName) === normalized
      )) continue;
      nodes.push(makeIntentNode(draft, message.messageId, this.authority.nextId('intent-node'), now));
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
          actorRef: { actorId: 'local-owner', actorKind: 'authenticated_project_owner' },
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
          actorRef: { actorId: 'local-owner', actorKind: 'authenticated_project_owner' },
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
      const target = questionTarget(nodes, currentQuestion.category);
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
    const now = this.authority.now();
    const data = {
      graphKind,
      snapshotId: graph.snapshotId,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        version: node.version,
        status: node.status,
        statement: node.statementOrName,
      })),
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
        actorRef: { actorId: 'local-owner', actorKind: 'authenticated_project_owner' },
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

  proposeSolution(
    features: readonly { name: string; intentNodeIds: readonly string[] }[],
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
    const now = this.authority.now();
    if (features.length === 0) {
      throw new ProjectServiceError('invalid_trace', 'A Solution proposal needs at least one traced feature.');
    }
    for (const feature of features) {
      if (feature.intentNodeIds.length === 0 || feature.intentNodeIds.some(
        (nodeId) => !this.value.intentGraph!.nodes.some((node) => node.id === nodeId),
      )) {
        throw new ProjectServiceError('invalid_trace', 'Every product feature must name existing Intent nodes.');
      }
    }
    const snapshotId = this.authority.nextId('solution-snapshot');
    const graphId = this.authority.nextId('solution-graph');
    const nodes = features.map((feature) => ({
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
    const draft = snapshotWithHash({
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
      edges: [],
      crossGraphLinks: [],
    });
    const crossGraphLinks = nodes.flatMap((node, nodeIndex) =>
      features[nodeIndex]!.intentNodeIds.map((nodeId, targetIndex) => ({
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
    const graph = bindLocalTraceHashes({ ...draft, crossGraphLinks });
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
    const nodes = solution.nodes.flatMap((solutionNode) => {
      const featureName = solutionNode.statementOrName.replace(/[.!?]+$/, '');
      return ([
      { roleRef: 'Plan', type: 'Decide', verb: 'Plan', objective: `Define the bounded implementation contract for ${featureName}.`, allowedPaths: ['docs/plans/**'] },
      { roleRef: 'Build', type: 'Implement', verb: 'Build', objective: `Implement only the approved Solution behavior: ${featureName}.`, allowedPaths: ['apps/**', 'packages/**', 'tests/**'] },
      { roleRef: 'Check', type: 'Verify', verb: 'Check', objective: `Independently verify ${featureName} against Intent and Solution.`, allowedPaths: [] },
    ] as const).map((role) => ({
      id: this.authority.nextId('task'),
      stableId: this.authority.nextId('task-stable'),
      version: 1,
      type: role.type,
      status: 'blocked',
      statementOrName: `${role.verb} ${featureName}`,
      createdAt: now,
      updatedAt: now,
      sourceRefs: [],
      actorRef: actor,
      attributes: {
        solutionNodeId: solutionNode.id,
        roleRef: role.roleRef,
        objective: role.objective,
        allowedPaths: [...role.allowedPaths],
        acceptanceCommands: [{ argv: ['node', '--test'] }],
        acceptanceChecks: [`${role.roleRef} remains traced to ${featureName}.`],
      },
    }));
    });
    const nodeRef = (node: GraphNode) => ({
      graphKind: 'execution' as const, graphId, nodeId: node.id, nodeVersion: 1,
      snapshotId, snapshotContentHash: '0'.repeat(64),
    });
    const edges = solution.nodes.flatMap((_, featureIndex) => {
      const plan = nodes[featureIndex * 3]!;
      const build = nodes[featureIndex * 3 + 1]!;
      const check = nodes[featureIndex * 3 + 2]!;
      return [
        {
          id: this.authority.nextId('dependency'), version: 1, type: 'DEPENDS_ON',
          sourceNodeRef: nodeRef(build), targetNodeRef: nodeRef(plan), status: 'confirmed',
          createdAt: now, updatedAt: now, sourceRefs: [], attributes: { order: 1 },
        },
        {
          id: this.authority.nextId('dependency'), version: 1, type: 'DEPENDS_ON',
          sourceNodeRef: nodeRef(check), targetNodeRef: nodeRef(build), status: 'confirmed',
          createdAt: now, updatedAt: now, sourceRefs: [], attributes: { order: 2 },
        },
      ];
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
    const crossGraphLinks = nodes.map((node, index) => ({
      id: `trace-execution-${index + 1}`,
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
        nodeId: solution.nodes[Math.floor(index / 3)]!.id,
        nodeVersion: solution.nodes[Math.floor(index / 3)]!.version,
        snapshotId: solution.snapshotId,
        snapshotContentHash: solution.contentHash,
      },
      sourceBaselineId: 'execution-proposal',
      targetBaselineId: solutionBaseline.baselineId,
      createdAt: now,
      transformationId: 'execution-compiler-v1',
    }));
    const graph = bindLocalTraceHashes({ ...draft, crossGraphLinks });
    this.replace({
      ...this.value,
      project: { ...this.value.project, activeExecutionSnapshotId: graph.snapshotId, updatedAt: now },
      executionGraph: graph,
    });
    return freeze(graph);
  }
}
