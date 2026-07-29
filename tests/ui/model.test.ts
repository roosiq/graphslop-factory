import { describe, expect, test } from 'vitest';
import { graphNodes, lifecycleLabel, roles, solutionFeatures, statusGroup, taskState } from '../../apps/control-plane/src/web/model.js';

describe('owner workspace model', () => {
  test('does not upgrade assumptions', () => {
    expect(statusGroup('confirmed')).toBe('confirmed');
    expect(statusGroup('inferred')).toBe('assumed');
    expect(statusGroup('proposed')).toBe('unresolved');
    expect(statusGroup('rejected')).toBe('excluded');
  });

  test('reads actual graph nodes and exposes work states', () => {
    expect(graphNodes({ executionGraph: { nodes: [{ id: 'task-1' }] } }, 'execution')).toEqual([{ id: 'task-1' }]);
    expect(graphNodes({}, 'intent')).toEqual([]);
    expect(['blocked', 'failed', 'repair', 'accepted'].map(taskState)).toEqual(['blocked', 'failed', 'repair', 'accepted']);
  });

  test('keeps roles to the caveman contract', () => {
    for (const role of roles) expect(Object.keys(role)).toEqual(['name', 'JOB', 'USE', 'TOUCH', "DON'T", 'DONE']);
    expect(lifecycleLabel('INTENT_REVIEW')).toBe('intent review');
  });

  test('keeps distinct product boundaries when shaping a solution', () => {
    const features = solutionFeatures([
      { id: 'goal', type: 'Goal', statementOrName: 'Analyze notes.' },
      { id: 'input', type: 'Input', statementOrName: 'Accept pasted notes.' },
      { id: 'output', type: 'Output', statementOrName: 'Show a score.' },
      { id: 'constraint', type: 'Constraint', statementOrName: 'Do not store text.' },
    ]);
    expect(features.map((item) => item.name)).toEqual(['Analyze notes', 'Accept pasted notes', 'Show a score']);
    expect(features.every((item) => item.intentNodeIds.includes('constraint'))).toBe(true);
  });
});
