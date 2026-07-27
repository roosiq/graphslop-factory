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
  SourceRefSchema,
  TimestampSchema,
  ValidationIssueSchema,
  ValidationReportSchema,
} from './schemas.js';

export * from './schemas.js';

const jsonSchemaOptions = { target: 'draft-2020-12' } as const;

/**
 * Native Zod JSON Schemas for the portable common layer. The value contains
 * only JSON data and can therefore cross process, provider, and runtime
 * boundaries without altering validation or authority semantics.
 */
export const commonContractSchemas = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://graphslop.dev/schemas/common-contracts/${CommonContractSchemaVersion}.json`,
  version: CommonContractSchemaVersion,
  schemas: Object.freeze({
    identifier: z.toJSONSchema(IdentifierSchema, jsonSchemaOptions),
    hash: z.toJSONSchema(HashSchema, jsonSchemaOptions),
    timestamp: z.toJSONSchema(TimestampSchema, jsonSchemaOptions),
    graphKind: z.toJSONSchema(GraphKindSchema, jsonSchemaOptions),
    nodeRef: z.toJSONSchema(NodeRefSchema, jsonSchemaOptions),
    sourceRef: z.toJSONSchema(SourceRefSchema, jsonSchemaOptions),
    actorRef: z.toJSONSchema(ActorRefSchema, jsonSchemaOptions),
    artifactRef: z.toJSONSchema(ArtifactRefSchema, jsonSchemaOptions),
    baselineRef: z.toJSONSchema(BaselineRefSchema, jsonSchemaOptions),
    validationIssue: z.toJSONSchema(ValidationIssueSchema, jsonSchemaOptions),
    validationReport: z.toJSONSchema(ValidationReportSchema, jsonSchemaOptions),
  }),
});

export const CommonContractSchemaRegistry = commonContractSchemas;
