import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('ProjectWorkbench', () => {
  it('isolates projects and serializes model-backed graph writes', async () => {
    const first = env.PROJECTS.getByName(`first-${crypto.randomUUID()}`);
    const second = env.PROJECTS.getByName(`second-${crypto.randomUUID()}`);
    const createdAt = '2026-07-29T12:00:00.000Z';
    const firstView = JSON.parse(await first.create({
      projectId: `project-${crypto.randomUUID()}`,
      displayName: 'First project',
      actorId: `user-${crypto.randomUUID()}`,
      createdAt,
    }));
    const secondView = JSON.parse(await second.create({
      projectId: `project-${crypto.randomUUID()}`,
      displayName: 'Second project',
      actorId: `user-${crypto.randomUUID()}`,
      createdAt,
    }));

    expect(firstView.state.project.displayName).toBe('First project');
    expect(secondView.state.project.displayName).toBe('Second project');
    expect(firstView.state.project.projectId).not.toBe(secondView.state.project.projectId);

    const actorId = `user-${crypto.randomUUID()}`;
    const queued = await first.createModelJob({
      actorId,
      role: 'owner',
      expectedRevision: 1,
      command: 'submit-message',
      input: { content: 'Need app. Paste text. Show score.' },
    });
    expect(queued.job.status).toBe('queued');

    const revision = await first.completeModelJob(queued.job.jobId, {
      intentNodes: [{
        type: 'Goal',
        statement: 'Score pasted text',
        sourceQuote: 'Paste text. Show score.',
        normalizedInterpretation: 'Score pasted text',
        confidence: 0.8,
        status: 'proposed',
      }],
      corrections: [],
      questions: [],
    });
    expect(revision).toBe(2);

    const updated = JSON.parse(await first.read());
    expect(updated.state.intentGraph.nodes[0].statementOrName).toBe('Score pasted text');
    expect(updated.revision).toBe(2);
    expect(updated.pendingJob).toBeNull();

    const reviewed = JSON.parse(await first.command({
      actorId,
      role: 'owner',
      expectedRevision: 2,
      command: 'review-intent',
      input: {},
    }));
    const projection = reviewed.state.projections.at(-1);
    const intent = reviewed.state.intentGraph;
    const approved = JSON.parse(await first.command({
      actorId,
      role: 'owner',
      expectedRevision: 3,
      command: 'approve-intent',
      input: {
        approvalId: 'approval-intent',
        actorId,
        actorKind: 'authenticated_project_owner',
        artifactType: 'intent_baseline',
        artifactId: 'intent-v1',
        artifactVersion: 1,
        artifactContentHash: intent.contentHash,
        displayedProjectionHash: projection.contentHash,
        sourceMessageId: updated.state.messages[0].messageId,
        sourceQuote: 'Approved',
        approvedAt: '2026-07-29T12:01:00.000Z',
        includedEdgeRefs: [],
        renderedDataHash: projection.contentHash,
        generatedAt: projection.generatedAt,
      },
    }));
    const solutionJob = await first.createModelJob({
      actorId,
      role: 'owner',
      expectedRevision: approved.revision,
      command: 'propose-solution',
      input: {},
    });
    const detail = await first.modelJob(solutionJob.job.jobId);
    expect(detail?.solutionContext?.intentNodes[0].statement).toBe('Score pasted text');
    await first.completeModelJob(solutionJob.job.jobId, {
      features: [{
        key: 'score-text',
        name: 'Score pasted text',
        intentNodeIds: [intent.nodes[0].id],
      }],
      roles: [{
        key: 'scoring-engineer',
        name: 'Scoring engineer',
        intentNodeIds: [intent.nodes[0].id],
        job: 'Make scoring work.',
        use: ['Approved scoring need.'],
        touch: ['Scoring feature.'],
        dont: ['Change score meaning.'],
        done: ['Scoring checks pass.'],
      }, {
        key: 'scoring-reviewer',
        name: 'Scoring reviewer',
        intentNodeIds: [intent.nodes[0].id],
        job: 'Check scoring.',
        use: ['Approved scoring need and result.'],
        touch: ['Verification only.'],
        dont: ['Build scoring.'],
        done: ['Report pass or gap.'],
      }],
      assignments: [{
        featureKey: 'score-text',
        roleKey: 'scoring-engineer',
        taskTypes: ['Decide', 'Implement'],
      }, {
        featureKey: 'score-text',
        roleKey: 'scoring-reviewer',
        taskTypes: ['Verify'],
      }],
    });
    const planned = JSON.parse(await first.read());
    expect(planned.state.solutionGraph.nodes.filter((node: { type: string }) => node.type === 'Role')).toHaveLength(2);
    expect(planned.state.solutionGraph.edges[0].type).toBe('USES');
  });
});
