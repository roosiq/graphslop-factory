import { z } from 'zod';

import {
  ActorRefSchema,
  HashSchema,
  IdentifierSchema,
  NodeVersionSchema,
  TimestampSchema,
} from './schemas.js';
import { AuthoritativeGraphKindSchema } from './graph.js';

export const ProjectLifecycleStateSchema = z.enum([
  'CAPTURE',
  'DISCOVERY',
  'INTENT_REVIEW',
  'INTENT_APPROVED',
  'SOLUTION_GENERATION',
  'SOLUTION_REVIEW',
  'SOLUTION_APPROVED',
  'EXECUTION',
  'VERIFICATION',
  'REPAIR',
  'COMPLETE',
]);

export const ProjectStateSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  projectId: IdentifierSchema,
  displayName: z.string().min(1).max(256),
  lifecycleState: ProjectLifecycleStateSchema,
  activeIntentBaselineId: IdentifierSchema.nullable(),
  activeSolutionBaselineId: IdentifierSchema.nullable(),
  activeExecutionSnapshotId: IdentifierSchema.nullable(),
  connectedRepository: z.string().min(1).max(4_096).nullable(),
  integrationCommit: z.string().min(1).max(256).nullable(),
  activeLeaseId: IdentifierSchema.nullable(),
  runnerEnrollmentId: IdentifierSchema.nullable(),
  currentQuestionId: IdentifierSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  closedAt: TimestampSchema.nullable(),
}).strict();

export const ApprovalRecordSchema = z.object({
  approvalId: IdentifierSchema,
  actorId: IdentifierSchema,
  actorKind: z.literal('authenticated_project_owner'),
  artifactType: z.enum(['intent_baseline', 'solution_baseline']),
  artifactId: IdentifierSchema,
  artifactVersion: NodeVersionSchema,
  artifactContentHash: HashSchema,
  displayedProjectionHash: HashSchema,
  sourceMessageId: IdentifierSchema,
  sourceQuote: z.string().min(1).max(16_384),
  approvedAt: TimestampSchema,
  includedEdgeRefs: z.array(IdentifierSchema),
  renderedDataHash: HashSchema,
  generatedAt: TimestampSchema,
}).strict();

export const BaselineNodeVersionSchema = z.object({
  nodeId: IdentifierSchema,
  version: NodeVersionSchema,
}).strict();

export const ProtectedAssertionRecordSchema = z.object({
  assertionId: IdentifierSchema,
  statement: z.string().min(1).max(16_384),
  sourceIntentRefs: z.array(IdentifierSchema).min(1),
  severity: z.enum(['blocking', 'important']),
  validationRuleId: IdentifierSchema,
}).strict();

export const ApprovedBaselineSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  baselineId: IdentifierSchema,
  graphKind: AuthoritativeGraphKindSchema,
  projectId: IdentifierSchema,
  status: z.literal('approved'),
  snapshotId: IdentifierSchema,
  snapshotContentHash: HashSchema,
  projectionId: IdentifierSchema,
  projectionContentHash: HashSchema,
  nodeVersions: z.array(BaselineNodeVersionSchema),
  protectedAssertions: z.array(ProtectedAssertionRecordSchema),
  unresolvedNonBlocking: z.array(IdentifierSchema),
  approvalRecord: ApprovalRecordSchema,
  createdAt: TimestampSchema,
  supersedesBaselineId: IdentifierSchema.nullable(),
}).strict();

export const CorrectionRecordSchema = z.object({
  correctionId: IdentifierSchema,
  nodeId: IdentifierSchema,
  priorVersion: NodeVersionSchema,
  nextVersion: NodeVersionSchema,
  sourceMessageId: IdentifierSchema,
  rawContent: z.string().min(1).max(65_536),
  normalizedContent: z.string().min(1).max(65_536),
  createdAt: TimestampSchema,
}).strict();

export const FactoryStoredFileSchema = z.object({
  path: z.string().min(1).max(1_024),
  contentHash: HashSchema,
  format: z.enum(['json', 'jsonl']),
}).strict();

export const FactoryManifestSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  transactionId: IdentifierSchema,
  parentHeadHash: HashSchema.nullable(),
  files: z.array(FactoryStoredFileSchema),
  createdAt: TimestampSchema,
  manifestHash: HashSchema,
}).strict();

export const FactoryHeadSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  transactionId: IdentifierSchema,
  parentHeadHash: HashSchema.nullable(),
  manifestHash: HashSchema,
  committedAt: TimestampSchema,
  headHash: HashSchema,
}).strict();

export type ProjectLifecycleState = z.infer<typeof ProjectLifecycleStateSchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export type ApprovedBaseline = z.infer<typeof ApprovedBaselineSchema>;
export type CorrectionRecord = z.infer<typeof CorrectionRecordSchema>;
export type FactoryStoredFile = z.infer<typeof FactoryStoredFileSchema>;
export type FactoryManifest = z.infer<typeof FactoryManifestSchema>;
export type FactoryHead = z.infer<typeof FactoryHeadSchema>;
