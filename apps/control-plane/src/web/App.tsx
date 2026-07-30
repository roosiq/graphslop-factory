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
  Decide: 'Decision',
  Implement: 'Implementation',
  Verify: 'Verification',
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
  const phaseX: Record<string, number> = { Decide: 1360, Implement: 1700, Verify: 2040 };
  const roleLaneY = new Map<string, number>();
  let nextLaneY = 220;
  for (const role of roleNodes) {
    roleLaneY.set(role.id, nextLaneY);
    const tasksForRole = executionNodes.filter((node) => node.attributes?.roleRef === role.id);
    const maxInPhase = Math.max(1, ...['Decide', 'Implement', 'Verify'].map((phase) =>
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
      const dependency = kind === 'execution' && edge.type === 'DEPENDS_ON';
      edges.push({
        id: `${kind}-edge:${edge.id}`,
        source: graphFlowId(kind, dependency
          ? edge.targetNodeRef?.nodeId ?? edge.to
          : edge.sourceNodeRef?.nodeId ?? edge.from),
        target: graphFlowId(kind, dependency
          ? edge.sourceNodeRef?.nodeId ?? edge.from
          : edge.targetNodeRef?.nodeId ?? edge.to),
        label: dependency
          ? 'precedes'
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
        data: { rawId: edge.id, graphKind: kind },
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
  if (selectedEdge?.data?.graphKind === 'intent') {
    return <aside className="inspector" aria-label="Graph inspector">
      <p className="eyebrow">link</p>
      <h2>{display(selectedEdge.label)}</h2>
      <code>{display(selectedEdge.data.rawId)}</code>
      <button className="danger" disabled={!canEdit || busy} onClick={() => void run('edit-intent-graph', {
        action: 'delete-edge',
        edgeId: selectedEdge.data?.rawId,
      })}>Delete relationship</button>
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
  const question = asRecord(project.currentQuestion);
  const messages = asList(project.messages);
  const editBinding = bindingFor(bindings, 'edit-intent-graph');
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    await run('submit-message', { content: message.trim() });
    setMessage('');
  }
  async function reply(disposition: 'answered' | 'deferred') {
    await run('resolve-question', {
      questionId: question.questionId,
      disposition,
      content: answer.trim() || 'Decision deferred.',
    });
    setAnswer('');
  }
  return <aside className="conversation-panel" aria-label="Requirements conversation">
    <div className="conversation-title">
      <div className="conversation-avatar" aria-hidden="true">
        <img src="/brand/caveman-concept-c-older-portrait.webp" alt="" />
      </div>
      <div className="conversation-heading-copy">
        <p className="eyebrow">Drub</p>
        <h2>Start with what<br />you know.</h2>
        <p>Drub asks only the questions that affect the product.</p>
      </div>
    </div>
    <div className="thread" tabIndex={0} aria-label="Requirements message history">
      {messages.length === 0 && <div className="starter">
        <span aria-hidden="true">↳</span>
        <p>Describe the project in your own words. Missing details are fine.</p>
      </div>}
      {messages.slice(-6).map((item) => <article className="owner-message" key={item.messageId}>
        <small>{item.actor === 'owner' ? 'You' : 'Drub'}</small><p>{display(item.content)}</p>
      </article>)}
      {question.questionId && <article className="model-question">
        <small>Drub asks · {display(question.category)}</small>
        <p>{display(question.text)}</p>
        <textarea aria-label="Answer Drub" rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)}
          placeholder="Answer in your own words…" disabled={!bindingFor(bindings, 'resolve-question') || busy} />
        <div className="button-row">
          <button className="primary" disabled={!answer.trim() || busy} onClick={() => void reply('answered')}>Answer</button>
          <button disabled={busy} onClick={() => void reply('deferred')}>Decide later</button>
        </div>
      </article>}
    </div>
    <form className="rough-composer" onSubmit={send}>
      <label htmlFor="rough-input">{messages.length ? 'Add or correct something' : 'What are you building?'}</label>
      <textarea id="rough-input" rows={4} value={message} onChange={(event) => setMessage(event.target.value)}
        placeholder="I need a simple app that analyzes pasted text and shows a useful score. No login."
        disabled={!bindingFor(bindings, 'submit-message') || busy} />
      <button className="primary" disabled={!message.trim() || !bindingFor(bindings, 'submit-message') || busy}>
        {thinking ? 'Drub is thinking…' : 'Send to Drub'}
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
  const hasOpenQuestion = Boolean(project.currentQuestion?.questionId);
  return <div className="stage-actions">
    {!hasOpenQuestion && button('review-intent', 'Review requirements')}
    {button('approve-intent', 'Approve requirements', approvalInput(project, 'intent', actorId))}
    {button('propose-solution', 'Generate solution')}
    {button('review-solution', 'Review solution')}
    {button('approve-solution', 'Approve solution', approvalInput(project, 'solution', actorId))}
    {button('compile-execution', 'Generate build pack')}
    {baselines.length >= 2 && tasks.length > 0 && <button className="stage-action download" disabled={busy}
      onClick={() => void download()}>Download .factory.zip<span>↓</span></button>}
    {hasOpenQuestion
      ? <small>Answer or defer the open question before approving requirements.</small>
      : !bindings.some((item) => ['review-intent', 'approve-intent', 'propose-solution', 'review-solution', 'approve-solution', 'compile-execution'].includes(item.command))
      && tasks.length === 0 && <small>Answer the question or add more context.</small>}
  </div>;
}

type PageKey = 'overview' | 'intake' | 'graph' | 'build' | 'settings';

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
  actorId,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  download: () => Promise<void>;
  go: (page: PageKey) => void;
  nodes: AppNode[];
  edges: Edge[];
  actorId?: string;
}) {
  const intent = graphNodes(project, 'intent');
  const solution = graphNodes(project, 'solution');
  const execution = graphNodes(project, 'execution');
  const questions = intent.filter((node) => node.type === 'Question' && !['confirmed', 'superseded'].includes(String(node.status))).length
    + (project.currentQuestion?.questionId ? 1 : 0);
  const baselines = asList(project.approvedBaselines);
  const nextPage: PageKey = project.currentQuestion?.questionId || intent.length === 0 ? 'intake'
    : baselines.length < 2 ? 'build'
    : execution.length === 0 ? 'build'
    : 'graph';
  return <div className="page-scroll overview-page">
    <SectionHeading
      eyebrow="Project overview"
      title={display(project.project?.displayName, 'Local project')}
      description="Turn an initial idea into an approved build pack."
      aside={<span className="lifecycle-badge"><i />{lifecycleLabel(project.project?.lifecycleState)}</span>}
    />
    <section className="next-step-card">
      <div className="next-step-copy">
        <span className="step-number">next</span>
        <div>
          <p className="eyebrow">recommended next step</p>
          <h2>{pageMeta[nextPage].description}</h2>
          <p>{nextPage === 'intake'
            ? 'Answer the question or add context.'
            : nextPage === 'build'
              ? 'Review, approve, and compile.'
              : 'Trace requirements to planned work.'}</p>
        </div>
      </div>
      <PageLink page={nextPage} go={go} className="primary-link">Open {pageMeta[nextPage].label}<span>→</span></PageLink>
    </section>
    <section className="metric-grid" aria-label="Project metrics">
      <article><small>requirements</small><strong>{intent.filter((node) => node.type !== 'Question').length}</strong><span>{questions ? `${questions} open question${questions === 1 ? '' : 's'}` : 'No blocking questions'}</span></article>
      <article><small>solution</small><strong>{solution.length}</strong><span>{baselines.some((item) => item.graphKind === 'solution') ? 'Baseline approved' : 'Approval required'}</span></article>
      <article><small>tasks</small><strong>{execution.length}</strong><span>{execution.length ? 'Tasks ready' : 'No tasks yet'}</span></article>
      <article><small>relationships</small><strong>{edges.length}</strong><span>{nodes.length} graph nodes</span></article>
    </section>
    <div className="overview-columns">
      <section className="card project-flow-card">
        <header><div><p className="eyebrow">Project workflow</p><h2>From requirements to build pack</h2></div></header>
        <div className="project-flow">
          {[
            ['1', 'requirements', intent.length > 0, 'capture the goal'],
            ['2', 'solution', solution.length > 0, 'shape the product'],
            ['3', 'tasks', execution.length > 0, 'create bounded tasks'],
            ['4', 'build pack', execution.length > 0 && baselines.length >= 2, 'use files anywhere'],
          ].map(([number, label, done, help], index) => <article key={String(label)} className={done ? 'is-done' : ''}>
            <span>{done ? '✓' : number}</span>
            <div><strong>{label}</strong><small>{help}</small></div>
            {index < 3 && <i />}
          </article>)}
        </div>
      </section>
      <section className="card action-card">
        <header><div><p className="eyebrow">available actions</p><h2>Move the project forward</h2></div></header>
        <StageActions project={project} bindings={bindings} busy={busy} run={run} download={download} actorId={actorId} />
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
    <SectionHeading eyebrow="Project requirements" title="Tell Drub what you’re building"
      description="Drub records your requirements and asks focused follow-up questions." />
    <div className="intake-layout">
      <Conversation project={project} bindings={bindings} busy={busy} thinking={thinking} run={run} />
      <RequirementLedger project={project} go={go} />
    </div>
  </div>;
}

function GraphPage({
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
  return <div className="graph-page">
    <div className="graph-page-head">
      <div><p className="eyebrow">Project traceability</p><h1>Project graph</h1><p>Every planned task traces back to the requirement that authorized it.</p></div>
      <div className="graph-page-stats"><span>{nodes.length} nodes</span><i /><span>{edges.length} links</span></div>
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
          {['source', 'requirements', 'solution', 'roles', 'decisions', 'implementation', 'verification'].map((stage, index) =>
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
  return <div className="page-scroll build-page">
    <SectionHeading eyebrow="Export" title="Build pack"
      description="Approve the requirements and solution, then download the complete project plan."
      aside={tasks.length > 0 && baselines.length >= 2
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
  { speaker: 'you', text: 'Need a site. Paste writing. Show what sounds weak.', adds: 'goal · input · behavior', step: 0 },
  { speaker: 'Drub', text: 'One score, flagged lines, or both?', adds: 'open question', step: 1 },
  { speaker: 'you', text: 'Both. Show the exact lines.', adds: 'output · success check', step: 2 },
  { speaker: 'Drub', text: 'Save the writing?', adds: 'privacy decision', step: 3 },
  { speaker: 'you', text: 'No. No login either.', adds: '2 hard limits', step: 4 },
] as const;

const drubGraphNodes = [
  { label: 'rough brief', kind: 'input', x: 12, y: 16, step: 0 },
  { label: 'find weak writing', kind: 'intent', x: 11, y: 34, step: 0 },
  { label: 'pasted text', kind: 'intent', x: 14, y: 54, step: 0 },
  { label: 'analyze text', kind: 'intent', x: 11, y: 74, step: 0 },
  { label: 'score + lines', kind: 'intent', x: 16, y: 91, step: 2 },
  { label: 'single page', kind: 'solution', x: 43, y: 14, step: 1 },
  { label: 'text editor', kind: 'solution', x: 40, y: 32, step: 2 },
  { label: 'scoring rules', kind: 'solution', x: 47, y: 50, step: 2 },
  { label: 'score card', kind: 'solution', x: 41, y: 68, step: 2 },
  { label: 'flagged lines', kind: 'solution', x: 48, y: 86, step: 2 },
  { label: 'no accounts', kind: 'guard', x: 65, y: 17, step: 4 },
  { label: 'no storage', kind: 'guard', x: 66, y: 34, step: 4 },
  { label: 'build input', kind: 'execution', x: 84, y: 13, step: 2 },
  { label: 'build scorer', kind: 'execution', x: 83, y: 30, step: 2 },
  { label: 'render score', kind: 'execution', x: 86, y: 47, step: 2 },
  { label: 'mark exact lines', kind: 'execution', x: 81, y: 65, step: 2 },
  { label: 'privacy check', kind: 'execution', x: 86, y: 82, step: 4 },
  { label: 'browser proof', kind: 'execution', x: 80, y: 94, step: 4 },
] as const;

const drubGraphEdges = [
  { path: 'M12 16 C12 23 11 26 11 34', step: 0 },
  { path: 'M11 34 C12 42 14 46 14 54', step: 0 },
  { path: 'M14 54 C13 62 11 66 11 74', step: 0 },
  { path: 'M11 74 C12 82 15 84 16 91', step: 2 },
  { path: 'M12 16 C24 16 31 14 43 14', step: 1 },
  { path: 'M14 54 C24 49 31 36 40 32', step: 2 },
  { path: 'M11 74 C25 70 33 55 47 50', step: 2 },
  { path: 'M16 91 C27 87 32 72 41 68', step: 2 },
  { path: 'M16 91 C28 94 37 90 48 86', step: 2 },
  { path: 'M43 14 C57 10 72 10 84 13', step: 2 },
  { path: 'M40 32 C55 29 68 28 83 30', step: 2 },
  { path: 'M47 50 C62 48 73 47 86 47', step: 2 },
  { path: 'M41 68 C55 66 68 53 86 47', step: 2 },
  { path: 'M48 86 C60 79 69 69 81 65', step: 2 },
  { path: 'M65 17 C75 17 79 20 83 30', step: 4 },
  { path: 'M66 34 C76 48 80 67 86 82', step: 4 },
  { path: 'M86 47 C85 55 83 59 81 65', step: 2 },
  { path: 'M81 65 C83 72 85 76 86 82', step: 4 },
  { path: 'M86 82 C85 88 83 91 80 94', step: 4 },
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
        <img src="/brand/caveman-concept-c-older-portrait.webp" alt="Drub, looking curious" />
        <div>
          <p className="marketing-kicker">meet Drub</p>
          <h2>Simple questions.<br />Serious plan.</h2>
        </div>
      </div>
      <p>Drub turns each answer into linked requirements. The graph grows while you talk.</p>
    </header>

    <div key={run} className={`drub-demo ${started ? 'is-building' : ''}`}>
      <div className="drub-chat" aria-label="Example requirements conversation">
        <header>
          <div><i /><span>requirements</span></div>
          <strong>one question at a time</strong>
        </header>
        <ol>
          {drubWalkthrough.map((item) => <li
            className={`drub-message is-${item.speaker === 'Drub' ? 'drub' : 'user'}`}
            key={`${item.step}-${item.speaker}`}
            style={{ '--step': item.step } as React.CSSProperties}
          >
            <span>{item.speaker}</span>
            <p>{item.text}</p>
            <small>{item.adds}</small>
          </li>)}
        </ol>
      </div>

      <div className="drub-graph">
        <header>
          <div><span>live project graph</span><i>draft</i></div>
          <div className="drub-graph-counts"><span>intent 5</span><span>solution 5</span><span>jobs 6</span></div>
        </header>
        <div className="drub-graph-canvas" role="img" aria-label="A linked intent, solution, and execution graph growing from the requirements conversation">
          <div className="drub-graph-lanes" aria-hidden="true">
            <span>intent</span><span>solution</span><span>execution</span>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {drubGraphEdges.map((edge, index) => <path
              d={edge.path}
              key={index}
              pathLength="1"
              style={{ '--step': edge.step } as React.CSSProperties}
            />)}
          </svg>
          {drubGraphNodes.map((node) => <div
            className={`drub-graph-node is-${node.kind}`}
            key={node.label}
            style={{
              '--step': node.step,
              left: `${node.x}%`,
              top: `${node.y}%`,
            } as React.CSSProperties}
          >
            <i />
            <span>{node.label}</span>
          </div>)}
        </div>
        <footer>
          <span>Every node keeps its source.</span>
          <button type="button" onClick={() => { setStarted(true); setRun((value) => value + 1); }}>replay build</button>
        </footer>
      </div>
    </div>
    <p className="drub-lock-note"><i />Nothing runs until you approve the plan.</p>
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
        <a href="#drub" onClick={(event) => scrollTo(event, 'drub')}>meet Drub</a>
        <a href="#how" onClick={(event) => scrollTo(event, 'how')}>how it works</a>
        <a href="#output" onClick={(event) => scrollTo(event, 'output')}>files you get</a>
      </nav>
      {workspaceLink('marketing-nav-cta', 'open workbench')}
    </header>

    <section className="marketing-hero">
      <div className="marketing-hero-copy">
        <p className="marketing-kicker">start with the idea</p>
        <h1>Bring the idea.<br />Leave with a plan.</h1>
        <p>Drub asks what matters, records decisions, and makes a build pack.</p>
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
          <header><span>your initial request</span><i>Drub is listening</i></header>
          <p>Need app. Upload document. Find repeated language. Show score.</p>
          <div className="hero-graph-row">
            <span>input</span><b>→</b><span>behavior</span><b>→</b><span>output</span>
          </div>
          <footer><i />one important question to answer</footer>
        </div>
      </div>
    </section>

    <section className="marketing-signal" aria-label="Product promise">
      <span>describe the idea</span><i>·</i><span>Drub asks what matters</span><i>·</i><span>approve the plan</span><i>·</i><span>build anywhere</span>
    </section>

    <MeetDrub />

    <section className="marketing-section product-section" id="product">
      <div className="marketing-section-copy">
        <p className="marketing-kicker">built to remember</p>
        <h2>Your idea stays your idea.</h2>
        <p>Requirements and approvals stay linked. Coding tools follow the plan.</p>
        <ul>
          <li><span>—</span>ask only what matters</li>
          <li><span>—</span>record every decision</li>
          <li><span>—</span>wait for approval</li>
        </ul>
      </div>
      <div className="marketing-product-shell" aria-label="Graphslop product preview">
        <aside>
          <div className="mini-brand"><BrandMark /></div>
          <i className="is-active">⌂</i><i>✦</i><i>⌘</i><i>▣</i>
          <div className="mini-presence" aria-label="Drub is online"><i />D</div>
        </aside>
        <div className="mini-workspace">
          <header><div><small>current understanding</small><strong>document checker</strong></div><span>4 choices linked</span></header>
          <div className="mini-canvas">
            <div className="mini-node mini-node-input"><small>INPUT</small><b>paste document</b></div>
            <div className="mini-node mini-node-intent"><small>GOAL</small><b>find repeated language</b></div>
            <div className="mini-node mini-node-solution"><small>OUTPUT</small><b>clear score and examples</b></div>
            <div className="mini-node mini-node-execution"><small>FIRST TASK</small><b>build scoring step</b></div>
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
          <span>02 / Drub asks</span>
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
        <p>Requirements, decisions, build order, boundaries, and acceptance checks.</p>
        {workspaceLink('marketing-primary', 'make a build pack')}
      </div>
      <div className="file-pack" aria-label="Example project plan">
        <header><BrandMark /><strong>approved build pack</strong><span>ready</span></header>
        <div className="file-tree">
          <p><i>▾</i><b>approved project</b></p>
          <p><i>├</i><span>product summary</span><em>plain language</em></p>
          <p><i>├</i><span>primary users</span><em>real people</em></p>
          <p><i>├</i><span>product behavior</span><em>screens and flow</em></p>
          <p><i>├</i><span>execution plan</span><em>build order</em></p>
          <p><i>├</i><span>excluded scope</span><em>hard boundaries</em></p>
          <p><i>└</i><span>acceptance checks</span><em>proof</em></p>
        </div>
        <footer><span><i /> meaning locked</span><span><i /> plan locked</span><span><i /> ready for code</span></footer>
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
        ? 'Drub is thinking. You can leave this page.'
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
      go={go} nodes={nodes} edges={edges} actorId={user?.id} />,
    intake: <IntakePage project={project} bindings={bindings} busy={busy}
      thinking={Boolean(pendingJob) || activeCommand === 'submit-message' || activeCommand === 'resolve-question'} run={run} go={go} />,
    graph: <GraphPage projectReady={Boolean(projectReady)} nodes={nodes} edges={edges}
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
            <div><strong>From idea to build pack.</strong><small>Drub plans. Your coding tool builds.</small></div>
          </div>
        </aside>
        <main className="saas-content">{pageContent}</main>
      </div>}
  </div>;
}
