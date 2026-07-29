import { createHash } from 'node:crypto';

export type StoredResponse = Readonly<{
  status: number;
  body: unknown;
}>;

type Entry = StoredResponse & Readonly<{ requestHash: string }>;

export class IdempotencyStore {
  readonly #entries = new Map<string, Entry | Promise<Entry>>();

  requestHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  async run(
    identity: string,
    key: string,
    requestHash: string,
    perform: () => Promise<StoredResponse>,
  ): Promise<StoredResponse | 'conflict'> {
    const storageKey = `${identity}:${key}`;
    const existing = this.#entries.get(storageKey);
    if (existing) {
      const entry = await existing;
      return entry.requestHash === requestHash
        ? { status: entry.status, body: structuredClone(entry.body) }
        : 'conflict';
    }
    const pending = perform().then((response) => ({
      requestHash,
      ...structuredClone(response),
    }));
    this.#entries.set(storageKey, pending);
    try {
      const entry = await pending;
      this.#entries.set(storageKey, entry);
      return { status: entry.status, body: structuredClone(entry.body) };
    } catch (cause) {
      if (this.#entries.get(storageKey) === pending) this.#entries.delete(storageKey);
      throw cause;
    }
  }
}
