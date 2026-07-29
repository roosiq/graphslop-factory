import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  ApprovedBaselineSchema,
  FactoryHeadSchema,
  FactoryManifestSchema,
  GraphSnapshotSchema,
  type FactoryHead,
  type FactoryManifest,
  type GraphBaselineRef,
  type GraphSnapshot,
} from '@graphslop/contracts';
import { validateGraphSnapshots } from '@graphslop/graph-kernel';

type StoredValue = unknown | string;

export type FactoryFiles = Readonly<Record<string, StoredValue>>;

export type PrepareCommitInput = {
  readonly transactionId: string;
  readonly files: FactoryFiles;
};

export type CommitInput = PrepareCommitInput & {
  readonly expectedHeadHash: string | null;
};

export type PreparedCommit = {
  readonly transactionId: string;
  readonly parentHeadHash: string | null;
  readonly manifestHash: string;
};

export type FactoryReadResult = {
  readonly head: FactoryHead;
  readonly manifest: FactoryManifest;
  readonly files: Readonly<Record<string, unknown | string>>;
};

export type FactoryRecoveryResult = {
  readonly selectedHeadHash: string | null;
  readonly quarantinedTransactionIds: readonly string[];
};

export class FactoryStoreError extends Error {
  constructor(
    readonly code:
      | 'empty_store'
      | 'invalid_path'
      | 'invalid_content'
      | 'invalid_head'
      | 'stale_head'
      | 'writer_busy'
      | 'transaction_exists'
      | 'prepared_commit_missing'
      | 'immutable_history'
      | 'invalid_graph_state',
    message: string,
  ) {
    super(message);
    this.name = 'FactoryStoreError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FactoryStoreError('invalid_content', 'Stored JSON numbers must be finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === undefined) {
    throw new FactoryStoreError('invalid_content', 'Stored values must be JSON data.');
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(',')}}`;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function humanJson(value: unknown): string {
  canonicalJson(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function storedText(path: string, value: StoredValue): { readonly text: string; readonly format: 'json' | 'jsonl' } {
  if (path.endsWith('.jsonl')) {
    if (typeof value !== 'string') {
      throw new FactoryStoreError('invalid_content', `${path} must be supplied as JSON Lines text.`);
    }
    for (const line of value.split('\n').filter(Boolean)) {
      try {
        JSON.parse(line);
      } catch {
        throw new FactoryStoreError('invalid_content', `${path} contains an invalid JSON line.`);
      }
    }
    return { text: value.length === 0 || value.endsWith('\n') ? value : `${value}\n`, format: 'jsonl' };
  }
  if (!path.endsWith('.json')) {
    throw new FactoryStoreError('invalid_path', 'Factory files must use .json or .jsonl.');
  }
  if (typeof value === 'string') {
    throw new FactoryStoreError('invalid_content', `${path} must be supplied as JSON data, not text.`);
  }
  return { text: humanJson(value), format: 'json' };
}

function safeRelativePath(path: string): string {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new FactoryStoreError('invalid_path', `Unsafe factory path: ${path}`);
  }
  const resolved = resolve('/', path);
  const normalized = relative('/', resolved);
  if (normalized === '' || normalized === '..' || normalized.startsWith(`..${sep}`) || normalized !== path) {
    throw new FactoryStoreError('invalid_path', `Unsafe factory path: ${path}`);
  }
  return path;
}

async function durableWrite(path: string, content: string, exclusive = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, exclusive ? 'wx' : 'w', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export class FactoryFileStore {
  readonly factoryDirectory: string;
  private readonly commitsDirectory: string;
  private readonly quarantineDirectory: string;
  private readonly headPath: string;
  private readonly lockPath: string;

  constructor(
    readonly projectDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly durabilityObserver: (event: 'transaction_tree_synced' | 'head_renamed') => void = () => {},
  ) {
    this.factoryDirectory = join(projectDirectory, '.factory');
    this.commitsDirectory = join(this.factoryDirectory, 'commits');
    this.quarantineDirectory = join(this.factoryDirectory, 'quarantine');
    this.headPath = join(this.factoryDirectory, 'head.json');
    this.lockPath = join(this.factoryDirectory, 'writer.lock');
  }

  async initialize(): Promise<void> {
    await mkdir(this.commitsDirectory, { recursive: true });
    await mkdir(this.quarantineDirectory, { recursive: true });
  }

  async commit(input: CommitInput): Promise<FactoryHead> {
    await this.acquireWriter();
    try {
      const current = await this.readHeadOrNull();
      if ((current?.headHash ?? null) !== input.expectedHeadHash) {
        throw new FactoryStoreError('stale_head', 'The expected head hash is not current.');
      }
      if (current) {
        const prior = await this.readVerifiedCommit(current);
        this.validateHistory(prior.files, input.files);
      }
      this.validateAuthoritativeGraphs(input.files);
      const prepared = await this.prepareUnlocked(input, current);
      return await this.publishUnlocked(prepared, input.expectedHeadHash);
    } finally {
      await this.releaseWriter();
    }
  }

  /**
   * Write immutable files without moving the head. This is the crash-safe
   * prepare phase; an unpublished directory is ignored and later quarantined.
   */
  async prepareCommit(input: PrepareCommitInput): Promise<PreparedCommit> {
    await this.acquireWriter();
    try {
      return await this.prepareUnlocked(input, await this.readHeadOrNull());
    } finally {
      await this.releaseWriter();
    }
  }

  async read(): Promise<FactoryReadResult> {
    const head = await this.readHeadOrNull();
    if (!head) throw new FactoryStoreError('empty_store', 'The factory has no committed head.');
    return this.readVerifiedCommit(head);
  }

  async recover(): Promise<FactoryRecoveryResult> {
    await this.acquireWriter(true);
    try {
      const head = await this.readHeadOrNull();
      if (head) await this.readVerifiedCommit(head);

      const quarantined: string[] = [];
      for (const entry of await readdir(this.commitsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === head?.transactionId) continue;
        const target = join(this.quarantineDirectory, `${entry.name}-${Date.now()}`);
        await rename(join(this.commitsDirectory, entry.name), target);
        quarantined.push(entry.name);
      }
      return {
        selectedHeadHash: head?.headHash ?? null,
        quarantinedTransactionIds: quarantined.sort(),
      };
    } finally {
      await this.releaseWriter();
    }
  }

  private async prepareUnlocked(input: PrepareCommitInput, current: FactoryHead | null): Promise<PreparedCommit> {
    safeRelativePath(input.transactionId);
    const transactionDirectory = join(this.commitsDirectory, input.transactionId);
    try {
      await mkdir(transactionDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new FactoryStoreError('transaction_exists', `Transaction ${input.transactionId} already exists.`);
      }
      throw error;
    }

    const createdAt = this.now();
    const fileRecords: FactoryManifest['files'][number][] = [];
    try {
      for (const path of Object.keys(input.files).sort()) {
        safeRelativePath(path);
        const { text, format } = storedText(path, input.files[path]);
        await durableWrite(join(transactionDirectory, path), text, true);
        fileRecords.push({ path, contentHash: hashText(text), format });
      }
      const manifestWithoutHash = {
        schemaVersion: '1.0.0' as const,
        transactionId: input.transactionId,
        parentHeadHash: current?.headHash ?? null,
        files: fileRecords,
        createdAt,
      };
      const manifest: FactoryManifest = {
        ...manifestWithoutHash,
        manifestHash: hashCanonicalJson(manifestWithoutHash),
      };
      await durableWrite(join(transactionDirectory, 'manifest.json'), humanJson(manifest), true);
      const directories = new Set<string>([transactionDirectory]);
      for (const path of Object.keys(input.files)) {
        let parent = dirname(join(transactionDirectory, path));
        while (parent.startsWith(`${transactionDirectory}${sep}`)) {
          directories.add(parent);
          parent = dirname(parent);
        }
      }
      for (const path of [...directories].sort((left, right) => right.length - left.length)) {
        await this.syncDirectory(path);
      }
      await this.syncDirectory(this.commitsDirectory);
      this.durabilityObserver('transaction_tree_synced');
      return {
        transactionId: input.transactionId,
        parentHeadHash: manifest.parentHeadHash,
        manifestHash: manifest.manifestHash,
      };
    } catch (error) {
      await rm(transactionDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  private validateHistory(
    priorFiles: Readonly<Record<string, unknown | string>>,
    nextFiles: FactoryFiles,
  ): void {
    for (const [path, priorValue] of Object.entries(priorFiles)) {
      const immutableBaseline = /^(intent|solution)\/baselines\/[^/]+\.json$/.test(path);
      if (immutableBaseline) {
        if (!Object.hasOwn(nextFiles, path) || canonicalJson(nextFiles[path]) !== canonicalJson(priorValue)) {
          throw new FactoryStoreError('immutable_history', `Approved baseline history cannot change: ${path}`);
        }
      }
      if (path.endsWith('.jsonl')) {
        const nextValue = nextFiles[path];
        if (typeof priorValue !== 'string' || typeof nextValue !== 'string' || !nextValue.startsWith(priorValue)) {
          throw new FactoryStoreError('immutable_history', `JSON Lines history can only append: ${path}`);
        }
      }
    }
  }

  private validateAuthoritativeGraphs(files: FactoryFiles): void {
    const graphPaths = {
      intent: 'intent/graph.json',
      solution: 'solution/graph.json',
      execution: 'execution/graph.json',
    } as const;
    const presentKinds = (Object.keys(graphPaths) as (keyof typeof graphPaths)[])
      .filter((kind) => Object.hasOwn(files, graphPaths[kind]));
    if (presentKinds.length === 0) return;

    const snapshots = new Map<GraphSnapshot['graphKind'], GraphSnapshot>();
    for (const kind of presentKinds) {
      const parsed = GraphSnapshotSchema.safeParse(files[graphPaths[kind]]);
      if (!parsed.success || parsed.data.graphKind !== kind) {
        throw new FactoryStoreError('invalid_graph_state', `${graphPaths[kind]} is not a valid ${kind} snapshot.`);
      }
      snapshots.set(kind, parsed.data);
    }
    if (snapshots.has('solution') && !snapshots.has('intent')) {
      throw new FactoryStoreError('invalid_graph_state', 'Solution state requires its exact Intent source snapshot.');
    }
    if (snapshots.has('execution') && (!snapshots.has('intent') || !snapshots.has('solution'))) {
      throw new FactoryStoreError('invalid_graph_state', 'Execution state requires exact Intent and Solution source snapshots.');
    }

    const approvedBaselines: GraphBaselineRef[] = [];
    for (const [path, value] of Object.entries(files)) {
      if (!/^(intent|solution)\/(?:baselines\/[^/]+|(?:intent|solution)-v[0-9]+)\.json$/.test(path)) continue;
      const parsed = ApprovedBaselineSchema.safeParse(value);
      if (!parsed.success) {
        throw new FactoryStoreError('invalid_graph_state', `${path} is not a valid approved baseline.`);
      }
      const snapshot = snapshots.get(parsed.data.graphKind);
      if (!snapshot) continue;
      approvedBaselines.push({
        graphKind: parsed.data.graphKind,
        graphId: snapshot.graphId,
        baselineId: parsed.data.baselineId,
        snapshotId: parsed.data.snapshotId,
        snapshotContentHash: parsed.data.snapshotContentHash,
      });
    }
    if (
      snapshots.has('solution')
      && !approvedBaselines.some((baseline) => baseline.graphKind === 'intent')
    ) {
      throw new FactoryStoreError('invalid_graph_state', 'Solution state requires an approved exact Intent baseline.');
    }
    if (
      snapshots.has('execution')
      && !approvedBaselines.some((baseline) => baseline.graphKind === 'solution')
    ) {
      throw new FactoryStoreError('invalid_graph_state', 'Execution state requires an approved exact Solution baseline.');
    }
    const execution = snapshots.get('execution');
    if (execution) {
      const sourceBindingIds = new Set(
        execution.crossGraphLinks
          .filter((link) => link.type === 'SATISFIES_SOLUTION')
          .map((link) => link.sourceBaselineId),
      );
      if (sourceBindingIds.size !== 1) {
        throw new FactoryStoreError(
          'invalid_graph_state',
          'Execution traces must share one exact compiled source-snapshot binding.',
        );
      }
      /*
       * GraphBaselineRef is the kernel's exact snapshot-binding shape. For
       * Execution this is compiler identity, not an owner ApprovalRecord:
       * Intent and Solution remain the only owner-approved baselines.
       */
      approvedBaselines.push({
        graphKind: 'execution',
        graphId: execution.graphId,
        baselineId: [...sourceBindingIds][0],
        snapshotId: execution.snapshotId,
        snapshotContentHash: execution.contentHash,
      });
    }

    const report = validateGraphSnapshots({
      snapshots: [...snapshots.values()],
      approvedBaselines,
    });
    if (!report.valid) {
      throw new FactoryStoreError(
        'invalid_graph_state',
        `Authoritative graph validation failed: ${report.issues.map((entry) => entry.code).join(', ')}`,
      );
    }
  }

  private async publishUnlocked(prepared: PreparedCommit, expectedHeadHash: string | null): Promise<FactoryHead> {
    const current = await this.readHeadOrNull();
    if ((current?.headHash ?? null) !== expectedHeadHash || prepared.parentHeadHash !== expectedHeadHash) {
      throw new FactoryStoreError('stale_head', 'The prepared commit no longer extends the current head.');
    }
    const manifestPath = join(this.commitsDirectory, prepared.transactionId, 'manifest.json');
    if (!await exists(manifestPath)) {
      throw new FactoryStoreError('prepared_commit_missing', 'The prepared commit is missing its manifest.');
    }
    const committedAt = this.now();
    const headWithoutHash = {
      schemaVersion: '1.0.0' as const,
      transactionId: prepared.transactionId,
      parentHeadHash: prepared.parentHeadHash,
      manifestHash: prepared.manifestHash,
      committedAt,
    };
    const head: FactoryHead = {
      ...headWithoutHash,
      headHash: hashCanonicalJson(headWithoutHash),
    };
    const temporaryHead = join(this.factoryDirectory, `.head-${process.pid}-${Date.now()}.tmp`);
    await durableWrite(temporaryHead, humanJson(head), true);
    await rename(temporaryHead, this.headPath);
    this.durabilityObserver('head_renamed');
    const directory = await open(this.factoryDirectory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return head;
  }

  private async readHeadOrNull(): Promise<FactoryHead | null> {
    let raw: string;
    try {
      raw = await readFile(this.headPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new FactoryStoreError('invalid_head', 'head.json is not valid JSON.');
    }
    const parsed = FactoryHeadSchema.safeParse(value);
    if (!parsed.success) throw new FactoryStoreError('invalid_head', 'head.json does not match the head contract.');
    const { headHash, ...withoutHash } = parsed.data;
    if (hashCanonicalJson(withoutHash) !== headHash) {
      throw new FactoryStoreError('invalid_head', 'head.json has an invalid content hash.');
    }
    return parsed.data;
  }

  private async readVerifiedCommit(head: FactoryHead): Promise<FactoryReadResult> {
    const directory = join(this.commitsDirectory, head.transactionId);
    let rawManifest: string;
    try {
      rawManifest = await readFile(join(directory, 'manifest.json'), 'utf8');
    } catch {
      throw new FactoryStoreError('invalid_head', 'The selected head has no complete manifest.');
    }
    let value: unknown;
    try {
      value = JSON.parse(rawManifest);
    } catch {
      throw new FactoryStoreError('invalid_head', 'The selected manifest is invalid JSON.');
    }
    const parsed = FactoryManifestSchema.safeParse(value);
    if (!parsed.success) throw new FactoryStoreError('invalid_head', 'The selected manifest does not match its contract.');
    const { manifestHash, ...withoutHash } = parsed.data;
    if (
      hashCanonicalJson(withoutHash) !== manifestHash
      || manifestHash !== head.manifestHash
      || parsed.data.transactionId !== head.transactionId
      || parsed.data.parentHeadHash !== head.parentHeadHash
    ) {
      throw new FactoryStoreError('invalid_head', 'The selected manifest is not bound to head.json.');
    }

    const files: Record<string, unknown | string> = {};
    for (const file of parsed.data.files) {
      safeRelativePath(file.path);
      let text: string;
      try {
        text = await readFile(join(directory, file.path), 'utf8');
      } catch {
        throw new FactoryStoreError('invalid_head', `The selected head is missing ${file.path}.`);
      }
      if (hashText(text) !== file.contentHash) {
        throw new FactoryStoreError('invalid_head', `The selected head has invalid content for ${file.path}.`);
      }
      try {
        files[file.path] = file.format === 'json' ? JSON.parse(text) : text;
      } catch {
        throw new FactoryStoreError('invalid_head', `The selected head contains invalid ${file.format}.`);
      }
    }
    return { head, manifest: parsed.data, files };
  }

  private async acquireWriter(recoverStale = false): Promise<void> {
    await this.initialize();
    try {
      await durableWrite(
        this.lockPath,
        humanJson({ pid: process.pid, createdAt: this.now() }),
        true,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (recoverStale && await this.lockIsStale()) {
        await rm(this.lockPath, { force: true });
        return this.acquireWriter(false);
      }
      throw new FactoryStoreError('writer_busy', 'Another project writer holds the lock.');
    }
  }

  private async lockIsStale(): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(this.lockPath, 'utf8')) as { pid?: unknown };
      if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0) return true;
      try {
        process.kill(value.pid as number, 0);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
      }
    } catch {
      return true;
    }
  }

  private async releaseWriter(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }

  private async syncDirectory(path: string): Promise<void> {
    const directory = await open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
