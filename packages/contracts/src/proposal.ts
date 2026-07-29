import { z } from 'zod';

import { GraphSnapshotSchema } from './graph.js';
import { HashSchema, IdentifierSchema, TimestampSchema } from './schemas.js';
import { ApprovedBaselineSchema, CorrectionRecordSchema, ProjectStateSchema } from './state.js';

export const MessageRecordSchema = z.object({
  messageId: IdentifierSchema,
  projectId: IdentifierSchema,
  actor: z.enum(['owner', 'system']),
  content: z.string().min(1).max(65_536),
  createdAt: TimestampSchema,
}).strict();

export const IntentNodeDraftSchema = z.object({
  type: IdentifierSchema,
  statement: z.string().min(1).max(16_384),
  sourceQuote: z.string().min(1).max(16_384),
  normalizedInterpretation: z.string().min(1).max(16_384),
  confidence: z.number().min(0).max(0.89),
  status: z.enum(['inferred', 'proposed', 'unresolved', 'deferred']),
}).strict();

export const QuestionDraftSchema = z.object({
  text: z.string().min(1).max(2_048),
  category: IdentifierSchema,
  uncertaintyReduction: z.number().positive(),
  implementationImpact: z.number().positive(),
  driftRisk: z.number().positive(),
  dependencyCount: z.number().int().positive(),
  blocking: z.boolean(),
}).strict();

export const ProposalOutputSchema = z.object({
  intentNodes: z.array(IntentNodeDraftSchema),
  corrections: z.array(z.object({
    targetStableId: IdentifierSchema,
    statement: z.string().min(1).max(16_384),
    sourceQuote: z.string().min(1).max(16_384),
  }).strict()),
  questions: z.array(QuestionDraftSchema),
}).strict();

export const RankedQuestionSchema = QuestionDraftSchema.extend({
  questionId: IdentifierSchema,
  score: z.number().positive(),
  sourceMessageId: IdentifierSchema,
}).strict();

export const QuestionResolutionSchema = z.object({
  resolutionId: IdentifierSchema,
  questionId: IdentifierSchema,
  questionText: z.string().min(1).max(2_048).optional(),
  category: IdentifierSchema.optional(),
  disposition: z.enum(['answered', 'deferred']),
  ownerMessageId: IdentifierSchema,
  ownerContent: z.string().min(1).max(65_536),
  resolvedAt: TimestampSchema,
}).strict();

export const ProjectionRecordSchema = z.object({
  projectionId: IdentifierSchema,
  graphKind: z.enum(['intent', 'solution']),
  snapshotId: IdentifierSchema,
  contentHash: HashSchema,
  data: z.json(),
  generatedAt: TimestampSchema,
}).strict();

export const ConversationCorrectionSchema = CorrectionRecordSchema.extend({
  priorStatement: z.string().min(1).max(16_384),
  nextStatement: z.string().min(1).max(16_384),
  priorInterpretation: z.string().min(1).max(16_384),
  nextInterpretation: z.string().min(1).max(16_384),
}).strict();

export const ProjectConversationStateSchema = z.object({
  project: ProjectStateSchema,
  messages: z.array(MessageRecordSchema),
  intentGraph: GraphSnapshotSchema.nullable(),
  solutionGraph: GraphSnapshotSchema.nullable(),
  executionGraph: GraphSnapshotSchema.nullable(),
  corrections: z.array(ConversationCorrectionSchema),
  currentQuestion: RankedQuestionSchema.nullable(),
  questionResolutions: z.array(QuestionResolutionSchema).default([]),
  projections: z.array(ProjectionRecordSchema),
  approvedBaselines: z.array(ApprovedBaselineSchema),
}).strict();

export type MessageRecord = z.infer<typeof MessageRecordSchema>;
export type IntentNodeDraft = z.infer<typeof IntentNodeDraftSchema>;
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;
export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;
export type RankedQuestion = z.infer<typeof RankedQuestionSchema>;
export type QuestionResolution = z.infer<typeof QuestionResolutionSchema>;
export type ProjectionRecord = z.infer<typeof ProjectionRecordSchema>;
export type ConversationCorrection = z.infer<typeof ConversationCorrectionSchema>;
export type ProjectConversationState = z.infer<typeof ProjectConversationStateSchema>;
