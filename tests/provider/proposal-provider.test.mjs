import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexProposalProvider,
  FixtureProposalProvider,
  LocalQwenClient,
  parseLocalQwenTimeout,
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
    readinessGaps: ['input and output'],
  });
  assert.match(prompt, /^JOB\n/);
  assert.match(prompt, /\nUSE\n/);
  assert.match(prompt, /\nTOUCH\n/);
  assert.match(prompt, /\nDON'T\n/);
  assert.match(prompt, /\nDONE\n/);
  assert.match(prompt, /goal-one: Keep it local/);
  assert.match(prompt, /ANSWERED \[User\] Who uses this\? ANSWER: Just me\./);
  assert.match(prompt, /READINESS GAPS\ninput and output/);
  assert.match(prompt, /Ask exactly one new, high-impact question/);
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
  assert.match(prompt, /Every feature must receive Implement and Verify/);
  assert.match(prompt, /Inspect\|Decide\|Implement\|Test\|Integrate\|Verify\|Document\|Release/);
  assert.match(prompt, /Never create Repair work/);
  assert.equal(outputContract.name, 'solution_proposal');
  assert.equal(outputContract.schema.type, 'object');
  assert.equal(outputContract.schema.properties.roles.items.properties.use.type, 'array');
  assert.equal(outputContract.schema.properties.roles.items.properties.touch.type, 'array');
  assert.equal(outputContract.schema.properties.roles.items.properties.dont.type, 'array');
  assert.equal(outputContract.schema.properties.roles.items.properties.done.type, 'array');
  assert.deepEqual(
    outputContract.schema.properties.features.items.properties.intentNodeIds.items.enum,
    ['behavior-score'],
  );
  assert.deepEqual(
    outputContract.schema.properties.roles.items.properties.intentNodeIds.items.enum,
    ['behavior-score'],
  );

  const generic = new CodexProposalProvider(async () => ({
    ...proposal,
    roles: proposal.roles.map((role) => ({ ...role, name: 'Build' })),
  }));
  await assert.rejects(() => generic.planSolution({
    intentNodes: [{ id: 'behavior-score', type: 'Behavior', statement: 'Score submitted text.' }],
  }), /Task actions cannot be used as role names/);

  const nonIndependent = new CodexProposalProvider(async () => ({
    ...proposal,
    assignments: [{
      featureKey: 'score-text',
      roleKey: 'language-analysis',
      taskTypes: ['Implement', 'Verify'],
    }, {
      featureKey: 'score-text',
      roleKey: 'language-quality',
      taskTypes: ['Decide'],
    }],
  }));
  await assert.rejects(() => nonIndependent.planSolution({
    intentNodes: [{ id: 'behavior-score', type: 'Behavior', statement: 'Score submitted text.' }],
  }), /independent verification role/);
});

test('solution planner accepts optional stages and typed feature dependency handoffs', async () => {
  const provider = new CodexProposalProvider(async () => ({
    features: [{
      key: 'shared-schema',
      name: 'Publish shared schema',
      intentNodeIds: ['schema-intent'],
    }, {
      key: 'submit-form',
      name: 'Submit form data',
      intentNodeIds: ['submit-intent'],
    }],
    roles: [{
      key: 'schema-engineer',
      name: 'Schema engineer',
      intentNodeIds: ['schema-intent'],
      job: 'Define the shared schema.',
      use: ['Approved schema need.'],
      touch: ['Schema contract.'],
      dont: ['Change product behavior.'],
      done: ['Schema evidence exists.'],
    }, {
      key: 'schema-reviewer',
      name: 'Schema reviewer',
      intentNodeIds: ['schema-intent'],
      job: 'Verify the shared schema.',
      use: ['Schema contract.'],
      touch: ['Verification evidence.'],
      dont: ['Implement the schema.'],
      done: ['Schema checks pass.'],
    }, {
      key: 'form-engineer',
      name: 'Form engineer',
      intentNodeIds: ['submit-intent'],
      job: 'Build the form submission.',
      use: ['Approved submission need.'],
      touch: ['Form behavior.'],
      dont: ['Change schema contract.'],
      done: ['Submission works.'],
    }, {
      key: 'form-reviewer',
      name: 'Form reviewer',
      intentNodeIds: ['submit-intent'],
      job: 'Verify the form submission.',
      use: ['Submission result.'],
      touch: ['Verification evidence.'],
      dont: ['Implement the form.'],
      done: ['Submission checks pass.'],
    }],
    assignments: [{
      featureKey: 'shared-schema',
      roleKey: 'schema-engineer',
      taskTypes: ['Inspect', 'Implement', 'Document'],
    }, {
      featureKey: 'shared-schema',
      roleKey: 'schema-reviewer',
      taskTypes: ['Verify'],
    }, {
      featureKey: 'submit-form',
      roleKey: 'form-engineer',
      taskTypes: ['Implement', 'Test', 'Integrate', 'Release'],
    }, {
      featureKey: 'submit-form',
      roleKey: 'form-reviewer',
      taskTypes: ['Verify'],
    }],
    dependencies: [{
      featureKey: 'submit-form',
      dependsOnFeatureKey: 'shared-schema',
      artifacts: [{
        key: 'submission-schema',
        type: 'schema',
        description: 'Schema required to submit form data.',
        paths: ['packages/contracts/src/submission.ts'],
        requiredEvidence: ['file_hash', 'independent_check'],
      }],
    }],
  }));
  const proposal = await provider.planSolution({
    intentNodes: [
      { id: 'schema-intent', type: 'Output', statement: 'Publish a shared schema.' },
      { id: 'submit-intent', type: 'Behavior', statement: 'Submit form data.' },
    ],
  });
  assert.equal(proposal.dependencies.length, 1);
  assert.deepEqual(proposal.dependencies[0].artifacts[0].requiredEvidence, ['file_hash', 'independent_check']);
  assert.deepEqual(proposal.assignments[0].taskTypes, ['Inspect', 'Implement', 'Document']);
});

test('solution planner defaults missing dependencies and rejects invalid dependency topology', async () => {
  const valid = {
    features: [{ key: 'feature-a', name: 'Feature A', intentNodeIds: ['intent-a'] }, {
      key: 'feature-b', name: 'Feature B', intentNodeIds: ['intent-b'] }, {
      key: 'feature-c', name: 'Feature C', intentNodeIds: ['intent-c'] }],
    roles: [{
      key: 'builder-a', name: 'Builder A', intentNodeIds: ['intent-a'], job: 'Build A.',
      use: ['A need.'], touch: ['A code.'], dont: ['Change B.'], done: ['A works.'],
    }, {
      key: 'reviewer-a', name: 'Reviewer A', intentNodeIds: ['intent-a'], job: 'Verify A.',
      use: ['A result.'], touch: ['A checks.'], dont: ['Build A.'], done: ['A passes.'],
    }, {
      key: 'builder-b', name: 'Builder B', intentNodeIds: ['intent-b'], job: 'Build B.',
      use: ['B need.'], touch: ['B code.'], dont: ['Change C.'], done: ['B works.'],
    }, {
      key: 'reviewer-b', name: 'Reviewer B', intentNodeIds: ['intent-b'], job: 'Verify B.',
      use: ['B result.'], touch: ['B checks.'], dont: ['Build B.'], done: ['B passes.'],
    }, {
      key: 'builder-c', name: 'Builder C', intentNodeIds: ['intent-c'], job: 'Build C.',
      use: ['C need.'], touch: ['C code.'], dont: ['Change A.'], done: ['C works.'],
    }, {
      key: 'reviewer-c', name: 'Reviewer C', intentNodeIds: ['intent-c'], job: 'Verify C.',
      use: ['C result.'], touch: ['C checks.'], dont: ['Build C.'], done: ['C passes.'],
    }],
    assignments: ['a', 'b', 'c'].flatMap((suffix) => [{
      featureKey: `feature-${suffix}`,
      roleKey: `builder-${suffix}`,
      taskTypes: ['Implement'],
    }, {
      featureKey: `feature-${suffix}`,
      roleKey: `reviewer-${suffix}`,
      taskTypes: ['Verify'],
    }]),
  };
  const context = {
    intentNodes: [
      { id: 'intent-a', type: 'Behavior', statement: 'A.' },
      { id: 'intent-b', type: 'Behavior', statement: 'B.' },
      { id: 'intent-c', type: 'Behavior', statement: 'C.' },
    ],
  };
  const missingDependencies = new CodexProposalProvider(async () => valid);
  assert.deepEqual((await missingDependencies.planSolution(context)).dependencies, []);

  const repair = new CodexProposalProvider(async () => ({
    ...valid,
    assignments: [...valid.assignments, {
      featureKey: 'feature-a', roleKey: 'builder-a', taskTypes: ['Repair'],
    }],
  }));
  await assert.rejects(() => repair.planSolution(context));
  const untypedHandoff = new CodexProposalProvider(async () => ({
    ...valid,
    dependencies: [{
      featureKey: 'feature-a',
      dependsOnFeatureKey: 'feature-b',
      artifacts: [{ key: 'unknown', type: 'binary', description: 'Unsupported handoff.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }],
    }],
  }));
  await assert.rejects(() => untypedHandoff.planSolution(context));

  const cases = [{
    name: 'missing feature',
    dependencies: [{ featureKey: 'feature-a', dependsOnFeatureKey: 'missing', artifacts: [{ key: 'a', type: 'source', description: 'A.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }] }],
    error: /reference proposed features/,
  }, {
    name: 'self dependency',
    dependencies: [{ featureKey: 'feature-a', dependsOnFeatureKey: 'feature-a', artifacts: [{ key: 'a', type: 'source', description: 'A.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }] }],
    error: /cannot depend on itself/,
  }, {
    name: 'duplicate dependency',
    dependencies: [{ featureKey: 'feature-a', dependsOnFeatureKey: 'feature-b', artifacts: [{ key: 'a', type: 'source', description: 'A.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }] }, { featureKey: 'feature-a', dependsOnFeatureKey: 'feature-b', artifacts: [{ key: 'b', type: 'test', description: 'B.', paths: ['tests/b.ts'], requiredEvidence: ['file_hash'] }] }],
    error: /dependencies must be unique/,
  }, {
    name: 'duplicate artifact key',
    dependencies: [{ featureKey: 'feature-a', dependsOnFeatureKey: 'feature-b', artifacts: [{ key: 'same', type: 'source', description: 'A.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }, { key: 'same', type: 'test', description: 'B.', paths: ['tests/b.ts'], requiredEvidence: ['file_hash'] }] }],
    error: /Artifact handoff keys must be unique/,
  }, {
    name: 'producer artifact collision',
    dependencies: [{ featureKey: 'feature-a', dependsOnFeatureKey: 'feature-b', artifacts: [{ key: 'same', type: 'source', description: 'A.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }] }, { featureKey: 'feature-c', dependsOnFeatureKey: 'feature-b', artifacts: [{ key: 'same', type: 'test', description: 'C.', paths: ['tests/c.ts'], requiredEvidence: ['file_hash'] }] }],
    error: /unique for each producing feature/,
  }, {
    name: 'cycle',
    dependencies: [{ featureKey: 'feature-a', dependsOnFeatureKey: 'feature-b', artifacts: [{ key: 'a', type: 'source', description: 'A.', paths: ['src/a.ts'], requiredEvidence: ['file_hash'] }] }, { featureKey: 'feature-b', dependsOnFeatureKey: 'feature-c', artifacts: [{ key: 'b', type: 'source', description: 'B.', paths: ['src/b.ts'], requiredEvidence: ['file_hash'] }] }, { featureKey: 'feature-c', dependsOnFeatureKey: 'feature-a', artifacts: [{ key: 'c', type: 'source', description: 'C.', paths: ['src/c.ts'], requiredEvidence: ['file_hash'] }] }],
    error: /must be acyclic/,
  }];
  for (const item of cases) {
    const provider = new CodexProposalProvider(async () => ({ ...valid, dependencies: item.dependencies }));
    await assert.rejects(() => provider.planSolution(context), item.error, item.name);
  }
});

test('local Qwen sends the selected JSON Schema to llama.cpp', async () => {
  assert.equal(parseLocalQwenTimeout(undefined, 300_000), 300_000);
  assert.equal(parseLocalQwenTimeout('600000', 300_000), 600_000);
  assert.throws(() => parseLocalQwenTimeout('299999', 300_000), /300000 to 1800000/);
  assert.throws(
    () => new LocalQwenClient('http://127.0.0.1:8001/v1', 'local-qwen', 1_800_001),
    /1 to 1800000/,
  );
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
        items: {
          type: 'string',
          maxLength: 2_048,
          pattern: '^(?!/).+$',
        },
      },
      pattern: {
        type: 'string',
        pattern: '^safe$',
      },
      maxLength: {
        type: 'integer',
      },
    },
    required: ['answer', 'pattern', 'maxLength'],
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
        pattern: {
          type: 'string',
        },
        maxLength: {
          type: 'integer',
        },
      },
      required: ['answer', 'pattern', 'maxLength'],
      additionalProperties: false,
    },
  });
  assert.deepEqual(requestBody.chat_template_kwargs, { enable_thinking: false });
});

test('local Qwen preserves a concise llama.cpp request error', async () => {
  const client = new LocalQwenClient(
    'http://127.0.0.1:8001/v1',
    'local-qwen',
    1_000,
    async () => new Response(JSON.stringify({
      error: {
        message: 'Failed to initialize samplers: failed to parse grammar',
      },
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  );

  await assert.rejects(
    () => client.call('Return the answer.', {
      name: 'answer',
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false,
      },
    }),
    /Local Qwen request failed \(400\): Failed to initialize samplers: failed to parse grammar/,
  );
});

test('local Qwen does not expose arbitrary server error content', async () => {
  for (const response of [
    new Response(JSON.stringify({
      error: {
        message: 'Bad request for /home/ryan/private?token=secret with Bearer abc123',
      },
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
    new Response('<html>proxy secret</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
  ]) {
    const client = new LocalQwenClient(
      'http://127.0.0.1:8001/v1',
      'local-qwen',
      1_000,
      async () => response.clone(),
    );

    await assert.rejects(
      () => client.call('Return the answer.', {
        name: 'answer',
        schema: { type: 'object' },
      }),
      new RegExp(`^Error: Local Qwen request failed \\(${response.status}\\)\\.$`),
    );
  }
});
