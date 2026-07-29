import { graphMetamodelRegistry } from '../../packages/contracts/dist/index.js';

// The exported grammar is immutable to TypeScript consumers as well as at runtime.
// @ts-expect-error Nested endpoint pairs are readonly.
graphMetamodelRegistry.graphs.intent.edgeTypes.PROJECT_HAS_GOAL[0].sourceType = 'Goal';
// @ts-expect-error Node type arrays are readonly.
graphMetamodelRegistry.graphs.solution.nodeTypes.push('Persona');
