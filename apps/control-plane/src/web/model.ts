export type AnyRecord = Record<string, any>;
export const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
export const asList = (value: unknown): AnyRecord[] => Array.isArray(value) ? value.map(asRecord) : [];
export const graphNodes = (project: AnyRecord, kind: 'intent' | 'solution' | 'execution') =>
  asList(project[`${kind}Graph`]?.nodes);
export const display = (value: unknown, fallback = 'Not set') =>
  typeof value === 'string' && value.trim() ? value : fallback;
export const lifecycleLabel = (value: unknown) => display(value, 'EMPTY').replaceAll('_', ' ').toLowerCase();

export function solutionFeatures(intentNodes: AnyRecord[]) {
  const coreTypes = new Set(['Goal', 'Behavior', 'Input', 'Output']);
  const sharedTypes = new Set(['Goal', 'Constraint', 'Preference', 'Exclusion', 'SuccessCriterion', 'Risk']);
  const candidates = intentNodes.filter((node) => coreTypes.has(String(node.type)));
  const source = candidates.length ? candidates : intentNodes.slice(0, 1);
  const sharedIds = intentNodes.filter((node) => sharedTypes.has(String(node.type))).map((node) => String(node.id));
  const seen = new Set<string>();
  return source.flatMap((node) => {
    const name = display(node.statementOrName, 'Build the approved product').replace(/[.!?]+$/, '');
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      name,
      intentNodeIds: [...new Set([String(node.id), ...sharedIds])],
    }];
  });
}

export function statusGroup(status: unknown): 'confirmed' | 'assumed' | 'unresolved' | 'excluded' {
  const value = String(status).toLowerCase();
  if (['confirmed', 'accepted', 'approved'].includes(value)) return 'confirmed';
  if (['unresolved', 'proposed'].includes(value)) return 'unresolved';
  if (['rejected', 'superseded'].includes(value)) return 'excluded';
  return 'assumed';
}

export function taskState(status: unknown) {
  const value = String(status).toLowerCase();
  if (['accepted', 'completed', 'done'].includes(value)) return 'accepted';
  if (['failed', 'rejected'].includes(value)) return 'failed';
  if (value.includes('repair')) return 'repair';
  if (['ready', 'running', 'blocked'].includes(value)) return value;
  return 'blocked';
}

export const roles = [
  { name: 'Figure Out', JOB: 'Turn rough words into a clear want.', USE: 'Owner messages and current Intent.', TOUCH: 'Intent nodes, questions, and review.', "DON'T": 'Design or code the product.', DONE: 'Owner approves the Intent.' },
  { name: 'Plan', JOB: 'Turn approved want into a build shape.', USE: 'Approved Intent.', TOUCH: 'Solution nodes and acceptance behavior.', "DON'T": 'Change what the owner approved.', DONE: 'Owner approves the Solution.' },
  { name: 'Build', JOB: 'Do one bounded task.', USE: 'Task brief, baselines, and allowed files.', TOUCH: 'Only paths named by the task.', "DON'T": 'Add features or change authority.', DONE: 'Return changes, tests, and evidence.' },
  { name: 'Check', JOB: 'Check work against approved truth.', USE: 'Intent, Solution, task, code, and evidence.', TOUCH: 'Verification and drift reports.', "DON'T": 'Approve its own build work.', DONE: 'Accept work or name the exact repair.' },
] as const;
