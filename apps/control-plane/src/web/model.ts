export type AnyRecord = Record<string, any>;
export const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
export const asList = (value: unknown): AnyRecord[] => Array.isArray(value) ? value.map(asRecord) : [];
export const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : [];
export const graphNodes = (project: AnyRecord, kind: 'intent' | 'solution' | 'execution') =>
  asList(project[`${kind}Graph`]?.nodes);
export const display = (value: unknown, fallback = 'Not set') =>
  typeof value === 'string' && value.trim() ? value : fallback;
export const lifecycleLabel = (value: unknown) => display(value, 'EMPTY').replaceAll('_', ' ').toLowerCase();

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
