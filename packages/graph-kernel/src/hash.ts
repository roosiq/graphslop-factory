// @ts-ignore Node provides this runtime API; this lean package intentionally has no Node typings.
import { createHash } from 'node:crypto';

import type { GraphSnapshot, NodeRef } from '@graphslop/contracts';

type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('RFC 8785 canonicalization rejects ill-formed Unicode strings.');
      }
      index += 1;
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      throw new TypeError('RFC 8785 canonicalization rejects ill-formed Unicode strings.');
    }
  }
}

function canonicalize(value: CanonicalValue): string {
  if (typeof value === 'string') {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const objectValue = value as { readonly [key: string]: CanonicalValue };
  return `{${Object.keys(objectValue).sort(compare).map((key) => {
    assertWellFormedUnicode(key);
    return `${JSON.stringify(key)}:${canonicalize(objectValue[key])}`;
  }).join(',')}}`;
}

function isLocalReference(ref: NodeRef, snapshot: GraphSnapshot): boolean {
  return ref.graphKind === snapshot.graphKind
    && ref.graphId === snapshot.graphId
    && ref.snapshotId === snapshot.snapshotId;
}

function canonicalNodeRef(ref: NodeRef, snapshot: GraphSnapshot): CanonicalValue {
  if (!isLocalReference(ref, snapshot)) return ref;
  const { snapshotContentHash: _snapshotContentHash, ...withoutSnapshotContentHash } = ref;
  return withoutSnapshotContentHash;
}

function refKey(ref: CanonicalValue): string {
  return canonicalize(ref);
}

function canonicalSnapshotValue(snapshot: GraphSnapshot): CanonicalValue {
  const { contentHash: _contentHash, nodes, edges, crossGraphLinks, ...header } = snapshot;
  return {
    ...header,
    nodes: [...nodes]
      .sort((left, right) => compare(left.id, right.id))
      .map((node) => {
        const { sourceRefs, baselineMembership, supports, ...nodeHeader } = node;
        return {
          ...nodeHeader,
          sourceRefs: [...sourceRefs].sort((left, right) => compare(
            `${left.sourceId}\u0000${left.contentHash ?? ''}`,
            `${right.sourceId}\u0000${right.contentHash ?? ''}`,
          )),
          ...(baselineMembership === undefined ? {} : { baselineMembership: [...baselineMembership].sort(compare) }),
          ...(supports === undefined
            ? {}
            : { supports: [...supports].map((ref) => canonicalNodeRef(ref, snapshot)).sort((left, right) => compare(refKey(left), refKey(right))) }),
        };
      }),
    edges: [...edges]
      .sort((left, right) => compare(left.id, right.id))
      .map((edge) => ({
        ...edge,
        sourceNodeRef: canonicalNodeRef(edge.sourceNodeRef, snapshot),
        targetNodeRef: canonicalNodeRef(edge.targetNodeRef, snapshot),
        sourceRefs: [...edge.sourceRefs].sort((left, right) => compare(
          `${left.sourceId}\u0000${left.contentHash ?? ''}`,
          `${right.sourceId}\u0000${right.contentHash ?? ''}`,
        )),
      })),
    crossGraphLinks: [...crossGraphLinks]
      .sort((left, right) => compare(left.id, right.id))
      .map((link) => ({
        ...link,
        source: canonicalNodeRef(link.source, snapshot),
        target: canonicalNodeRef(link.target, snapshot),
      })),
  };
}

/** RFC 8785 JSON text for a GraphSnapshot's documented canonical preimage. */
export function canonicalizeGraphSnapshot(snapshot: GraphSnapshot): string {
  return canonicalize(canonicalSnapshotValue(snapshot));
}

/** Lowercase SHA-256 digest of a GraphSnapshot's documented canonical preimage. */
export function hashGraphSnapshot(snapshot: GraphSnapshot): string {
  return createHash('sha256').update(canonicalizeGraphSnapshot(snapshot), 'utf8').digest('hex');
}
