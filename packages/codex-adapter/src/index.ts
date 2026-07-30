import {
  ProposalOutputJsonSchema,
  ProposalOutputSchema,
  SolutionProposalOutputJsonSchema,
  SolutionProposalOutputSchema,
  type MessageRecord,
  type ProposalOutput,
  type SolutionProposalOutput,
} from '@graphslop/contracts';

export type ProposalContext = {
  readonly message: MessageRecord;
  readonly priorIntentNodes: readonly {
    readonly stableId: string;
    readonly statement: string;
  }[];
  readonly priorQuestions?: readonly {
    readonly text: string;
    readonly category: string;
    readonly disposition: 'open' | 'answered' | 'deferred';
    readonly ownerContent?: string;
  }[];
};

export interface ProposalProvider {
  propose(context: ProposalContext): Promise<ProposalOutput>;
}

export type SolutionProposalContext = Readonly<{
  intentNodes: readonly Readonly<{
    id: string;
    type: string;
    statement: string;
  }>[];
}>;

export interface SolutionProposalProvider {
  planSolution(context: SolutionProposalContext): Promise<SolutionProposalOutput>;
}

export class FixtureProposalProvider implements ProposalProvider {
  constructor(private readonly fixture?: ProposalOutput) {}

  async propose(context: ProposalContext): Promise<ProposalOutput> {
    const fallback: ProposalOutput = {
      intentNodes: [{
        type: 'Goal',
        statement: `Build a product from: ${context.message.content}`,
        sourceQuote: context.message.content,
        normalizedInterpretation: context.message.content.trim(),
        confidence: 0.6,
        status: 'proposed',
      }],
      corrections: [],
      questions: [{
        text: 'What result must the user get first?',
        category: 'Outcome',
        uncertaintyReduction: 5,
        implementationImpact: 5,
        driftRisk: 5,
        dependencyCount: 5,
        blocking: true,
      }],
    };
    return ProposalOutputSchema.parse(this.fixture ?? fallback);
  }
}

export type StructuredOutputContract = Readonly<{
  name: string;
  schema: Readonly<Record<string, unknown>>;
}>;

export type CodexProposalCall = (
  prompt: string,
  output: StructuredOutputContract,
) => Promise<unknown>;

export type LocalModelInfo = Readonly<{
  connected: boolean;
  name: string;
}>;

type OpenAIModelList = {
  data?: readonly { id?: unknown }[];
  models?: readonly { name?: unknown; model?: unknown }[];
};

type OpenAIChatCompletion = {
  choices?: readonly {
    message?: {
      content?: unknown;
    };
  }[];
};

/**
 * Small OpenAI-compatible client for the loopback llama.cpp server. It never
 * sends project text anywhere except the configured local URL.
 */
export class LocalQwenClient {
  private resolvedModel?: string;

  constructor(
    private readonly baseUrl = 'http://127.0.0.1:8001/v1',
    private readonly configuredModel?: string,
    private readonly timeoutMs = 120_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async info(): Promise<LocalModelInfo> {
    try {
      const model = await this.model();
      return { connected: true, name: shortModelName(model) };
    } catch {
      return { connected: false, name: 'Qwen local' };
    }
  }

  async call(prompt: string, output: StructuredOutputContract): Promise<unknown> {
    const model = await this.model();
    const response = await this.request('/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You turn rough software requirements into strict JSON. Do not write prose or code.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 4096,
        response_format: {
          type: 'json_object',
          schema: llamaCppGenerationSchema(output.schema),
        },
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    const body = await response.json() as OpenAIChatCompletion;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Local Qwen returned no JSON content.');
    try {
      return JSON.parse(content);
    } catch {
      throw new Error('Local Qwen returned invalid JSON.');
    }
  }

  private async model(): Promise<string> {
    if (this.configuredModel) return this.configuredModel;
    if (this.resolvedModel) return this.resolvedModel;
    const response = await this.request('/models');
    const body = await response.json() as OpenAIModelList;
    const candidate = body.data?.[0]?.id ?? body.models?.[0]?.model ?? body.models?.[0]?.name;
    if (typeof candidate !== 'string' || !candidate) throw new Error('No local Qwen model is loaded.');
    this.resolvedModel = candidate;
    return candidate;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Local Qwen request failed (${response.status}).`);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function shortModelName(model: string): string {
  const file = model.split('/').at(-1) ?? model;
  return file.replace(/\.(?:gguf|bin)$/i, '');
}

/**
 * llama.cpp expands maxLength into grammar rules and rejects these product
 * schemas before inference. Keep the structural constraints in generation;
 * the authoritative Zod parse below still enforces string length.
 */
function llamaCppGenerationSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(llamaCppGenerationSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'maxLength')
      .map(([key, child]) => [key, llamaCppGenerationSchema(child)]),
  );
}

/**
 * Optional live boundary. Its output is only an untrusted proposal. The
 * project service creates IDs, timestamps, graph state, and authority.
 */
export class CodexProposalProvider implements ProposalProvider, SolutionProposalProvider {
  constructor(private readonly call: CodexProposalCall) {}

  async propose(context: ProposalContext): Promise<ProposalOutput> {
    const priorQuestions = context.priorQuestions ?? [];
    const prompt = [
      'JOB',
      'Read rough project words and suggest meaning.',
      'USE',
      context.message.content,
      'CURRENT INTENT',
      ...(context.priorIntentNodes.length === 0
        ? ['None yet.']
        : context.priorIntentNodes.map((node) => `${node.stableId}: ${node.statement}`)),
      'QUESTION HISTORY',
      ...(priorQuestions.length === 0
        ? ['None yet.']
        : priorQuestions.map((question) =>
          `${question.disposition.toUpperCase()} [${question.category}] ${question.text}`
          + (question.ownerContent ? ` ANSWER: ${question.ownerContent}` : ''))),
      'TOUCH',
      'Suggestions only.',
      "DON'T",
      'Create IDs, time, approval, authority, files, or code.',
      'DONE',
      'Return exactly one JSON object with these keys:',
      '{"intentNodes":[{"type":"Goal|UserType|Problem|UseCase|Behavior|Input|Output|Constraint|Preference|Exclusion|SuccessCriterion|Assumption|Decision|Example|Risk","statement":"normalized requirement","sourceQuote":"exact words from the new message","normalizedInterpretation":"same clear requirement","confidence":0.0,"status":"inferred|proposed|unresolved|deferred"}],"corrections":[{"targetStableId":"an exact stable ID from CURRENT INTENT","statement":"replacement meaning","sourceQuote":"exact words from the new message"}],"questions":[{"text":"one focused high-impact question","category":"Outcome|User|Input|Behavior|Output|Scope|Exclusions|Experience|Data|Constraints|Success","uncertaintyReduction":1,"implementationImpact":1,"driftRisk":1,"dependencyCount":1,"blocking":true}]}',
      'Use corrections instead of duplicating a current requirement.',
      'Extract every requirement, decision, constraint, preference, or exclusion stated in an answer into intentNodes.',
      'Do not put questions in intentNodes. The service records the selected question as an unresolved graph node.',
      'Never ask for a decision already present in CURRENT INTENT or QUESTION HISTORY, even with different wording.',
      'Ask at most one question, and only if its answer can materially change scope, behavior, architecture, privacy, or acceptance.',
      'Return an empty questions array when the project is buildable or the remaining uncertainty is low impact.',
      'Write the public question in grug voice: lowercase, blunt, short, and concrete. Example shape: "what thing must user get first?" Keep exact technical terms when needed. No jokes, filler, or insults.',
      'Confidence must be at most 0.89 because only the owner confirms requirements.',
    ].join('\n');
    return ProposalOutputSchema.parse(normalizeProposal(await this.call(prompt, {
      name: 'intent_proposal',
      schema: ProposalOutputJsonSchema,
    }), context));
  }

  async planSolution(context: SolutionProposalContext): Promise<SolutionProposalOutput> {
    const prompt = [
      'JOB',
      'Turn approved needs into product features and only the expert lenses needed to build them.',
      'USE',
      ...context.intentNodes.map((node) => `${node.id} [${node.type}] ${node.statement}`),
      'TOUCH',
      'Suggested Feature nodes, Role nodes, and Feature USES Role assignments only.',
      "DON'T",
      'Change the needs. Add generic roles by habit. Use Plan, Build, Check, Decide, Implement, or Verify as role names. Create IDs, approval, time, files, or code.',
      'DONE',
      'Return exactly one JSON object with these keys:',
      '{"features":[{"key":"short-key","name":"product behavior","intentNodeIds":["exact intent id"]}],"roles":[{"key":"short-key","name":"specific expert lens","intentNodeIds":["exact intent id"],"job":"one short sentence","use":["short input"],"touch":["short responsibility"],"dont":["short boundary"],"done":["short proof"]}],"assignments":[{"featureKey":"exact feature key","roleKey":"exact role key","taskTypes":["Decide|Implement|Verify"]}]}',
      'Pick roles from the needs. Examples are lenses like interaction design, frontend engineering, privacy review, model integration, accessibility, or quality assurance. These are examples, not a required list.',
      'Merge overlapping roles. Do not create a role unless a need makes it useful.',
      'Every feature and role must trace to exact IDs from USE.',
      'Every feature must receive Decide, Implement, and Verify work across its assigned roles.',
      'Verification must be assigned to a role that does not implement the same feature.',
      'Keep every role instruction blunt, short, and plain.',
    ].join('\n');
    return validateSolutionProposal(await this.call(prompt, {
      name: 'solution_proposal',
      schema: SolutionProposalOutputJsonSchema,
    }), context);
  }
}

export function validateSolutionProposal(
  value: unknown,
  context: SolutionProposalContext,
): SolutionProposalOutput {
  rejectAuthorityShape(value);
  const proposal = SolutionProposalOutputSchema.parse(value);
  const intentIds = new Set(context.intentNodes.map((node) => node.id));
  const featureKeys = new Set<string>();
  const roleKeys = new Set<string>();
  const roleNames = new Set<string>();
  const reservedRoleNames = new Set(['plan', 'build', 'check', 'decide', 'implement', 'verify']);

  for (const feature of proposal.features) {
    if (featureKeys.has(feature.key)) throw new Error('Solution feature keys must be unique.');
    featureKeys.add(feature.key);
    if (feature.intentNodeIds.some((id) => !intentIds.has(id))) {
      throw new Error('Every feature must trace to an approved Intent node.');
    }
  }
  for (const role of proposal.roles) {
    const normalizedName = canonicalName(role.name);
    if (roleKeys.has(role.key) || roleNames.has(normalizedName)) {
      throw new Error('Solution roles must be unique.');
    }
    if (reservedRoleNames.has(normalizedName)) {
      throw new Error('Task actions cannot be used as role names.');
    }
    roleKeys.add(role.key);
    roleNames.add(normalizedName);
    if (role.intentNodeIds.some((id) => !intentIds.has(id))) {
      throw new Error('Every role must trace to an approved Intent node.');
    }
  }

  const tasksByFeature = new Map<string, Set<string>>();
  const rolesByFeatureAndTask = new Map<string, Set<string>>();
  const usedRoles = new Set<string>();
  for (const assignment of proposal.assignments) {
    if (!featureKeys.has(assignment.featureKey) || !roleKeys.has(assignment.roleKey)) {
      throw new Error('Every role assignment must reference a proposed feature and role.');
    }
    usedRoles.add(assignment.roleKey);
    const taskTypes = tasksByFeature.get(assignment.featureKey) ?? new Set<string>();
    for (const taskType of assignment.taskTypes) {
      taskTypes.add(taskType);
      const key = `${assignment.featureKey}:${taskType}`;
      const rolesForTask = rolesByFeatureAndTask.get(key) ?? new Set<string>();
      rolesForTask.add(assignment.roleKey);
      rolesByFeatureAndTask.set(key, rolesForTask);
    }
    tasksByFeature.set(assignment.featureKey, taskTypes);
  }
  if ([...roleKeys].some((key) => !usedRoles.has(key))) {
    throw new Error('Every proposed role must be assigned to work.');
  }
  for (const featureKey of featureKeys) {
    const taskTypes = tasksByFeature.get(featureKey) ?? new Set<string>();
    if (!['Decide', 'Implement', 'Verify'].every((taskType) => taskTypes.has(taskType))) {
      throw new Error('Every feature needs Decide, Implement, and Verify work.');
    }
    const implementRoles = rolesByFeatureAndTask.get(`${featureKey}:Implement`) ?? new Set<string>();
    const verifyRoles = rolesByFeatureAndTask.get(`${featureKey}:Verify`) ?? new Set<string>();
    if (![...verifyRoles].some((roleKey) => !implementRoles.has(roleKey))) {
      throw new Error('Every feature needs an independent verification role.');
    }
  }
  return proposal;
}

function canonicalName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const allowedIntentTypes = new Set([
  'Project', 'Goal', 'UserType', 'Problem', 'UseCase', 'Behavior', 'Input', 'Output',
  'Constraint', 'Preference', 'Exclusion', 'SuccessCriterion', 'Assumption',
  'Decision', 'Example', 'Risk',
]);
const allowedStatuses = new Set(['inferred', 'proposed', 'unresolved', 'deferred']);
const allowedCategories = new Set([
  'Outcome', 'User', 'Input', 'Behavior', 'Output', 'Scope', 'Exclusions',
  'Experience', 'Data', 'Constraints', 'Success',
]);

function normalizeProposal(value: unknown, context: ProposalContext): ProposalOutput {
  rejectAuthorityShape(value);
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const text = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback;
  const positive = (candidate: unknown, fallback: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
  const grounded = (quote: string) => {
    const words = quote.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const sourceWords = new Set(context.message.content.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    return words.length > 0 && words.filter((word) => sourceWords.has(word)).length / words.length >= 0.55;
  };
  const intentNodes = Array.isArray(record.intentNodes) ? record.intentNodes.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (item.type === 'Question') return [];
    const statement = text(item.statement, text(item.normalizedInterpretation, context.message.content));
    const sourceQuote = text(item.sourceQuote, context.message.content);
    if (!grounded(sourceQuote)) return [];
    return [{
      type: allowedIntentTypes.has(String(item.type)) ? String(item.type) : 'Behavior',
      statement,
      sourceQuote,
      normalizedInterpretation: text(item.normalizedInterpretation, statement),
      confidence: Math.max(0, Math.min(0.89, typeof item.confidence === 'number' ? item.confidence : 0.65)),
      status: allowedStatuses.has(String(item.status))
        ? String(item.status) as ProposalOutput['intentNodes'][number]['status']
        : 'proposed' as const,
    }];
  }) : [];
  const currentIds = new Set(context.priorIntentNodes.map((node) => node.stableId));
  const corrections = Array.isArray(record.corrections) ? record.corrections.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const targetStableId = String(item.targetStableId ?? '');
    if (!currentIds.has(targetStableId)) return [];
    const sourceQuote = text(item.sourceQuote, context.message.content);
    if (!grounded(sourceQuote)) return [];
    return [{
      targetStableId,
      statement: text(item.statement, context.message.content),
      sourceQuote,
    }];
  }) : [];
  const questions = Array.isArray(record.questions) ? record.questions.slice(0, 1).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.text !== 'string' || !item.text.trim()) return [];
    return [{
      text: item.text.trim(),
      category: allowedCategories.has(String(item.category)) ? String(item.category) : 'Scope',
      uncertaintyReduction: positive(item.uncertaintyReduction, 3),
      implementationImpact: positive(item.implementationImpact, 3),
      driftRisk: positive(item.driftRisk, 3),
      dependencyCount: Math.max(1, Math.round(positive(item.dependencyCount, 3))),
      blocking: typeof item.blocking === 'boolean' ? item.blocking : true,
    }];
  }) : [];
  if (intentNodes.length === 0 && corrections.length === 0) {
    intentNodes.push({
      type: 'Decision',
      statement: context.message.content.trim(),
      sourceQuote: context.message.content,
      normalizedInterpretation: context.message.content.trim(),
      confidence: 0.89,
      status: 'proposed',
    });
  }
  return { intentNodes, corrections, questions };
}

const authorityKeys = new Set([
  'approvalId', 'approvedAt', 'approvedByUser', 'actorRef', 'actorId',
  'baselineId', 'contentHash', 'snapshotId', 'graphId', 'capability', 'token',
  'leaseId', 'taskId', 'createdAt', 'updatedAt',
]);

function rejectAuthorityShape(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) rejectAuthorityShape(child);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (authorityKeys.has(key)) throw new Error('Model output attempted to create authority fields.');
    rejectAuthorityShape(child);
  }
}
