import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexProposalProvider,
  FixtureProposalProvider,
  LocalQwenClient,
} from '../../packages/codex-adapter/dist/index.js';

const message = {
  messageId: 'message-1',
  projectId: 'project-1',
  actor: 'owner',
  content: 'Need app. Keep simple.',
  createdAt: '2026-07-28T12:00:00Z',
};

test('fixture provider is deterministic and proposes no authority fields', async () => {
  const provider = new FixtureProposalProvider();
  const first = await provider.propose({ message, priorIntentNodes: [] });
  const second = await provider.propose({ message, priorIntentNodes: [] });
  assert.deepEqual(first, second);
  assert.equal(first.questions.length, 1);
  assert.equal(JSON.stringify(first).includes('approvalId'), false);
  assert.equal(JSON.stringify(first).includes('createdAt'), false);
});

test('optional Codex boundary uses caveman contract and rejects authority-shaped output', async () => {
  let prompt = '';
  let outputContract;
  const provider = new CodexProposalProvider(async (value, output) => {
    prompt = value;
    outputContract = output;
    return { intentNodes: [], corrections: [], questions: [] };
  });
  await provider.propose({
    message,
    priorIntentNodes: [{ stableId: 'goal-one', statement: 'Keep it local' }],
    priorQuestions: [{
      text: 'Who uses this?',
      category: 'User',
      disposition: 'answered',
      ownerContent: 'Just me.',
    }],
  });
  assert.match(prompt, /^JOB\n/);
  assert.match(prompt, /\nUSE\n/);
  assert.match(prompt, /\nTOUCH\n/);
  assert.match(prompt, /\nDON'T\n/);
  assert.match(prompt, /\nDONE\n/);
  assert.match(prompt, /goal-one: Keep it local/);
  assert.match(prompt, /ANSWERED \[User\] Who uses this\? ANSWER: Just me\./);
  assert.match(prompt, /Never ask for a decision already present/);
  assert.equal(outputContract.name, 'intent_proposal');
  assert.equal(outputContract.schema.type, 'object');
  assert.equal(outputContract.schema.additionalProperties, false);
  assert.equal(outputContract.schema.properties.intentNodes.type, 'array');

  const hostile = new CodexProposalProvider(async () => ({
    intentNodes: [],
    corrections: [],
    questions: [],
    approvalId: 'model-made-authority',
  }));
  await assert.rejects(() => hostile.propose({ message, priorIntentNodes: [] }));
});

test('local model proposals are grounded, normalized, and fail safely to the owner words', async () => {
  const provider = new CodexProposalProvider(async () => ({
    intentNodes: [
      {
        type: 'Goal',
        statement: 'Keep the app simple.',
        sourceQuote: 'Keep simple',
        normalizedInterpretation: 'Keep the app simple.',
        confidence: 4,
        status: 'confirmed',
      },
      {
        type: 'Exclusion',
        statement: 'Do not create authority fields.',
        sourceQuote: 'Create IDs, time, approval, authority, files, or code.',
        normalizedInterpretation: 'Prompt instructions must not become product intent.',
        confidence: 0.7,
        status: 'proposed',
      },
      {
        type: 'Question',
        statement: 'Should the app stay simple?',
        sourceQuote: 'Keep simple',
        normalizedInterpretation: 'Should the app stay simple?',
        confidence: 0.7,
        status: 'unresolved',
      },
    ],
    corrections: [],
    questions: [],
  }));
  const proposal = await provider.propose({ message, priorIntentNodes: [] });
  assert.equal(proposal.intentNodes.length, 1);
  assert.equal(proposal.intentNodes[0].statement, 'Keep the app simple.');
  assert.equal(proposal.intentNodes[0].confidence, 0.89);
  assert.equal(proposal.intentNodes[0].status, 'proposed');

  const fallback = new CodexProposalProvider(async () => ({
    intentNodes: [],
    corrections: [],
    questions: [],
  }));
  const answer = await fallback.propose({ message, priorIntentNodes: [] });
  assert.deepEqual(answer.intentNodes, [{
    type: 'Decision',
    statement: message.content,
    sourceQuote: message.content,
    normalizedInterpretation: message.content,
    confidence: 0.89,
    status: 'proposed',
  }]);
});

test('missing model question text is dropped instead of replaced by a canned question', async () => {
  const provider = new CodexProposalProvider(async () => ({
    intentNodes: [{
      type: 'Goal',
      statement: 'Keep the app simple.',
      sourceQuote: 'Keep simple',
      normalizedInterpretation: 'Keep the app simple.',
      confidence: 0.8,
      status: 'proposed',
    }],
    corrections: [],
    questions: [{
      text: '   ',
      category: 'Outcome',
      uncertaintyReduction: 5,
      implementationImpact: 5,
      driftRisk: 5,
      dependencyCount: 5,
      blocking: true,
    }],
  }));

  const proposal = await provider.propose({ message, priorIntentNodes: [] });
  assert.deepEqual(proposal.questions, []);
});

test('solution planner derives traced role lenses and keeps task actions separate', async () => {
  let prompt = '';
  let outputContract;
  const provider = new CodexProposalProvider(async (value, output) => {
    prompt = value;
    outputContract = output;
    return {
      features: [{
        key: 'score-text',
        name: 'Score submitted text',
        intentNodeIds: ['behavior-score'],
      }],
      roles: [{
        key: 'language-analysis',
        name: 'Language analysis engineer',
        intentNodeIds: ['behavior-score'],
        job: 'Make the scoring behavior.',
        use: ['Approved scoring need.'],
        touch: ['Scoring behavior.'],
        dont: ['Change score meaning.'],
        done: ['Scoring checks pass.'],
      }, {
        key: 'language-quality',
        name: 'Language quality reviewer',
        intentNodeIds: ['behavior-score'],
        job: 'Check the scoring behavior.',
        use: ['Approved scoring need and result.'],
        touch: ['Verification only.'],
        dont: ['Build the scoring behavior.'],
        done: ['Report pass or exact gap.'],
      }],
      assignments: [{
        featureKey: 'score-text',
        roleKey: 'language-analysis',
        taskTypes: ['Decide', 'Implement'],
      }, {
        featureKey: 'score-text',
        roleKey: 'language-quality',
        taskTypes: ['Verify'],
      }],
    };
  });
  const proposal = await provider.planSolution({
    intentNodes: [{ id: 'behavior-score', type: 'Behavior', statement: 'Score submitted text.' }],
  });
  assert.equal(proposal.roles[0].name, 'Language analysis engineer');
  assert.match(prompt, /Pick roles from the needs/);
  assert.match(prompt, /Every feature must receive Decide, Implement, and Verify/);
  assert.equal(outputContract.name, 'solution_proposal');
  assert.equal(outputContract.schema.type, 'object');
  assert.equal(outputContract.schema.properties.roles.items.properties.use.type, 'array');
  assert.equal(outputContract.schema.properties.roles.items.properties.touch.type, 'array');
  assert.equal(outputContract.schema.properties.roles.items.properties.dont.type, 'array');
  assert.equal(outputContract.schema.properties.roles.items.properties.done.type, 'array');

  const generic = new CodexProposalProvider(async () => ({
    ...proposal,
    roles: proposal.roles.map((role) => ({ ...role, name: 'Build' })),
  }));
  await assert.rejects(() => generic.planSolution({
    intentNodes: [{ id: 'behavior-score', type: 'Behavior', statement: 'Score submitted text.' }],
  }), /Task actions cannot be used as role names/);
});

test('local Qwen sends the selected JSON Schema to llama.cpp', async () => {
  let requestBody;
  const client = new LocalQwenClient(
    'http://127.0.0.1:8001/v1',
    'local-qwen',
    1_000,
    async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"answer":["yes"]}' } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  const schema = {
    type: 'object',
    properties: {
      answer: {
        type: 'array',
        items: { type: 'string', maxLength: 2_048 },
      },
    },
    required: ['answer'],
    additionalProperties: false,
  };

  const result = await client.call('Return the answer.', {
    name: 'answer',
    schema,
  });

  assert.deepEqual(result, { answer: ['yes'] });
  assert.deepEqual(requestBody.response_format, {
    type: 'json_object',
    schema: {
      type: 'object',
      properties: {
        answer: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['answer'],
      additionalProperties: false,
    },
  });
  assert.deepEqual(requestBody.chat_template_kwargs, { enable_thinking: false });
});
