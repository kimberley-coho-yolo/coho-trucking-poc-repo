// Works with or without signal.
// Every change goes through here. With signal it goes straight to the database. Without signal (or if the
// network drops mid-save) it is kept on the device in an outbox and sent, in order, as soon as signal is back.
// A local copy of what this device has seen lets screens open and show records while offline.
// If the database refuses a queued change, the person is told why and can send it anyway, fix it or discard it.
import type { Backend, Filter, Row, Session, WatchSpec } from './backend';
import { clean, uuid } from './backend';
import type { TableName } from './schema';
import type { Perms } from './permissions';
import type { KV } from './offlineStore';

export type OutboxStatus = 'queued' | 'sending' | 'failed' | 'sign_in';
export type FailKind = 'conflict' | 'rejected';
export interface OutboxItem {
  id: string;
  userId: string;
  table: TableName;
  op: 'save' | 'remove';
  rowId: string;
  row?: Row;             // what the person saved
  base?: Row | null;     // the record as it was before their change (to merge with changes made elsewhere)
  queuedAt: string;
  attempts: number;
  status: OutboxStatus;
  kind?: FailKind;
  reason?: string;
  conflictFields?: string[];
}

// ---------- pure helpers (unit tested) ----------
export type ErrorKind = 'network' | 'conflict' | 'sign_in' | 'rejected';
export function classifyError(e: unknown): ErrorKind {
  const x = e as any;
  const msg = String(x?.message ?? x ?? '');
  if (x?.code === '40001' || /changed on another device/i.test(msg)) return 'conflict';
  if (x?.code === 'PGRST301' || x?.code === 'PGRST303' || x?.status === 401 || /jwt|token.*expired|not authenticated|sign in again/i.test(msg)) return 'sign_in';
  if (x?.name === 'AbortError' || x?.name === 'TimeoutError' || x?.status === 0
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|no signal|offline/i.test(msg)) return 'network';
  return 'rejected';
}

const SYSTEM = new Set(['version', 'updated_at', 'updated_by', 'created_at', 'created_by', 'approved_at', 'approved_by']);
const NESTED = ['extras', 'data'];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Fields that differ between two versions of a record; inside extras/data each key counts on its own. */
export function changedPaths(a: Row | null | undefined, b: Row | null | undefined): string[] {
  const out: string[] = [];
  const A = a ?? {}, B = b ?? {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (SYSTEM.has(k) || k.startsWith('__')) continue;
    if (NESTED.includes(k) && (A[k] === undefined || typeof A[k] === 'object') && (B[k] === undefined || typeof B[k] === 'object')) {
      const ak = A[k] ?? {}, bk = B[k] ?? {};
      for (const j of new Set([...Object.keys(ak), ...Object.keys(bk)])) if (!same(ak[j], bk[j])) out.push(`${k}.${j}`);
    } else if (!same(A[k], B[k])) out.push(k);
  }
  return out;
}
/** Copy the given fields from "from" onto "onto". */
export function applyPaths(onto: Row, from: Row, paths: string[]): Row {
  const out: Row = { ...onto };
  for (const p of paths) {
    const [k, j] = p.split('.');
    if (j !== undefined) out[k] = { ...(out[k] ?? {}), [j]: from[k]?.[j] };
    else out[k] = from[k];
  }
  return out;
}
/**
 * Someone else changed the record while this change waited to send.
 * If they changed different fields, both changes are kept. If they changed the same fields, ask the person.
 */
export function mergeOnConflict(base: Row | null | undefined, mine: Row, server: Row): { merged: Row; clashes: string[] } {
  const myChanges = changedPaths(base, mine);
  const theirChanges = new Set(changedPaths(base, server));
  const clashes = myChanges.filter(p => theirChanges.has(p) && !same(pick(mine, p), pick(server, p)));
  return { merged: { ...applyPaths(server, mine, myChanges), version: server.version }, clashes };
}
const pick = (r: Row, p: string) => { const [k, j] = p.split('.'); return j !== undefined ? r[k]?.[j] : r[k]; };

function matches(r: Row, filter?: Filter) {
  return Object.entries(filter ?? {}).every(([k, v]) => (r[k] ?? null) === v);
}
function sortRows(rows: Row[], order?: { column: string; ascending?: boolean }) {
  if (!order) return rows;
  const dir = order.ascending === false ? -1 : 1;
  return [...rows].sort((a, b) => String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? '')) * dir);
}

const FRIENDLY: Record<ErrorKind, string> = {
  network: 'Waiting for signal',
  sign_in: 'Sign in again to send',
  conflict: 'Someone else changed the same fields while this was waiting',
  rejected: 'The system did not accept this change',
};

// ---------- the wrapper ----------
export class OfflineBackend implements Backend {
  mode: 'supabase' | 'demo';
  private queue: OutboxItem[] = [];
  private mirror: Record<string, Record<string, Row>> = {};
  private cache: { role?: string | null; perms?: Perms; people?: Row[] } = {};
  private listeners = new Set<{ specs: WatchSpec[]; cb: (t: TableName, r: Row | null) => void }>();
  private outboxListeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private userId: string | null = null;
  isOnline: () => boolean;

  constructor(public inner: Backend, private kv: KV, opts: { isOnline?: () => boolean } = {}) {
    this.mode = inner.mode;
    this.isOnline = opts.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  }
  /** Load the outbox and the local copy from the device. Call once before the app starts. */
  async init(autoSend = true) {
    this.queue = (await this.kv.get<OutboxItem[]>('queue')) ?? [];
    this.mirror = (await this.kv.get<Record<string, Record<string, Row>>>('mirror')) ?? {};
    this.cache = (await this.kv.get<typeof this.cache>('cache')) ?? {};
    for (const q of this.queue) if (q.status === 'sending') q.status = 'queued';   // the app closed mid-send
    this.userId = (await this.inner.getSession().catch(() => null))?.userId ?? null;
    if (autoSend && typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.notify(); this.flush(); });
      window.addEventListener('offline', () => this.notify());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.flush(); });
      setInterval(() => { if (this.queue.some(q => q.status === 'queued')) this.flush(); }, 30_000);
      this.flush();
    }
    return this;
  }
  private removed = new Set<string>();
  private dropItem(id: string) { this.removed.add(id); this.queue = this.queue.filter(x => x.id !== id); }
  private persist(now = false) {
    clearTimeout(this.saveTimer);
    // another open tab of the app may have queued changes too: keep theirs as well as ours
    const write = async () => {
      const stored = (await this.kv.get<OutboxItem[]>('queue').catch(() => undefined)) ?? [];
      const ours = new Set(this.queue.map(q => q.id));
      this.queue = [...this.queue, ...stored.filter(q => !ours.has(q.id) && !this.removed.has(q.id))]
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
      await Promise.all([this.kv.set('queue', this.queue), this.kv.set('mirror', this.mirror), this.kv.set('cache', this.cache)]).catch(() => null);
    };
    if (now) return write();
    this.saveTimer = setTimeout(write, 250);
    return Promise.resolve();
  }
  private notify() { for (const l of this.outboxListeners) l(); }
  private emit(table: TableName, row: Row | null) {
    for (const l of this.listeners) for (const s of l.specs)
      if (s.table === table && (!s.column || !row || String(row[s.column]) === s.value)) l.cb(table, row);
  }
  private remember(table: string, rows: Row[], filter?: Filter, full = false) {
    const t = (this.mirror[table] ??= {});
    const pending = new Set(this.queue.filter(q => q.table === table).map(q => q.rowId));
    const seen = new Set(rows.map(r => r.id));
    if (full || filter) for (const [id, r] of Object.entries(t)) if (!seen.has(id) && !pending.has(id) && (full || matches(r, filter))) delete t[id];
    for (const r of rows) if (r?.id !== undefined && !pending.has(r.id)) t[r.id] = r;
    this.persist();
  }
  private mine = () => this.queue.filter(q => !this.userId || q.userId === this.userId);

  // ---------- what the screens use ----------
  outbox(): OutboxItem[] { return this.mine().map(q => ({ ...q })); }
  onOutbox(cb: () => void) { this.outboxListeners.add(cb); return () => { this.outboxListeners.delete(cb); }; }
  describe(q: OutboxItem) { return q.reason ?? FRIENDLY[q.status === 'sign_in' ? 'sign_in' : q.status === 'failed' ? (q.kind ?? 'rejected') : 'network']; }

  // ---------- sign-in and access (cached so the app still opens offline) ----------
  async getSession(): Promise<Session | null> {
    const s = await this.inner.getSession();
    this.userId = s?.userId ?? null;
    return s;
  }
  async sendCode(t: { email?: string; phone?: string }) {
    if (!this.isOnline()) throw new Error('No signal. You need signal to get a sign-in code.');
    return this.inner.sendCode(t);
  }
  async verifyCode(t: { email?: string; phone?: string }, code: string) {
    const s = await this.inner.verifyCode(t, code);
    this.userId = s.userId; this.notify(); this.flush();
    return s;
  }
  signOut() { return this.inner.signOut(); }
  private async cached<K extends keyof OfflineBackend['cache']>(key: K, fn: () => Promise<NonNullable<OfflineBackend['cache'][K]> | null>) {
    try {
      const v = await fn();
      (this.cache as any)[key] = v; this.persist();
      return v;
    } catch (e) {
      if (classifyError(e) === 'network' && this.cache[key] !== undefined) return this.cache[key] as any;
      throw e;
    }
  }
  myRole() { return this.cached('role', () => this.inner.myRole()); }
  myPermissions() { return this.cached('perms', () => this.inner.myPermissions()) as Promise<Perms>; }
  peopleForMyPhone() { return this.cached('people', () => this.inner.peopleForMyPhone()) as Promise<Row[]>; }
  claimFirstAdmin() { return this.inner.claimFirstAdmin(); }
  runSelect(sql: string) { return this.inner.runSelect(sql); }

  // ---------- reading ----------
  private local(table: TableName, filter?: Filter, order?: { column: string; ascending?: boolean }) {
    return sortRows(Object.values(this.mirror[table] ?? {}).filter(r => matches(r, filter)), order).map(r => ({ ...r }));
  }
  async list(table: TableName, filter?: Filter, order?: { column: string; ascending?: boolean }) {
    if (!this.isOnline()) return this.local(table, filter, order);
    try {
      const rows = await this.inner.list(table, filter, order);
      this.remember(table, rows, filter, !filter || !Object.keys(filter).length);
      // changes still waiting to send stay visible on this device
      const pending = this.mine().filter(q => q.table === table);
      if (!pending.length) return rows;
      const byId = new Map(rows.map(r => [r.id, r]));
      for (const q of pending) {
        if (q.op === 'remove') byId.delete(q.rowId);
        else { const r = this.mirror[table]?.[q.rowId]; if (r && matches(r, filter)) byId.set(q.rowId, { ...r, __queued: true }); }
      }
      return sortRows([...byId.values()], order);
    } catch (e) {
      if (classifyError(e) === 'network') return this.local(table, filter, order);
      throw e;
    }
  }
  async get(table: TableName, id: string) {
    const pending = this.mine().find(q => q.table === table && q.rowId === id);
    if (pending) return pending.op === 'remove' ? null : { ...(this.mirror[table]?.[id] ?? pending.row), __queued: true };
    if (!this.isOnline()) return this.mirror[table]?.[id] ? { ...this.mirror[table][id] } : null;
    try {
      const r = await this.inner.get(table, id);
      if (r) this.remember(table, [r]); else if (this.mirror[table]) delete this.mirror[table][id];
      return r;
    } catch (e) {
      if (classifyError(e) === 'network') return this.mirror[table]?.[id] ? { ...this.mirror[table][id] } : null;
      throw e;
    }
  }

  // ---------- writing ----------
  private enqueue(table: TableName, op: 'save' | 'remove', rowId: string, row?: Row): Row | undefined {
    const t = (this.mirror[table] ??= {});
    const before = t[rowId] ? { ...t[rowId] } : null;
    const waiting = this.queue.find(q => q.table === table && q.rowId === rowId && q.op === op && q.status !== 'sending' && q.userId === (this.userId ?? ''));
    let local: Row | undefined;
    if (op === 'save') {
      local = { ...(before ?? {}), ...row };
      t[rowId] = local;
    } else delete t[rowId];
    if (waiting) {
      // one change waiting per record: keep the original "before" so merging still works
      waiting.row = op === 'save' ? { ...(waiting.row ?? {}), ...row } : undefined;
      if (waiting.status === 'failed' && waiting.kind === 'conflict') { /* still needs the person */ } else waiting.status = 'queued';
    } else {
      this.queue.push({ id: uuid(), userId: this.userId ?? '', table, op, rowId, row: op === 'save' ? { ...row } : undefined, base: before,
        queuedAt: new Date().toISOString(), attempts: 0, status: 'queued' });
    }
    this.persist(true); this.notify();
    if (local) this.emit(table, local); else this.emit(table, null);
    return local;
  }
  async save(table: TableName, row: Row) {
    const body = { ...row };
    for (const k of Object.keys(body)) if (k.startsWith('__')) delete body[k];
    body.id ??= uuid();
    const blocked = this.mine().some(q => q.status !== 'failed' || q.rowId === body.id);   // keep the order: earlier changes first
    if (this.isOnline() && !blocked) {
      try {
        const saved = await this.inner.save(table, body);
        this.remember(table, [saved]);
        return saved;
      } catch (e) {
        if (classifyError(e) !== 'network') throw e;
      }
    }
    const local = this.enqueue(table, 'save', body.id, body)!;
    this.flush();
    return { ...local, __queued: true };
  }
  async saveMany(table: TableName, rows: Row[]) {
    if (!this.isOnline()) throw new Error('No signal. Uploading a spreadsheet needs signal.');
    return this.inner.saveMany(table, rows);
  }
  async remove(table: TableName, id: string) {
    const blocked = this.mine().some(q => q.status !== 'failed' || q.rowId === id);
    if (this.isOnline() && !blocked) {
      try { await this.inner.remove(table, id); if (this.mirror[table]) delete this.mirror[table][id]; this.persist(); return; }
      catch (e) { if (classifyError(e) !== 'network') throw e; }
    }
    this.enqueue(table, 'remove', id);
    this.flush();
  }

  watch(specs: WatchSpec[], cb: (table: TableName, row: Row | null) => void) {
    const l = { specs, cb };
    this.listeners.add(l);
    const stop = this.inner.watch(specs, (t, r) => { if (r?.id) this.remember(t, [r]); cb(t, r); });
    return () => { this.listeners.delete(l); stop(); };
  }

  // ---------- sending the outbox ----------
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => { this.flushing = null; this.notify(); });
    return this.flushing;
  }
  private async sendOne(q: OutboxItem, force = false): Promise<void> {
    if (q.op === 'remove') { await this.inner.remove(q.table, q.rowId); if (this.mirror[q.table]) delete this.mirror[q.table][q.rowId]; return; }
    const body = clean({ ...q.row });
    try {
      const saved = await this.inner.save(q.table, body);
      this.mirror[q.table] ??= {}; this.mirror[q.table][q.rowId] = saved;
      this.emit(q.table, saved);
    } catch (e) {
      if (classifyError(e) !== 'conflict') throw e;
      const server = await this.inner.get(q.table, q.rowId);
      if (!server) throw e;
      const { merged, clashes } = mergeOnConflict(q.base, q.row ?? {}, server);
      if (clashes.length && !force) throw Object.assign(new Error(`Changed on another device while this was waiting: ${clashes.join(', ')}`), { code: '40001', clashes });
      const saved = await this.inner.save(q.table, clean(merged));
      this.mirror[q.table] ??= {}; this.mirror[q.table][q.rowId] = saved;
      this.emit(q.table, saved);
    }
  }
  private async doFlush() {
    if (!this.isOnline()) return;
    const session = await this.inner.getSession().catch(() => null);
    this.userId = session?.userId ?? this.userId;
    if (!session) return;
    const stuckRows = new Set<string>();
    for (const q of [...this.queue]) {
      if (q.userId && q.userId !== session.userId) continue;
      if (q.status === 'failed') { stuckRows.add(q.rowId); continue; }
      if (stuckRows.has(q.rowId)) continue;                 // later change to a record that is waiting for the person
      q.status = 'sending'; q.attempts += 1; this.notify();
      try {
        await this.sendOne(q);
        this.dropItem(q.id);
        await this.persist(true);
      } catch (e) {
        const kind = classifyError(e);
        if (kind === 'network') { q.status = 'queued'; q.reason = undefined; await this.persist(true); return; }
        if (kind === 'sign_in') { q.status = 'sign_in'; q.reason = FRIENDLY.sign_in; await this.persist(true); return; }
        q.status = 'failed'; q.kind = kind === 'conflict' ? 'conflict' : 'rejected';
        q.conflictFields = (e as any)?.clashes;
        q.reason = kind === 'conflict' ? `${FRIENDLY.conflict}${q.conflictFields?.length ? ': ' + q.conflictFields.join(', ') : ''}.` : `${FRIENDLY.rejected}: ${(e as any)?.message ?? e}`;
        stuckRows.add(q.rowId);
        await this.persist(true);
      }
    }
  }
  /** "Send it anyway": for a clash, this device's values win for the fields it changed; otherwise try again. */
  async pushThrough(itemId: string) {
    const q = this.queue.find(x => x.id === itemId);
    if (!q) return;
    q.status = 'sending'; q.attempts += 1; this.notify();
    try {
      await this.sendOne(q, true);
      this.dropItem(q.id);
    } catch (e) {
      const kind = classifyError(e);
      q.status = kind === 'network' ? 'queued' : kind === 'sign_in' ? 'sign_in' : 'failed';
      q.reason = kind === 'network' ? undefined : `${FRIENDLY[kind]}: ${(e as any)?.message ?? e}`;
      await this.persist(true); this.notify();
      throw e;
    }
    await this.persist(true); this.notify();
    await this.flush();
  }
  /** Throw away a change that was never sent, and go back to what the system has. */
  async discard(itemId: string) {
    const q = this.queue.find(x => x.id === itemId);
    if (!q) return;
    this.dropItem(itemId);
    const t = (this.mirror[q.table] ??= {});
    if (q.base) t[q.rowId] = q.base; else delete t[q.rowId];
    await this.persist(true); this.notify();
    this.emit(q.table, t[q.rowId] ?? null);
  }
}
