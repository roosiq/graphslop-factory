import { asRecord, display, graphNodes, type AnyRecord } from './model.js';

export function unresolvedQuestionNodes(project: AnyRecord) {
  return graphNodes(project, 'intent').filter((node) =>
    node.type === 'Question'
    && !['confirmed', 'rejected', 'superseded', 'deferred'].includes(String(node.status)),
  );
}

export function nextProjectQuestion(project: AnyRecord) {
  const active = asRecord(project.currentQuestion);
  if (active.questionId) return { ...active, source: 'active' as const };
  const node = unresolvedQuestionNodes(project).at(-1);
  return node ? {
    questionId: node.id,
    text: display(node.statementOrName),
    category: display(node.attributes?.category, 'project decision'),
    source: 'graph' as const,
  } : null;
}
