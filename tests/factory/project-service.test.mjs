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
  const blockedProjection = service.createReviewProjection('intent');
  assert.notEqual(service.state().currentQuestion, null);
  const blockedApproval = {
    approvalId: 'approval-blocked',
    actorId: 'owner-one',
    actorKind: 'authenticated_project_owner',
    artifactType: 'intent_baseline',
    artifactId: 'intent-blocked',
    artifactVersion: 1,
    artifactContentHash: discovered.intentGraph.contentHash,
    displayedProjectionHash: blockedProjection.contentHash,
    sourceMessageId: discovered.messages[0].messageId,
    sourceQuote: 'Approved',
    approvedAt: '2026-07-28T12:02:00Z',
    includedEdgeRefs: [],
    renderedDataHash: blockedProjection.contentHash,
    generatedAt: blockedProjection.generatedAt,
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
