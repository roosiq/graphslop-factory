const node = (id: string, type: string, statementOrName: string, status = 'confirmed', attributes = {}) =>
  ({ id, type, statementOrName, status, attributes });
const edge = (id: string, type: string, from: string, to: string) => ({ id, type, from, to });

const intentNodes = [
  node('intent-goal', 'Goal', 'Turn rough human requests into verified software'),
  node('intent-user', 'UserType', 'One project owner working in one repository'),
  node('intent-input', 'Input', 'Incomplete, informal, or contradictory language'),
  node('intent-behavior', 'Behavior', 'Clarify one important unknown at a time'),
  node('intent-output', 'Output', 'Approved software with traceable evidence'),
  node('intent-constraint', 'Constraint', 'No coding before Intent and Solution approval'),
  node('intent-exclusion', 'Exclusion', 'No silent requirement changes'),
  node('intent-success', 'SuccessCriterion', 'Every accepted task traces to approved intent'),
  node('intent-preference', 'Preference', 'Agent instructions use plain caveman language'),
];

const solutionNodes = [
  node('solution-intake', 'Feature', 'Caveman project intake', 'approved'),
  node('solution-intent', 'Feature', 'Persistent Intent graph', 'approved'),
  node('solution-review', 'Workflow', 'Review and freeze baselines', 'approved'),
  node('solution-graph', 'Component', 'Connected graph workspace', 'approved'),
  node('solution-orchestrator', 'Service', 'Dependency-aware work orchestrator', 'approved'),
  node('solution-evidence', 'Feature', 'Evidence and drift ledger', 'approved'),
  node('solution-roles', 'Rule', 'Figure Out → Plan → Build → Check', 'approved'),
];

const taskNames = [
  ['P3-001', 'Inspect repository and lock toolchain', 'Figure Out'],
  ['P3-002', 'Build persistent project state', 'Build'],
  ['P3-003', 'Compile dependency-aware work graph', 'Plan'],
  ['P3-004', 'Run bounded work and collect evidence', 'Build'],
  ['P3-005', 'Protect owner-only control API', 'Build'],
  ['P3-006', 'Build connected owner workspace', 'Build'],
  ['P3-007', 'Verify full factory against frozen truth', 'Check'],
];
const executionNodes = taskNames.map(([id, name, roleRef]) =>
  node(id, roleRef === 'Check' ? 'Verify' : roleRef === 'Plan' ? 'Decide' : 'Implement', name, 'accepted', { roleRef }));

const intentEdges = [
  edge('i1', 'PROJECT_HAS_GOAL', 'intent-user', 'intent-goal'),
  edge('i2', 'BEHAVIOR_ACCEPTS_INPUT', 'intent-behavior', 'intent-input'),
  edge('i3', 'BEHAVIOR_PRODUCES_OUTPUT', 'intent-behavior', 'intent-output'),
  edge('i4', 'CONSTRAINT_LIMITS', 'intent-constraint', 'intent-behavior'),
  edge('i5', 'EXCLUSION_PROHIBITS', 'intent-exclusion', 'intent-output'),
  edge('i6', 'SUCCESS_VALIDATES', 'intent-success', 'intent-goal'),
  edge('i7', 'PREFERENCE_INFLUENCES', 'intent-preference', 'intent-behavior'),
];
const solutionEdges = [
  edge('s1', 'DEPENDS_ON', 'solution-intent', 'solution-intake'),
  edge('s2', 'DEPENDS_ON', 'solution-review', 'solution-intent'),
  edge('s3', 'DEPENDS_ON', 'solution-graph', 'solution-review'),
  edge('s4', 'DEPENDS_ON', 'solution-orchestrator', 'solution-review'),
  edge('s5', 'DEPENDS_ON', 'solution-evidence', 'solution-orchestrator'),
  edge('s6', 'DEPENDS_ON', 'solution-roles', 'solution-orchestrator'),
];
const executionEdges = taskNames.slice(1).map(([id], index) =>
  edge(`x${index + 1}`, 'DEPENDS_ON', id, taskNames[index][0]));
const intentToSolution = [
  edge('is1', 'SATISFIES', 'solution-intake', 'intent-input'),
  edge('is2', 'SATISFIES', 'solution-intent', 'intent-behavior'),
  edge('is3', 'SATISFIES', 'solution-review', 'intent-constraint'),
  edge('is4', 'SATISFIES', 'solution-graph', 'intent-output'),
  edge('is5', 'SATISFIES', 'solution-orchestrator', 'intent-goal'),
  edge('is6', 'SATISFIES', 'solution-evidence', 'intent-success'),
  edge('is7', 'SATISFIES', 'solution-roles', 'intent-preference'),
];
const solutionToExecution = [
  edge('se1', 'IMPLEMENTS', 'P3-001', 'solution-intake'),
  edge('se2', 'IMPLEMENTS', 'P3-002', 'solution-intent'),
  edge('se3', 'IMPLEMENTS', 'P3-003', 'solution-orchestrator'),
  edge('se4', 'IMPLEMENTS', 'P3-004', 'solution-evidence'),
  edge('se5', 'IMPLEMENTS', 'P3-005', 'solution-review'),
  edge('se6', 'IMPLEMENTS', 'P3-006', 'solution-graph'),
  edge('se7', 'VERIFIES', 'P3-007', 'solution-roles'),
];

export const demoProject = {
  project: { lifecycleState: 'COMPLETE' },
  messages: [
    { messageId: 'msg-1', actor: 'owner', content: 'Need software factory. User talks caveman. Turn it into graph. Do not let agents invent requirements.' },
    { messageId: 'msg-2', actor: 'factory', content: 'You want rough language converted into approved Intent, Solution, and Execution graphs. Work cannot change frozen truth.' },
    { messageId: 'msg-3', actor: 'owner', content: 'Keep the graph. Agent roles use plain caveman language. Do it.' },
  ],
  currentQuestion: {},
  intentGraph: { nodes: intentNodes, edges: intentEdges, crossGraphLinks: [], contentHash: '04a584cf…913a' },
  solutionGraph: { nodes: solutionNodes, edges: solutionEdges, crossGraphLinks: intentToSolution, contentHash: '356684d7…a727' },
  executionGraph: { nodes: executionNodes, edges: executionEdges, crossGraphLinks: solutionToExecution, contentHash: 'execution-v3' },
  approvedBaselines: [
    { baselineId: 'intent-v3', graphKind: 'intent' },
    { baselineId: 'solution-v3', graphKind: 'solution' },
  ],
  projections: [{
    projectionId: 'solution-v3-approved',
    graphKind: 'solution',
    contentHash: '356684d7…a727',
    generatedAt: '2026-07-28T12:30:00-04:00',
    data: { nodes: solutionNodes.map(({ id, statementOrName, status }) => ({ id, statement: statementOrName, status })) },
  }],
  executionControl: {
    status: 'accepted',
    taskId: 'P3-007',
    acceptedTaskIds: executionNodes.map(({ id }) => id),
  },
  impact: { unaffectedTasks: executionNodes.map(({ id }) => id), tasksRequiringModification: [], discardedTasks: [], newTasks: [] },
  drifts: [],
};

export const demoEvents = [
  { eventId: 'proof-1', status: 'accepted', summary: '150 unit, contract, and integration tests passed.' },
  { eventId: 'proof-2', status: 'accepted', summary: '5 real-browser acceptance scenarios passed.' },
  { eventId: 'proof-3', status: 'accepted', summary: '82 of 82 Solution nodes traced to evidence.' },
  { eventId: 'proof-4', status: 'accepted', summary: 'Independent verifier found no blocking drift.' },
];
