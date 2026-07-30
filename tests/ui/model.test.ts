import { describe, expect, test } from 'vitest';
import { graphNodes, lifecycleLabel, statusGroup, stringList, taskState } from '../../apps/control-plane/src/web/model.js';

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

  test('keeps lifecycle labels plain', () => {
    expect(lifecycleLabel('INTENT_REVIEW')).toBe('intent review');
  });

  test('does not invent solution roles in the browser', () => {
    expect(graphNodes({ solutionGraph: { nodes: [] } }, 'solution')).toEqual([]);
  });

  test('keeps role contract strings readable', () => {
    expect(stringList(['Approved needs.', '  Tests.  ', null, { text: 'wrong shape' }]))
      .toEqual(['Approved needs.', 'Tests.']);
    expect(stringList(undefined)).toEqual([]);
  });
});
