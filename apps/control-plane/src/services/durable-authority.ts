import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  RepairAuthorization,
  WorkerCredential,
  WorkerIdentityAuthority,
} from '../../../runner/src/index.js';
import type {
  ExecutionControlArtifact,
  RepairAuthorityStore,
  VerifierDriftRecord,
  VerifierDriftStore,
} from './bridge.js';

async function locked<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(lock, 'wx', 0o600);
  try {
    return await work();
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

export class FileExecutionArtifactStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ExecutionControlArtifact | undefined> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as ExecutionControlArtifact; }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  }

  async install(
    value: ExecutionControlArtifact,
    expected: null | Readonly<{ version: number; graphSnapshotId: string; graphContentHash: string }>,
  ): Promise<void> {
    if (expected === undefined) throw new Error('Execution artifact expectation is required.');
    await locked(this.path, async () => {
      const current = await this.load();
      if (expected === null && current) throw new Error('Execution artifact install-if-absent CAS failed.');
      if (expected && (!current
        || current.version !== expected.version
        || current.graphSnapshotId !== expected.graphSnapshotId
        || current.graphContentHash !== expected.graphContentHash
        || value.version !== expected.version + 1)) {
        throw new Error('Execution artifact CAS failed.');
      }
      if (!current && value.version !== 1) throw new Error('Execution artifact genesis version is invalid.');
      await atomicJson(this.path, value);
    });
  }

  async updateLease(expectedLeaseId: string, value: ExecutionControlArtifact): Promise<void> {
    await locked(this.path, async () => {
      const current = await this.load();
      if (!current || current.leaseId !== expectedLeaseId || current.graphSnapshotId !== value.graphSnapshotId) {
        throw new Error('Execution lease CAS failed.');
      }
      await atomicJson(this.path, value);
    });
  }
}

export type CheckDriftReceipt = Readonly<{
  identity: WorkerCredential;
  taskId: string;
  leaseId: string;
  evidenceHash: string;
  driftRecordHash: string;
  executionHash: string;
  intentBaselineHash: string;
  solutionBaselineHash: string;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: string;
  signature: string;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function recordHash(record: VerifierDriftRecord): string {
  return createHash('sha256').update(canonical(record)).digest('hex');
}

function receiptPayload(receipt: Omit<CheckDriftReceipt, 'signature'>): string {
  return canonical(receipt);
}

export class HmacCheckDriftReceiptAuthority {
  constructor(
    private readonly identities: WorkerIdentityAuthority,
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.length < 32) throw new Error('Check drift receipt secret is too short.');
  }

  async issue(
    record: VerifierDriftRecord,
    identity: WorkerCredential,
    leaseId: string,
    ttlMs = 60_000,
  ): Promise<CheckDriftReceipt> {
    if (identity.kind !== 'Check' || !await this.identities.authenticate(identity, {
      kind: 'Check', taskId: record.sourceTaskId, leaseId,
    })) throw new Error('Authenticated Check identity required.');
    const issuedAtMs = this.now();
    const payload = {
      identity: structuredClone(identity),
      taskId: record.sourceTaskId,
      leaseId,
      evidenceHash: record.evidenceHash,
      driftRecordHash: recordHash(record),
      executionHash: record.executionHash,
      intentBaselineHash: record.intentBaselineHash,
      solutionBaselineHash: record.solutionBaselineHash,
      issuedAtMs,
      expiresAtMs: issuedAtMs + ttlMs,
      nonce: randomUUID(),
    };
    return {
      ...payload,
      signature: createHmac('sha256', this.secret).update(receiptPayload(payload)).digest('base64url'),
    };
  }

  async verifyForIngest(record: VerifierDriftRecord, receipt: CheckDriftReceipt): Promise<boolean> {
    return this.verify(record, receipt, true);
  }

  async verifyStoredIntegrity(record: VerifierDriftRecord, receipt: CheckDriftReceipt): Promise<boolean> {
    return this.verify(record, receipt, false);
  }

  private async verify(
    record: VerifierDriftRecord,
    receipt: CheckDriftReceipt,
    requireFresh: boolean,
  ): Promise<boolean> {
    const { signature, ...payload } = receipt;
    const expected = Buffer.from(createHmac('sha256', this.secret).update(receiptPayload(payload)).digest('base64url'));
    const received = Buffer.from(signature);
    return receipt.identity.kind === 'Check'
      && receipt.taskId === record.sourceTaskId
      && receipt.identity.taskId === receipt.taskId
      && receipt.identity.leaseId === receipt.leaseId
      && receipt.evidenceHash === record.evidenceHash
      && receipt.driftRecordHash === recordHash(record)
      && receipt.executionHash === record.executionHash
      && receipt.intentBaselineHash === record.intentBaselineHash
      && receipt.solutionBaselineHash === record.solutionBaselineHash
      && receipt.expiresAtMs > receipt.issuedAtMs
      && (!requireFresh || (receipt.issuedAtMs <= this.now() && receipt.expiresAtMs > this.now()))
      && expected.length === received.length
      && timingSafeEqual(expected, received)
      && await this.identities.authenticate(receipt.identity, {
        kind: 'Check', taskId: receipt.taskId, leaseId: receipt.leaseId,
      });
  }
}

type SignedDrift = { record: VerifierDriftRecord; receipt: CheckDriftReceipt };
type DriftFile = { version: 1; records: Record<string, SignedDrift>; consumedNonces: string[] };

export class FileVerifierDriftStore implements VerifierDriftStore {
  constructor(
    private readonly path: string,
    private readonly receipts: HmacCheckDriftReceiptAuthority,
  ) {}

  async persistVerified(
    record: VerifierDriftRecord,
    receipt: CheckDriftReceipt,
  ): Promise<void> {
    if (!await this.receipts.verifyForIngest(record, receipt)
      || !/^[a-f0-9]{64}$/.test(record.evidenceHash)
      || !/^[a-f0-9]{64}$/.test(record.intentBaselineHash)
      || !/^[a-f0-9]{64}$/.test(record.solutionBaselineHash)
      || !/^[a-f0-9]{64}$/.test(record.executionHash)
      || record.status !== 'idle' || !record.instruction) {
      throw new Error('Authenticated verifier drift is invalid.');
    }
    await locked(this.path, async () => {
      let state: DriftFile = { version: 1, records: {}, consumedNonces: [] };
      try { state = JSON.parse(await readFile(this.path, 'utf8')) as DriftFile; }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
      if (state.version !== 1 || !Array.isArray(state.consumedNonces)
        || state.records[record.driftId] || state.consumedNonces.includes(receipt.nonce)
        || Object.values(state.records).some((item) =>
          item.record.evidenceHash === record.evidenceHash && item.record.sourceTaskId === record.sourceTaskId)) {
        throw new Error('Verifier drift replay rejected.');
      }
      state.records[record.driftId] = { record: structuredClone(record), receipt: structuredClone(receipt) };
      state.consumedNonces.push(receipt.nonce);
      state.consumedNonces.sort();
      await atomicJson(this.path, state);
    });
  }

  async resolve(driftId: string): Promise<VerifierDriftRecord | undefined> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as DriftFile;
      const signed = state.version === 1 ? state.records[driftId] : undefined;
      return signed && await this.receipts.verifyStoredIntegrity(signed.record, signed.receipt)
        ? structuredClone(signed.record)
        : undefined;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  }

  async all(): Promise<readonly VerifierDriftRecord[]> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as DriftFile;
      if (state.version !== 1) throw new Error('Verifier drift store version is invalid.');
      const verified = await Promise.all(Object.values(state.records).map(async (signed) =>
        await this.receipts.verifyStoredIntegrity(signed.record, signed.receipt)
          ? structuredClone(signed.record) : undefined));
      return verified.filter((item): item is VerifierDriftRecord => item !== undefined)
        .sort((left, right) => left.driftId.localeCompare(right.driftId));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }
}

type RepairFile = { version: 1; records: Record<string, RepairAuthorization> };

export class FileRepairAuthorityStore implements RepairAuthorityStore {
  constructor(private readonly path: string) {}

  async persist(record: RepairAuthorization): Promise<void> {
    await locked(this.path, async () => {
      let state: RepairFile = { version: 1, records: {} };
      try { state = JSON.parse(await readFile(this.path, 'utf8')) as RepairFile; }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
      if (state.version !== 1 || state.records[record.ownerAuthorizationId]
        || Object.values(state.records).some((item) => item.repairId === record.repairId)) {
        throw new Error('Repair authorization replay rejected.');
      }
      state.records[record.ownerAuthorizationId] = structuredClone(record);
      await atomicJson(this.path, state);
    });
  }

  async resolve(ownerAuthorizationId: string): Promise<RepairAuthorization | undefined> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as RepairFile;
      return state.version === 1 && state.records[ownerAuthorizationId]
        ? structuredClone(state.records[ownerAuthorizationId])
        : undefined;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  }
}
