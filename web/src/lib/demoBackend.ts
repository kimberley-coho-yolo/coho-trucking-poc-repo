// In-browser demo database for training, screenshots and trying ideas without Supabase.
// Data is kept in this browser only (localStorage) and can be reset from the Data screen.
import type { Backend, Filter, Role, Row, Session, WatchSpec } from './backend';
import { clean, uuid } from './backend';
import type { TableName } from './schema';
import { normPhone, samePhone } from './phone';
import { demoSeed, demoSettings } from './demoSeed';
import { best, canEdit, canRead, effectiveAccess, FEATURES, TABLE_FEATURE, type Perms } from './permissions';

const KEY = 'coho-poc-demo-db-v1';
const SESSION_KEY = 'coho-poc-demo-session-v1';
const DRIVER_TABLES: TableName[] = ['shifts', 'dockets', 'loads', 'signoffs', 'faults', 'timesheet_lines'];
const REFERENCE: TableName[] = ['people', 'work_phones', 'phone_assignments', 'trucks', 'equipment', 'customers', 'locations', 'jobs', 'allocations'];

type Db = Record<string, Row[]>;
type Listener = { specs: WatchSpec[]; cb: (table: TableName, row: Row | null) => void };
export const STALE_DOCKET = 'This docket was changed on another device after you opened it. Tap Reload to get the latest copy, then make your change again.';

function safeGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* storage full or blocked */ } }

export class DemoBackend implements Backend {
  mode = 'demo' as const;
  db: Db;
  session: Session | null;
  private listeners = new Set<Listener>();
  constructor() {
    const raw = safeGet(KEY);
    this.db = raw ? JSON.parse(raw) : demoSeed();
    if (!this.db.roles) Object.assign(this.db, demoSettings());   // older demo data: add roles and access settings
    const s = safeGet(SESSION_KEY);
    this.session = s ? JSON.parse(s) : null;
    // another tab or window saved: pick up its copy and tell open screens (the demo's stand-in for Supabase Realtime)
    if (typeof window !== 'undefined') window.addEventListener('storage', e => {
      if (e.key !== KEY || !e.newValue) return;
      try { this.db = JSON.parse(e.newValue); } catch { return; }
      for (const l of this.listeners) for (const sp of l.specs) l.cb(sp.table, null);
    });
  }
  watch(specs: WatchSpec[], cb: (table: TableName, row: Row | null) => void) {
    const l: Listener = { specs, cb };
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  private emit(table: TableName, row: Row) {
    for (const l of this.listeners) for (const sp of l.specs)
      if (sp.table === table && (!sp.column || String(row[sp.column]) === sp.value) && this.canSee(table, row)) l.cb(table, { ...row });
  }
  /** People on this work phone, plus a person linked to the login (same as my_person_ids() in the database). */
  private myPeople(): string[] {
    const s = this.session; if (!s) return [];
    const phones = this.t('work_phones').filter(w => w.active !== false && s.phone && samePhone(w.phone, s.phone)).map(w => w.id);
    const ids = new Set(this.t('phone_assignments').filter(a => phones.includes(a.work_phone_id)).map(a => a.person_id));
    for (const l of this.t('app_logins')) if (l.person_id && l.active !== false && ((l.email && s.email && l.email.toLowerCase() === s.email.toLowerCase()) || (l.phone && s.phone && samePhone(l.phone, s.phone)))) ids.add(l.person_id);
    return [...ids];
  }
  private assigned(table: TableName, r: Row | undefined): boolean {
    if (!r) return false;
    const d = table === 'dockets' ? r : (table === 'loads' || table === 'signoffs') ? this.t('dockets').find(x => x.id === r.docket_id) : undefined;
    const mine = this.myPeople();
    return !!d && (d.assigned_person_ids ?? []).some((p: string) => mine.includes(p));
  }
  private persist() { safeSet(KEY, JSON.stringify(this.db)); }
  reset() { this.db = demoSeed(); this.persist(); }
  private t(table: TableName) { return (this.db[table] ??= []); }

  async getSession() { return this.session; }
  async sendCode() { /* demo: the code is always 123456 */ }
  async verifyCode(t: { email?: string; phone?: string }, code: string) {
    if (code.trim() !== '123456') throw new Error('Demo code is 123456');
    const existing = this.t('app_logins').find(l => (t.email && l.email?.toLowerCase() === t.email.toLowerCase()) || (t.phone && samePhone(l.phone, t.phone)));
    const id = existing?.auth_user_id ?? 'demo-' + (t.email?.toLowerCase() ?? normPhone(t.phone));
    this.session = { userId: id, email: t.email ?? null, phone: t.phone ? normPhone(t.phone) : null };
    safeSet(SESSION_KEY, JSON.stringify(this.session));
    return this.session;
  }
  async signOut() { this.session = null; safeSet(SESSION_KEY, 'null'); }

  private role(): Role | null {
    const s = this.session; if (!s) return null;
    const roles = new Map(this.t('roles').filter(r => r.active !== false).map(r => [r.code, r.rank ?? 50]));
    const matches = this.t('app_logins').filter(l => l.active !== false && roles.has(l.role) && (
      (l.email && s.email && l.email.toLowerCase() === s.email.toLowerCase()) || (l.phone && s.phone && samePhone(l.phone, s.phone))));
    matches.sort((a, b) => (roles.get(a.role) ?? 99) - (roles.get(b.role) ?? 99));
    return (matches[0]?.role as Role) ?? null;
  }
  async myRole() { return this.role(); }
  private perms(): Perms {
    const role = this.role();
    const out: Perms = {};
    for (const f of FEATURES) {
      const stored = this.t('role_permissions').find(p => p.role === role && p.feature === f.code)?.access;
      out[f.code] = effectiveAccess(role, f, stored);
    }
    return out;
  }
  async myPermissions() { return this.perms(); }
  async claimFirstAdmin() {
    if (this.t('app_logins').some(l => l.role === 'admin' && l.active !== false)) return 'An admin already exists. Ask them to add you.';
    this.t('app_logins').push({ id: uuid(), label: 'First admin', email: this.session?.email, phone: this.session?.phone, role: 'admin', active: true });
    this.persist(); return 'You are now the admin.';
  }
  async peopleForMyPhone() {
    const phone = this.session?.phone;
    const phones = this.t('work_phones').filter(w => samePhone(w.phone, phone)).map(w => w.id);
    const ids = new Set(this.t('phone_assignments').filter(a => phones.includes(a.work_phone_id)).map(a => a.person_id));
    return this.t('people').filter(p => ids.has(p.id) && p.active !== false);
  }

  // Same rules as the database's row level security (supabase/migrations/*_role_permissions.sql).
  private canSee(table: TableName, r: Row): boolean {
    const role = this.role();
    if (!role) return false;
    const p = this.perms();
    const f = TABLE_FEATURE[table];
    const own = r.created_by === this.session?.userId;
    if (REFERENCE.includes(table) || table === 'roles' || table === 'features' || table === 'role_permissions') return true;
    if (table === 'app_logins') return canRead(p, 'logins') || own;
    if (table === 'prestart_records') return true;
    if (table === 'import_batches') return canRead(p, 'data_transfer') || canRead(p, 'integration_data');
    if (DRIVER_TABLES.includes(table)) return canRead(p, 'all_work') || ((own || this.assigned(table, r)) && canRead(p, f!)) || (table === 'timesheet_lines' && canRead(p, 'approvals'));
    return f ? canRead(p, f) : role === 'admin';
  }
  private canWrite(table: TableName, existing?: Row, body?: Row): boolean {
    const role = this.role();
    if (!role) return false;
    const p = this.perms();
    const f = TABLE_FEATURE[table];
    if (table === 'features' || table === 'audit_log') return false;
    if (table === 'role_permissions') return canEdit(p, 'settings') && (existing?.role ?? body?.role) !== 'admin';
    if (table === 'import_batches') return canEdit(p, 'data_transfer') || canEdit(p, 'integration_data');
    if (DRIVER_TABLES.includes(table)) {
      if (table === 'timesheet_lines' && existing?.status === 'approved' && role !== 'admin') return false;
      const own = !existing || existing.created_by === this.session?.userId || this.assigned(table, existing);
      return best(p, 'all_work') === 'edit' || (own && canEdit(p, f!)) || (table === 'timesheet_lines' && !!existing && canEdit(p, 'approvals'));
    }
    return f ? canEdit(p, f) : role === 'admin';
  }

  async list(table: TableName, filter?: Filter, order?: { column: string; ascending?: boolean }) {
    let rows = this.t(table).filter(r => this.canSee(table, r));
    for (const [k, v] of Object.entries(filter ?? {})) rows = rows.filter(r => (r[k] ?? null) === v);
    if (order) {
      const dir = order.ascending === false ? -1 : 1;
      rows = [...rows].sort((a, b) => String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? '')) * dir);
    }
    return rows.map(r => ({ ...r }));
  }
  async get(table: TableName, id: string) {
    const r = this.t(table).find(x => x.id === id);
    return r && this.canSee(table, r) ? { ...r } : null;
  }
  async save(table: TableName, row: Row) {
    const body = clean(row);
    const list = this.t(table);
    const idx = body.id ? list.findIndex(r => r.id === body.id) : -1;
    const existing = idx >= 0 ? list[idx] : undefined;
    if (!this.canWrite(table, existing, body)) throw new Error('Your role does not have edit access to ' + table);
    if (table === 'roles' && existing?.is_system && body.code && body.code !== existing.code) throw new Error('Built-in role codes cannot change. Change the name instead.');
    if (table === 'roles' && existing?.code === 'admin' && body.active === false) throw new Error('The admin role must stay active.');
    const now = new Date().toISOString();
    if (table === 'dockets' && existing && body.version !== undefined && body.version !== (existing.version ?? 1)) throw Object.assign(new Error(STALE_DOCKET), { code: '40001' });
    const saved: Row = existing
      ? { ...existing, ...body, updated_at: now }
      : { id: uuid(), created_at: now, created_by: this.session?.userId, ...body };
    if (table === 'dockets') {
      if (existing) { saved.version = (existing.version ?? 1) + 1; saved.updated_by = this.session?.userId; }
      else {
        saved.version = 1; saved.assigned_person_ids ??= [];
        saved.docket_no ??= 1 + Math.max(100000, ...this.t('dockets').map(d => Number(d.docket_no) || 0));
      }
    }
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    this.audit(table, saved.id, existing ? 'UPDATE' : 'INSERT', existing, saved);
    this.persist();
    this.emit(table, saved);
    return { ...saved };
  }
  async saveMany(table: TableName, rows: Row[]) {
    for (const r of rows) await this.save(table, r);
    return rows.length;
  }
  async remove(table: TableName, id: string) {
    const list = this.t(table);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return;
    if (!this.canWrite(table, list[idx])) throw new Error('Your role does not have edit access to ' + table);
    if (table === 'roles') {
      if (list[idx].is_system) throw new Error('Built-in roles cannot be deleted. You can rename them instead.');
      if (this.t('app_logins').some(l => l.role === list[idx].code)) throw new Error('This role is still used by a login. Move those logins to another role first.');
      this.db.role_permissions = this.t('role_permissions').filter(p => p.role !== list[idx].code);
    }
    this.audit(table, id, 'DELETE', list[idx], null);
    const gone = list[idx];
    list.splice(idx, 1);
    this.persist();
    for (const l of this.listeners) for (const sp of l.specs) if (sp.table === table && (!sp.column || String(gone[sp.column]) === sp.value)) l.cb(table, null);
  }
  private audit(table: string, id: string, action: string, before: Row | undefined | null, after: Row | null) {
    if (table === 'audit_log') return;
    const log = this.t('audit_log');
    log.push({ id: log.length + 1, table_name: table, record_id: id, action, actor: this.session?.userId, before_data: before ?? null, after_data: after, at: new Date().toISOString() });
    if (log.length > 2000) log.splice(0, log.length - 2000);
  }
  // Demo query console: supports "select * from <table>" with an optional "limit n".
  async runSelect(sql: string) {
    if (!canRead(this.perms(), 'query')) throw new Error('Your role does not have the query console');
    const m = /^\s*select\s+\*\s+from\s+(\w+)(?:\s+limit\s+(\d+))?\s*;?\s*$/i.exec(sql);
    if (!m) throw new Error('Demo mode only supports: select * from <table> [limit n]. The full SQL console works when connected to Supabase.');
    const rows = await this.list(m[1] as TableName);
    return m[2] ? rows.slice(0, Number(m[2])) : rows;
  }
}
