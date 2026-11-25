// Small key-value store on the device for the offline queue and the local copy of records.
// IndexedDB (room for photos and signatures); falls back to memory where IndexedDB is not available (tests).
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

class MemoryKV implements KV {
  m = new Map<string, unknown>();
  async get<T>(k: string) { return this.m.get(k) as T | undefined; }
  async set(k: string, v: unknown) { this.m.set(k, v); }
}

class IdbKV implements KV {
  private db: Promise<IDBDatabase>;
  constructor(name: string) {
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db;
    return new Promise((res, rej) => {
      const req = fn(db.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => res(req.result as T);
      req.onerror = () => rej(req.error);
    });
  }
  get<T>(k: string) { return this.tx<T | undefined>('readonly', s => s.get(k)); }
  async set(k: string, v: unknown) { await this.tx('readwrite', s => s.put(v, k)); }
}

export function openStore(name = 'coho-drive-offline'): KV {
  try { if (typeof indexedDB !== 'undefined') return new IdbKV(name); } catch { /* blocked: use memory */ }
  return new MemoryKV();
}
export const memoryStore = (): KV => new MemoryKV();
