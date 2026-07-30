import {
  GraphBaselineRefSchema,
  GraphSnapshotSchema,
  graphMetamodelRegistry,
  isCompatibleEdgeEndpoint,
  isKnownNodeType,
  IntentNodeStatusSchema,
  type CrossGraphLink,
  type GraphBaselineRef,
  type GraphNode,
  type GraphSnapshot,
  type NodeRef,
  type ValidationIssue,
  type ValidationPathSegment,
  type ValidationReport,
} from '@graphslop/contracts';

import { hashGraphSnapshot } from './hash.js';

/** Exact current snapshots and approved baselines used for pure validation. */
export type GraphValidationInput = {
  readonly snapshots: readonly unknown[];
  readonly approvedBaselines: readonly unknown[];
  readonly currentSourceSnapshots?: readonly unknown[];
};

type ParsedSnapshot = {
  readonly snapshot: GraphSnapshot;
  readonly path: readonly ValidationPathSegment[];
};

type ParsedBaseline = {
  readonly baseline: GraphBaselineRef;
  readonly path: readonly ValidationPathSegment[];
};

const reportSchemaVersion = '1.0.0' as const;
const intentProvenanceFields = [
  'sourceQuote',
  'originalInterpretation',
  'normalizedInterpretation',
  'confidence',
  'approvedByUser',
  'baselineMembership',
] as const;

function issue(
  code: string,
  message: string,
  path: readonly ValidationPathSegment[],
): ValidationIssue {
  return { code, message, path: [...path] };
}

function report(issues: readonly ValidationIssue[]): ValidationReport {
  return issues.length === 0
    ? { schemaVersion: reportSchemaVersion, valid: true, issues: [] }
    : { schemaVersion: reportSchemaVersion, valid: false, issues: [...issues] };
}

function zodIssues(
  code: string,
  prefix: readonly ValidationPathSegment[],
  error: { issues: readonly { message: string; path: readonly PropertyKey[] }[] },
): ValidationIssue[] {
  return error.issues.map((entry) =>
    issue(
      code,
      entry.message,
      [...prefix, ...entry.path.filter((part): part is ValidationPathSegment =>
        typeof part === 'string' || typeof part === 'number',
      )],
    ),
  );
}

function snapshotKey(snapshot: Pick<GraphSnapshot, 'graphKind' | 'graphId' | 'snapshotId' | 'contentHash'>): string {
  return `${snapshot.graphKind}\u0000${snapshot.graphId}\u0000${snapshot.snapshotId}\u0000${snapshot.contentHash}`;
}

function graphKey(graphKind: string, graphId: string): string {
  return `${graphKind}\u0000${graphId}`;
}

function parseSnapshots(
  values: readonly unknown[],
  prefix: string,
  issues: ValidationIssue[],
): ParsedSnapshot[] {
  const parsed: ParsedSnapshot[] = [];
  values.forEach((value, index) => {
    const result = GraphSnapshotSchema.safeParse(value);
    if (!result.success) {
      issues.push(...zodIssues('invalid_graph_snapshot', [prefix, index], result.error));
      return;
    }
    parsed.push({ snapshot: result.data, path: [prefix, index] });
  });
  return parsed;
}

function parseBaselines(values: readonly unknown[], issues: ValidationIssue[]): ParsedBaseline[] {
  const parsed: ParsedBaseline[] = [];
  values.forEach((value, index) => {
    const result = GraphBaselineRefSchema.safeParse(value);
    if (!result.success) {
      issues.push(...zodIssues('invalid_approved_baseline', ['approvedBaselines', index], result.error));
      return;
    }
    parsed.push({ baseline: result.data, path: ['approvedBaselines', index] });
  });
  return parsed;
}

function resolveNodeRef(
  ref: NodeRef,
  snapshots: ReadonlyMap<string, GraphSnapshot>,
  path: readonly ValidationPathSegment[],
  issues: ValidationIssue[],
): { readonly snapshot: GraphSnapshot; readonly node: GraphNode } | undefined {
  const exact = snapshots.get(snapshotKey({
    graphKind: ref.graphKind as GraphSnapshot['graphKind'],
    graphId: ref.graphId,
    snapshotId: ref.snapshotId,
    contentHash: ref.snapshotContentHash,
  }));

  if (!exact) {
    const sameSnapshot = [...snapshots.values()].find(
      (snapshot) =>
        snapshot.graphKind === ref.graphKind &&
        snapshot.graphId === ref.graphId &&
        snapshot.snapshotId === ref.snapshotId,
    );
    const sameGraph = [...snapshots.values()].find(
      (snapshot) => snapshot.graphKind === ref.graphKind && snapshot.graphId === ref.graphId,
    );
    issues.push(
      issue(
        sameSnapshot ? 'stale_snapshot_hash' : sameGraph ? 'stale_snapshot_ref' : 'dangling_snapshot_ref',
        sameSnapshot
          ? 'The node reference content hash does not match the named snapshot.'
          : sameGraph
            ? 'The node reference names a stale or unknown snapshot.'
            : 'The node reference names a graph snapshot that was not supplied.',
        path,
      ),
    );
    return undefined;
  }

  const node = exact.nodes.find((candidate) => candidate.id === ref.nodeId);
  if (!node) {
    issues.push(issue('dangling_node_ref', 'The node reference does not resolve in its snapshot.', path));
    return undefined;
  }
  if (node.version !== ref.nodeVersion) {
    issues.push(
      issue('stale_node_version', 'The node reference does not name the retained node version.', path),
    );
    return undefined;
  }
  return { snapshot: exact, node };
}

function validateSnapshotShape(snapshot: GraphSnapshot, path: readonly ValidationPathSegment[], issues: ValidationIssue[]): void {
  const hasParentId = snapshot.parentSnapshotId !== null;
  const hasParentHash = snapshot.parentSnapshotContentHash !== null;
  if (snapshot.revision === 1 && (hasParentId || hasParentHash)) {
    issues.push(
      issue(
        'invalid_parent_snapshot',
        'Revision 1 requires null parent snapshot ID and content hash.',
        [...path, 'parentSnapshotId'],
      ),
    );
  }
  if (snapshot.revision > 1 && (!hasParentId || !hasParentHash)) {
    issues.push(
      issue(
        'invalid_parent_snapshot',
        'Later revisions require both a parent snapshot ID and content hash.',
        [...path, hasParentId ? 'parentSnapshotContentHash' : 'parentSnapshotId'],
      ),
    );
  }

  const nodeIds = new Set<string>();
  const stableVersions = new Set<string>();
  snapshot.nodes.forEach((node, nodeIndex) => {
    const nodePath = [...path, 'nodes', nodeIndex] as const;
    if (nodeIds.has(node.id)) {
      issues.push(issue('duplicate_node_id', 'Node IDs must be unique within a snapshot.', [...nodePath, 'id']));
    }
    nodeIds.add(node.id);
    const stableVersion = `${node.stableId}\u0000${node.version}`;
    if (stableVersions.has(stableVersion)) {
      issues.push(
        issue(
          'duplicate_node_version',
          'Stable node ID and version pairs must be unique within a snapshot.',
          [...nodePath, 'stableId'],
        ),
      );
    }
    stableVersions.add(stableVersion);
    if (!isKnownNodeType(snapshot.graphKind, node.type)) {
      issues.push(
        issue('unknown_node_type', `Unknown ${snapshot.graphKind} node type: ${node.type}.`, [...nodePath, 'type']),
      );
    }
    if (snapshot.graphKind === 'intent') {
      for (const field of intentProvenanceFields) {
        if (node[field] === undefined) {
          issues.push(
            issue('missing_intent_provenance', `Intent nodes require ${field}.`, [...nodePath, field]),
          );
        }
      }
      if (node.sourceRefs.length === 0) {
        issues.push(
          issue('missing_intent_source_ref', 'Intent nodes require a source message reference.', [...nodePath, 'sourceRefs']),
        );
      }
      if (!IntentNodeStatusSchema.safeParse(node.status).success) {
        issues.push(
          issue('invalid_intent_status', `Unknown Intent node status: ${node.status}.`, [...nodePath, 'status']),
        );
      }
    } else {
      const intentOnlyField = intentProvenanceFields.find((field) => node[field] !== undefined);
      if (intentOnlyField) {
        issues.push(
          issue(
            'non_intent_provenance',
            'Only Intent nodes may declare Intent provenance fields.',
            [...nodePath, intentOnlyField],
          ),
        );
      }
    }
    if (snapshot.graphKind !== 'solution' && (node.scope !== undefined || node.supports !== undefined)) {
      issues.push(
        issue(
          'non_solution_scope',
          'Only Solution nodes may declare scope or supports references.',
          node.scope !== undefined ? [...nodePath, 'scope'] : [...nodePath, 'supports'],
        ),
      );
    }
  });

  const edgeIds = new Set<string>();
  snapshot.edges.forEach((edge, edgeIndex) => {
    if (edgeIds.has(edge.id)) {
      issues.push(
        issue('duplicate_edge_id', 'Edge IDs must be unique within a snapshot.', [...path, 'edges', edgeIndex, 'id']),
      );
    }
    edgeIds.add(edge.id);
  });

  const linkIds = new Set<string>();
  snapshot.crossGraphLinks.forEach((link, linkIndex) => {
    if (linkIds.has(link.id)) {
      issues.push(
        issue(
          'duplicate_cross_graph_link_id',
          'Cross-graph link IDs must be unique within a snapshot.',
          [...path, 'crossGraphLinks', linkIndex, 'id'],
        ),
      );
    }
    linkIds.add(link.id);
  });
}

function validateParentLineage(
  snapshot: GraphSnapshot,
  path: readonly ValidationPathSegment[],
  allSnapshots: ReadonlyMap<string, GraphSnapshot>,
  issues: ValidationIssue[],
): void {
  if (snapshot.revision === 1 || snapshot.parentSnapshotId === null || snapshot.parentSnapshotContentHash === null) {
    return;
  }
  const parent = allSnapshots.get(snapshotKey({
    graphKind: snapshot.graphKind,
    graphId: snapshot.graphId,
    snapshotId: snapshot.parentSnapshotId,
    contentHash: snapshot.parentSnapshotContentHash,
  }));
  if (!parent) {
    issues.push(
      issue(
        'invalid_parent_snapshot',
        'The exact parent snapshot must be supplied for a later revision.',
        [...path, 'parentSnapshotId'],
      ),
    );
    return;
  }
  if (parent.revision !== snapshot.revision - 1) {
    issues.push(
      issue(
        'invalid_parent_revision',
        'The parent snapshot revision must be exactly one less than the current revision.',
        [...path, 'parentSnapshotId'],
      ),
    );
  }
}

function validateLocalReference(
  ref: NodeRef,
  snapshot: GraphSnapshot,
  path: readonly ValidationPathSegment[],
  issues: ValidationIssue[],
): GraphNode | undefined {
  if (ref.graphKind !== snapshot.graphKind || ref.graphId !== snapshot.graphId) {
    issues.push(issue('wrong_graph_ref', 'The reference must name the current graph.', path));
    return undefined;
  }
  if (ref.snapshotId !== snapshot.snapshotId) {
    issues.push(issue('stale_snapshot_ref', 'The reference must name the current snapshot.', path));
    return undefined;
  }
  if (ref.snapshotContentHash !== snapshot.contentHash) {
    issues.push(issue('stale_snapshot_hash', 'The reference must name the current snapshot hash.', path));
    return undefined;
  }
  const node = snapshot.nodes.find((candidate) => candidate.id === ref.nodeId);
  if (!node) {
    issues.push(issue('dangling_node_ref', 'The reference does not resolve to a node.', path));
    return undefined;
  }
  if (node.version !== ref.nodeVersion) {
    issues.push(issue('stale_node_version', 'The reference does not name the node version.', path));
    return undefined;
  }
  return node;
}

function validateEdges(snapshot: GraphSnapshot, path: readonly ValidationPathSegment[], issues: ValidationIssue[]): void {
  snapshot.edges.forEach((edge, edgeIndex) => {
    const edgePath = [...path, 'edges', edgeIndex] as const;
    const source = validateLocalReference(edge.sourceNodeRef, snapshot, [...edgePath, 'sourceNodeRef'], issues);
    const target = validateLocalReference(edge.targetNodeRef, snapshot, [...edgePath, 'targetNodeRef'], issues);
    if (!Object.hasOwn(graphMetamodelRegistry.graphs[snapshot.graphKind].edgeTypes, edge.type)) {
      issues.push(
        issue('unknown_edge_type', `Unknown ${snapshot.graphKind} edge type: ${edge.type}.`, [...edgePath, 'type']),
      );
      return;
    }
    if (source && target && !isCompatibleEdgeEndpoint(snapshot.graphKind, edge.type, source.type, target.type)) {
      issues.push(
        issue(
          'invalid_edge_endpoints',
          `${edge.type} cannot connect ${source.type} to ${target.type}.`,
          [...edgePath, 'type'],
        ),
      );
    }
  });
}

function validateBaselineTarget(
  link: CrossGraphLink,
  linkPath: readonly ValidationPathSegment[],
  baselines: ReadonlyMap<string, GraphBaselineRef>,
  issues: ValidationIssue[],
): void {
  const baseline = baselines.get(graphKey(link.target.graphKind, link.target.graphId));
  if (!baseline) {
    issues.push(
      issue(
        'missing_approved_baseline',
        'A cross-graph target must have an exact approved baseline reference.',
        [...linkPath, 'targetBaselineId'],
      ),
    );
    return;
  }
  if (link.targetBaselineId !== baseline.baselineId) {
    issues.push(issue('stale_target_baseline', 'The target baseline ID is stale.', [...linkPath, 'targetBaselineId']));
  }
  if (link.target.snapshotId !== baseline.snapshotId || link.target.snapshotContentHash !== baseline.snapshotContentHash) {
    issues.push(
      issue(
        'stale_target_snapshot',
        'The target reference must bind the exact approved baseline snapshot and hash.',
        [...linkPath, 'target'],
      ),
    );
  }
}

function validateBaselineSource(
  snapshot: GraphSnapshot,
  link: CrossGraphLink,
  linkPath: readonly ValidationPathSegment[],
  baselines: ReadonlyMap<string, GraphBaselineRef>,
  issues: ValidationIssue[],
): void {
  const baseline = baselines.get(graphKey(snapshot.graphKind, snapshot.graphId));
  if (!baseline) {
    issues.push(
      issue(
        'missing_approved_source_baseline',
        'A cross-graph source must have an exact supplied approved baseline reference.',
        [...linkPath, 'sourceBaselineId'],
      ),
    );
    return;
  }
  if (link.sourceBaselineId !== baseline.baselineId) {
    issues.push(issue('stale_source_baseline', 'The source baseline ID is stale.', [...linkPath, 'sourceBaselineId']));
  }
  if (link.source.snapshotId !== baseline.snapshotId || link.source.snapshotContentHash !== baseline.snapshotContentHash) {
    issues.push(
      issue(
        'stale_source_snapshot',
        'The source reference must bind the exact approved baseline snapshot and hash.',
        [...linkPath, 'source'],
      ),
    );
  }
}

function validateCrossGraphLinks(
  snapshot: GraphSnapshot,
  path: readonly ValidationPathSegment[],
  allSnapshots: ReadonlyMap<string, GraphSnapshot>,
  baselines: ReadonlyMap<string, GraphBaselineRef>,
  issues: ValidationIssue[],
): void {
  snapshot.crossGraphLinks.forEach((link, linkIndex) => {
    const linkPath = [...path, 'crossGraphLinks', linkIndex] as const;
    const source = validateLocalReference(link.source, snapshot, [...linkPath, 'source'], issues);
    const target = resolveNodeRef(link.target, allSnapshots, [...linkPath, 'target'], issues);
    const expected = link.type === 'SATISFIES_INTENT'
      ? { sourceGraphKind: 'solution', targetGraphKind: 'intent' }
      : { sourceGraphKind: 'execution', targetGraphKind: 'solution' };
    if (snapshot.graphKind !== expected.sourceGraphKind || link.source.graphKind !== expected.sourceGraphKind) {
      issues.push(
        issue('wrong_link_direction', `${link.type} has an invalid source graph kind.`, [...linkPath, 'source']),
      );
    }
    if (link.target.graphKind !== expected.targetGraphKind) {
      issues.push(
        issue('wrong_link_target_type', `${link.type} has an invalid target graph kind.`, [...linkPath, 'target']),
      );
    }
    if (source && target && target.snapshot.graphKind !== expected.targetGraphKind) {
      issues.push(
        issue('wrong_link_target_type', `${link.type} resolves to an invalid target graph kind.`, [...linkPath, 'target']),
      );
    }
    validateBaselineTarget(link, linkPath, baselines, issues);

    validateBaselineSource(snapshot, link, linkPath, baselines, issues);
  });
}

function validateTraceClosure(snapshot: GraphSnapshot, path: readonly ValidationPathSegment[], issues: ValidationIssue[]): void {
  if (snapshot.graphKind === 'solution') {
    snapshot.nodes.forEach((node, nodeIndex) => {
      const nodePath = [...path, 'nodes', nodeIndex] as const;
      const linksFromNode = snapshot.crossGraphLinks.filter((link) => link.source.nodeId === node.id);
      if (node.scope === undefined) {
        issues.push(issue('missing_solution_scope', 'Every Solution node must declare scope.', [...nodePath, 'scope']));
        return;
      }
      if (node.scope === 'product') {
        if (!linksFromNode.some((link) => link.type === 'SATISFIES_INTENT')) {
          issues.push(
            issue('missing_intent_trace', 'A product Solution node requires a SATISFIES_INTENT link.', nodePath),
          );
        }
        if (node.supports !== undefined) {
          issues.push(
            issue('product_node_supports', 'A product Solution node may not use support-only references.', [...nodePath, 'supports']),
          );
        }
      } else {
        if (!node.supports || node.supports.length === 0) {
          issues.push(
            issue('missing_supports_trace', 'An implementation-support node requires an internal supports reference.', [...nodePath, 'supports']),
          );
        } else {
          node.supports.forEach((support, supportIndex) => {
            validateLocalReference(support, snapshot, [...nodePath, 'supports', supportIndex], issues);
          });
        }
      }
    });
  }

  if (snapshot.graphKind === 'execution') {
    snapshot.nodes.forEach((node, nodeIndex) => {
      if (!snapshot.crossGraphLinks.some(
        (link) => link.type === 'SATISFIES_SOLUTION' && link.source.nodeId === node.id,
      )) {
        issues.push(
          issue(
            'missing_solution_trace',
            'Every Execution task requires a SATISFIES_SOLUTION link.',
            [...path, 'nodes', nodeIndex],
          ),
        );
      }
    });
  }
}

function validateSnapshotSemantics(
  snapshot: GraphSnapshot,
  path: readonly ValidationPathSegment[],
  allSnapshots: ReadonlyMap<string, GraphSnapshot>,
  baselines: ReadonlyMap<string, GraphBaselineRef>,
  issues: ValidationIssue[],
): void {
  validateSnapshotShape(snapshot, path, issues);
  validateParentLineage(snapshot, path, allSnapshots, issues);
  validateEdges(snapshot, path, issues);
  validateCrossGraphLinks(snapshot, path, allSnapshots, baselines, issues);
  validateTraceClosure(snapshot, path, issues);
}

/**
 * Pure, fail-closed validation of authoritative graph snapshots. It performs
 * canonical hash verification but no persistence, lifecycle, scheduling, or mutation.
 */
export function validateGraphSnapshots(input: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return report([issue('invalid_validation_input', 'Validation input must be an object.', [])]);
  }
  const candidate = input as Partial<GraphValidationInput>;
  if (!Array.isArray(candidate.snapshots)) {
    return report([issue('invalid_validation_input', 'snapshots must be an array.', ['snapshots'])]);
  }
  if (!Array.isArray(candidate.approvedBaselines)) {
    return report([issue('invalid_validation_input', 'approvedBaselines must be an array.', ['approvedBaselines'])]);
  }
  if (candidate.currentSourceSnapshots !== undefined && !Array.isArray(candidate.currentSourceSnapshots)) {
    return report([
      issue('invalid_validation_input', 'currentSourceSnapshots must be an array.', ['currentSourceSnapshots']),
    ]);
  }

  const activeSnapshots = parseSnapshots(candidate.snapshots, 'snapshots', issues);
  const sourceSnapshots = parseSnapshots(candidate.currentSourceSnapshots ?? [], 'currentSourceSnapshots', issues);
  const parsedBaselines = parseBaselines(candidate.approvedBaselines, issues);

  const allSnapshots = new Map<string, GraphSnapshot>();
  const activeSnapshotKeys = new Set<string>();
  const activeGraphKinds = new Set<string>();
  activeSnapshots.forEach(({ snapshot, path }) => {
    const key = snapshotKey(snapshot);
    if (allSnapshots.has(key)) {
      issues.push(issue('duplicate_snapshot', 'Snapshot identity is duplicated.', path));
    }
    if (activeGraphKinds.has(snapshot.graphKind)) {
      issues.push(issue('duplicate_graph_kind', 'Only one current snapshot per graph kind may be validated.', path));
    }
    activeGraphKinds.add(snapshot.graphKind);
    activeSnapshotKeys.add(key);
    allSnapshots.set(key, snapshot);
  });
  const sourceSnapshotsToValidate: ParsedSnapshot[] = [];
  sourceSnapshots.forEach((parsed) => {
    const { snapshot, path } = parsed;
    const key = snapshotKey(snapshot);
    if (activeSnapshotKeys.has(key)) {
      return;
    }
    if (allSnapshots.has(key)) {
      issues.push(issue('duplicate_snapshot', 'Snapshot identity is duplicated.', path));
      return;
    }
    allSnapshots.set(key, snapshot);
    sourceSnapshotsToValidate.push(parsed);
  });

  const baselines = new Map<string, GraphBaselineRef>();
  parsedBaselines.forEach(({ baseline, path }) => {
    const key = graphKey(baseline.graphKind, baseline.graphId);
    if (baselines.has(key)) {
      issues.push(issue('duplicate_approved_baseline', 'Approved baseline identity is duplicated.', path));
    }
    baselines.set(key, baseline);
  });

  [...sourceSnapshots, ...activeSnapshots].forEach(({ snapshot, path }) => {
    try {
      if (hashGraphSnapshot(snapshot) === snapshot.contentHash) return;
      issues.push(
        issue(
          'snapshot_content_hash_mismatch',
          'The snapshot content hash does not match its canonical graph bytes.',
          [...path, 'contentHash'],
        ),
      );
    } catch {
      issues.push(
        issue(
          'invalid_snapshot_canonicalization',
          'The snapshot cannot be RFC 8785 canonicalized.',
          [...path, 'contentHash'],
        ),
      );
    }
  });
  if (issues.length > 0) return report(issues);

  sourceSnapshotsToValidate.forEach(({ snapshot, path }) => {
    validateSnapshotSemantics(snapshot, path, allSnapshots, baselines, issues);
  });
  activeSnapshots.forEach(({ snapshot, path }) => {
    validateSnapshotSemantics(snapshot, path, allSnapshots, baselines, issues);
  });

  return report(issues);
}

/** Compatibility aliases for callers validating a named set of snapshots. */
export const validateGraphSet = validateGraphSnapshots;
export const validateSnapshotSet = validateGraphSnapshots;
