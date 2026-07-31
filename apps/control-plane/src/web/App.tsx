/// <reference types="vite/client" />
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  bindingFor,
  OwnerApi,
  type NextBinding,
  type OwnerCommand,
  type PlatformMode,
  type ProjectSummary,
  type SessionUser,
} from './api.js';
import { demoProject } from './demo.js';
import { asList, asRecord, display, graphNodes, lifecycleLabel, stringList } from './model.js';
import { nextProjectQuestion, unresolvedQuestionNodes } from './progress.js';

const api = new OwnerApi();
const demoMode = import.meta.env.VITE_REMOTE_DEMO === '1';
const intentTypes = [
  'Goal', 'UserType', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output',
  'Constraint', 'Preference', 'Exclusion', 'SuccessCriterion', 'Assumption', 'Risk',
];
const relationshipTypes = [
  'DEPENDS_ON', 'USE_CASE_REQUIRES_BEHAVIOR', 'BEHAVIOR_ACCEPTS_INPUT',
  'BEHAVIOR_PRODUCES_OUTPUT', 'CONSTRAINT_LIMITS', 'EXCLUSION_PROHIBITS',
  'SUCCESS_VALIDATES', 'CONTRADICTS',
  'QUESTION_RESOLVES', 'DECISION_RESOLVES',
];
const commandNotices: Partial<Record<OwnerCommand, string>> = {
  'submit-message': 'Message added.',
  'resolve-question': 'Answer recorded.',
  'review-intent': 'Requirements are ready for review.',
  'approve-intent': 'Requirements approved.',
  'propose-solution': 'Solution generated.',
  'review-solution': 'Solution is ready for review.',
  'approve-solution': 'Solution approved.',
  'compile-execution': 'Build pack generated.',
  'dispatch-task': 'Task dispatched.',
  'authorize-repair': 'Repair authorized.',
  'preview-pull-request': 'Pull request preview created.',
};

type AnyProject = Record<string, any>;
type GraphKind = 'input' | 'intent' | 'solution' | 'role' | 'execution' | 'question';
type FlowData = {
  kind: GraphKind;
  rawId: string;
  type: string;
  status: string;
  label: string;
  raw?: AnyProject;
};
type AppNode = Node<FlowData>;

const color = {
  input: '#a7a098',
  question: '#d5a45f',
  intent: '#9888ef',
  solution: '#64b8a8',
  role: '#e0b16f',
  execution: '#d87961',
} satisfies Record<GraphKind, string>;
const graphKindLabel: Record<GraphKind, string> = {
  input: 'source',
  question: 'question',
  intent: 'requirement',
  solution: 'solution',
  role: 'role',
  execution: 'task',
};
const taskPhaseLabel: Record<string, string> = {
  Inspect: 'Inspection',
  Decide: 'Decision',
  Implement: 'Implementation',
  Test: 'Testing',
  Integrate: 'Integration',
  Verify: 'Verification',
  Document: 'Documentation',
  Release: 'Release',
};
const taskPhaseOrder = ['Inspect', 'Decide', 'Implement', 'Test', 'Integrate', 'Document', 'Release', 'Verify'];
const taskPhaseGuideLabel: Record<string, string> = {
  Inspect: 'inspection',
  Decide: 'decisions',
  Implement: 'implementation',
  Test: 'testing',
  Integrate: 'integration',
  Document: 'documentation',
  Release: 'release',
  Verify: 'verification',
};

function readableLabel(value: unknown) {
  const text = display(value);
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
    <path d="M6 8.5 14 4l8 4.5v10L14 23l-8-4.5Z" />
    <path d="m6 8.5 8 4.5 8-4.5M14 13v10" />
    <circle cx="6" cy="8.5" r="2" />
    <circle cx="14" cy="4" r="2" />
    <circle cx="22" cy="8.5" r="2" />
    <circle cx="14" cy="23" r="2" />
  </svg>;
}

function flowId(kind: GraphKind, id: string) {
  return `${kind}:${id}`;
}

function GraphNode({ data, selected }: NodeProps<AppNode>) {
  return <article className={`graph-node graph-node-${data.kind} ${selected ? 'is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="graph-node-meta">
      <span>{graphKindLabel[data.kind]}</span>
      <i style={{ background: color[data.kind] }} />
      <small>{data.kind === 'execution'
        ? taskPhaseLabel[data.type] ?? readableLabel(data.type)
        : readableLabel(data.type)}</small>
    </div>
    <strong>{data.label}</strong>
    <div className="graph-node-state">{data.status}</div>
    <Handle type="source" position={Position.Right} />
  </article>;
}

const nodeTypes = { graph: GraphNode };

function savedPosition(id: string, fallback: { x: number; y: number }) {
  try {
    const value = JSON.parse(localStorage.getItem(`graphslop-position-v2:${id}`) ?? 'null');
    return typeof value?.x === 'number' && typeof value?.y === 'number' ? value : fallback;
  } catch {
    return fallback;
  }
}

function makeFlow(project: AnyProject): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = [];
  const edges: Edge[] = [];
  const columns: Record<GraphKind, number> = {
    input: 0,
    question: 0,
    intent: 340,
    solution: 680,
    role: 1020,
    execution: 1360,
  };
  const counts: Record<GraphKind, number> = {
    input: 0,
    question: 0,
    intent: 0,
    solution: 0,
    role: 0,
    execution: 0,
  };
  const solutionNodes = graphNodes(project, 'solution');
  const executionNodes = graphNodes(project, 'execution');
  const roleNodes = solutionNodes.filter((node) => node.type === 'Role');
  const presentPhases = taskPhaseOrder.filter((phase) =>
    executionNodes.some((node) => node.type === phase));
  const phaseX = Object.fromEntries(presentPhases.map((phase, index) => [phase, 1360 + index * 340]));
  const roleLaneY = new Map<string, number>();
  let nextLaneY = 220;
  for (const role of roleNodes) {
    roleLaneY.set(role.id, nextLaneY);
    const tasksForRole = executionNodes.filter((node) => node.attributes?.roleRef === role.id);
    const maxInPhase = Math.max(1, ...taskPhaseOrder.map((phase) =>
      tasksForRole.filter((node) => node.type === phase).length));
    nextLaneY += Math.max(180, maxInPhase * 132 + 54);
  }
  const taskLaneCount = new Map<string, number>();
  const pushNode = (
    kind: GraphKind,
    rawId: string,
    label: string,
    type: string,
    status: string,
    raw?: AnyProject,
    explicitPosition?: { x: number; y: number },
  ) => {
    const index = counts[kind]++;
    const id = flowId(kind, rawId);
    const baseY = kind === 'question' ? 410 : 40 + index * 132;
    nodes.push({
      id,
      type: 'graph',
      position: savedPosition(id, explicitPosition ?? { x: columns[kind], y: baseY }),
      data: { kind, rawId, label, type, status, raw },
    });
  };
  const graphFlowId = (kind: 'intent' | 'solution' | 'execution', rawId: string) => {
    const raw = graphNodes(project, kind).find((node) => node.id === rawId);
    const visualKind: GraphKind = kind === 'intent' && raw?.type === 'Question'
      ? 'question'
      : kind === 'solution' && raw?.type === 'Role'
        ? 'role'
        : kind;
    return flowId(visualKind, rawId);
  };
  const crossFlowId = (kind: GraphKind, rawId: string) =>
    kind === 'intent' || kind === 'solution' || kind === 'execution'
      ? graphFlowId(kind, rawId)
      : flowId(kind, rawId);

  for (const message of asList(project.messages)) {
    pushNode('input', message.messageId, display(message.content), 'message', message.actor === 'owner' ? 'owner input' : 'model');
  }
  for (const node of graphNodes(project, 'intent')) {
    pushNode(node.type === 'Question' ? 'question' : 'intent',
      node.id, display(node.statementOrName, node.id), display(node.type), display(node.status), node);
  }
  for (const node of solutionNodes) {
    const position = node.type === 'Role'
      ? { x: columns.role, y: roleLaneY.get(node.id) ?? nextLaneY }
      : undefined;
    pushNode(node.type === 'Role' ? 'role' : 'solution', node.id, display(node.statementOrName, node.id),
      display(node.type), display(node.status), node, position);
  }
  for (const node of executionNodes) {
    const roleRef = String(node.attributes?.roleRef ?? '');
    const phase = display(node.type);
    const laneKey = `${roleRef}:${phase}`;
    const phaseIndex = taskLaneCount.get(laneKey) ?? 0;
    taskLaneCount.set(laneKey, phaseIndex + 1);
    const position = {
      x: phaseX[phase] ?? columns.execution,
      y: (roleLaneY.get(roleRef) ?? nextLaneY) + phaseIndex * 132,
    };
    pushNode('execution', node.id, display(node.statementOrName, node.id),
      phase, display(node.status), node, position);
  }
  const question = asRecord(project.currentQuestion);
  const graphHasQuestion = graphNodes(project, 'intent').some((node) =>
    node.type === 'Question' && (node.stableId === question.questionId || node.id === question.questionId));
  if (question.questionId && !graphHasQuestion) {
    pushNode('question', question.questionId, display(question.text), display(question.category), question.blocking ? 'blocking' : 'open', question);
    const firstIntent = graphNodes(project, 'intent')[0];
    if (firstIntent) edges.push({
      id: `question:${question.questionId}`,
      source: flowId('intent', firstIntent.id),
      target: flowId('question', question.questionId),
      label: 'requires answer',
      animated: true,
      style: { stroke: color.question },
    });
  }

  for (const intent of graphNodes(project, 'intent')) {
    for (const source of asList(intent.sourceRefs)) {
      if (asList(project.messages).some((message) => message.messageId === source.sourceId)) {
        edges.push({
          id: `source:${source.sourceId}:${intent.id}`,
          source: flowId('input', source.sourceId),
          target: graphFlowId('intent', intent.id),
          label: 'source',
          type: 'smoothstep',
          className: 'graph-edge graph-edge-source',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#817d78', strokeWidth: 1.8 },
        });
      }
    }
  }
  for (const kind of ['intent', 'solution', 'execution'] as const) {
    const graph = asRecord(project[`${kind}Graph`]);
    for (const edge of asList(graph.edges)) {
      const dependency = (kind === 'solution' || kind === 'execution') && edge.type === 'DEPENDS_ON';
      const handoffs = asList(edge.attributes?.artifacts);
      edges.push({
        id: `${kind}-edge:${edge.id}`,
        source: graphFlowId(kind, dependency
          ? edge.targetNodeRef?.nodeId ?? edge.to
          : edge.sourceNodeRef?.nodeId ?? edge.from),
        target: graphFlowId(kind, dependency
          ? edge.sourceNodeRef?.nodeId ?? edge.from
          : edge.targetNodeRef?.nodeId ?? edge.to),
        label: dependency
          ? handoffs.length === 1
            ? display(handoffs[0]?.description, 'hands off')
            : handoffs.length > 1
              ? `${handoffs.length} handoffs`
              : 'precedes'
          : kind === 'solution' && edge.type === 'USES'
            ? 'requires role'
            : display(edge.type),
        type: 'smoothstep',
        animated: dependency,
        className: dependency
          ? 'graph-edge graph-edge-handoff'
          : kind === 'solution' && edge.type === 'USES'
            ? 'graph-edge graph-edge-ownership'
            : 'graph-edge graph-edge-internal',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: dependency
            ? color.execution
            : kind === 'solution' && edge.type === 'USES'
              ? color.role
              : color[kind],
          strokeWidth: dependency || (kind === 'solution' && edge.type === 'USES') ? 2.8 : 1.25,
        },
        data: { rawId: edge.id, graphKind: kind, raw: edge },
      });
    }
    for (const link of asList(graph.crossGraphLinks)) {
      const sourceKind = display(link.source?.graphKind) as GraphKind;
      const targetKind = display(link.target?.graphKind) as GraphKind;
      const graphOrder: Record<GraphKind, number> = {
        input: 0,
        question: 1,
        intent: 1,
        solution: 2,
        role: 3,
        execution: 4,
      };
      const showForward = graphOrder[sourceKind] > graphOrder[targetKind];
      edges.push({
        id: `trace:${link.id}`,
        source: crossFlowId(showForward ? targetKind : sourceKind,
          showForward ? link.target?.nodeId : link.source?.nodeId),
        target: crossFlowId(showForward ? sourceKind : targetKind,
          showForward ? link.source?.nodeId : link.target?.nodeId),
        label: sourceKind === 'execution' || targetKind === 'execution' ? 'creates task' : 'informs',
        type: 'smoothstep',
        className: sourceKind === 'execution' || targetKind === 'execution'
          ? 'graph-edge graph-edge-delivery'
          : 'graph-edge graph-edge-trace',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: sourceKind === 'execution' || targetKind === 'execution' ? color.execution : color.intent,
          strokeWidth: sourceKind === 'execution' || targetKind === 'execution' ? 2.2 : 1.35,
        },
      });
    }
  }
  for (const task of executionNodes) {
    const roleRef = String(task.attributes?.roleRef ?? '');
    if (!roleNodes.some((role) => role.id === roleRef)) continue;
    edges.push({
      id: `role-owner:${roleRef}:${task.id}`,
      source: flowId('role', roleRef),
      target: flowId('execution', task.id),
      label: 'assigned',
      type: 'smoothstep',
      className: 'graph-edge graph-edge-ownership',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: color.role, strokeWidth: 3 },
    });
  }
  return { nodes, edges };
}

function approvalInput(project: AnyProject, kind: 'intent' | 'solution', actorId = 'local-owner') {
  const baselines = asList(project.approvedBaselines);
  const projection = [...asList(project.projections)].reverse().find((item) => item.graphKind === kind);
  const graph = asRecord(project[`${kind}Graph`]);
  const version = baselines.filter((item) => item.graphKind === kind).length + 1;
  return {
    approvalId: `${kind}-approval-${crypto.randomUUID()}`,
    actorId,
    actorKind: 'authenticated_project_owner',
    artifactType: `${kind}_baseline`,
    artifactId: `${kind}-v${version}`,
    artifactVersion: version,
    artifactContentHash: graph.contentHash,
    displayedProjectionHash: projection?.contentHash,
    sourceMessageId: asList(project.messages).at(-1)?.messageId ?? 'owner-approval',
    sourceQuote: 'Approved',
    approvedAt: new Date().toISOString(),
    includedEdgeRefs: [...asList(graph.edges), ...asList(graph.crossGraphLinks)].map((edge) => edge.id),
    renderedDataHash: projection?.contentHash,
    generatedAt: projection?.generatedAt,
  };
}

function IntentInspector({
  selected,
  selectedEdge,
  canEdit,
  busy,
  run,
}: {
  selected?: AppNode;
  selectedEdge?: Edge;
  canEdit: boolean;
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
}) {
  const [statement, setStatement] = useState('');
  const [type, setType] = useState('Behavior');
  useEffect(() => {
    if (!selected) return;
    setStatement(selected.data.label);
    setType(selected.data.type);
  }, [selected?.id]);
  if (selectedEdge) {
    const edge = asRecord(selectedEdge.data?.raw);
    const artifacts = asList(edge.attributes?.artifacts);
    return <aside className="inspector" aria-label="Graph inspector">
      <p className="eyebrow">link</p>
      <h2>{display(selectedEdge.label)}</h2>
      <code>{display(selectedEdge.data?.rawId)}</code>
      {artifacts.length > 0 && <section className="source-quote">
        <small>Required handoff</small>
        {artifacts.map((artifact) => <p key={display(artifact.key)}>
          <strong>{readableLabel(artifact.type)}</strong> · {display(artifact.description)}
        </p>)}
      </section>}
      {selectedEdge.data?.graphKind === 'intent' && <button className="danger" disabled={!canEdit || busy} onClick={() => void run('edit-intent-graph', {
          action: 'delete-edge',
          edgeId: selectedEdge.data?.rawId,
        })}>Delete relationship</button>}
    </aside>;
  }
  if (!selected) return <aside className="inspector empty-inspector" aria-label="Graph inspector">
    <div className="empty-orbit" aria-hidden="true"><i /><i /><i /></div>
    <h2>Select a node</h2>
    <p>Inspect a node or relationship. Drag between requirement nodes to create a relationship.</p>
  </aside>;
  const editable = selected.data.kind === 'intent' && canEdit;
  return <aside className="inspector" aria-label="Graph inspector">
    <div className="inspector-kind"><i style={{ background: color[selected.data.kind] }} />{selected.data.kind}</div>
    <h2>{selected.data.label}</h2>
    <dl>
      <div><dt>type</dt><dd>{selected.data.kind === 'execution'
        ? taskPhaseLabel[selected.data.type] ?? readableLabel(selected.data.type)
        : readableLabel(selected.data.type)}</dd></div>
      <div><dt>state</dt><dd>{selected.data.status}</dd></div>
      <div><dt>ID</dt><dd><code>{selected.data.rawId}</code></dd></div>
    </dl>
    {selected.data.raw?.sourceQuote && <section className="source-quote">
      <small>Source text</small>
      <q>{display(selected.data.raw.sourceQuote)}</q>
    </section>}
    {selected.data.kind === 'intent' && <form onSubmit={(event) => {
      event.preventDefault();
      void run('edit-intent-graph', {
        action: 'update-node',
        nodeId: selected.data.rawId,
        type,
        statement: statement.trim(),
      });
    }}>
      <label htmlFor="edit-type">Requirement type</label>
      <select id="edit-type" value={type} onChange={(event) => setType(event.target.value)} disabled={!editable || busy}>
        {intentTypes.map((item) => <option key={item} value={item}>{readableLabel(item)}</option>)}
      </select>
      <label htmlFor="edit-statement">Requirement</label>
      <textarea id="edit-statement" rows={5} value={statement} onChange={(event) => setStatement(event.target.value)}
        disabled={!editable || busy} />
      <button className="primary" disabled={!editable || busy || !statement.trim()}>Save requirement</button>
      {!canEdit && <small>Requirements are locked. Create a new baseline to make changes.</small>}
    </form>}
  </aside>;
}

function Conversation({
  project,
  bindings,
  busy,
  thinking,
  run,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  thinking: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [newType, setNewType] = useState('Behavior');
  const [newStatement, setNewStatement] = useState('');
  const question = nextProjectQuestion(project);
  const messages = asList(project.messages);
  const editBinding = bindingFor(bindings, 'edit-intent-graph');
  const resolveBinding = bindingFor(bindings, 'resolve-question');
  const submitBinding = bindingFor(bindings, 'submit-message');
  const canAnswerQuestion = question?.source === 'active' ? Boolean(resolveBinding) : Boolean(submitBinding);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    await run('submit-message', { content: message.trim() });
    setMessage('');
  }
  async function reply(disposition: 'answered' | 'deferred') {
    if (!question) return;
    if (question.source === 'active') {
      await run('resolve-question', {
        questionId: question.questionId,
        disposition,
        content: answer.trim() || 'Decision deferred.',
      });
    } else {
      await run('submit-message', {
        content: disposition === 'deferred'
          ? `Decide later: ${question.text}`
          : `Question: ${question.text}\nAnswer: ${answer.trim()}`,
      });
    }
    setAnswer('');
  }
  return <aside className="conversation-panel" aria-label="Requirements conversation">
    <div className="conversation-title">
      <div className="conversation-avatar" aria-hidden="true">
        <img src="/brand/caveman-concept-c-older-portrait.webp" alt="" />
      </div>
      <div className="conversation-heading-copy">
        <p className="eyebrow">Dun</p>
        <h2>Start with what<br />you know.</h2>
        <p>Dun asks only the questions that affect the product.</p>
      </div>
    </div>
    <div className="thread" tabIndex={0} aria-label="Requirements message history">
      {messages.length === 0 && <div className="starter">
        <span aria-hidden="true">↳</span>
        <p>Describe the project in your own words. Missing details are fine.</p>
      </div>}
      {messages.slice(-6).map((item) => <article className="owner-message" key={item.messageId}>
        <small>{item.actor === 'owner' ? 'You' : 'Dun'}</small><p>{display(item.content)}</p>
      </article>)}
      {question?.questionId && <article className="model-question">
        <small>Dun asks · {display(question.category)}</small>
        <p>{display(question.text)}</p>
        <textarea aria-label="Answer Dun" rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)}
          placeholder="Answer in your own words…" disabled={!canAnswerQuestion || busy} />
        <div className="button-row">
          <button className="primary" disabled={!answer.trim() || !canAnswerQuestion || busy} onClick={() => void reply('answered')}>Answer</button>
          <button disabled={!canAnswerQuestion || busy} onClick={() => void reply('deferred')}>Decide later</button>
        </div>
      </article>}
    </div>
    <form className="rough-composer" onSubmit={send}>
      <label htmlFor="rough-input">{messages.length ? 'Add or correct something' : 'What are you building?'}</label>
      <textarea id="rough-input" rows={4} value={message} onChange={(event) => setMessage(event.target.value)}
        placeholder="I need a simple app that analyzes pasted text and shows a useful score. No login."
        disabled={!bindingFor(bindings, 'submit-message') || busy} />
      <button className="primary" disabled={!message.trim() || !bindingFor(bindings, 'submit-message') || busy}>
        {thinking ? 'Dun is thinking…' : 'Send to Dun'}
      </button>
      {thinking && <small className="thinking-note" role="status">Local model: 20–45 seconds.</small>}
    </form>
    <details className="manual-add">
      <summary>Add a requirement manually</summary>
      <select value={newType} onChange={(event) => setNewType(event.target.value)} disabled={!editBinding || busy}>
        {intentTypes.map((item) => <option key={item} value={item}>{readableLabel(item)}</option>)}
      </select>
      <textarea rows={2} value={newStatement} onChange={(event) => setNewStatement(event.target.value)}
        placeholder="Describe the requirement…" disabled={!editBinding || busy} />
      <button disabled={!editBinding || !newStatement.trim() || busy} onClick={() => {
        void run('edit-intent-graph', { action: 'add-node', type: newType, statement: newStatement.trim() });
        setNewStatement('');
      }}>Add requirement</button>
    </details>
  </aside>;
}

function StageActions({
  project,
  bindings,
  busy,
  run,
  download,
  actorId,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  download: () => Promise<void>;
  actorId?: string;
}) {
  const button = (command: OwnerCommand, label: string, input: unknown = {}) =>
    bindingFor(bindings, command)
      ? <button className="stage-action" disabled={busy} onClick={() => void run(command, input)}>{label}<span>→</span></button>
      : null;
  const tasks = graphNodes(project, 'execution');
  const baselines = asList(project.approvedBaselines);
  const buildPackReady = ['EXECUTION', 'VERIFICATION', 'REPAIR', 'COMPLETE']
    .includes(String(project.project?.lifecycleState));
  const hasBlockingQuestion = Boolean(project.currentQuestion?.questionId && project.currentQuestion?.blocking);
  const readinessTypes = graphNodes(project, 'intent').filter((node) => node.type !== 'Question'
    && !['rejected', 'superseded'].includes(String(node.status))).map((node) => String(node.type));
  const missingReadiness = [
    !['Goal', 'Problem', 'UseCase'].some((type) => readinessTypes.includes(type)) && 'scope',
    !['UserType', 'UseCase'].some((type) => readinessTypes.includes(type)) && 'users or usage context',
    !['Behavior', 'UseCase'].some((type) => readinessTypes.includes(type)) && 'behavior',
    (!readinessTypes.includes('Input') || !readinessTypes.includes('Output')) && 'input and output',
    !['Constraint', 'Exclusion'].some((type) => readinessTypes.includes(type)) && 'constraints and exclusions',
    !readinessTypes.includes('SuccessCriterion') && 'success criteria',
  ].filter((item): item is string => Boolean(item));
  return <div className="stage-actions">
    {!hasBlockingQuestion && missingReadiness.length === 0 && button('review-intent', 'Review requirements')}
    {button('approve-intent', 'Approve requirements', approvalInput(project, 'intent', actorId))}
    {button('propose-solution', 'Generate solution')}
    {button('review-solution', 'Review solution')}
    {button('approve-solution', 'Approve solution', approvalInput(project, 'solution', actorId))}
    {button('compile-execution', 'Generate build pack')}
    {buildPackReady && baselines.length >= 2 && tasks.length > 0 && <button className="stage-action download" disabled={busy}
      onClick={() => void download()}>Download .factory.zip<span>↓</span></button>}
    {hasBlockingQuestion
      ? <small>Answer or defer the open question before approving requirements.</small>
      : missingReadiness.length > 0
        ? <small>Requirements still need: {missingReadiness.join(', ')}.</small>
      : !bindings.some((item) => ['review-intent', 'approve-intent', 'propose-solution', 'review-solution', 'approve-solution', 'compile-execution'].includes(item.command))
      && tasks.length === 0 && <small>Answer the question or add more context.</small>}
  </div>;
}

type PageKey = 'overview' | 'intake' | 'graph' | 'build' | 'settings';
type ProjectNextStep = Readonly<{
  title: string;
  detail: string;
  label: string;
} & (
  | { page: PageKey; command?: never; download?: never }
  | { command: OwnerCommand; page?: never; download?: never }
  | { download: true; page?: never; command?: never }
)>;

const pageMeta: Record<PageKey, { label: string; short: string; description: string }> = {
  overview: { label: 'overview', short: '⌂', description: 'Review the project and next step' },
  intake: { label: 'requirements', short: '✦', description: 'Describe the product and answer questions' },
  graph: { label: 'graph', short: '⌘', description: 'Review requirements and dependencies' },
  build: { label: 'build pack', short: '▣', description: 'Approve the plan and download the files' },
  settings: { label: 'settings', short: '⚙', description: 'Review services and connections' },
};

function pageFromPath(): PageKey {
  const value = window.location.pathname.split('/').filter(Boolean).at(-1);
  return value && value in pageMeta ? value as PageKey : 'overview';
}

function projectPath(page: PageKey, projectId?: string) {
  const routedProject = window.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const id = projectId ?? routedProject ?? 'local-project';
  return `/projects/${encodeURIComponent(id)}${page === 'overview' ? '' : `/${page}`}`;
}

function PageLink({
  page,
  active,
  go,
  children,
  className = '',
}: {
  page: PageKey;
  active?: boolean;
  go: (page: PageKey) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return <a
    href={projectPath(page)}
    className={`${className} ${active ? 'is-active' : ''}`.trim()}
    aria-current={active ? 'page' : undefined}
    onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(page);
    }}
  >{children}</a>;
}

function SectionHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
}) {
  return <header className="page-heading">
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {aside && <div className="page-heading-aside">{aside}</div>}
  </header>;
}

function RequirementLedger({ project, go }: { project: AnyProject; go: (page: PageKey) => void }) {
  const requirements = graphNodes(project, 'intent').filter((node) => node.type !== 'Question');
  const unresolved = requirements.filter((node) => ['inferred', 'proposed', 'unresolved'].includes(String(node.status)));
  return <section className="ledger-card">
    <header>
      <div>
        <p className="eyebrow">current understanding</p>
        <h2>{requirements.length ? `${requirements.length} requirement${requirements.length === 1 ? '' : 's'} captured` : 'Nothing captured yet'}</h2>
      </div>
      <PageLink page="graph" go={go} className="text-link">View graph <span>→</span></PageLink>
    </header>
    <div className="ledger-list">
      {requirements.length === 0 && <div className="ledger-empty">
        <span>01</span>
        <p>Your first words become connected requirements.</p>
      </div>}
      {requirements.slice(-8).reverse().map((node) => <article key={node.id}>
        <i style={{ background: color.intent }} />
        <div><small>{readableLabel(node.type)}</small><p>{display(node.statementOrName)}</p></div>
        <span className={`status-pill status-${String(node.status).toLowerCase()}`}>{display(node.status)}</span>
      </article>)}
    </div>
    {requirements.length > 0 && <footer>
      <span>{requirements.length - unresolved.length} confirmed</span>
      <span>{unresolved.length} require review</span>
    </footer>}
  </section>;
}

function OverviewPage({
  project,
  bindings,
  busy,
  run,
  download,
  go,
  nodes,
  edges,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  download: () => Promise<void>;
  go: (page: PageKey) => void;
  nodes: AppNode[];
  edges: Edge[];
}) {
  const intent = graphNodes(project, 'intent');
  const solution = graphNodes(project, 'solution');
  const execution = graphNodes(project, 'execution');
  const requirements = intent.filter((node) => node.type !== 'Question');
  const unresolvedQuestions = unresolvedQuestionNodes(project);
  const projectQuestion = nextProjectQuestion(project);
  const questions = new Set([
    ...unresolvedQuestions.map((node) => String(node.stableId ?? node.id)),
    ...(project.currentQuestion?.questionId
      && !unresolvedQuestions.some((node) => node.stableId === project.currentQuestion.questionId || node.id === project.currentQuestion.questionId)
      ? [String(project.currentQuestion.questionId)]
      : []),
  ]).size;
  const baselines = asList(project.approvedBaselines);
  const lifecycle = String(project.project?.lifecycleState ?? 'CAPTURE');
  const buildPackReady = ['EXECUTION', 'VERIFICATION', 'REPAIR', 'COMPLETE'].includes(lifecycle);
  const has = (command: OwnerCommand) => Boolean(bindingFor(bindings, command));
  const questionCanBeAnswered = projectQuestion?.source === 'active'
    ? has('resolve-question')
    : Boolean(projectQuestion) && has('submit-message');
  const nextStep: ProjectNextStep = projectQuestion && questionCanBeAnswered
    ? { title: 'Answer this question', detail: display(projectQuestion.text), label: 'Answer question', page: 'intake' as PageKey }
    : requirements.length === 0
      ? { title: 'Describe what you want to build', detail: 'Start rough. Dun will record the requirements and ask what matters.', label: 'Add requirements', page: 'intake' as PageKey }
      : has('submit-message') && baselines.length === 0
        ? { title: 'Continue the requirements', detail: `${requirements.length} captured. Add the missing detail that will move the project to review.`, label: 'Continue requirements', page: 'intake' as PageKey }
      : has('approve-intent')
        ? { title: 'Approve the requirements', detail: 'Confirm the product needs before Dun creates a solution.', label: 'Review requirements', page: 'build' as PageKey }
        : has('review-intent')
          ? { title: 'Review the requirements', detail: 'Check the captured needs and relationships before approval.', label: 'Open requirements', page: 'graph' as PageKey }
          : has('propose-solution')
            ? { title: 'Create the solution', detail: 'Turn the approved requirements into features, roles, and work.', label: 'Create solution', page: 'build' as PageKey }
            : has('approve-solution')
              ? { title: 'Approve the solution', detail: 'Confirm what will be built and who the work needs.', label: 'Review solution', page: 'build' as PageKey }
              : has('review-solution')
                ? { title: 'Review the solution', detail: 'Check the proposed features and roles before approval.', label: 'Open solution', page: 'build' as PageKey }
                : has('compile-execution')
                  ? { title: 'Generate the build pack', detail: 'Both baselines are approved. Compile the tasks and files your coding tool can run.', label: 'Generate build pack', command: 'compile-execution' }
                  : buildPackReady
                    ? { title: 'Your build pack is ready', detail: 'Download it, unzip it in a repository, and run it with your coding harness.', label: 'Download .factory.zip', download: true }
                    : { title: 'Review the project graph', detail: 'Trace the approved requirements to the planned work.', label: 'Open graph', page: 'graph' as PageKey };
  const intentApproved = baselines.some((item) => item.graphKind === 'intent');
  const solutionApproved = baselines.some((item) => item.graphKind === 'solution');
  const workflow = [
    ['1', 'requirements', intentApproved, 'capture and approve the goal'],
    ['2', 'solution', solutionApproved, 'approve features and roles'],
    ['3', 'tasks', buildPackReady && execution.length > 0, 'compile bounded work'],
    ['4', 'build pack', buildPackReady && execution.length > 0, 'download and build anywhere'],
  ] as const;
  const currentStep = workflow.findIndex((item) => !item[2]);
  return <div className="page-scroll overview-page">
    <SectionHeading
      eyebrow="Project overview"
      title={display(project.project?.displayName, 'Local project')}
      description="Turn an initial idea into an approved build pack."
      aside={<span className="lifecycle-badge"><i />{lifecycleLabel(project.project?.lifecycleState)}</span>}
    />
    <section className="next-step-card">
      <div className="next-step-copy">
        <span className="step-number">{currentStep === -1 ? 'done' : `${currentStep + 1} / 4`}</span>
        <div>
          <p className="eyebrow">recommended next step</p>
          <h2>{nextStep.title}</h2>
          <p>{nextStep.detail}</p>
        </div>
      </div>
      {nextStep.command !== undefined
        ? <button className="primary-link" disabled={busy} onClick={() => void run(nextStep.command, {})}>{nextStep.label}<span>→</span></button>
        : nextStep.download
          ? <button className="primary-link" disabled={busy} onClick={() => void download()}>{nextStep.label}<span>↓</span></button>
          : <PageLink page={nextStep.page} go={go} className="primary-link">{nextStep.label}<span>→</span></PageLink>}
    </section>
    <section className="metric-grid" aria-label="Project metrics">
      <article><small>requirements</small><strong>{requirements.length}</strong><span>{questions
        ? baselines.some((item) => item.graphKind === 'intent')
          ? `${questions} deferred decision${questions === 1 ? '' : 's'}`
          : `${questions} question${questions === 1 ? '' : 's'} to answer`
        : 'No blocking questions'}</span></article>
      <article><small>solution</small><strong>{solution.length}</strong><span>{baselines.some((item) => item.graphKind === 'solution') ? 'Baseline approved' : 'Approval required'}</span></article>
      <article><small>tasks</small><strong>{execution.length}</strong><span>{buildPackReady ? 'Compiled and ready' : execution.length ? 'Planned, not compiled' : 'No tasks yet'}</span></article>
      <article><small>relationships</small><strong>{edges.length}</strong><span>{nodes.length} graph nodes</span></article>
    </section>
    <div className="overview-columns overview-single-column">
      <section className="card project-flow-card">
        <header><div><p className="eyebrow">Project workflow</p><h2>From requirements to build pack</h2></div></header>
        <div className="project-flow">
          {workflow.map(([number, label, done, help], index) => <article key={String(label)} className={done ? 'is-done' : workflow.slice(0, index).every((item) => item[2]) ? 'is-current' : ''}>
            <span>{done ? '✓' : number}</span>
            <div><strong>{label}</strong><small>{help}</small></div>
            {index < 3 && <i />}
          </article>)}
        </div>
      </section>
    </div>
  </div>;
}

function IntakePage({
  project,
  bindings,
  busy,
  thinking,
  run,
  go,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  thinking: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  go: (page: PageKey) => void;
}) {
  return <div className="page-scroll intake-page">
    <SectionHeading eyebrow="Project requirements" title="Tell Dun what you’re building"
      description="Dun records your requirements and asks focused follow-up questions." />
    <div className="intake-layout">
      <Conversation project={project} bindings={bindings} busy={busy} thinking={thinking} run={run} />
      <RequirementLedger project={project} go={go} />
    </div>
  </div>;
}

function GraphPage({
  project,
  projectReady,
  nodes,
  edges,
  selected,
  selectedEdge,
  canEdit,
  busy,
  search,
  setSearch,
  edgeType,
  setEdgeType,
  onNodesChange,
  onConnect,
  setSelectedId,
  setSelectedEdgeId,
  run,
}: {
  project: AnyProject;
  projectReady: boolean;
  nodes: AppNode[];
  edges: Edge[];
  selected?: AppNode;
  selectedEdge?: Edge;
  canEdit: boolean;
  busy: boolean;
  search: string;
  setSearch: (value: string) => void;
  edgeType: string;
  setEdgeType: (value: string) => void;
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  onConnect: (connection: Connection) => void;
  setSelectedId: (value?: string) => void;
  setSelectedEdgeId: (value?: string) => void;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
}) {
  const authoritativeNodes = (['intent', 'solution', 'execution'] as const)
    .reduce((total, kind) => total + graphNodes(project, kind).length, 0);
  const authoritativeLinks = (['intent', 'solution', 'execution'] as const).reduce((total, kind) => {
    const graph = asRecord(project[`${kind}Graph`]);
    return total + asList(graph.edges).length + asList(graph.crossGraphLinks).length;
  }, 0);
  const sourceNodes = asList(project.messages).length;
  const sourceLinks = edges.filter((edge) => String(edge.id).startsWith('source:')).length;
  const presentTaskPhases = taskPhaseOrder.filter((phase) =>
    graphNodes(project, 'execution').some((node) => node.type === phase));
  return <div className="graph-page">
    <div className="graph-page-head">
      <div><p className="eyebrow">Project traceability</p><h1>Project graph</h1><p>Every planned task traces back to the requirement that authorized it.</p></div>
      <div className="graph-page-stats"><span>{authoritativeNodes} graph nodes</span><i /><span>{authoritativeLinks} graph links</span><i /><span>{sourceNodes} source nodes / {sourceLinks} source links shown</span></div>
    </div>
    <div className="graph-page-layout">
      <section className="graph-workspace" aria-label="Project knowledge graph">
        <div className="graph-toolbar">
          <label className="graph-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search graph" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes…" />
          </label>
          <label className="edge-picker">
            <span>New relationship</span>
            <select value={edgeType} onChange={(event) => setEdgeType(event.target.value)} disabled={!canEdit}>
              {relationshipTypes.map((item) => <option key={item} value={item}>{readableLabel(item)}</option>)}
            </select>
          </label>
        </div>
        {nodes.some((node) => node.data.kind === 'execution') && <div className="graph-phase-guide" aria-label="Graph execution order">
          {['source', 'requirements', 'solution', 'roles', ...presentTaskPhases.map((phase) =>
            taskPhaseGuideLabel[phase])].map((stage, index) =>
            <span key={stage}><small>{String(index + 1).padStart(2, '0')}</small>{stage}</span>)}
        </div>}
        {!projectReady && <div className="graph-empty">
          <img className="empty-mascot" src="/brand/caveman-concept-c-older-portrait.webp" alt="" />
          <div><h2>No graph yet.</h2><p>Open Requirements and describe what you’re building.</p></div>
        </div>}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => { setSelectedId(node.id); setSelectedEdgeId(undefined); }}
          onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedId(undefined); }}
          onPaneClick={() => { setSelectedId(undefined); setSelectedEdgeId(undefined); }}
          onNodeDragStop={(_, node) => localStorage.setItem(`graphslop-position-v2:${node.id}`, JSON.stringify(node.position))}
          nodesConnectable={canEdit}
          fitView
          fitViewOptions={{ padding: 0.24 }}
          minZoom={0.18}
          maxZoom={2.2}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#3d3a37" gap={28} size={1.25} variant={BackgroundVariant.Dots} />
          <MiniMap nodeColor={(node) => color[(node.data as FlowData).kind]} maskColor="rgba(10, 12, 15, .78)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="graph-legend">
          {(Object.keys(color) as GraphKind[]).map((kind) => <span key={kind}><i style={{ background: color[kind] }} />{graphKindLabel[kind]}</span>)}
        </div>
      </section>
      <IntentInspector selected={selected} selectedEdge={selectedEdge} canEdit={canEdit} busy={busy} run={run} />
    </div>
  </div>;
}

function BuildPage({
  project,
  bindings,
  busy,
  run,
  download,
  actorId,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  download: () => Promise<void>;
  actorId?: string;
}) {
  const baselines = asList(project.approvedBaselines);
  const solution = graphNodes(project, 'solution');
  const features = solution.filter((node) => node.type === 'Feature');
  const roles = solution.filter((node) => node.type === 'Role');
  const roleName = new Map(roles.map((node) => [node.id, display(node.statementOrName)]));
  const tasks = graphNodes(project, 'execution');
  const buildPackReady = ['EXECUTION', 'VERIFICATION', 'REPAIR', 'COMPLETE']
    .includes(String(project.project?.lifecycleState));
  return <div className="page-scroll build-page">
    <SectionHeading eyebrow="Export" title="Build pack"
      description="Approve the requirements and solution, then download the complete project plan."
      aside={buildPackReady && tasks.length > 0 && baselines.length >= 2
        ? <button className="primary" disabled={busy} onClick={() => void download()}>Download .factory.zip</button>
        : undefined} />
    <section className="build-action-band">
      <div><small>Current stage</small><strong>{lifecycleLabel(project.project?.lifecycleState)}</strong></div>
      <StageActions project={project} bindings={bindings} busy={busy} run={run} download={download} actorId={actorId} />
    </section>
    <div className="build-grid">
      <section className="card baseline-card">
        <header><div><p className="eyebrow">Approvals</p><h2>Approved baselines</h2></div><span>{baselines.length}/2</span></header>
        {(['intent', 'solution'] as const).map((kind) => {
          const baseline = baselines.find((item) => item.graphKind === kind);
          return <article key={kind} className={baseline ? 'is-ready' : ''}>
            <span>{baseline ? '✓' : '○'}</span>
            <div><strong>{kind === 'intent' ? 'requirements baseline' : 'solution baseline'}</strong>
              <small>{baseline ? display(baseline.baselineId, 'locked') : 'not locked yet'}</small></div>
          </article>;
        })}
      </section>
      <section className="card build-list-card">
        <header><div><p className="eyebrow">Approved product</p><h2>Features</h2></div><span>{features.length}</span></header>
        <div className="compact-list">
          {features.length === 0 && <p className="empty-copy">Approve intent to create the plan.</p>}
          {features.slice(0, 7).map((node) => <article key={node.id}><i style={{ background: color.solution }} /><div><strong>{display(node.statementOrName)}</strong><small>feature</small></div></article>)}
        </div>
      </section>
      <section className="card build-list-card roles-card">
        <header><div><p className="eyebrow">Required expertise</p><h2>Roles</h2></div><span>{roles.length}</span></header>
        <div className="compact-list">
          {roles.length === 0 && <p className="empty-copy">Roles are generated from the approved requirements.</p>}
          {roles.slice(0, 7).map((node) => {
            const context = stringList(node.attributes?.use);
            const allowedScope = stringList(node.attributes?.touch);
            const restrictions = stringList(node.attributes?.dont);
            const completion = stringList(node.attributes?.done);
            return <article key={node.id}><i style={{ background: color.solution }} /><div>
              <strong>{display(node.statementOrName)}</strong>
              <small><b>Responsibility</b> {display(node.attributes?.job, 'Specific area of responsibility')}</small>
              {context.length > 0 && <small><b>Context</b> {context.join(' · ')}</small>}
              {allowedScope.length > 0 && <small><b>Allowed scope</b> {allowedScope.join(' · ')}</small>}
              {restrictions.length > 0 && <small><b>Restrictions</b> {restrictions.join(' · ')}</small>}
              {completion.length > 0 && <small><b>Completion</b> {completion.join(' · ')}</small>}
            </div></article>;
          })}
        </div>
      </section>
      <section className="card build-list-card tasks-card">
        <header><div><p className="eyebrow">Execution</p><h2>Tasks</h2></div><span>{tasks.length}</span></header>
        <div className="compact-list">
          {tasks.length === 0 && <p className="empty-copy">Approve both baselines to create tasks.</p>}
          {tasks.slice(0, 8).map((node) => <article key={node.id}><i style={{ background: color.execution }} /><div><strong>{display(node.statementOrName)}</strong><small>{taskPhaseLabel[display(node.type)] ?? readableLabel(node.type)} · {roleName.get(String(node.attributes?.roleRef)) ?? 'Role not assigned'}</small></div></article>)}
        </div>
      </section>
    </div>
  </div>;
}

function SettingsPage({
  project,
  model,
  platformMode,
}: {
  project: AnyProject;
  model: { connected: boolean; name: string };
  platformMode: PlatformMode;
}) {
  const architecture = platformMode === 'hosted' ? [
    ['Cloudflare Worker', 'Active', 'Serves the app and validates requests.'],
    ['Browser session', 'Active', 'Keeps each session isolated.'],
    ['Durable Object', 'Active', 'Orders each project graph.'],
    ['D1', 'Active', 'Stores sessions and projects.'],
    ['Cloudflare Queue', 'Active', 'Carries model work.'],
    ['R2', 'Active', 'Stores versioned build packs.'],
    ['Qwen local model', model.connected ? 'Active' : 'Offline', 'Answers questions and updates the graph.'],
  ] : [
    ['Local application', 'Active', 'Runs on this machine.'],
    ['Local project files', 'Active', 'Keeps the graph portable.'],
    ['Qwen local model', model.connected ? 'Active' : 'Offline', 'Processes project answers locally.'],
  ];
  return <div className="page-scroll settings-page">
    <SectionHeading eyebrow="Infrastructure" title="Settings"
      description="Cloudflare hosts the app. The model stays local." />
    <div className="settings-grid">
      <section className="card settings-card">
        <header><div><p className="eyebrow">project</p><h2>{display(project.project?.displayName, 'Project')}</h2></div></header>
        <dl>
          <div><dt>project ID</dt><dd><code>{display(project.project?.projectId, 'Not configured')}</code></dd></div>
          <div><dt>repository</dt><dd><code>{display(project.project?.connectedRepository, 'Not configured')}</code></dd></div>
          <div><dt>stage</dt><dd>{lifecycleLabel(project.project?.lifecycleState)}</dd></div>
        </dl>
      </section>
      <section className="card runtime-card">
        <header><div><p className="eyebrow">Services</p><h2>Service locations</h2></div></header>
        <div className="service-list">
          {architecture.map(([name, status, description]) => <article key={name}>
            <span className={`service-status service-${status.toLowerCase()}`}>{status}</span>
            <div><strong>{name}</strong><p>{description}</p></div>
          </article>)}
        </div>
      </section>
    </div>
  </div>;
}

const drubWalkthrough = [
  {
    speaker: 'you',
    text: 'Neighbors got extra food. Other people need dinner. Make handoff easy and safe. Maybe volunteers help. No marketplace nonsense. Keep it simple.',
    adds: 'goal · users · limits',
    delay: 0,
  },
  {
    speaker: 'Dun',
    text: 'Who checks if food is safe to eat?',
    adds: 'one blocking question',
    delay: 1100,
  },
  {
    speaker: 'you',
    text: 'Donors confirm freshness and allergens. Recipients choose. Volunteers move sealed food only. Show rough area to everyone; exact address only for the handoff.',
    adds: 'safety · privacy · success',
    delay: 2100,
  },
] as const;

const drubGraphNodes = [
  { label: 'rough food brief', kind: 'input', x: 12, y: 12, delay: 180 },
  { label: 'safe handoff', kind: 'intent', x: 12, y: 26, delay: 480 },
  { label: 'donor food details', kind: 'intent', x: 12, y: 40, delay: 2400 },
  { label: 'reserve + confirm', kind: 'intent', x: 12, y: 54, delay: 2600 },
  { label: 'exact address private', kind: 'intent', x: 12, y: 68, delay: 2800 },
  { label: 'sealed volunteer only', kind: 'intent', x: 12, y: 82, delay: 3000 },
  { label: 'no marketplace', kind: 'guard', x: 12, y: 94, delay: 780 },

  { label: 'food posts', kind: 'solution', x: 38, y: 15, delay: 3300 },
  { label: 'reservation flow', kind: 'solution', x: 38, y: 33, delay: 3500 },
  { label: 'location rules', kind: 'solution', x: 38, y: 51, delay: 3700 },
  { label: 'volunteer handoff', kind: 'solution', x: 38, y: 69, delay: 3900 },
  { label: 'safety guardrails', kind: 'solution', x: 38, y: 87, delay: 4100 },

  { label: 'interaction design', kind: 'role', x: 63, y: 15, delay: 4400 },
  { label: 'frontend', kind: 'role', x: 63, y: 33, delay: 4600 },
  { label: 'backend', kind: 'role', x: 63, y: 51, delay: 4800 },
  { label: 'privacy review', kind: 'role', x: 63, y: 69, delay: 5000 },
  { label: 'quality assurance', kind: 'role', x: 63, y: 87, delay: 5200 },

  { label: 'post flow · 4 jobs', kind: 'execution', x: 88, y: 15, delay: 5500 },
  { label: 'pickup · 4 jobs', kind: 'execution', x: 88, y: 33, delay: 5700 },
  { label: 'privacy · 4 jobs', kind: 'execution', x: 88, y: 51, delay: 5900 },
  { label: 'volunteer · 4 jobs', kind: 'execution', x: 88, y: 69, delay: 6100 },
  { label: 'guardrails · 4 jobs', kind: 'execution', x: 88, y: 87, delay: 6300 },
] as const;

const drubGraphEdges = [
  { path: 'M12 12 C12 18 12 20 12 26', delay: 300 },
  { path: 'M12 12 C8 24 8 33 12 40', delay: 2250 },
  { path: 'M12 12 C7 32 7 46 12 54', delay: 2450 },
  { path: 'M12 12 C6 40 7 60 12 68', delay: 2650 },
  { path: 'M12 12 C5 48 7 73 12 82', delay: 2850 },
  { path: 'M12 12 C4 55 7 86 12 94', delay: 600 },

  { path: 'M12 40 C21 33 28 20 38 15', delay: 3150 },
  { path: 'M12 54 C22 48 28 38 38 33', delay: 3350 },
  { path: 'M12 68 C22 65 28 54 38 51', delay: 3550 },
  { path: 'M12 82 C22 81 28 72 38 69', delay: 3750 },
  { path: 'M12 94 C22 96 29 90 38 87', delay: 3950 },

  { path: 'M38 15 C48 15 53 15 63 15', delay: 4250 },
  { path: 'M38 15 C49 20 54 27 63 33', delay: 4450 },
  { path: 'M38 33 C49 33 54 33 63 33', delay: 4450 },
  { path: 'M38 33 C48 40 54 47 63 51', delay: 4650 },
  { path: 'M38 51 C48 51 54 51 63 51', delay: 4650 },
  { path: 'M38 51 C49 57 55 65 63 69', delay: 4850 },
  { path: 'M38 69 C49 69 54 69 63 69', delay: 4850 },
  { path: 'M38 87 C48 87 54 87 63 87', delay: 5050 },
  { path: 'M38 87 C49 82 55 74 63 69', delay: 4850 },

  { path: 'M38 15 C56 7 73 9 88 15', delay: 5300 },
  { path: 'M38 33 C56 26 73 27 88 33', delay: 5500 },
  { path: 'M38 51 C56 44 73 45 88 51', delay: 5700 },
  { path: 'M38 69 C56 62 73 63 88 69', delay: 5900 },
  { path: 'M38 87 C56 80 73 81 88 87', delay: 6100 },

  { path: 'M63 15 C73 15 78 15 88 15', delay: 5300 },
  { path: 'M63 33 C74 27 79 22 88 15', delay: 5300 },
  { path: 'M63 33 C73 33 78 33 88 33', delay: 5500 },
  { path: 'M63 51 C73 45 78 39 88 33', delay: 5500 },
  { path: 'M63 51 C73 51 78 51 88 51', delay: 5700 },
  { path: 'M63 69 C73 63 78 57 88 51', delay: 5700 },
  { path: 'M63 69 C73 69 78 69 88 69', delay: 5900 },
  { path: 'M63 69 C74 75 79 81 88 87', delay: 6100 },
  { path: 'M63 87 C73 87 78 87 88 87', delay: 6100 },
] as const;

function MeetDrub() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [started, setStarted] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setStarted(true);
        observer.disconnect();
      }
    }, { threshold: .22 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return <section ref={sectionRef} className="marketing-section drub-section" id="drub">
    <header className="drub-section-head">
      <div className="drub-intro">
        <img src="/brand/caveman-concept-c-older-portrait.webp" alt="Dun, looking curious" />
        <div>
          <p className="marketing-kicker">meet Dun</p>
          <h2>Simple questions.<br />Serious plan.</h2>
        </div>
      </div>
      <p>Each answer becomes a requirement. The graph links it to what gets built, who handles it, and what happens next.</p>
    </header>

    <div key={run} className={`drub-demo ${started ? 'is-building' : ''}`}>
      <div className="drub-chat" aria-label="Example requirements conversation">
        <header>
          <div><i /><span>requirements</span></div>
          <strong>one question at a time</strong>
        </header>
        <ol>
          {drubWalkthrough.map((item) => <li
            className={`drub-message is-${item.speaker === 'Dun' ? 'drub' : 'user'}`}
            key={`${item.delay}-${item.speaker}`}
            style={{ '--delay': `${item.delay}ms` } as React.CSSProperties}
          >
            <span>{item.speaker}</span>
            <p>{item.text}</p>
            <small>{item.adds}</small>
          </li>)}
        </ol>
      </div>

      <div className="drub-graph">
        <header>
          <div><span>neighborhood food graph</span><i>real build</i></div>
          <div className="drub-graph-counts"><span>intent 21</span><span>features 5</span><span>roles 5</span><span>jobs 20</span></div>
        </header>
        <div className="drub-graph-canvas" role="img" aria-label="The real neighborhood food app intent, solution, generated roles, and 20 execution jobs">
          <div className="drub-graph-lanes" aria-hidden="true">
            <span>intent</span><span>solution</span><span>role lenses</span><span>execution</span>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {drubGraphEdges.map((edge, index) => <path
              d={edge.path}
              key={index}
              pathLength="1"
              style={{ '--delay': `${edge.delay}ms` } as React.CSSProperties}
            />)}
          </svg>
          {drubGraphNodes.map((node) => <div
            className={`drub-graph-node is-${node.kind}`}
            key={node.label}
            title={node.label}
            style={{
              '--delay': `${node.delay}ms`,
              left: `${node.x}%`,
              top: `${node.y}%`,
            } as React.CSSProperties}
          >
            <i />
            <span>{node.label}</span>
          </div>)}
        </div>
        <footer>
          <span>Real build pack · 20 jobs accepted · 91 checks passed</span>
          <button type="button" onClick={() => { setStarted(true); setRun((value) => value + 1); }}>replay build</button>
        </footer>
      </div>
    </div>
    <p className="drub-lock-note"><i />Not just a picture. The links control build order, approval, verification, and repair.</p>
  </section>;
}

function MarketingHome({ enterWorkspace }: { enterWorkspace: () => void }) {
  const scrollTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState({}, '', `#${id}`);
  };
  const workspaceLink = (className: string, label: string) => <a className={className} href="/workspace" onClick={(event) => {
    event.preventDefault();
    enterWorkspace();
  }}>{label}<span aria-hidden="true">→</span></a>;

  return <main className="marketing-home">
    <header className="marketing-nav">
      <a className="brand" href="/" aria-label="Graphslop home"><BrandMark /><span>graphslop</span></a>
      <nav aria-label="Public navigation">
        <a href="#drub" onClick={(event) => scrollTo(event, 'drub')}>meet Dun</a>
        <a href="#how" onClick={(event) => scrollTo(event, 'how')}>how it works</a>
        <a href="#output" onClick={(event) => scrollTo(event, 'output')}>files you get</a>
      </nav>
      {workspaceLink('marketing-nav-cta', 'open workbench')}
    </header>

    <section className="marketing-hero">
      <div className="marketing-hero-copy">
        <p className="marketing-kicker">start with the idea</p>
        <h1>Bring the idea.<br />Leave with a plan.</h1>
        <p>Dun asks what matters, records decisions, and makes a build pack.</p>
        <div className="marketing-actions">
          {workspaceLink('marketing-primary', 'start a project')}
          <a className="marketing-secondary" href="#how" onClick={(event) => scrollTo(event, 'how')}>see how it works <span>↓</span></a>
        </div>
        <div className="marketing-proof">
          <span>one question at a time</span>
          <span>decisions stay linked</span>
          <span>works with any coding tool</span>
        </div>
      </div>
      <div className="marketing-hero-visual" aria-label="A rough idea becoming a clear software plan">
        <img src="/brand/caveman-grounded-hero.webp" alt="A bald Neanderthal pulling a secured load of rough ideas through shallow cave water" />
        <div className="hero-product-card">
          <header><span>your initial request</span><i>Dun is listening</i></header>
          <p>Neighbors got extra food. Other people need dinner. Make handoff easy and safe.</p>
          <div className="hero-graph-row">
            <span>surplus food</span><b>→</b><span>safe handoff</span><b>→</b><span>confirmed pickup</span>
          </div>
          <footer><i />one safety question to answer</footer>
        </div>
      </div>
    </section>

    <section className="marketing-signal" aria-label="Product promise">
      <span>describe the idea</span><i>·</i><span>Dun asks what matters</span><i>·</i><span>approve the plan</span><i>·</i><span>build anywhere</span>
    </section>

    <MeetDrub />

    <section className="marketing-section product-section" id="product">
      <div className="marketing-section-copy">
        <p className="marketing-kicker">graph engineering, made simple</p>
        <h2>The plan knows what comes next.</h2>
        <p>Work waits for what it needs. Failed checks go back for repair. Every job stays tied to the idea you approved.</p>
        <ul>
          <li><span>—</span>only the roles this project needs</li>
          <li><span>—</span>dependencies decide what is ready</li>
          <li><span>—</span>every completed job needs proof</li>
        </ul>
      </div>
      <div className="marketing-product-shell" aria-label="Graphslop product preview">
        <aside>
          <div className="mini-brand"><BrandMark /></div>
          <i className="is-active">⌂</i><i>✦</i><i>⌘</i><i>▣</i>
          <div className="mini-presence" aria-label="Dun is online"><i />D</div>
        </aside>
        <div className="mini-workspace">
          <header><div><small>current understanding</small><strong>neighborhood food</strong></div><span>21 requirements linked</span></header>
          <div className="mini-canvas">
            <div className="mini-node mini-node-input"><small>INPUT</small><b>food, area, and time</b></div>
            <div className="mini-node mini-node-intent"><small>GOAL</small><b>safe neighbor handoff</b></div>
            <div className="mini-node mini-node-solution"><small>OUTPUT</small><b>reservation and pickup</b></div>
            <div className="mini-node mini-node-execution"><small>FIRST JOB</small><b>design the posting flow</b></div>
            <svg viewBox="0 0 700 320" preserveAspectRatio="none" aria-hidden="true">
              <path d="M140 78 C205 78 195 78 255 78 M390 78 C455 78 455 218 530 218 M390 78 C455 78 455 78 530 78" />
            </svg>
          </div>
        </div>
      </div>
    </section>

    <section className="marketing-section how-section" id="how">
      <header className="marketing-section-head">
        <p className="marketing-kicker">three clear steps</p>
        <h2>Start before you know everything.</h2>
        <p>Describe. Clarify. Build.</p>
      </header>
      <div className="journey-grid">
        <article>
          <div className="journey-image"><img src="/brand/caveman-grounded-idea.webp" alt="A bald Neanderthal sorting too many rough ideas before the water reaches them" /></div>
          <span>01 / you describe</span>
          <h3>Describe the idea.</h3>
          <p>Start with a single sentence.</p>
        </article>
        <article>
          <div className="journey-image"><img src="/brand/caveman-grounded-decision.webp" alt="A bald Neanderthal choosing between two real cave paths" /></div>
          <span>02 / Dun asks</span>
          <h3>Answer what matters.</h3>
          <p>Only questions that change the product.</p>
        </article>
        <article>
          <div className="journey-image"><img src="/brand/caveman-grounded-plan.webp" alt="A bald Neanderthal carrying one clear plan up a solid cave path" /></div>
          <span>03 / you approve</span>
          <h3>Take the build pack.</h3>
          <p>Use it with any coding tool.</p>
        </article>
      </div>
    </section>

    <section className="marketing-section output-section" id="output">
      <div className="output-copy">
        <p className="marketing-kicker">the build pack</p>
        <h2>A small pack for the whole build.</h2>
        <p>The food-sharing idea needed five roles and twenty ordered jobs. Each finished with proof.</p>
        {workspaceLink('marketing-primary', 'make a build pack')}
      </div>
      <div className="file-pack" aria-label="Real neighborhood food build pack">
        <header><BrandMark /><strong>approved build pack</strong><span>built</span></header>
        <div className="file-tree">
          <p><i>▾</i><b>neighborhood food</b></p>
          <p><i>├</i><span>what people need</span><em>21 linked requirements</em></p>
          <p><i>├</i><span>what gets built</span><em>5 product features</em></p>
          <p><i>├</i><span>who does the work</span><em>5 role lenses</em></p>
          <p><i>├</i><span>build order</span><em>20 bounded jobs</em></p>
          <p><i>├</i><span>hard limits</span><em>no marketplace</em></p>
          <p><i>└</i><span>proof</span><em>91 checks passed</em></p>
        </div>
        <footer><span><i /> requirements locked</span><span><i /> solution locked</span><span><i /> 20 jobs accepted</span></footer>
      </div>
    </section>

    <section className="marketing-final">
      <img src="/brand/caveman-grounded-finale.webp" alt="A bald Neanderthal leaving the cave with one clear plan" />
      <div>
        <p className="marketing-kicker">ready to build</p>
        <h2>From initial idea to build-ready plan.</h2>
        <p>Your requirements become clear, traceable tasks.</p>
        {workspaceLink('marketing-primary', 'open workbench')}
      </div>
    </section>

    <footer className="marketing-footer">
      <a className="brand" href="/"><BrandMark /><span>graphslop</span></a>
      <p>idea → approved build pack</p>
      <a href="/workspace" onClick={(event) => { event.preventDefault(); enterWorkspace(); }}>open workbench</a>
    </footer>
  </main>;
}

export function App() {
  const [project, setProject] = useState<AnyProject | null>(demoMode ? demoProject : null);
  const [bindings, setBindings] = useState<readonly NextBinding[]>([]);
  const [model, setModel] = useState({ connected: demoMode, name: demoMode ? 'demo only' : 'local qwen' });
  const [platformMode, setPlatformMode] = useState<PlatformMode>('local');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [pendingJob, setPendingJob] = useState<{ jobId: string; status: string } | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [loading, setLoading] = useState(!demoMode);
  const [busy, setBusy] = useState(false);
  const [activeCommand, setActiveCommand] = useState<OwnerCommand>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [edgeType, setEdgeType] = useState('DEPENDS_ON');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<PageKey>(pageFromPath);
  const [route, setRoute] = useState(window.location.pathname);
  const initialFlow = useMemo(() => makeFlow(project ?? {}), [project]);
  const [nodes, setNodes] = useState<AppNode[]>(initialFlow.nodes);
  const edges = initialFlow.edges;

  useEffect(() => {
    setNodes(initialFlow.nodes.map((node) => ({
      ...node,
      style: search && !`${node.data.label} ${node.data.type}`.toLowerCase().includes(search.toLowerCase())
        ? { opacity: 0.18 }
        : undefined,
    })));
  }, [initialFlow, search]);

  const load = useCallback(async (quiet = false) => {
    if (demoMode) return;
    if (!quiet) setLoading(true);
    try {
      const mode = await api.initialize();
      setPlatformMode(mode);
      const modelInfo = await api.modelInfo();
      setModel(modelInfo);
      const sessionUser = await api.session();
      if (mode === 'hosted') {
        setUser(sessionUser);
        const available = await api.projects();
        setProjects(available);
        if (window.location.pathname === '/projects/new') {
          setActiveProjectId(undefined);
          setProject(null);
          setBindings([]);
          setPendingJob(null);
          return;
        }
        const routed = window.location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
        const selected = available.find((item) => item.projectId === routed)?.projectId
          ?? available.find((item) => item.projectId === activeProjectId)?.projectId
          ?? available[0]?.projectId;
        if (!selected) {
          setActiveProjectId(undefined);
          setProject(null);
          setBindings([]);
          setPendingJob(null);
          return;
        }
        setActiveProjectId(selected);
        const response = await api.project(selected);
        setProject(asRecord(response.project));
        setBindings(response.nextBindings);
        setPendingJob(response.pendingJob ?? null);
        return;
      }
      setUser(null);
      setProjects([]);
      const response = await api.project();
      setProject(asRecord(response.project));
      setBindings(response.nextBindings);
      setActiveProjectId(display(asRecord(response.project).project?.projectId, 'local-project'));
      setPendingJob(null);
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) {
        setError(cause instanceof Error ? cause.message : 'Could not load the project.');
      }
      setProject(null);
      try { setModel(await api.modelInfo()); } catch { /* status is already offline */ }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [activeProjectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!pendingJob || platformMode !== 'hosted') return;
    const timer = window.setInterval(() => { void load(true); }, 2_000);
    return () => window.clearInterval(timer);
  }, [load, pendingJob, platformMode]);
  useEffect(() => {
    const syncRoute = () => {
      setPage(pageFromPath());
      setRoute(window.location.pathname);
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  function go(nextPage: PageKey) {
    if (nextPage === page) return;
    window.history.pushState({}, '', projectPath(nextPage, activeProjectId));
    setPage(nextPage);
    setRoute(window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function enterWorkspace() {
    window.history.pushState({}, '', '/workspace');
    setRoute('/workspace');
  }

  async function createHostedProject(event: FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.createProject(name);
      setNewProjectName('');
      setActiveProjectId(created.projectId);
      window.history.replaceState({}, '', projectPath('overview', created.projectId));
      setPage('overview');
      setRoute(window.location.pathname);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the project.');
    } finally {
      setBusy(false);
    }
  }

  async function switchProject(projectId: string) {
    setActiveProjectId(projectId);
    window.history.pushState({}, '', projectPath('overview', projectId));
    setPage('overview');
    setRoute(window.location.pathname);
    await load();
  }

  async function run(command: OwnerCommand, input: unknown) {
    const binding = bindingFor(bindings, command);
    if (!binding) return;
    setBusy(true);
    setActiveCommand(command);
    setError('');
    setNotice('');
    try {
      const response = await api.command(binding, input);
      setBindings(response.nextBindings);
      setPendingJob(response.pendingJob ?? null);
      setNotice(response.pendingJob
        ? 'Dun is thinking. You can leave this page.'
        : command === 'edit-intent-graph'
          ? 'Graph updated.'
          : commandNotices[command] ?? 'Action completed.');
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await load();
        setNotice('The graph changed elsewhere. The latest version is now loaded.');
      } else {
        setError(cause instanceof Error ? cause.message : 'The request failed.');
      }
    } finally {
      setBusy(false);
      setActiveCommand(undefined);
    }
  }

  async function download() {
    setBusy(true);
    setError('');
    try {
      await api.downloadBuildPack(activeProjectId);
      setNotice('Build pack downloaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the build pack.');
    } finally {
      setBusy(false);
    }
  }

  function onNodesChange(changes: NodeChange<AppNode>[]) {
    setNodes((current) => applyNodeChanges(changes, current));
  }

  function onConnect(connection: Connection) {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target || source.data.kind !== 'intent' || target.data.kind !== 'intent') {
      setNotice('You can manually connect requirement nodes only.');
      return;
    }
    void run('edit-intent-graph', {
      action: 'connect',
      sourceNodeId: source.data.rawId,
      targetNodeId: target.data.rawId,
      edgeType,
    });
  }

  const selected = nodes.find((node) => node.id === selectedId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const projectReady = project && graphNodes(project, 'intent').length > 0;
  const canEdit = Boolean(bindingFor(bindings, 'edit-intent-graph'));
  const relationshipCount = edges.length;

  const pageContent = project && ({
    overview: <OverviewPage project={project} bindings={bindings} busy={busy} run={run} download={download}
      go={go} nodes={nodes} edges={edges} />,
    intake: <IntakePage project={project} bindings={bindings} busy={busy}
      thinking={Boolean(pendingJob) || activeCommand === 'submit-message' || activeCommand === 'resolve-question'} run={run} go={go} />,
    graph: <GraphPage project={project} projectReady={Boolean(projectReady)} nodes={nodes} edges={edges}
      selected={selected} selectedEdge={selectedEdge} canEdit={canEdit} busy={busy}
      search={search} setSearch={setSearch} edgeType={edgeType} setEdgeType={setEdgeType}
      onNodesChange={onNodesChange} onConnect={onConnect} setSelectedId={setSelectedId}
      setSelectedEdgeId={setSelectedEdgeId} run={run} />,
    build: <BuildPage project={project} bindings={bindings} busy={busy} run={run} download={download} actorId={user?.id} />,
    settings: <SettingsPage project={project} model={model} platformMode={platformMode} />,
  } satisfies Record<PageKey, React.ReactNode>)[page];

  if (route === '/') return <MarketingHome enterWorkspace={enterWorkspace} />;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Graphslop home" onClick={(event) => {
        if (!project) return;
        event.preventDefault();
        go('overview');
      }}><BrandMark /><span>graphslop</span></a>
      {project ? <div className="project-switcher">
        <span className="project-avatar">{display(project.project?.displayName, 'LP').slice(0, 2).toUpperCase()}</span>
        {platformMode === 'hosted' ? <label>
          <span className="sr-only">Current project</span>
          <select value={activeProjectId} onChange={(event) => {
            if (event.target.value === '__new__') {
              setProject(null);
              setActiveProjectId(undefined);
              window.history.pushState({}, '', '/projects/new');
              setRoute('/projects/new');
              return;
            }
            void switchProject(event.target.value);
          }}>
            {projects.map((item) => <option value={item.projectId} key={item.projectId}>{item.displayName}</option>)}
            <option value="__new__">+ new project</option>
          </select>
          <small>{projects.find((item) => item.projectId === activeProjectId)?.role ?? 'member'} workspace</small>
        </label> : <div><strong>{display(project.project?.displayName, 'local project')}</strong><small>local workspace</small></div>}
      </div> : <div className="topbar-center"><span>requirements → build pack</span></div>}
      <div className="topbar-actions">
        <div className={`model-status ${model.connected ? 'connected' : ''}`}>
          <i /> <span>{pendingJob ? 'Qwen is working' : model.connected ? model.name : 'Qwen offline'}</span>
        </div>
      </div>
    </header>
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="error-toast" role="alert"><strong>Something went wrong.</strong>{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}

    {loading ? <main className="loading"><div className="loader-orbit"><i /><i /><i /></div><p>Opening your project…</p></main>
      : !project && platformMode === 'hosted' ? <main className="claim-screen create-project-screen">
        <div className="claim-stage">
          <div className="claim-character" aria-hidden="true" />
          <form onSubmit={createHostedProject}>
            <div className="claim-brand"><BrandMark /><span>graphslop</span></div>
            <p className="eyebrow">new project</p>
            <h1>Name your project.</h1>
            <p>Create one now. You can add more projects later.</p>
            <label htmlFor="project-name">Project name</label>
            <input id="project-name" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)}
              maxLength={80} autoFocus />
            <button className="primary" disabled={busy || !newProjectName.trim()}>Create project</button>
          </form>
        </div>
      </main>
      : !project ? <main className="claim-screen">
        <div className="claim-stage">
          <div className="claim-character" aria-hidden="true" />
          <section className="hosted-access-card">
            <div className="claim-brand"><BrandMark /><span>graphslop</span></div>
            <p className="eyebrow">local workspace</p>
            <h1>No project is open.</h1>
            <p>Check the local server, then try again.</p>
            <button className="primary" onClick={() => void load()}>Try again</button>
          </section>
        </div>
      </main>
      : <div className="saas-shell">
        <aside className="sidebar">
          <nav aria-label="Project navigation">
            {(Object.keys(pageMeta) as PageKey[]).map((key) => <PageLink key={key} page={key} active={page === key} go={go}>
              <span className="nav-icon" aria-hidden="true">{pageMeta[key].short}</span>
              <span>{pageMeta[key].label}</span>
              {key === 'intake' && project.currentQuestion?.questionId && <i className="nav-alert" />}
            </PageLink>)}
          </nav>
          <div className="sidebar-foot">
            <img src="/brand/caveman-concept-c-older-portrait.webp" alt="" />
            <div><strong>From idea to build pack.</strong><small>Dun plans. Your coding tool builds.</small></div>
          </div>
        </aside>
        <main className="saas-content">{pageContent}</main>
      </div>}
  </div>;
}
