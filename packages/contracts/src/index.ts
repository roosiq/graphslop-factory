import { z } from 'zod';

import {
  ActorRefSchema,
  ArtifactRefSchema,
  BaselineRefSchema,
  CommonContractSchemaVersion,
  GraphKindSchema,
  HashSchema,
  IdentifierSchema,
  NodeRefSchema,
  NodeVersionSchema,
  SourceRefSchema,
  TimestampSchema,
  ValidationIssueSchema,
  ValidationPathSegmentSchema,
  ValidationReportSchema,
} from './schemas.js';

export * from './schemas.js';
export * from './graph.js';
export * from './metamodel.js';
export * from './state.js';
export * from './proposal.js';

const jsonSchemaOptions = { target: 'draft-2020-12' } as const;

type CommonContractSchemaRegistryData = {
  $schema: string;
  $id: string;
  version: typeof CommonContractSchemaVersion;
  schemas: {
    identifier: z.core.ZodStandardJSONSchemaPayload<typeof IdentifierSchema>;
    hash: z.core.ZodStandardJSONSchemaPayload<typeof HashSchema>;
    timestamp: z.core.ZodStandardJSONSchemaPayload<typeof TimestampSchema>;
    graphKind: z.core.ZodStandardJSONSchemaPayload<typeof GraphKindSchema>;
    nodeVersion: z.core.ZodStandardJSONSchemaPayload<typeof NodeVersionSchema>;
    nodeRef: z.core.ZodStandardJSONSchemaPayload<typeof NodeRefSchema>;
    sourceRef: z.core.ZodStandardJSONSchemaPayload<typeof SourceRefSchema>;
    actorRef: z.core.ZodStandardJSONSchemaPayload<typeof ActorRefSchema>;
    artifactRef: z.core.ZodStandardJSONSchemaPayload<typeof ArtifactRefSchema>;
    baselineRef: z.core.ZodStandardJSONSchemaPayload<typeof BaselineRefSchema>;
    validationPathSegment: z.core.ZodStandardJSONSchemaPayload<typeof ValidationPathSegmentSchema>;
    validationIssue: z.core.ZodStandardJSONSchemaPayload<typeof ValidationIssueSchema>;
    validationReport: z.core.ZodStandardJSONSchemaPayload<typeof ValidationReportSchema>;
  };
};

/** Recursively freeze JSON-compatible registry data, including nested schemas. */
function deepFreeze<T>(value: T): import('./metamodel.js').DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }

  return value as import('./metamodel.js').DeepReadonly<T>;
}

/**
 * Native Zod JSON Schemas for the portable common layer. The value contains
 * only JSON data and can therefore cross process, provider, and runtime
 * boundaries without altering validation or authority semantics.
 */
export const commonContractSchemas: import('./metamodel.js').DeepReadonly<CommonContractSchemaRegistryData> = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://graphslop.dev/schemas/common-contracts/${CommonContractSchemaVersion}.json`,
  version: CommonContractSchemaVersion,
  schemas: {
    identifier: z.toJSONSchema(IdentifierSchema, jsonSchemaOptions),
    hash: z.toJSONSchema(HashSchema, jsonSchemaOptions),
    timestamp: z.toJSONSchema(TimestampSchema, jsonSchemaOptions),
    graphKind: z.toJSONSchema(GraphKindSchema, jsonSchemaOptions),
    nodeVersion: z.toJSONSchema(NodeVersionSchema, jsonSchemaOptions),
    nodeRef: z.toJSONSchema(NodeRefSchema, jsonSchemaOptions),
    sourceRef: z.toJSONSchema(SourceRefSchema, jsonSchemaOptions),
    actorRef: z.toJSONSchema(ActorRefSchema, jsonSchemaOptions),
    artifactRef: z.toJSONSchema(ArtifactRefSchema, jsonSchemaOptions),
    baselineRef: z.toJSONSchema(BaselineRefSchema, jsonSchemaOptions),
    validationPathSegment: z.toJSONSchema(ValidationPathSegmentSchema, jsonSchemaOptions),
    validationIssue: z.toJSONSchema(ValidationIssueSchema, jsonSchemaOptions),
    validationReport: z.toJSONSchema(ValidationReportSchema, jsonSchemaOptions),
  },
});

export const CommonContractSchemaRegistry: typeof commonContractSchemas = commonContractSchemas;
