import assert from 'node:assert/strict';
import test from 'node:test';

import { FixtureProposalProvider } from '../../packages/codex-adapter/dist/index.js';
import { ProjectService, ProjectServiceError } from '../../packages/control-state/dist/index.js';
import { validateGraphSnapshots } from '../../packages/graph-kernel/dist/index.js';

const hash = (character) => character.repeat(64);

function setup(provider, ownerActor) {
  let sequence = 0;
  const initial = {
    project: {
      schemaVersion: '1.0.0',
      projectId: 'project-one',
      displayName: 'One',
      lifecycleState: 'CAPTURE',
      activeIntentBaselineId: null,
      activeSolutionBaselineId: null,
      activeExecutionSnapshotId: null,
      connectedRepository: null,
      integrationCommit: null,
      activeLeaseId: null,
      runnerEnrollmentId: null,
      currentQuestionId: null,
      createdAt: '2026-07-28T12:00:00Z',
      updatedAt: '2026-07-28T12:00:00Z',
      closedAt: null,
    },
    messages: [],
    intentGraph: null,
    solutionGraph: null,
    executionGraph: null,
    corrections: [],
    currentQuestion: null,
    questionResolutions: [],
    projections: [],
    approvedBaselines: [],
  };
  return new ProjectService(initial, provider, {
    nextId: (kind) => `${kind}-${++sequence}`,
    now: () => '2026-07-28T12:01:00Z',
  }, undefined, ownerActor);
}

test('rough language creates proposed Intent and exactly one highest-value question', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Make a simple analyzer',
      sourceQuote: 'Need analyzer. Simple.',
      normalizedInterpretation: 'Build a simple analyzer',
      confidence: 0.7,
      status: 'proposed',
    }],
    corrections: [],
    questions: [{
      text: 'Cosmetic?',
      category: 'Experience',
      uncertaintyReduction: 1,
      implementationImpact: 1,
      driftRisk: 1,
      dependencyCount: 1,
      blocking: false,
    }, {
      text: 'What is the required output?',
      category: 'Output',
      uncertaintyReduction: 5,
      implementationImpact: 5,
      driftRisk: 5,
      dependencyCount: 5,
      blocking: true,
    }],
  }));
  const state = await service.submitMessage('Need analyzer. Simple.');
  assert.equal(state.intentGraph.nodes.length, 2);
  assert.equal(state.intentGraph.nodes.find((node) => node.type === 'Goal').status, 'proposed');
  assert.equal(state.intentGraph.nodes.find((node) => node.type === 'Question').status, 'unresolved');
  assert.equal(state.intentGraph.edges[0].type, 'QUESTION_RESOLVES');
  assert.equal(state.currentQuestion.text, 'What is the required output?');
  assert.equal(state.project.currentQuestionId, state.currentQuestion.questionId);
});

test('hosted graph edits retain the authenticated project actor', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Build one thing',
      sourceQuote: 'Build one thing',
      normalizedInterpretation: 'Build one thing',
      confidence: 0.8,
      status: 'proposed',
    }],
    corrections: [],
    questions: [],
  }), {
    actorId: 'user-72a4c8cb',
    actorKind: 'authenticated_project_owner',
  });
  await service.submitMessage('Build one thing');
  const next = service.editIntentGraph({
    action: 'add-node',
    type: 'Constraint',
    statement: 'Keep data private.',
  });
  const constraint = next.intentGraph.nodes.find((node) => node.type === 'Constraint');
  assert.deepEqual(constraint.actorRef, {
    actorId: 'user-72a4c8cb',
    actorKind: 'authenticated_project_owner',
  });
});

test('zero questions stop discovery instead of forcing a generic fallback while an empty proposal fails closed', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Make something',
      sourceQuote: 'make thing',
      normalizedInterpretation: 'Make a product',
      confidence: 0.5,
      status: 'proposed',
    }],
    corrections: [],
    questions: [],
  }));
  const first = await service.submitMessage('make thing');
  assert.equal(first.currentQuestion, null);
  assert.equal(first.project.currentQuestionId, null);

  const empty = setup(new FixtureProposalProvider({
    intentNodes: [],
    corrections: [],
    questions: [],
  }));
  await assert.rejects(
    () => empty.submitMessage('nothing'),
    (error) => error instanceof ProjectServiceError && error.code === 'provider_failed',
  );
  assert.equal(empty.state().intentGraph, null);
  assert.equal(empty.state().messages.length, 1);
});

test('readiness gaps retry the model for one generated question and block review', async () => {
  const contexts = [];
  const service = setup({
    propose: async (context) => {
      contexts.push(context);
      return {
        intentNodes: [{
          type: 'Goal', statement: 'Share neighborhood food', sourceQuote: context.message.content,
          normalizedInterpretation: 'Share neighborhood food', confidence: 0.6, status: 'proposed',
        }],
        corrections: [],
        questions: context.readinessGaps ? [{
          text: 'who can collect the food?', category: 'User', uncertaintyReduction: 5,
          implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true,
        }] : [],
      };
    },
  });
  const state = await service.submitMessage('Help neighbors share extra food.');
  assert.equal(contexts.length, 2);
  assert.ok(contexts[1].readinessGaps.includes('users or usage context'));
  assert.equal(state.currentQuestion.text, 'who can collect the food?');
  assert.throws(() => service.createReviewProjection('intent'), /blocking question/);
});

test('answer-derived requirements are confirmed owner statements with typed graph links', async () => {
  let call = 0;
  const service = setup({
    propose: async ({ message, priorIntentNodes }) => {
      call += 1;
      return call === 1 ? {
        intentNodes: [{ type: 'Goal', statement: 'Share food', sourceQuote: message.content,
          normalizedInterpretation: 'Share food', confidence: 0.7, status: 'proposed' }],
        corrections: [],
        questions: [{ text: 'what does pickup look like?', category: 'Behavior', uncertaintyReduction: 5,
          implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true }],
      } : {
        intentNodes: [{ type: 'Behavior', statement: 'Neighbors reserve a pickup time', sourceQuote: message.content,
          normalizedInterpretation: 'Reserve a pickup time', confidence: 0.7, status: 'proposed' },
        { type: 'Output', statement: 'Show the confirmed pickup time', sourceQuote: message.content,
          normalizedInterpretation: 'Show confirmed pickup time', confidence: 0.7, status: 'proposed' },
        { type: 'Preference', statement: 'Integrate with Salesforce', sourceQuote: 'Must integrate with Salesforce',
          normalizedInterpretation: 'Integrate with Salesforce', confidence: 0.7, status: 'proposed' }],
        corrections: [{
          targetStableId: priorIntentNodes[0].stableId,
          statement: 'Share food through reserved pickup times',
          sourceQuote: message.content,
        }],
        questions: [{ text: 'what makes the sharing safe?', category: 'Constraints', uncertaintyReduction: 5,
          implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true }],
      };
    },
  });
  const first = await service.submitMessage('Share food with neighbors.');
  const state = await service.resolveCurrentQuestion(first.currentQuestion.questionId, 'answered', 'Neighbors reserve a pickup time.', true);
  const answerMessageId = state.questionResolutions[0].ownerMessageId;
  const answerNodes = state.intentGraph.nodes.filter((node) =>
    ['Behavior', 'Output'].includes(node.type) && node.sourceRefs.some((source) => source.sourceId === answerMessageId));
  assert.equal(answerNodes.length, 2);
  assert.ok(answerNodes.every((node) => node.status === 'confirmed' && node.approvedByUser));
  assert.ok(answerNodes.every((node) => node.actorRef.actorId === 'local-owner'));
  const correctedGoal = state.intentGraph.nodes.find((node) => node.type === 'Goal');
  assert.equal(correctedGoal.status, 'confirmed');
  assert.equal(correctedGoal.approvedByUser, true);
  assert.equal(correctedGoal.actorRef.actorId, 'local-owner');
  const ungrounded = state.intentGraph.nodes.find((node) => node.statementOrName === 'Integrate with Salesforce');
  assert.equal(ungrounded.status, 'proposed');
  assert.equal(ungrounded.approvedByUser, false);
  assert.ok(answerNodes.every((node) => state.intentGraph.edges.some((edge) =>
    edge.sourceNodeRef.nodeId === node.id || edge.targetNodeRef.nodeId === node.id)));
  const output = answerNodes.find((node) => node.type === 'Output');
  assert.ok(state.intentGraph.edges.some((edge) =>
    edge.type === 'BEHAVIOR_PRODUCES_OUTPUT' && edge.targetNodeRef.nodeId === output.id));
});

test('typed relationships choose the matching behavior instead of the newest compatible node', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Behavior', statement: 'Reserve a neighborhood food pickup', sourceQuote: 'Reserve food pickup',
      normalizedInterpretation: 'Reserve a neighborhood food pickup', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Behavior', statement: 'Send weekly program statistics', sourceQuote: 'weekly statistics',
      normalizedInterpretation: 'Send weekly program statistics', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Constraint', statement: 'Food pickup reservations expire after one hour', sourceQuote: 'pickup expires',
      normalizedInterpretation: 'Food pickup reservations expire after one hour', confidence: 0.8, status: 'proposed',
    }],
    corrections: [],
    questions: [{
      text: 'who can reserve food?', category: 'User', uncertaintyReduction: 5,
      implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true,
    }],
  }));
  const state = await service.submitMessage('Reserve food pickup. weekly statistics. pickup expires.');
  const constraint = state.intentGraph.nodes.find((node) => node.type === 'Constraint');
  const reservation = state.intentGraph.nodes.find((node) => node.statementOrName.includes('Reserve a neighborhood'));
  assert.ok(state.intentGraph.edges.some((edge) =>
    edge.type === 'CONSTRAINT_LIMITS'
    && edge.sourceNodeRef.nodeId === constraint.id
    && edge.targetNodeRef.nodeId === reservation.id));
});

test('a follow-up is suppressed when the owner answer already confirms the same issue', async () => {
  let call = 0;
  const service = setup({
    propose: async ({ message }) => {
      call += 1;
      if (call === 1) {
        return {
          intentNodes: [
            { type: 'Goal', statement: 'Share food', sourceQuote: message.content,
              normalizedInterpretation: 'Share food', confidence: 0.7, status: 'proposed' },
            { type: 'UserType', statement: 'Neighbors', sourceQuote: message.content,
              normalizedInterpretation: 'Neighbors', confidence: 0.7, status: 'proposed' },
            { type: 'Behavior', statement: 'Reserve food', sourceQuote: message.content,
              normalizedInterpretation: 'Reserve food', confidence: 0.7, status: 'proposed' },
            { type: 'Input', statement: 'Food post', sourceQuote: message.content,
              normalizedInterpretation: 'Food post', confidence: 0.7, status: 'proposed' },
            { type: 'Output', statement: 'Reservation', sourceQuote: message.content,
              normalizedInterpretation: 'Reservation', confidence: 0.7, status: 'proposed' },
            { type: 'Constraint', statement: 'Private pickup details', sourceQuote: message.content,
              normalizedInterpretation: 'Private pickup details', confidence: 0.7, status: 'proposed' },
            { type: 'SuccessCriterion', statement: 'Pickup is confirmed', sourceQuote: message.content,
              normalizedInterpretation: 'Pickup is confirmed', confidence: 0.7, status: 'proposed' },
          ],
          corrections: [],
          questions: [{ text: 'who sees the pickup area and time?', category: 'Scope',
            uncertaintyReduction: 5, implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true }],
        };
      }
      return {
        intentNodes: [{
          type: 'Constraint',
          statement: 'Assigned volunteers see details only for their handoff',
          sourceQuote: message.content,
          normalizedInterpretation: 'Assigned volunteers see details only for their handoff',
          confidence: 0.8,
          status: 'proposed',
        }],
        corrections: [],
        questions: [{ text: 'who can see the assigned volunteer?', category: 'Scope',
          uncertaintyReduction: 5, implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true }],
      };
    },
  });
  const first = await service.submitMessage('Neighbors share food with volunteer pickup.');
  const state = await service.resolveCurrentQuestion(
    first.currentQuestion.questionId,
    'answered',
    'Assigned volunteers see details only for their handoff.',
    true,
  );
  assert.equal(state.currentQuestion, null);
  assert.deepEqual(service.intentReadinessGaps(), []);
});

test('question relationships prefer the requirement whose words match the question', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal', statement: 'Share neighborhood food', sourceQuote: 'Share food',
      normalizedInterpretation: 'Share neighborhood food', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Constraint', statement: 'Only assigned people see the volunteer name', sourceQuote: 'volunteer name',
      normalizedInterpretation: 'Only assigned people see the volunteer name', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Behavior', statement: 'Delete the pickup address after completion', sourceQuote: 'delete address',
      normalizedInterpretation: 'Delete the pickup address after completion', confidence: 0.8, status: 'proposed',
    }],
    corrections: [],
    questions: [{
      text: 'who sees the volunteer name?', category: 'Scope', uncertaintyReduction: 5,
      implementationImpact: 5, driftRisk: 5, dependencyCount: 5, blocking: true,
    }],
  }));
  const state = await service.submitMessage('Share food. volunteer name. delete address.');
  const question = state.intentGraph.nodes.find((node) => node.type === 'Question');
  const volunteer = state.intentGraph.nodes.find((node) => node.statementOrName.includes('volunteer name'));
  assert.ok(state.intentGraph.edges.some((edge) =>
    edge.type === 'QUESTION_RESOLVES'
    && edge.sourceNodeRef.nodeId === question.id
    && edge.targetNodeRef.nodeId === volunteer.id));
});

test('settled questions are retained and reworded repeats are suppressed', async () => {
  const question = {
    text: 'What is the primary purpose of the website?',
    category: 'Outcome',
    uncertaintyReduction: 5,
    implementationImpact: 5,
    driftRisk: 5,
    dependencyCount: 5,
    blocking: true,
  };
  let call = 0;
  const service = setup({
    propose: async (context) => {
      call += 1;
      if (call === 2) {
        assert.equal(context.priorQuestions.length, 1);
        assert.equal(context.priorQuestions[0].text, question.text);
        assert.equal(context.priorQuestions[0].ownerContent, 'For fun.');
      }
      return {
        intentNodes: [{
          type: 'Goal',
          statement: call === 1 ? 'Build a cat website' : 'Make it entertaining',
          sourceQuote: call === 1 ? 'Cat website' : 'For fun',
          normalizedInterpretation: call === 1 ? 'Build a cat website' : 'Make it entertaining',
          confidence: 0.8,
          status: 'proposed',
        }],
        corrections: [],
        questions: [call === 1 ? question : {
          ...question,
          text: "What should the website's primary purpose be?",
        }],
      };
    },
  });
  const discovered = await service.submitMessage('Cat website');
  const unresolvedIntent = structuredClone(discovered.intentGraph);
  const next = await service.resolveCurrentQuestion(
    discovered.currentQuestion.questionId,
    'answered',
    'For fun.',
    true,
  );
  assert.equal(next.currentQuestion, null);
  assert.equal(next.questionResolutions[0].questionText, question.text);
  assert.equal(next.questionResolutions[0].category, 'Outcome');
  assert.equal(next.intentGraph.nodes.find((node) => node.type === 'Question').status, 'confirmed');
  assert.equal(next.intentGraph.nodes.find((node) => node.type === 'Decision').statementOrName, 'For fun.');
  assert.deepEqual(
    [...new Set(next.intentGraph.edges.map((edge) => edge.type))].sort(),
    ['DECISION_RESOLVES', 'QUESTION_RESOLVES'],
  );
  const graphValidation = validateGraphSnapshots({
    snapshots: [next.intentGraph],
    currentSourceSnapshots: [unresolvedIntent],
    approvedBaselines: [],
  });
  assert.ok(graphValidation.issues.length > 0);
  assert.ok(graphValidation.issues.every(
    (issue) => issue.code === 'missing_intent_provenance'
      && issue.path.at(-1) === 'baselineMembership',
  ));
});

test('provider failure preserves message and leaves every graph unchanged', async () => {
  const service = setup({ propose: async () => { throw new Error('offline'); } });
  await assert.rejects(
    () => service.submitMessage('Keep this message'),
    (error) => error instanceof ProjectServiceError && error.code === 'provider_failed',
  );
  const state = service.state();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].content, 'Keep this message');
  assert.equal(state.intentGraph, null);
  assert.equal(state.solutionGraph, null);
  assert.equal(state.executionGraph, null);
});

test('repeated normalized requirements do not create duplicate Intent nodes', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Constraint',
      statement: 'Input text is not stored.',
      sourceQuote: 'Do not save text',
      normalizedInterpretation: 'Input text is not stored.',
      confidence: 0.89,
      status: 'inferred',
    }],
    corrections: [],
    questions: [],
  }));
  await service.submitMessage('Do not save text.');
  const state = await service.submitMessage('Still do not save text.');
  assert.equal(state.messages.length, 2);
  assert.equal(state.intentGraph.nodes.length, 1);
});

test('question resolution rejects wrong, stale, missing, and no-current actions without mutation', async () => {
  let questionNumber = 0;
  const service = setup({
    propose: async ({ message }) => {
      questionNumber += 1;
      return {
        intentNodes: [{
          type: 'Goal',
          statement: message.content,
          sourceQuote: message.content,
          normalizedInterpretation: message.content,
          confidence: 0.5,
          status: 'proposed',
        }],
        corrections: [],
        questions: [{
          text: `Material question ${questionNumber}?`,
          category: 'Scope',
          uncertaintyReduction: 5,
          implementationImpact: 5,
          driftRisk: 5,
          dependencyCount: 5,
          blocking: true,
        }],
      };
    },
  });
  const q1State = await service.submitMessage('make tool');
  const q1 = q1State.currentQuestion.questionId;
  service.resolveCurrentQuestion(q1, 'answered', 'First answer.');
  const q2State = await service.submitMessage('make it useful');
  const q2 = q2State.currentQuestion.questionId;
  assert.notEqual(q1, q2);

  for (const expectedId of [q1, 'wrong-question', undefined]) {
    const before = service.state();
    assert.throws(
      () => service.resolveCurrentQuestion(expectedId, 'answered', 'This must not land.'),
      (error) => error instanceof ProjectServiceError && error.code === 'wrong_state',
    );
    assert.deepEqual(service.state(), before);
  }

  service.resolveCurrentQuestion(q2, 'answered', 'This is the current answer.');
  const resolved = service.state();
  assert.throws(
    () => service.resolveCurrentQuestion(q2, 'deferred', 'Too late.'),
    (error) => error instanceof ProjectServiceError && error.code === 'wrong_state',
  );
  assert.deepEqual(service.state(), resolved);
});

test('authority-shaped provider output is rejected before graph mutation', async () => {
  const service = setup({
    propose: async () => ({
      intentNodes: [],
      corrections: [],
      questions: [],
      approvalId: 'made-by-model',
    }),
  });
  await assert.rejects(
    () => service.submitMessage('Approve yourself'),
    (error) => error instanceof ProjectServiceError && error.code === 'provider_failed',
  );
  const state = service.state();
  assert.equal(state.messages.length, 1);
  assert.equal(state.intentGraph, null);
  assert.equal(state.approvedBaselines.length, 0);
});

test('correction creates an append-only delta and a successor snapshot', async () => {
  const firstProvider = new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Store results',
      sourceQuote: 'save it',
      normalizedInterpretation: 'Persist results',
      confidence: 0.6,
      status: 'proposed',
    }],
    corrections: [],
    questions: [],
  });
  let currentProvider = firstProvider;
  const service = setup({ propose: (context) => currentProvider.propose(context) });
  const first = await service.submitMessage('save it');
  const stableId = first.intentGraph.nodes[0].stableId;
  currentProvider = new FixtureProposalProvider({
    intentNodes: [],
    corrections: [{
      targetStableId: stableId,
      statement: 'Do not store results',
      sourceQuote: 'No storage',
    }],
    questions: [],
  });
  const second = await service.submitMessage('No storage');
  assert.equal(second.corrections.length, 1);
  assert.equal(second.corrections[0].priorVersion, 1);
  assert.equal(second.corrections[0].nextVersion, 2);
  assert.equal(second.corrections[0].priorStatement, 'Store results');
  assert.equal(second.corrections[0].nextStatement, 'Do not store results');
  assert.equal(second.corrections[0].priorInterpretation, 'Persist results');
  assert.equal(second.corrections[0].nextInterpretation, 'Do not store results');
  assert.equal(second.intentGraph.parentSnapshotId, first.intentGraph.snapshotId);
  assert.equal(second.intentGraph.nodes[0].statementOrName, 'Do not store results');
});

test('unknown correction target preserves the message and exact graph revision', async () => {
  let currentProvider = new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Keep it',
      sourceQuote: 'keep it',
      normalizedInterpretation: 'Keep it',
      confidence: 0.5,
      status: 'proposed',
    }],
    corrections: [],
    questions: [],
  });
  const service = setup({ propose: (context) => currentProvider.propose(context) });
  const before = await service.submitMessage('keep it');
  currentProvider = new FixtureProposalProvider({
    intentNodes: [],
    corrections: [{
      targetStableId: 'missing-node',
      statement: 'Change it',
      sourceQuote: 'change it',
    }],
    questions: [],
  });
  await assert.rejects(
    () => service.submitMessage('change it'),
    (error) => error instanceof ProjectServiceError && error.code === 'invalid_trace',
  );
  const after = service.state();
  assert.equal(after.messages.length, 2);
  assert.equal(after.intentGraph.snapshotId, before.intentGraph.snapshotId);
  assert.equal(after.intentGraph.contentHash, before.intentGraph.contentHash);
  assert.equal(after.corrections.length, 0);
});

test('owner graph edits version nodes and persist explicit relationships', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Make a useful tool',
      sourceQuote: 'make tool',
      normalizedInterpretation: 'Make a useful tool',
      confidence: 0.6,
      status: 'proposed',
    }],
    corrections: [],
    questions: [],
  }));
  const discovered = await service.submitMessage('make tool');
  const goal = discovered.intentGraph.nodes[0];
  const added = service.editIntentGraph({
    action: 'add-node',
    type: 'Input',
    statement: 'Accept pasted text',
  });
  const input = added.intentGraph.nodes.find((node) => node.type === 'Input');
  assert.equal(input.status, 'confirmed');
  assert.equal(input.approvedByUser, true);
  const updated = service.editIntentGraph({
    action: 'update-node',
    nodeId: goal.id,
    type: 'Goal',
    statement: 'Make a focused text tool',
  });
  const changedGoal = updated.intentGraph.nodes.find((node) => node.stableId === goal.stableId);
  assert.equal(changedGoal.version, 2);
  assert.equal(changedGoal.status, 'confirmed');
  assert.equal(updated.corrections.length, 1);
  const connected = service.editIntentGraph({
    action: 'connect',
    sourceNodeId: changedGoal.id,
    targetNodeId: input.id,
    edgeType: 'DEPENDS_ON',
  });
  assert.equal(connected.intentGraph.edges.length, 1);
  assert.equal(connected.intentGraph.edges[0].sourceNodeRef.nodeId, changedGoal.id);
  assert.equal(connected.intentGraph.edges[0].targetNodeRef.nodeId, input.id);
  const removed = service.editIntentGraph({
    action: 'delete-edge',
    edgeId: connected.intentGraph.edges[0].id,
  });
  assert.equal(removed.intentGraph.edges.length, 0);
  assert.equal(removed.intentGraph.revision, discovered.intentGraph.revision + 4);
});

test('owner approval binds exact graph and projection, then proposals retain complete trace links', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [{
      type: 'Goal',
      statement: 'Analyze text',
      sourceQuote: 'analyze text',
      normalizedInterpretation: 'Analyze submitted text',
      confidence: 0.8,
      status: 'proposed',
    }, {
      type: 'UserType', statement: 'People with text to analyze', sourceQuote: 'analyze text',
      normalizedInterpretation: 'People with text to analyze', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Behavior', statement: 'Analyze submitted text', sourceQuote: 'analyze text',
      normalizedInterpretation: 'Perform analysis on submitted text', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Input', statement: 'Accept submitted text', sourceQuote: 'analyze text',
      normalizedInterpretation: 'Accept submitted text', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Output', statement: 'Show analysis', sourceQuote: 'analyze text',
      normalizedInterpretation: 'Show analysis', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Constraint', statement: 'Keep analysis deterministic', sourceQuote: 'analyze text',
      normalizedInterpretation: 'Keep analysis deterministic', confidence: 0.8, status: 'proposed',
    }, {
      type: 'SuccessCriterion', statement: 'Show a clear result', sourceQuote: 'analyze text',
      normalizedInterpretation: 'Show a clear result', confidence: 0.8, status: 'proposed',
    }, {
      type: 'Risk', statement: 'Avoid misleading results', sourceQuote: 'analyze text',
      normalizedInterpretation: 'Avoid misleading results', confidence: 0.8, status: 'proposed',
    }],
    corrections: [],
    questions: [{
      text: 'Must the analysis be deterministic?',
      category: 'Constraints',
      uncertaintyReduction: 5,
      implementationImpact: 5,
      driftRisk: 5,
      dependencyCount: 5,
      blocking: true,
    }],
  }));
  const discovered = await service.submitMessage('analyze text');
  assert.throws(() => service.createReviewProjection('intent'), /blocking question/);
  assert.notEqual(service.state().currentQuestion, null);
  const blockedApproval = {
    approvalId: 'approval-blocked',
    actorId: 'owner-one',
    actorKind: 'authenticated_project_owner',
    artifactType: 'intent_baseline',
    artifactId: 'intent-blocked',
    artifactVersion: 1,
    artifactContentHash: discovered.intentGraph.contentHash,
    displayedProjectionHash: discovered.intentGraph.contentHash,
    sourceMessageId: discovered.messages[0].messageId,
    sourceQuote: 'Approved',
    approvedAt: '2026-07-28T12:02:00Z',
    includedEdgeRefs: [],
    renderedDataHash: discovered.intentGraph.contentHash,
    generatedAt: '2026-07-28T12:02:00Z',
  };
  assert.throws(() => service.approve('intent', blockedApproval));
  const resolved = service.resolveCurrentQuestion(
    discovered.currentQuestion.questionId,
    'deferred',
    'Good enough for now. Build it.',
  );
  assert.equal(resolved.currentQuestion, null);
  assert.equal(resolved.questionResolutions.length, 1);
  assert.equal(resolved.questionResolutions[0].questionId, discovered.currentQuestion.questionId);
  assert.equal(resolved.questionResolutions[0].disposition, 'deferred');
  assert.equal(resolved.questionResolutions[0].ownerContent, 'Good enough for now. Build it.');
  assert.equal(
    resolved.questionResolutions[0].ownerMessageId,
    resolved.messages.at(-1).messageId,
  );
  const intentProjection = service.createReviewProjection('intent');
  const intentApproval = {
    approvalId: 'approval-intent',
    actorId: 'owner-one',
    actorKind: 'authenticated_project_owner',
    artifactType: 'intent_baseline',
    artifactId: 'intent-v1',
    artifactVersion: 1,
    artifactContentHash: resolved.intentGraph.contentHash,
    displayedProjectionHash: intentProjection.contentHash,
    sourceMessageId: discovered.messages[0].messageId,
    sourceQuote: 'Approved',
    approvedAt: '2026-07-28T12:02:00Z',
    includedEdgeRefs: [],
    renderedDataHash: intentProjection.contentHash,
    generatedAt: intentProjection.generatedAt,
  };
  service.approve('intent', intentApproval);
  assert.throws(
    () => service.approve('intent', intentApproval),
    (error) => error instanceof ProjectServiceError && error.code === 'invalid_approval',
  );
  const staleIntentState = structuredClone(service.state());
  staleIntentState.intentGraph.contentHash = hash('9');
  const staleIntentService = new ProjectService(
    staleIntentState,
    new FixtureProposalProvider(),
    { nextId: (kind) => `${kind}-stale`, now: () => '2026-07-28T12:03:00Z' },
  );
  const tracedIntentId = discovered.intentGraph.nodes[0].id;
  const solutionPlan = {
    features: [{
      key: 'text-analysis',
      name: 'Text analysis',
      intentNodeIds: [tracedIntentId],
    }],
    roles: [{
      key: 'language-tool-engineer',
      name: 'Language tool engineer',
      intentNodeIds: [tracedIntentId],
      job: 'Make the text analysis work.',
      use: ['Approved text needs.'],
      touch: ['Text analysis behavior.'],
      dont: ['Change the score meaning.'],
      done: ['Analysis behavior passes checks.'],
    }, {
      key: 'language-tool-reviewer',
      name: 'Language tool reviewer',
      intentNodeIds: [tracedIntentId],
      job: 'Check the text analysis.',
      use: ['Approved text needs and implementation.'],
      touch: ['Verification only.'],
      dont: ['Build what you check.'],
      done: ['Report pass or exact gap.'],
    }],
    assignments: [{
      featureKey: 'text-analysis',
      roleKey: 'language-tool-engineer',
      taskTypes: ['Decide', 'Implement'],
    }, {
      featureKey: 'text-analysis',
      roleKey: 'language-tool-reviewer',
      taskTypes: ['Verify'],
    }],
  };
  assert.throws(
    () => staleIntentService.proposeSolution(solutionPlan),
    (error) => error instanceof ProjectServiceError && error.code === 'missing_baseline',
  );

  assert.throws(
    () => service.proposeSolution({
      ...solutionPlan,
      roles: solutionPlan.roles.map((role) => ({ ...role, intentNodeIds: [] })),
    }),
  );
  const solution = service.proposeSolution(solutionPlan);
  assert.equal(solution.nodes.filter((node) => node.type === 'Role').length, 2);
  assert.equal(solution.edges[0].type, 'USES');
  assert.deepEqual(solution.edges[0].attributes.taskTypes, ['Decide', 'Implement']);
  assert.equal(solution.crossGraphLinks.length, solution.nodes.length);
  assert.equal(solution.crossGraphLinks[0].type, 'SATISFIES_INTENT');
  assert.equal(solution.crossGraphLinks[0].source.snapshotContentHash, solution.contentHash);

  const solutionProjection = service.createReviewProjection('solution');
  assert.throws(
    () => service.approve('solution', {
      ...intentApproval,
      approvalId: 'colliding-solution',
      artifactType: 'solution_baseline',
      artifactId: 'intent-v1',
      artifactContentHash: solution.contentHash,
      displayedProjectionHash: solutionProjection.contentHash,
      renderedDataHash: solutionProjection.contentHash,
    }),
    (error) => error instanceof ProjectServiceError && error.code === 'invalid_approval',
  );
  assert.throws(() => service.approve('solution', {
    ...intentApproval,
    approvalId: 'bad-solution',
    artifactType: 'solution_baseline',
    artifactId: 'solution-v1',
    artifactContentHash: hash('f'),
    displayedProjectionHash: solutionProjection.contentHash,
    renderedDataHash: solutionProjection.contentHash,
  }));
  service.approve('solution', {
    ...intentApproval,
    approvalId: 'approval-solution',
    artifactType: 'solution_baseline',
    artifactId: 'solution-v1',
    artifactContentHash: solution.contentHash,
    displayedProjectionHash: solutionProjection.contentHash,
    renderedDataHash: solutionProjection.contentHash,
  });
  assert.throws(
    () => service.approve('solution', {
      ...intentApproval,
      approvalId: 'replay-solution',
      artifactType: 'solution_baseline',
      artifactId: 'solution-v1',
      artifactContentHash: solution.contentHash,
      displayedProjectionHash: solutionProjection.contentHash,
      renderedDataHash: solutionProjection.contentHash,
    }),
    (error) => error instanceof ProjectServiceError && error.code === 'invalid_approval',
  );

  const execution = service.compileExecution();
  assert.equal(execution.nodes.length, 3);
  assert.deepEqual(execution.nodes.map((node) => node.type), ['Decide', 'Implement', 'Verify']);
  assert.equal(
    execution.nodes[0].statementOrName,
    'Decide — Language tool engineer: Text analysis',
  );
  assert.equal(
    execution.nodes[1].statementOrName,
    'Implement — Language tool engineer: Text analysis behavior',
  );
  assert.deepEqual(execution.nodes[0].attributes.acceptanceChecks, ['Analysis behavior passes checks.']);
  assert.deepEqual(execution.nodes[2].attributes.acceptanceChecks, ['Report pass or exact gap.']);
  assert.equal(
    execution.nodes[2].statementOrName,
    'Verify — Language tool reviewer: Text analysis',
  );
  const roleIds = new Set(solution.nodes.filter((candidate) => candidate.type === 'Role').map((node) => node.id));
  assert.ok(execution.nodes.every((node) => roleIds.has(node.attributes.roleRef)));
  assert.equal(execution.crossGraphLinks.length, execution.nodes.length * 2);
  assert.equal(execution.crossGraphLinks[0].source.snapshotContentHash, execution.contentHash);
  assert.deepEqual(
    new Set(execution.crossGraphLinks.map((link) => link.target.nodeId)),
    new Set(solution.nodes.map((node) => node.id)),
  );
  const staleSolutionState = structuredClone(service.state());
  staleSolutionState.solutionGraph.contentHash = hash('8');
  const staleSolutionService = new ProjectService(
    staleSolutionState,
    new FixtureProposalProvider(),
    { nextId: (kind) => `${kind}-stale`, now: () => '2026-07-28T12:04:00Z' },
  );
  assert.throws(
    () => staleSolutionService.compileExecution(),
    (error) => error instanceof ProjectServiceError && error.code === 'wrong_state',
  );
});

test('feature handoffs preserve sparse stage order from Solution through Execution', async () => {
  const service = setup(new FixtureProposalProvider({
    intentNodes: [
      ['Goal', 'Publish a dependable service'], ['UserType', 'Service operators'],
      ['Behavior', 'Operators publish a service'], ['Input', 'A service configuration'],
      ['Output', 'A published service'], ['Constraint', 'Keep publication traceable'],
      ['SuccessCriterion', 'Operators can verify publication'],
    ].map(([type, statement]) => ({
      type, statement, sourceQuote: 'Publish a dependable service', normalizedInterpretation: statement,
      confidence: 0.8, status: 'proposed',
    })),
    corrections: [], questions: [],
  }));
  const discovered = await service.submitMessage('Publish a dependable service.');
  const intentProjection = service.createReviewProjection('intent');
  service.approve('intent', {
    approvalId: 'topology-intent-approval', actorId: 'owner-one', actorKind: 'authenticated_project_owner',
    artifactType: 'intent_baseline', artifactId: 'topology-intent-v1', artifactVersion: 1,
    artifactContentHash: discovered.intentGraph.contentHash, displayedProjectionHash: intentProjection.contentHash,
    sourceMessageId: discovered.messages[0].messageId, sourceQuote: 'Approved',
    approvedAt: '2026-07-28T12:02:00Z', includedEdgeRefs: [], renderedDataHash: intentProjection.contentHash,
    generatedAt: intentProjection.generatedAt,
  });
  const intentNodeId = discovered.intentGraph.nodes.find((node) => node.type === 'Goal').id;
  const role = (key, name, job) => ({
    key, name, intentNodeIds: [intentNodeId], job, use: ['Approved publication intent.'],
    touch: ['The scoped publication work.'], dont: ['Change approved intent.'],
    done: [`${name} work is complete.`],
  });
  const handoff = {
    key: 'published-service-contract', type: 'api-contract',
    description: 'The published service contract consumed by release work.',
    paths: ['packages/contracts/src/published-service.ts'],
    requiredEvidence: ['file_hash', 'independent_check'],
  };
  const plan = {
    features: [
      { key: 'foundation', name: 'Publication foundation', intentNodeIds: [intentNodeId] },
      { key: 'release', name: 'Release workflow', intentNodeIds: [intentNodeId] },
    ],
    roles: [
      role('foundation-engineer', 'Foundation engineer', 'Build the foundation.'),
      role('foundation-reviewer', 'Foundation reviewer', 'Independently verify the foundation.'),
      role('release-engineer', 'Release engineer', 'Build the release workflow.'),
      role('release-reviewer', 'Release reviewer', 'Independently verify the release workflow.'),
    ],
    assignments: [
      { featureKey: 'foundation', roleKey: 'foundation-engineer', taskTypes: ['Inspect', 'Implement', 'Test', 'Integrate', 'Document'] },
      { featureKey: 'foundation', roleKey: 'foundation-reviewer', taskTypes: ['Verify'] },
      { featureKey: 'release', roleKey: 'release-engineer', taskTypes: ['Implement', 'Test', 'Release'] },
      { featureKey: 'release', roleKey: 'release-reviewer', taskTypes: ['Verify'] },
    ],
    dependencies: [{ featureKey: 'release', dependsOnFeatureKey: 'foundation', artifacts: [handoff] }],
  };
  assert.throws(
    () => service.proposeSolution({
      ...plan,
      dependencies: [...plan.dependencies, {
        featureKey: 'foundation', dependsOnFeatureKey: 'release', artifacts: [handoff],
      }],
    }),
    (error) => error instanceof ProjectServiceError
      && error.code === 'invalid_trace' && /acyclic/.test(error.message),
  );
  const solution = service.proposeSolution(plan, 'topology-solution-v1');
  const foundation = solution.nodes.find((node) => node.statementOrName === 'Publication foundation');
  const release = solution.nodes.find((node) => node.statementOrName === 'Release workflow');
  const solutionHandoff = solution.edges.find((edge) => edge.type === 'DEPENDS_ON');
  assert.equal(solutionHandoff.sourceNodeRef.nodeId, release.id);
  assert.equal(solutionHandoff.targetNodeRef.nodeId, foundation.id);
  assert.deepEqual(solutionHandoff.attributes, { kind: 'feature_handoff', artifacts: [handoff] });

  const solutionProjection = service.createReviewProjection('solution');
  service.approve('solution', {
    approvalId: 'topology-solution-approval', actorId: 'owner-one', actorKind: 'authenticated_project_owner',
    artifactType: 'solution_baseline', artifactId: 'topology-solution-v1', artifactVersion: 1,
    artifactContentHash: solution.contentHash, displayedProjectionHash: solutionProjection.contentHash,
    sourceMessageId: discovered.messages[0].messageId, sourceQuote: 'Approved',
    approvedAt: '2026-07-28T12:03:00Z', includedEdgeRefs: [], renderedDataHash: solutionProjection.contentHash,
    generatedAt: solutionProjection.generatedAt,
  });
  const execution = service.compileExecution();
  const tasksFor = (feature) => execution.nodes.filter((node) => node.attributes.solutionNodeId === feature.id);
  const foundationTasks = tasksFor(foundation);
  const releaseTasks = tasksFor(release);
  assert.deepEqual(foundationTasks.map((node) => node.type), ['Inspect', 'Implement', 'Test', 'Integrate', 'Document', 'Verify']);
  assert.deepEqual(releaseTasks.map((node) => node.type), ['Implement', 'Test', 'Release', 'Verify']);
  assert.ok(execution.nodes.every((node) => node.type !== 'Decide'));
  assert.deepEqual(foundationTasks.find((node) => node.type === 'Test').attributes.allowedPaths, ['tests/**']);
  const orderedFoundationEdges = execution.edges.filter((edge) =>
    edge.attributes.kind !== 'feature_handoff'
    && foundationTasks.some((task) => task.id === edge.sourceNodeRef.nodeId));
  assert.deepEqual(
    orderedFoundationEdges.map((edge) => [
      execution.nodes.find((node) => node.id === edge.sourceNodeRef.nodeId).type,
      execution.nodes.find((node) => node.id === edge.targetNodeRef.nodeId).type,
    ]),
    [['Implement', 'Inspect'], ['Test', 'Implement'], ['Integrate', 'Test'], ['Document', 'Integrate'], ['Verify', 'Document']],
  );
  const executionHandoff = execution.edges.find((edge) => edge.attributes.kind === 'feature_handoff');
  const dependentEntry = execution.nodes.find((node) => node.id === executionHandoff.sourceNodeRef.nodeId);
  const prerequisiteTerminal = execution.nodes.find((node) => node.id === executionHandoff.targetNodeRef.nodeId);
  assert.equal(dependentEntry.type, 'Implement');
  assert.equal(dependentEntry.attributes.solutionNodeId, release.id);
  assert.equal(prerequisiteTerminal.type, 'Verify');
  assert.equal(prerequisiteTerminal.attributes.solutionNodeId, foundation.id);
  assert.deepEqual(executionHandoff.attributes, { kind: 'feature_handoff', artifacts: [handoff] });
  assert.deepEqual(dependentEntry.attributes.requiresArtifacts, [handoff]);
  assert.deepEqual(prerequisiteTerminal.attributes.producesArtifacts, [handoff]);
  assert.equal(new Set(execution.edges.map((edge) => `${edge.sourceNodeRef.nodeId}:${edge.targetNodeRef.nodeId}`)).size, execution.edges.length);
  assert.ok(execution.edges.every((edge) =>
    edge.sourceNodeRef.snapshotContentHash === execution.contentHash
    && edge.targetNodeRef.snapshotContentHash === execution.contentHash));
  assert.ok(execution.crossGraphLinks.every((link) => link.source.snapshotContentHash === execution.contentHash));
});
