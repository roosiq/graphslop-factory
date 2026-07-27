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

export const NodeRefSchema = z
  .object({
    graphKind: GraphKindSchema,
    graphId: IdentifierSchema,
    nodeId: IdentifierSchema,
    nodeVersion: z.number().int().positive(),
    snapshotId: IdentifierSchema,
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

export const ValidationIssueSchema = z
  .object({
    code: IdentifierSchema,
    message: z.string().min(1).max(1_024),
    path: z.array(IdentifierSchema),
  })
  .strict();

export const CommonContractSchemaVersion = '1.0.0' as const;

export const ValidationReportSchema = z
  .object({
    schemaVersion: z.literal(CommonContractSchemaVersion),
    valid: z.boolean(),
    issues: z.array(ValidationIssueSchema),
  })
  .strict();

export type Identifier = z.infer<typeof IdentifierSchema>;
export type Hash = z.infer<typeof HashSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
export type GraphKind = z.infer<typeof GraphKindSchema>;
export type NodeRef = z.infer<typeof NodeRefSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type ActorRef = z.infer<typeof ActorRefSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type BaselineRef = z.infer<typeof BaselineRefSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
