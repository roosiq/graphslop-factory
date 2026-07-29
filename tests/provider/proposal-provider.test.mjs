import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexProposalProvider,
  FixtureProposalProvider,
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
  const provider = new CodexProposalProvider(async (value) => {
    prompt = value;
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
