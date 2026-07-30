import type { AuthoritativeGraphKind } from './graph.js';

/** Version of the authoritative graph vocabulary and endpoint table. */
export const GraphMetamodelVersion = '1.0.0' as const;

export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }

  return value as DeepReadonly<T>;
}

const intentNodeTypes = [
  'Project',
  'Goal',
  'UserType',
  'Problem',
  'UseCase',
  'Behavior',
  'Input',
  'Output',
  'Constraint',
  'Preference',
  'Exclusion',
  'SuccessCriterion',
  'Assumption',
  'Question',
  'Decision',
  'Example',
  'Risk',
] as const;

const solutionNodeTypes = [
  'Application',
  'Page',
  'Feature',
  'Workflow',
  'Component',
  'Service',
  'DataObject',
  'Rule',
  'API',
  'Integration',
  'Technology',
  'DeploymentTarget',
  'TestableBehavior',
  'Role',
] as const;

const executionNodeTypes = [
  'Inspect',
  'Decide',
  'Implement',
  'Test',
  'Verify',
  'Integrate',
  'Repair',
  'Document',
  'Release',
] as const;

type NodeType =
  | (typeof intentNodeTypes)[number]
  | (typeof solutionNodeTypes)[number]
  | (typeof executionNodeTypes)[number];

type EndpointPair = { readonly sourceType: NodeType; readonly targetType: NodeType };

function pairs(
  sourceTypes: readonly NodeType[],
  targetTypes: readonly NodeType[],
): readonly EndpointPair[] {
  return sourceTypes.flatMap((sourceType) =>
    targetTypes.map((targetType) => ({ sourceType, targetType })),
  );
}

function sameTypePairs(types: readonly NodeType[]): readonly EndpointPair[] {
  return types.map((type) => ({ sourceType: type, targetType: type }));
}

const intentEndpointPairs = {
  PROJECT_HAS_GOAL: [{ sourceType: 'Project', targetType: 'Goal' }],
  GOAL_SOLVES_PROBLEM: [{ sourceType: 'Goal', targetType: 'Problem' }],
  USER_HAS_PROBLEM: [{ sourceType: 'UserType', targetType: 'Problem' }],
  USER_PERFORMS_USE_CASE: [{ sourceType: 'UserType', targetType: 'UseCase' }],
  USE_CASE_REQUIRES_BEHAVIOR: [{ sourceType: 'UseCase', targetType: 'Behavior' }],
  BEHAVIOR_ACCEPTS_INPUT: [{ sourceType: 'Behavior', targetType: 'Input' }],
  BEHAVIOR_PRODUCES_OUTPUT: [{ sourceType: 'Behavior', targetType: 'Output' }],
  CONSTRAINT_LIMITS: pairs(['Constraint'], intentNodeTypes),
  PREFERENCE_INFLUENCES: pairs(['Preference'], intentNodeTypes),
  EXCLUSION_PROHIBITS: pairs(['Exclusion'], intentNodeTypes),
  SUCCESS_VALIDATES: pairs(['SuccessCriterion'], ['Goal', 'UseCase', 'Behavior', 'Output']),
  ASSUMPTION_SUPPORTS: pairs(['Assumption'], intentNodeTypes),
  QUESTION_RESOLVES: pairs(['Question'], intentNodeTypes),
  DECISION_RESOLVES: pairs(['Decision'], ['Question', 'Assumption', 'Risk']),
  EXAMPLE_CLARIFIES: pairs(['Example'], intentNodeTypes),
  CONTRADICTS: pairs(intentNodeTypes, intentNodeTypes),
  SUPERSEDES: sameTypePairs(intentNodeTypes),
  DEPENDS_ON: pairs(intentNodeTypes, intentNodeTypes),
} as const;

const solutionEndpointPairs = {
  CONTAINS: pairs(
    ['Application', 'Page', 'Feature', 'Workflow', 'Component', 'Service'],
    solutionNodeTypes,
  ),
  REALIZES: pairs(['Workflow', 'Component', 'Service', 'API'], ['Feature']),
  DEPENDS_ON: pairs(solutionNodeTypes, solutionNodeTypes),
  USES: pairs(
    ['Application', 'Page', 'Feature', 'Workflow', 'Component', 'Service', 'API', 'Integration', 'Role'],
    ['Service', 'DataObject', 'API', 'Integration', 'Technology', 'Role'],
  ),
  EXPOSES: pairs(['Application', 'Service'], ['API']),
  DEPLOYED_TO: pairs(['Application', 'Service'], ['DeploymentTarget']),
  PROTECTED_BY: pairs(solutionNodeTypes, ['Rule']),
  VALIDATED_BY: pairs(
    ['Application', 'Page', 'Feature', 'Workflow', 'Component', 'Service', 'API', 'Integration', 'Rule', 'Role'],
    ['TestableBehavior'],
  ),
} as const;

const executionEndpointPairs = {
  DEPENDS_ON: pairs(executionNodeTypes, executionNodeTypes),
} as const;

/**
 * The one authoritative graph vocabulary. Endpoint pairs are materialized in
 * the exported value so validation never falls back to permissive defaults.
 */
export const graphMetamodelRegistry = deepFreeze({
  version: GraphMetamodelVersion,
  graphKinds: ['intent', 'solution', 'execution'] as const,
  graphs: {
    intent: {
      nodeTypes: intentNodeTypes,
      edgeTypes: intentEndpointPairs,
    },
    solution: {
      nodeTypes: solutionNodeTypes,
      edgeTypes: solutionEndpointPairs,
    },
    execution: {
      nodeTypes: executionNodeTypes,
      edgeTypes: executionEndpointPairs,
    },
  },
  crossGraphLinkTypes: {
    SATISFIES_INTENT: {
      sourceGraphKind: 'solution',
      targetGraphKind: 'intent',
    },
    SATISFIES_SOLUTION: {
      sourceGraphKind: 'execution',
      targetGraphKind: 'solution',
    },
  },
});

export const GraphMetamodelRegistry: typeof graphMetamodelRegistry = graphMetamodelRegistry;

export type GraphMetamodelRegistry = typeof graphMetamodelRegistry;
export type GraphMetamodelGraphKind = AuthoritativeGraphKind;

export function isKnownNodeType(graphKind: AuthoritativeGraphKind, nodeType: string): boolean {
  return graphMetamodelRegistry.graphs[graphKind].nodeTypes.includes(nodeType as never);
}

export function isCompatibleEdgeEndpoint(
  graphKind: AuthoritativeGraphKind,
  edgeType: string,
  sourceType: string,
  targetType: string,
): boolean {
  const edgeTypes = graphMetamodelRegistry.graphs[graphKind].edgeTypes as Record<
    string,
    readonly EndpointPair[]
  >;
  const pairsForEdge = edgeTypes[edgeType];
  return pairsForEdge?.some(
    (pair) => pair.sourceType === sourceType && pair.targetType === targetType,
  ) ?? false;
}
