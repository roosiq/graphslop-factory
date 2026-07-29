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
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, bindingFor, OwnerApi, type NextBinding, type OwnerCommand } from './api.js';
import { demoProject } from './demo.js';
import { asList, asRecord, display, graphNodes, lifecycleLabel, solutionFeatures } from './model.js';

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

type AnyProject = Record<string, any>;
type GraphKind = 'input' | 'intent' | 'solution' | 'execution' | 'question';
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
  execution: '#d87961',
} satisfies Record<GraphKind, string>;

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
      <span>{data.kind}</span>
      <i style={{ background: color[data.kind] }} />
      <small>{data.type}</small>
    </div>
    <strong>{data.label}</strong>
    <div className="graph-node-state">{data.status}</div>
    <Handle type="source" position={Position.Right} />
  </article>;
}

const nodeTypes = { graph: GraphNode };

function savedPosition(id: string, fallback: { x: number; y: number }) {
  try {
    const value = JSON.parse(localStorage.getItem(`graphslop-position:${id}`) ?? 'null');
    return typeof value?.x === 'number' && typeof value?.y === 'number' ? value : fallback;
  } catch {
    return fallback;
  }
}

function makeFlow(project: AnyProject): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = [];
  const edges: Edge[] = [];
  const columns: Record<GraphKind, number> = { input: 0, question: 0, intent: 390, solution: 790, execution: 1190 };
  const counts: Record<GraphKind, number> = { input: 0, question: 0, intent: 0, solution: 0, execution: 0 };
  const pushNode = (kind: GraphKind, rawId: string, label: string, type: string, status: string, raw?: AnyProject) => {
    const index = counts[kind]++;
    const id = flowId(kind, rawId);
    const baseY = kind === 'question' ? 410 : 40 + index * 132;
    nodes.push({
      id,
      type: 'graph',
      position: savedPosition(id, { x: columns[kind], y: baseY }),
      data: { kind, rawId, label, type, status, raw },
    });
  };
  const graphFlowId = (kind: 'intent' | 'solution' | 'execution', rawId: string) => {
    const raw = graphNodes(project, kind).find((node) => node.id === rawId);
    return flowId(kind === 'intent' && raw?.type === 'Question' ? 'question' : kind, rawId);
  };

  for (const message of asList(project.messages)) {
    pushNode('input', message.messageId, display(message.content), 'message', message.actor === 'owner' ? 'owner input' : 'model');
  }
  for (const kind of ['intent', 'solution', 'execution'] as const) {
    for (const node of graphNodes(project, kind)) {
      pushNode(kind === 'intent' && node.type === 'Question' ? 'question' : kind,
        node.id, display(node.statementOrName, node.id), display(node.type), display(node.status), node);
    }
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
      label: 'needs answer',
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
          label: 'said as',
          style: { stroke: '#596273' },
        });
      }
    }
  }
  for (const kind of ['intent', 'solution', 'execution'] as const) {
    const graph = asRecord(project[`${kind}Graph`]);
    for (const edge of asList(graph.edges)) {
      edges.push({
        id: `${kind}-edge:${edge.id}`,
        source: graphFlowId(kind, edge.sourceNodeRef?.nodeId ?? edge.from),
        target: graphFlowId(kind, edge.targetNodeRef?.nodeId ?? edge.to),
        label: display(edge.type),
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: color[kind] },
        data: { rawId: edge.id, graphKind: kind },
      });
    }
    for (const link of asList(graph.crossGraphLinks)) {
      const sourceKind = display(link.source?.graphKind) as GraphKind;
      const targetKind = display(link.target?.graphKind) as GraphKind;
      edges.push({
        id: `trace:${link.id}`,
        source: flowId(sourceKind, link.source?.nodeId),
        target: flowId(targetKind, link.target?.nodeId),
        label: display(link.type),
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: color[sourceKind], strokeWidth: 1.5 },
      });
    }
  }
  return { nodes, edges };
}

function approvalInput(project: AnyProject, kind: 'intent' | 'solution') {
  const baselines = asList(project.approvedBaselines);
  const projection = [...asList(project.projections)].reverse().find((item) => item.graphKind === kind);
  const graph = asRecord(project[`${kind}Graph`]);
  const version = baselines.filter((item) => item.graphKind === kind).length + 1;
  return {
    approvalId: `${kind}-approval-${crypto.randomUUID()}`,
    actorId: 'local-owner',
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
      <p className="eyebrow">Relationship</p>
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
    <p>Inspect a requirement, edit it directly, or drag between requirement nodes to connect them.</p>
  </aside>;
  const editable = selected.data.kind === 'intent' && canEdit;
  return <aside className="inspector" aria-label="Graph inspector">
    <div className="inspector-kind"><i style={{ background: color[selected.data.kind] }} />{selected.data.kind}</div>
    <h2>{selected.data.label}</h2>
    <dl>
      <div><dt>Type</dt><dd>{selected.data.type}</dd></div>
      <div><dt>Status</dt><dd>{selected.data.status}</dd></div>
      <div><dt>ID</dt><dd><code>{selected.data.rawId}</code></dd></div>
    </dl>
    {selected.data.raw?.sourceQuote && <section className="source-quote">
      <small>Original words</small>
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
        {intentTypes.map((item) => <option key={item}>{item}</option>)}
      </select>
      <label htmlFor="edit-statement">Requirement</label>
      <textarea id="edit-statement" rows={5} value={statement} onChange={(event) => setStatement(event.target.value)}
        disabled={!editable || busy} />
      <button className="primary" disabled={!editable || busy || !statement.trim()}>Save requirement</button>
      {!canEdit && <small>Frozen requirements are read-only. Start a new baseline to change them.</small>}
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
      content: answer.trim() || 'Deferred by owner.',
    });
    setAnswer('');
  }
  return <aside className="conversation-panel" aria-label="Requirements conversation">
    <div className="conversation-title">
      <div className="conversation-avatar" aria-hidden="true">
        <img src="/brand/caveman-neanderthal-confused-portrait.webp" alt="" />
      </div>
      <div className="conversation-heading-copy">
        <p className="eyebrow">Talk to caveman</p>
        <h1>Say thing.<br />Make graph.</h1>
        <p>Caveman asks what matters. Every answer goes into the build pack.</p>
      </div>
    </div>
    <div className="thread" tabIndex={0} aria-label="Requirements message history">
      {messages.length === 0 && <div className="starter">
        <span aria-hidden="true">↳</span>
        <p>Describe the software in plain language. Contradictions and missing details are fine.</p>
      </div>}
      {messages.slice(-6).map((item) => <article className="owner-message" key={item.messageId}>
        <small>You</small><p>{display(item.content)}</p>
      </article>)}
      {question.questionId && <article className="model-question">
        <small>Caveman asks · {display(question.category)}</small>
        <p>{display(question.text)}</p>
        <textarea aria-label="Answer Qwen" rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)}
          placeholder="Answer in your own words…" disabled={!bindingFor(bindings, 'resolve-question') || busy} />
        <div className="button-row">
          <button className="primary" disabled={!answer.trim() || busy} onClick={() => void reply('answered')}>Answer</button>
          <button disabled={busy} onClick={() => void reply('deferred')}>Later</button>
        </div>
      </article>}
    </div>
    <form className="rough-composer" onSubmit={send}>
      <label htmlFor="rough-input">{messages.length ? 'Add or correct something' : 'What should we build?'}</label>
      <textarea id="rough-input" rows={4} value={message} onChange={(event) => setMessage(event.target.value)}
        placeholder="Need app. Paste text. Show useful score. No login."
        disabled={!bindingFor(bindings, 'submit-message') || busy} />
      <button className="primary" disabled={!message.trim() || !bindingFor(bindings, 'submit-message') || busy}>
        {thinking ? 'Caveman thinks…' : 'Tell caveman'}
      </button>
      {thinking && <small className="thinking-note" role="status">The local brain usually needs 20–45 seconds.</small>}
    </form>
    <details className="manual-add">
      <summary>Add requirement by hand</summary>
      <select value={newType} onChange={(event) => setNewType(event.target.value)} disabled={!editBinding || busy}>
        {intentTypes.map((item) => <option key={item}>{item}</option>)}
      </select>
      <textarea rows={2} value={newStatement} onChange={(event) => setNewStatement(event.target.value)}
        placeholder="Exact requirement…" disabled={!editBinding || busy} />
      <button disabled={!editBinding || !newStatement.trim() || busy} onClick={() => {
        void run('edit-intent-graph', { action: 'add-node', type: newType, statement: newStatement.trim() });
        setNewStatement('');
      }}>Add node</button>
    </details>
  </aside>;
}

function StageActions({
  project,
  bindings,
  busy,
  run,
  download,
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  download: () => Promise<void>;
}) {
  const button = (command: OwnerCommand, label: string, input: unknown = {}) =>
    bindingFor(bindings, command)
      ? <button className="stage-action" disabled={busy} onClick={() => void run(command, input)}>{label}<span>→</span></button>
      : null;
  const intentNodes = graphNodes(project, 'intent');
  const tasks = graphNodes(project, 'execution');
  const baselines = asList(project.approvedBaselines);
  const hasOpenQuestion = Boolean(project.currentQuestion?.questionId);
  return <div className="stage-actions">
    {!hasOpenQuestion && button('review-intent', 'Review requirements')}
    {button('approve-intent', 'Freeze requirements', approvalInput(project, 'intent'))}
    {button('propose-solution', 'Shape build plan', {
      features: solutionFeatures(intentNodes),
    })}
    {button('review-solution', 'Review build plan')}
    {button('approve-solution', 'Freeze build plan', approvalInput(project, 'solution'))}
    {button('compile-execution', 'Compile build pack')}
    {baselines.length >= 2 && tasks.length > 0 && <button className="stage-action download" disabled={busy}
      onClick={() => void download()}>Download .factory.zip<span>↓</span></button>}
    {hasOpenQuestion
      ? <small>Answer or defer the current question before freezing requirements.</small>
      : !bindings.some((item) => ['review-intent', 'approve-intent', 'propose-solution', 'review-solution', 'approve-solution', 'compile-execution'].includes(item.command))
      && tasks.length === 0 && <small>Answer the current question or add more detail.</small>}
  </div>;
}

type PageKey = 'overview' | 'intake' | 'graph' | 'build' | 'settings';

const pageMeta: Record<PageKey, { label: string; short: string; description: string }> = {
  overview: { label: 'Overview', short: '⌂', description: 'Project health and next step' },
  intake: { label: 'Intake', short: '✦', description: 'Tell us what to build' },
  graph: { label: 'Graph', short: '⌘', description: 'Requirements and relationships' },
  build: { label: 'Build pack', short: '▣', description: 'Freeze, compile, and export' },
  settings: { label: 'Settings', short: '⚙', description: 'Runtime and project connections' },
};

function pageFromPath(): PageKey {
  const value = window.location.pathname.split('/').filter(Boolean).at(-1);
  return value && value in pageMeta ? value as PageKey : 'overview';
}

function projectPath(page: PageKey) {
  return `/projects/local-project${page === 'overview' ? '' : `/${page}`}`;
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
        <p className="eyebrow">Live understanding</p>
        <h2>{requirements.length ? `${requirements.length} requirements captured` : 'Nothing captured yet'}</h2>
      </div>
      <PageLink page="graph" go={go} className="text-link">Open graph <span>→</span></PageLink>
    </header>
    <div className="ledger-list">
      {requirements.length === 0 && <div className="ledger-empty">
        <span>01</span>
        <p>Your first description becomes the first set of connected requirements.</p>
      </div>}
      {requirements.slice(-8).reverse().map((node) => <article key={node.id}>
        <i style={{ background: color.intent }} />
        <div><small>{display(node.type)}</small><p>{display(node.statementOrName)}</p></div>
        <span className={`status-pill status-${String(node.status).toLowerCase()}`}>{display(node.status)}</span>
      </article>)}
    </div>
    {requirements.length > 0 && <footer>
      <span>{requirements.length - unresolved.length} confirmed</span>
      <span>{unresolved.length} need review</span>
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
  const questions = intent.filter((node) => node.type === 'Question' && !['confirmed', 'superseded'].includes(String(node.status))).length
    + (project.currentQuestion?.questionId ? 1 : 0);
  const baselines = asList(project.approvedBaselines);
  const nextPage: PageKey = project.currentQuestion?.questionId || intent.length === 0 ? 'intake'
    : baselines.length < 2 ? 'build'
    : execution.length === 0 ? 'build'
    : 'graph';
  return <div className="page-scroll overview-page">
    <SectionHeading
      eyebrow="Project workspace"
      title={display(project.project?.displayName, 'Local project')}
      description="Turn rough intent into an approved, portable build pack."
      aside={<span className="lifecycle-badge"><i />{lifecycleLabel(project.project?.lifecycleState)}</span>}
    />
    <section className="next-step-card">
      <div className="next-step-copy">
        <span className="step-number">Next</span>
        <div>
          <p className="eyebrow">Keep the project moving</p>
          <h2>{pageMeta[nextPage].description}</h2>
          <p>{nextPage === 'intake'
            ? 'Answer one high-impact question or add more context.'
            : nextPage === 'build'
              ? 'Review the current truth, freeze it, and compile the work.'
              : 'Inspect the trace from your words to the planned work.'}</p>
        </div>
      </div>
      <PageLink page={nextPage} go={go} className="primary-link">Continue to {pageMeta[nextPage].label}<span>→</span></PageLink>
    </section>
    <section className="metric-grid" aria-label="Project metrics">
      <article><small>Requirements</small><strong>{intent.filter((node) => node.type !== 'Question').length}</strong><span>{questions ? `${questions} open question${questions === 1 ? '' : 's'}` : 'No blocking questions'}</span></article>
      <article><small>Solution</small><strong>{solution.length}</strong><span>{baselines.some((item) => item.graphKind === 'solution') ? 'Baseline frozen' : 'Awaiting approval'}</span></article>
      <article><small>Work</small><strong>{execution.length}</strong><span>{execution.length ? 'Tasks compiled' : 'Not compiled yet'}</span></article>
      <article><small>Traceability</small><strong>{edges.length}</strong><span>{nodes.length} graph nodes</span></article>
    </section>
    <div className="overview-columns">
      <section className="card project-flow-card">
        <header><div><p className="eyebrow">Project flow</p><h2>From rough idea to build pack</h2></div></header>
        <div className="project-flow">
          {[
            ['1', 'Intent', intent.length > 0, 'Capture what the user means'],
            ['2', 'Solution', solution.length > 0, 'Shape the approved product'],
            ['3', 'Execution', execution.length > 0, 'Compile bounded work'],
            ['4', 'Build pack', execution.length > 0 && baselines.length >= 2, 'Export to any harness'],
          ].map(([number, label, done, help], index) => <article key={String(label)} className={done ? 'is-done' : ''}>
            <span>{done ? '✓' : number}</span>
            <div><strong>{label}</strong><small>{help}</small></div>
            {index < 3 && <i />}
          </article>)}
        </div>
      </section>
      <section className="card action-card">
        <header><div><p className="eyebrow">Available action</p><h2>Advance this project</h2></div></header>
        <StageActions project={project} bindings={bindings} busy={busy} run={run} download={download} />
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
    <SectionHeading eyebrow="Project intake" title="Tell us what to build"
      description="Speak naturally. The model records your meaning and asks only what changes the build." />
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
      <div><p className="eyebrow">Knowledge graph</p><h1>Project graph</h1><p>Trace every planned task back to the words that authorized it.</p></div>
      <div className="graph-page-stats"><span>{nodes.length} nodes</span><i /><span>{edges.length} links</span></div>
    </div>
    <div className="graph-page-layout">
      <section className="graph-workspace" aria-label="Project knowledge graph">
        <div className="graph-toolbar">
          <label className="graph-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search graph" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a node…" />
          </label>
          <label className="edge-picker">
            <span>New link</span>
            <select value={edgeType} onChange={(event) => setEdgeType(event.target.value)} disabled={!canEdit}>
              {relationshipTypes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {!projectReady && <div className="graph-empty">
          <img className="empty-mascot" src="/brand/caveman-neanderthal-confused-portrait.webp" alt="" />
          <div><h2>No graph. Yet.</h2><p>Go to Intake and describe what you want to build.</p></div>
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
          onNodeDragStop={(_, node) => localStorage.setItem(`graphslop-position:${node.id}`, JSON.stringify(node.position))}
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
          {(Object.keys(color) as GraphKind[]).map((kind) => <span key={kind}><i style={{ background: color[kind] }} />{kind}</span>)}
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
}: {
  project: AnyProject;
  bindings: readonly NextBinding[];
  busy: boolean;
  run: (command: OwnerCommand, input: unknown) => Promise<void>;
  download: () => Promise<void>;
}) {
  const baselines = asList(project.approvedBaselines);
  const solution = graphNodes(project, 'solution');
  const tasks = graphNodes(project, 'execution');
  return <div className="page-scroll build-page">
    <SectionHeading eyebrow="Portable output" title="Build pack"
      description="Freeze approved truth, compile bounded work, then take the files to your preferred coding harness."
      aside={tasks.length > 0 && baselines.length >= 2
        ? <button className="primary" disabled={busy} onClick={() => void download()}>Download .factory.zip</button>
        : undefined} />
    <section className="build-action-band">
      <div><small>Current stage</small><strong>{lifecycleLabel(project.project?.lifecycleState)}</strong></div>
      <StageActions project={project} bindings={bindings} busy={busy} run={run} download={download} />
    </section>
    <div className="build-grid">
      <section className="card baseline-card">
        <header><div><p className="eyebrow">Authority</p><h2>Frozen baselines</h2></div><span>{baselines.length}/2</span></header>
        {(['intent', 'solution'] as const).map((kind) => {
          const baseline = baselines.find((item) => item.graphKind === kind);
          return <article key={kind} className={baseline ? 'is-ready' : ''}>
            <span>{baseline ? '✓' : '○'}</span>
            <div><strong>{kind === 'intent' ? 'Intent baseline' : 'Solution baseline'}</strong>
              <small>{baseline ? display(baseline.baselineId, 'Frozen') : 'Not frozen yet'}</small></div>
          </article>;
        })}
      </section>
      <section className="card build-list-card">
        <header><div><p className="eyebrow">Approved product</p><h2>Solution nodes</h2></div><span>{solution.length}</span></header>
        <div className="compact-list">
          {solution.length === 0 && <p className="empty-copy">Freeze Intent, then shape the build plan.</p>}
          {solution.slice(0, 7).map((node) => <article key={node.id}><i style={{ background: color.solution }} /><div><strong>{display(node.statementOrName)}</strong><small>{display(node.type)}</small></div></article>)}
        </div>
      </section>
      <section className="card build-list-card tasks-card">
        <header><div><p className="eyebrow">Executable work</p><h2>Task graph</h2></div><span>{tasks.length}</span></header>
        <div className="compact-list">
          {tasks.length === 0 && <p className="empty-copy">The execution graph appears after both baselines are frozen.</p>}
          {tasks.slice(0, 8).map((node) => <article key={node.id}><i style={{ background: color.execution }} /><div><strong>{display(node.statementOrName)}</strong><small>{display(node.status)} · {display(node.type)}</small></div></article>)}
        </div>
      </section>
    </div>
  </div>;
}

function SettingsPage({ project, model }: { project: AnyProject; model: { connected: boolean; name: string } }) {
  const architecture = [
    ['Workers + Static Assets', 'Active', 'Global application shell and same-origin API edge.'],
    ['Cloudflare Tunnel', 'Active', 'Named bridge from the Worker to this local control plane and model.'],
    ['Qwen local model', model.connected ? 'Active' : 'Offline', 'Intent extraction and question selection stay on this machine for now.'],
    ['Cloudflare Access', 'Next', 'Replace the one-time local owner key with identity at the edge.'],
    ['D1 + R2', 'Next', 'Store project graph state in D1 and versioned build packs in R2.'],
    ['Queues + Workflows', 'Later', 'Durable compilation and execution orchestration when background work is enabled.'],
  ];
  return <div className="page-scroll settings-page">
    <SectionHeading eyebrow="Project settings" title="Connections and runtime"
      description="Cloudflare runs the SaaS edge. The model stays local until you choose otherwise." />
    <div className="settings-grid">
      <section className="card settings-card">
        <header><div><p className="eyebrow">Project</p><h2>Local project</h2></div></header>
        <dl>
          <div><dt>Project ID</dt><dd><code>{display(project.project?.projectId)}</code></dd></div>
          <div><dt>Repository</dt><dd><code>{display(project.project?.connectedRepository)}</code></dd></div>
          <div><dt>Lifecycle</dt><dd>{lifecycleLabel(project.project?.lifecycleState)}</dd></div>
        </dl>
      </section>
      <section className="card runtime-card">
        <header><div><p className="eyebrow">SaaS architecture</p><h2>Cloudflare service map</h2></div></header>
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
        <a href="#product" onClick={(event) => scrollTo(event, 'product')}>Product</a>
        <a href="#how" onClick={(event) => scrollTo(event, 'how')}>How it works</a>
        <a href="#output" onClick={(event) => scrollTo(event, 'output')}>Build pack</a>
      </nav>
      {workspaceLink('marketing-nav-cta', 'Enter workspace')}
    </header>

    <section className="marketing-hero">
      <div className="marketing-hero-copy">
        <p className="marketing-kicker">Software starts with an incomplete idea</p>
        <h1>From rough idea to build-ready spec.</h1>
        <p>Graphslop asks only what matters, keeps every decision connected, and produces a complete build pack for your coding tools.</p>
        <div className="marketing-actions">
          {workspaceLink('marketing-primary', 'Start a project')}
          <a className="marketing-secondary" href="#product" onClick={(event) => scrollTo(event, 'product')}>Explore the product <span>↓</span></a>
        </div>
        <div className="marketing-proof">
          <span>No long questionnaire</span>
          <span>No silent assumptions</span>
          <span>Works with your coding harness</span>
        </div>
      </div>
      <div className="marketing-hero-visual" aria-label="A rough idea becoming an approved software graph">
        <img src="/brand/caveman-neanderthal-confused-hero.webp" alt="A confused Neanderthal considering a rough software idea" />
        <div className="hero-product-card">
          <header><span>Rough idea</span><i>live</i></header>
          <p>Need app. Upload document. Find repeated language. Show score.</p>
          <div className="hero-graph-row">
            <span>Input</span><b>→</b><span>Behavior</span><b>→</b><span>Output</span>
          </div>
          <footer><i />One important question ready</footer>
        </div>
      </div>
    </section>

    <section className="marketing-signal" aria-label="Product promise">
      <span>Rough brief</span><i>·</i><span>Approved graph</span><i>·</i><span>Build pack</span><i>·</i><span>Your tools</span>
    </section>

    <section className="marketing-section product-section" id="product">
      <div className="marketing-section-copy">
        <p className="marketing-kicker">Connected product context</p>
        <h2>Keep intent connected to the work.</h2>
        <p>Talk naturally or edit the graph directly. Every requirement keeps its source, status, relationships, and approval history.</p>
        <ul>
          <li><span>—</span>Questions come from unresolved graph issues</li>
          <li><span>—</span>Intent, solution, and work stay connected</li>
          <li><span>—</span>Approved decisions cannot silently drift</li>
        </ul>
      </div>
      <div className="marketing-product-shell" aria-label="Graphslop product preview">
        <aside>
          <div className="mini-brand"><BrandMark /></div>
          <i className="is-active">⌂</i><i>✦</i><i>⌘</i><i>▣</i>
          <img src="/brand/caveman-neanderthal-approved-portrait.webp" alt="" />
        </aside>
        <div className="mini-workspace">
          <header><div><small>Knowledge graph</small><strong>Project graph</strong></div><span>18 nodes · 24 links</span></header>
          <div className="mini-canvas">
            <div className="mini-node mini-node-input"><small>INPUT</small><b>Paste a document</b></div>
            <div className="mini-node mini-node-intent"><small>INTENT</small><b>Find repeated language</b></div>
            <div className="mini-node mini-node-solution"><small>SOLUTION</small><b>Document analysis flow</b></div>
            <div className="mini-node mini-node-execution"><small>EXECUTION</small><b>Build scoring module</b></div>
            <svg viewBox="0 0 700 320" preserveAspectRatio="none" aria-hidden="true">
              <path d="M140 78 C205 78 195 78 255 78 M390 78 C455 78 455 218 530 218 M390 78 C455 78 455 78 530 78" />
            </svg>
          </div>
        </div>
      </div>
    </section>

    <section className="marketing-section how-section" id="how">
      <header className="marketing-section-head">
        <p className="marketing-kicker">A focused path to clarity</p>
        <h2>Start before everything is figured out.</h2>
        <p>The factory waits to generate the build pack until the important decisions are stable.</p>
      </header>
      <div className="journey-grid">
        <article>
          <div className="journey-image"><img src="/brand/caveman-neanderthal-confused-hero.webp" alt="The starting idea is still unclear" /></div>
          <span>01 / Describe</span>
          <h3>Share the rough version.</h3>
          <p>Write what you know, even when the idea is incomplete or contradictory.</p>
        </article>
        <article>
          <div className="journey-image"><img src="/brand/caveman-neanderthal-aha-hero.webp" alt="The important product decisions become clear" /></div>
          <span>02 / Clarify</span>
          <h3>Resolve what matters.</h3>
          <p>The model asks one high-impact question at a time.</p>
        </article>
        <article>
          <div className="journey-image"><img src="/brand/caveman-neanderthal-builder-hero.webp" alt="The approved project is ready to build" /></div>
          <span>03 / Export</span>
          <h3>Build in your own tools.</h3>
          <p>Export bounded, traceable work for your preferred coding harness.</p>
        </article>
      </div>
    </section>

    <section className="marketing-section output-section" id="output">
      <div className="output-copy">
        <p className="marketing-kicker">Portable by default</p>
        <h2>A project package, not a transcript.</h2>
        <p>You get a human-readable project directory with approved baselines, connected graphs, ordered tasks, agent instructions, tests, and drift checks.</p>
        {workspaceLink('marketing-primary', 'Create your build pack')}
      </div>
      <div className="file-pack" aria-label="Example build pack files">
        <header><BrandMark /><strong>your-project.factory</strong><span>ready</span></header>
        <div className="file-tree">
          <p><i>▾</i><b>.factory/</b></p>
          <p><i>├</i><span>project.yaml</span><em>project truth</em></p>
          <p><i>├</i><span>intent/graph.json</span><em>what user means</em></p>
          <p><i>├</i><span>solution/graph.json</span><em>what gets built</em></p>
          <p><i>├</i><span>execution/graph.json</span><em>work order</em></p>
          <p><i>├</i><span>tasks/</span><em>bounded agent jobs</em></p>
          <p><i>└</i><span>verify/</span><em>drift and evidence</em></p>
        </div>
        <footer><span><i /> Intent frozen</span><span><i /> Solution frozen</span><span><i /> Work compiled</span></footer>
      </div>
    </section>

    <section className="marketing-final">
      <img src="/brand/caveman-neanderthal-approved-portrait.webp" alt="A satisfied Neanderthal ready to begin" />
      <div>
        <p className="marketing-kicker">Ready when the decisions are</p>
        <h2>Bring an idea. Leave with a buildable plan.</h2>
        <p>Graphslop turns a rough request into durable project context your tools can use from start to finish.</p>
        {workspaceLink('marketing-primary', 'Open Graphslop')}
      </div>
    </section>

    <footer className="marketing-footer">
      <a className="brand" href="/"><BrandMark /><span>graphslop</span></a>
      <p>From rough idea to build-ready spec.</p>
      <a href="/workspace" onClick={(event) => { event.preventDefault(); enterWorkspace(); }}>Workspace</a>
    </footer>
  </main>;
}

export function App() {
  const [project, setProject] = useState<AnyProject | null>(demoMode ? demoProject : null);
  const [bindings, setBindings] = useState<readonly NextBinding[]>([]);
  const [model, setModel] = useState({ connected: demoMode, name: demoMode ? 'Read-only demo' : 'Qwen local' });
  const [token, setToken] = useState('');
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

  const load = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    try {
      const modelInfo = await api.modelInfo();
      setModel(modelInfo);
      if (!api.hasOwnerHint()) {
        setProject(null);
        setBindings([]);
        return;
      }
      const response = await api.project();
      setProject(asRecord(response.project));
      setBindings(response.nextBindings);
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) {
        setError(cause instanceof Error ? cause.message : 'Could not load the project.');
      }
      setProject(null);
      try { setModel(await api.modelInfo()); } catch { /* status is already offline */ }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
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
    window.history.pushState({}, '', projectPath(nextPage));
    setPage(nextPage);
    setRoute(window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function enterWorkspace() {
    window.history.pushState({}, '', '/workspace');
    setRoute('/workspace');
  }

  async function claim(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.claim(token);
      setToken('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Claim failed.');
    } finally {
      setBusy(false);
    }
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
      setNotice(command === 'edit-intent-graph' ? 'Graph updated.' : `${command.replaceAll('-', ' ')} complete.`);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await load();
        setNotice('The graph changed. Fresh state loaded.');
      } else {
        setError(cause instanceof Error ? cause.message : 'That did not work.');
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
      await api.downloadBuildPack();
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
      setNotice('Only requirement nodes can be connected by hand.');
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
      thinking={activeCommand === 'submit-message' || activeCommand === 'resolve-question'} run={run} go={go} />,
    graph: <GraphPage projectReady={Boolean(projectReady)} nodes={nodes} edges={edges}
      selected={selected} selectedEdge={selectedEdge} canEdit={canEdit} busy={busy}
      search={search} setSearch={setSearch} edgeType={edgeType} setEdgeType={setEdgeType}
      onNodesChange={onNodesChange} onConnect={onConnect} setSelectedId={setSelectedId}
      setSelectedEdgeId={setSelectedEdgeId} run={run} />,
    build: <BuildPage project={project} bindings={bindings} busy={busy} run={run} download={download} />,
    settings: <SettingsPage project={project} model={model} />,
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
        <span className="project-avatar">LP</span>
        <div><strong>{display(project.project?.displayName, 'Local project')}</strong><small>Personal workspace</small></div>
        <span aria-hidden="true">⌄</span>
      </div> : <div className="topbar-center"><span>rough words → build pack</span></div>}
      <div className={`model-status ${model.connected ? 'connected' : ''}`}>
        <i /> <span>{model.connected ? model.name : 'Qwen offline'}</span>
      </div>
    </header>
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="error-toast" role="alert"><strong>Couldn’t do that.</strong>{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}

    {loading ? <main className="loading"><div className="loader-orbit"><i /><i /><i /></div><p>Waking the graph…</p></main>
      : !project ? <main className="claim-screen">
        <div className="claim-stage">
          <div className="claim-character" aria-hidden="true" />
          <form onSubmit={claim}>
            <div className="claim-brand"><BrandMark /><span>graphslop</span></div>
            <p className="eyebrow">Your private cave</p>
            <h1>You build here.</h1>
            <p>Use the owner key once. Then it is just you, caveman, and the graph.</p>
            <label htmlFor="claim-token">Owner key</label>
            <input id="claim-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
            <button className="primary" disabled={busy || token.length < 24}>Enter cave</button>
          </form>
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
            <img src="/brand/caveman-neanderthal-confused-portrait.webp" alt="" />
            <div><strong>Idea in. Pack out.</strong><small>No code runs here.</small></div>
          </div>
        </aside>
        <main className="saas-content">{pageContent}</main>
      </div>}
  </div>;
}
