// In-browser demo database for training, screenshots and trying ideas without Supabase.
// Data is kept in this browser only (localStorage) and can be reset from the Data screen.
import type { Backend, Filter, Role, Row, Session } from './backend';
import { clean, uuid } from './backend';
import type { TableName } from './schema';
import { normPhone, samePhone } from './phone';
import { demoSeed } from './demoSeed';

const KEY = 'coho-poc-demo-db-v1';
const SESSION_KEY = 'coho-poc-demo-session-v1';
const DRIVER_TABLES: TableName[] = ['shifts', 'dockets', 'loads', 'signoffs', 'faults', 'timesheet_lines'];
const STAFF_ONLY: TableName[] = ['gps_trips', 'km_segments', 'import_batches', 'audit_log'];
const OFFICE_WRITE: TableName[] = ['people', 'work_phones', 'phone_assignments', 'trucks', 'equipment', 'customers', 'locations', 'jobs', 'allocations', 'integrations', 'gps_trips', 'prestart_records', 'km_segments', 'import_batches'];

type Db = Record<string, Row[]>;

function safeGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* storage full or blocked */ } }

export class DemoBackend implements Backend {
  mode = 'demo' as const;
  db: Db;
  session: Session | null;
  constructor() {
    const raw = safeGet(KEY);
    this.db = raw ? JSON.parse(raw) : demoSeed();
    const s = safeGet(SESSION_KEY);
    this.session = s ? JSON.parse(s) : null;
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
    const rank: Record<string, number> = { admin: 1, office: 2, supervisor: 3, driver: 4 };
    const matches = this.t('app_logins').filter(l => l.active !== false && (
      (l.email && s.email && l.email.toLowerCase() === s.email.toLowerCase()) || (l.phone && s.phone && samePhone(l.phone, s.phone))));
    matches.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9));
    return (matches[0]?.role as Role) ?? null;
  }
  async myRole() { return this.role(); }
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

  private canSee(table: TableName, r: Row): boolean {
    const role = this.role();
    if (!role) return false;
    if (table === 'app_logins') return role === 'admin';
    if (STAFF_ONLY.includes(table)) return role !== 'driver';
    if (DRIVER_TABLES.includes(table)) return role !== 'driver' || r.created_by === this.session?.userId;
    return true;
  }
  private canWrite(table: TableName, existing?: Row): boolean {
    const role = this.role();
    if (!role) return false;
    if (table === 'app_logins') return role === 'admin';
    if (DRIVER_TABLES.includes(table)) {
      if (table === 'timesheet_lines' && existing?.status === 'approved' && role !== 'admin') return false;
      return role !== 'driver' || !existing || existing.created_by === this.session?.userId;
    }
    if (OFFICE_WRITE.includes(table)) return role === 'admin' || role === 'office';
    return role === 'admin';
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
    if (!this.canWrite(table, existing)) throw new Error('You do not have access to change ' + table);
    const now = new Date().toISOString();
    const saved: Row = existing
      ? { ...existing, ...body, updated_at: now }
      : { id: uuid(), created_at: now, created_by: this.session?.userId, ...body };
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    this.audit(table, saved.id, existing ? 'UPDATE' : 'INSERT', existing, saved);
    this.persist();
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
    if (!this.canWrite(table, list[idx])) throw new Error('You do not have access to delete from ' + table);
    this.audit(table, id, 'DELETE', list[idx], null);
    list.splice(idx, 1);
    this.persist();
  }
  private audit(table: string, id: string, action: string, before: Row | undefined | null, after: Row | null) {
    if (table === 'audit_log') return;
    const log = this.t('audit_log');
    log.push({ id: log.length + 1, table_name: table, record_id: id, action, actor: this.session?.userId, before_data: before ?? null, after_data: after, at: new Date().toISOString() });
    if (log.length > 2000) log.splice(0, log.length - 2000);
  }
  // Demo query console: supports "select * from <table>" with an optional "limit n".
  async runSelect(sql: string) {
    const role = this.role();
    if (role !== 'admin' && role !== 'office') throw new Error('Only admin or office can run queries');
    const m = /^\s*select\s+\*\s+from\s+(\w+)(?:\s+limit\s+(\d+))?\s*;?\s*$/i.exec(sql);
    if (!m) throw new Error('Demo mode only supports: select * from <table> [limit n]. The full SQL console works when connected to Supabase.');
    const rows = await this.list(m[1] as TableName);
    return m[2] ? rows.slice(0, Number(m[2])) : rows;
  }
}
