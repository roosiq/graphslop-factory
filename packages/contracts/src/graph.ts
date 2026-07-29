import { z } from 'zod';

import {
  ActorRefSchema,
  HashSchema,
  IdentifierSchema,
  NodeRefSchema,
  NodeVersionSchema,
  SourceRefSchema,
  TimestampSchema,
} from './schemas.js';

/** The only graph kinds with authority in this MVP. */
export const AuthoritativeGraphKindSchema = z.enum(['intent', 'solution', 'execution']);

/** The explicit classification required for every Solution node. */
export const SolutionScopeSchema = z.enum(['product', 'implementation_support']);

/** The only lifecycle states permitted for Intent meaning. */
export const IntentNodeStatusSchema = z.enum([
  'inferred',
  'proposed',
  'confirmed',
  'rejected',
  'superseded',
  'unresolved',
  'deferred',
]);

/**
 * A versioned graph node. Graph-kind-specific fields are retained here so a
 * portable snapshot can be parsed before graph-kind semantic validation. The
 * graph kernel requires Intent provenance and rejects it outside Intent, and
 * likewise rejects Solution-only fields outside Solution.
 */
export const GraphNodeSchema = z
  .object({
    id: IdentifierSchema,
    stableId: IdentifierSchema,
    version: NodeVersionSchema,
    type: IdentifierSchema,
    status: IdentifierSchema,
    statementOrName: z.string().min(1).max(16_384),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    sourceRefs: z.array(SourceRefSchema),
    actorRef: ActorRefSchema,
    attributes: z.record(z.string(), z.json()),
    sourceQuote: z.string().min(1).max(16_384).optional(),
    originalInterpretation: z.string().min(1).max(16_384).optional(),
    normalizedInterpretation: z.string().min(1).max(16_384).optional(),
    confidence: z.number().min(0).max(1).optional(),
    approvedByUser: z.boolean().optional(),
    baselineMembership: z.array(IdentifierSchema).optional(),
    scope: SolutionScopeSchema.optional(),
    supports: z.array(NodeRefSchema).min(1).optional(),
  })
  .strict();

/** A versioned edge whose endpoint references bind exact graph snapshots. */
export const GraphEdgeSchema = z
  .object({
    id: IdentifierSchema,
    version: NodeVersionSchema,
    type: IdentifierSchema,
    sourceNodeRef: NodeRefSchema,
    targetNodeRef: NodeRefSchema,
    status: IdentifierSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    sourceRefs: z.array(SourceRefSchema),
    attributes: z.record(z.string(), z.json()),
  })
  .strict();

/** The two and only two first-class cross-graph trace relationships. */
export const CrossGraphLinkTypeSchema = z.enum([
  'SATISFIES_INTENT',
  'SATISFIES_SOLUTION',
]);

/**
 * Trace links retain exact source and target node references. Baseline IDs are
 * resolved by the kernel against the current approved baseline set.
 */
export const CrossGraphLinkSchema = z
  .object({
    id: IdentifierSchema,
    type: CrossGraphLinkTypeSchema,
    source: NodeRefSchema,
    target: NodeRefSchema,
    sourceBaselineId: IdentifierSchema,
    targetBaselineId: IdentifierSchema,
    createdAt: TimestampSchema,
    transformationId: IdentifierSchema,
  })
  .strict();

/** A complete immutable graph snapshot before canonical hashing is introduced. */
export const GraphSnapshotSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    graphKind: AuthoritativeGraphKindSchema,
    graphId: IdentifierSchema,
    snapshotId: IdentifierSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    parentSnapshotId: IdentifierSchema.nullable(),
    parentSnapshotContentHash: HashSchema.nullable(),
    createdAt: TimestampSchema,
    createdBy: ActorRefSchema,
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
    crossGraphLinks: z.array(CrossGraphLinkSchema),
    contentHash: HashSchema,
  })
  .strict();

/** Exact approved-baseline binding supplied to deterministic graph validation. */
export const GraphBaselineRefSchema = z
  .object({
    graphKind: AuthoritativeGraphKindSchema,
    graphId: IdentifierSchema,
    baselineId: IdentifierSchema,
    snapshotId: IdentifierSchema,
    snapshotContentHash: HashSchema,
  })
  .strict();

export type AuthoritativeGraphKind = z.infer<typeof AuthoritativeGraphKindSchema>;
export type SolutionScope = z.infer<typeof SolutionScopeSchema>;
export type IntentNodeStatus = z.infer<typeof IntentNodeStatusSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type CrossGraphLinkType = z.infer<typeof CrossGraphLinkTypeSchema>;
export type CrossGraphLink = z.infer<typeof CrossGraphLinkSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
export type GraphBaselineRef = z.infer<typeof GraphBaselineRefSchema>;
