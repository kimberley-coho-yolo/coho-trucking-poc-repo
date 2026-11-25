// One interface for data and sign-in, with two implementations:
//  - SupabaseBackend: the real database (when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set)
//  - DemoBackend: an in-browser copy with made-up data, for training and screenshots
import type { TableName } from './schema';
import type { Perms } from './permissions';

export type Row = Record<string, any>;
// Built-in roles are driver, supervisor, office and admin; admins can add more in Settings.
export type Role = string;

export interface Filter { [column: string]: string | number | boolean | null }

/** A table to listen to for changes, optionally only rows where column = value. */
export interface WatchSpec { table: TableName; column?: string; value?: string }

export interface Session {
  userId: string;
  email?: string | null;
  phone?: string | null;
}

export interface Backend {
  mode: 'supabase' | 'demo';
  // sign-in
  getSession(): Promise<Session | null>;
  sendCode(target: { email?: string; phone?: string }): Promise<void>;
  verifyCode(target: { email?: string; phone?: string }, code: string): Promise<Session>;
  signOut(): Promise<void>;
  myRole(): Promise<Role | null>;
  myPermissions(): Promise<Perms>;               // hidden / read / edit for every function, for the signed-in user
  claimFirstAdmin(): Promise<string>;
  peopleForMyPhone(): Promise<Row[]>;
  // data
  list(table: TableName, filter?: Filter, order?: { column: string; ascending?: boolean }): Promise<Row[]>;
  get(table: TableName, id: string): Promise<Row | null>;
  save(table: TableName, row: Row): Promise<Row>;              // insert or update by id
  saveMany(table: TableName, rows: Row[]): Promise<number>;
  remove(table: TableName, id: string): Promise<void>;
  runSelect(sql: string): Promise<Row[]>;
  // live updates: calls back when a watched row is added, changed or deleted on any device; returns "stop watching"
  watch(specs: WatchSpec[], onChange: (table: TableName, row: Row | null) => void): () => void;
}

/** The outbox (lib/outbox.ts) adds these on top of a Backend. */
export interface OutboxApi {
  outbox(): import('./outbox').OutboxItem[];
  onOutbox(cb: () => void): () => void;
  describe(q: import('./outbox').OutboxItem): string;
  flush(): Promise<void>;
  pushThrough(itemId: string): Promise<void>;
  discard(itemId: string): Promise<void>;
  isOnline(): boolean;
}
export function outboxApi(): OutboxApi | null {
  const b = backend() as unknown as Partial<OutboxApi>;
  return typeof b.outbox === 'function' ? (b as OutboxApi) : null;
}

let current: Backend | null = null;
export function setBackend(b: Backend) { current = b; }
export function backend(): Backend {
  if (!current) throw new Error('Backend not initialised');
  return current;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Empty strings from forms become null so every field stays optional in the database.
export function clean(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('__')) continue;                 // screen-only markers, e.g. __queued
    if (v === '' || v === undefined) out[k] = null;
    else out[k] = v;
  }
  return out;
}
