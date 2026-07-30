import { z } from 'zod';

/** A portable identifier for a contract-owned resource or namespace. */
export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/)
  .describe('A non-empty portable identifier.');

/** A lowercase hexadecimal SHA-256 digest. */
export const HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe('A lowercase hexadecimal SHA-256 digest.');

/** An RFC 3339 timestamp with a UTC offset. */
export const TimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('An RFC 3339 timestamp with an explicit offset.');

/** An implementation-defined graph namespace; common contracts impose no behavior on it. */
export const GraphKindSchema = IdentifierSchema.describe(
  'An implementation-defined graph namespace.',
);

/** A positive version that can be represented exactly in JavaScript. */
export const NodeVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .describe('A positive safe integer node version.');

export const NodeRefSchema = z
  .object({
    graphKind: GraphKindSchema,
    graphId: IdentifierSchema,
    nodeId: IdentifierSchema,
    nodeVersion: NodeVersionSchema,
    snapshotId: IdentifierSchema,
    snapshotContentHash: HashSchema,
  })
  .strict();

export const SourceRefSchema = z
  .object({
    sourceId: IdentifierSchema,
    contentHash: HashSchema.optional(),
  })
  .strict();

export const ActorRefSchema = z
  .object({
    actorId: IdentifierSchema,
    actorKind: IdentifierSchema,
  })
  .strict();

export const ArtifactRefSchema = z
  .object({
    artifactId: IdentifierSchema,
    artifactKind: IdentifierSchema,
    contentHash: HashSchema,
  })
  .strict();

export const BaselineRefSchema = z
  .object({
    baselineId: IdentifierSchema,
    contentHash: HashSchema,
  })
  .strict();

/** A location in a JSON-like value, using object keys and array indexes. */
export const ValidationPathSegmentSchema = z.union([
  z.string(),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);

export const ValidationIssueSchema = z
  .object({
    code: IdentifierSchema,
    message: z.string().min(1).max(1_024),
    path: z.array(ValidationPathSegmentSchema),
  })
  .strict();

export const CommonContractSchemaVersion = '1.0.0' as const;

const ValidationReportBaseSchema = z.object({
  schemaVersion: z.literal(CommonContractSchemaVersion),
});

/**
 * A report is valid exactly when it has no issues. The union makes invalid
 * contradictory states unrepresentable at every portable contract boundary.
 */
export const ValidationReportSchema = z.discriminatedUnion('valid', [
  ValidationReportBaseSchema.extend({
    valid: z.literal(true),
    issues: z.array(ValidationIssueSchema).length(0),
  }).strict(),
  ValidationReportBaseSchema.extend({
    valid: z.literal(false),
    issues: z.array(ValidationIssueSchema).min(1),
  }).strict(),
]);

export type Identifier = z.infer<typeof IdentifierSchema>;
export type Hash = z.infer<typeof HashSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
export type GraphKind = z.infer<typeof GraphKindSchema>;
export type NodeVersion = z.infer<typeof NodeVersionSchema>;
export type NodeRef = z.infer<typeof NodeRefSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type ActorRef = z.infer<typeof ActorRefSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type BaselineRef = z.infer<typeof BaselineRefSchema>;
export type ValidationPathSegment = z.infer<typeof ValidationPathSegmentSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
