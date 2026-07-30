const node = (id: string, type: string, statementOrName: string, status = 'confirmed', attributes = {}) =>
  ({ id, type, statementOrName, status, attributes });
const edge = (id: string, type: string, from: string, to: string) => ({ id, type, from, to });

const intentNodes = [
  node('intent-goal', 'Goal', 'Turn incomplete project requests into verified software'),
  node('intent-user', 'UserType', 'One project owner working in one repository'),
  node('intent-input', 'Input', 'Incomplete, informal, or contradictory language'),
  node('intent-behavior', 'Behavior', 'Clarify one important unknown at a time'),
  node('intent-output', 'Output', 'Approved software with traceable evidence'),
  node('intent-constraint', 'Constraint', 'Do not begin coding until the requirements and solution are approved'),
  node('intent-exclusion', 'Exclusion', 'No silent requirement changes'),
  node('intent-success', 'SuccessCriterion', 'Every accepted task traces to approved requirements'),
  node('intent-preference', 'Preference', 'Agent instructions use concise, plain language'),
];

const solutionNodes = [
  node('solution-intake', 'Feature', 'Capture an initial project description', 'approved'),
  node('solution-intent', 'Feature', 'Store project intent in a versioned graph', 'approved'),
  node('solution-review', 'Workflow', 'Let the project owner review and approve baselines', 'approved'),
  node('solution-graph', 'Component', 'Provide an interactive graph workbench', 'approved'),
  node('solution-orchestrator', 'Service', 'Run tasks in dependency order', 'approved'),
  node('solution-evidence', 'Feature', 'Record verification evidence and implementation drift', 'approved'),
  node('solution-roles', 'Feature', 'Derive project roles from approved requirements', 'approved'),
  node('role-graph-engineer', 'Role', 'Graph system engineer', 'approved', {
    job: 'Maintain accurate, versioned graph state.',
  }),
  node('role-execution-engineer', 'Role', 'Execution safety engineer', 'approved', {
    job: 'Run bounded execution tasks safely.',
  }),
  node('role-interface-designer', 'Role', 'Product interface designer', 'approved', {
    job: 'Design a clear, usable workbench.',
  }),
  node('role-quality-reviewer', 'Role', 'Independent quality reviewer', 'approved', {
    job: 'Verify the product independently.',
  }),
];

const taskNames = [
  ['P3-001', 'Define safe repository boundaries', 'Decide', 'role-execution-engineer'],
  ['P3-002', 'Persist versioned project state', 'Implement', 'role-graph-engineer'],
  ['P3-003', 'Define task dependency order', 'Decide', 'role-execution-engineer'],
  ['P3-004', 'Run bounded tasks and record evidence', 'Implement', 'role-execution-engineer'],
  ['P3-005', 'Protect the control API', 'Implement', 'role-execution-engineer'],
  ['P3-006', 'Build the interactive graph workbench', 'Implement', 'role-interface-designer'],
  ['P3-007', 'Verify the factory against approved baselines', 'Verify', 'role-quality-reviewer'],
];
const executionNodes = taskNames.map(([id, name, type, roleRef]) =>
  node(id, type, name, 'accepted', { roleRef }));

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
  edge('s7', 'USES', 'solution-intent', 'role-graph-engineer'),
  edge('s8', 'USES', 'solution-orchestrator', 'role-execution-engineer'),
  edge('s9', 'USES', 'solution-graph', 'role-interface-designer'),
  edge('s10', 'USES', 'solution-evidence', 'role-quality-reviewer'),
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
  edge('is8', 'SATISFIES', 'role-graph-engineer', 'intent-success'),
  edge('is9', 'SATISFIES', 'role-execution-engineer', 'intent-constraint'),
  edge('is10', 'SATISFIES', 'role-interface-designer', 'intent-user'),
  edge('is11', 'SATISFIES', 'role-quality-reviewer', 'intent-success'),
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
    { messageId: 'msg-2', actor: 'factory', content: 'You want incomplete requests converted into approved intent, solution, and execution graphs without allowing agents to change the requirements.' },
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
