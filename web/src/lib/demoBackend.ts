// In-browser demo database for training, screenshots and trying ideas without Supabase.
// Data is kept in this browser only (localStorage) and can be reset from the Data screen.
import type { Backend, Filter, Role, Row, Session, WatchSpec } from './backend';
import { clean, uuid } from './backend';
import type { TableName } from './schema';
import { normPhone, samePhone } from './phone';
import { cleanFullName, surname } from './newDrivers';
import { demoSeed, demoSettings } from './demoSeed';
import { daysCovered, docketEntries, docketPeopleDays, planDay } from './timesheetSync';
import { best, canEdit, canRead, effectiveAccess, FEATURES, TABLE_FEATURE, type Perms } from './permissions';

const KEY = 'coho-poc-demo-db-v1';
const SESSION_KEY = 'coho-poc-demo-session-v1';
const DRIVER_TABLES: TableName[] = ['shifts', 'dockets', 'loads', 'signoffs', 'faults', 'timesheet_lines'];
const REFERENCE: TableName[] = ['people', 'work_phones', 'phone_assignments', 'trucks', 'equipment', 'customers', 'locations', 'jobs', 'allocations'];

type Db = Record<string, Row[]>;
type Listener = { specs: WatchSpec[]; cb: (table: TableName, row: Row | null) => void };
export const STALE_FORM = 'This form was changed on another device after you opened it. Tap Reload to get the latest copy, then make your change again.';
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
    // older demo data: add access rows for functions added since (e.g. "forms")
    const fresh = demoSettings().role_permissions as Row[];
    for (const r of fresh) if (!this.t('role_permissions').some(p => p.role === r.role && p.feature === r.feature)) this.t('role_permissions').push(r);
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
    return !!d && ((d.assigned_person_ids ?? []).some((p: string) => mine.includes(p)) || (!!d.assigned_phone_id && this.myPhones().includes(d.assigned_phone_id)));
  }
  private myPhones(): string[] {
    const ph = this.session?.phone;
    return ph ? this.t('work_phones').filter(w => w.active !== false && samePhone(w.phone, ph)).map(w => w.id) : [];
  }
  /** Departments this login reviews; empty = all (same as my_review_departments() in the database). */
  myReviewDepartments(): string[] {
    const s = this.session; if (!s) return [];
    const logins = this.t('app_logins').filter(l => l.active !== false && ((l.email && s.email && l.email.toLowerCase() === s.email.toLowerCase()) || (l.phone && s.phone && samePhone(l.phone, s.phone))));
    if (!logins.length || logins.some(l => !(l.departments ?? []).length)) return [];
    return [...new Set(logins.flatMap(l => l.departments ?? []))] as string[];
  }
  // the database's docket_workflow() trigger: who may assign, completing sends for review, reviewing
  private docketWorkflow(existing: Row | undefined, saved: Row) {
    const p = this.perms(); const admin = this.role() === 'admin'; const now = new Date().toISOString();
    const mineP = this.myPeople(); const mineW = this.myPhones();
    if (!existing) {
      const forOthers = (saved.assigned_phone_id && !mineW.includes(saved.assigned_phone_id)) || (saved.assigned_person_ids ?? []).some((x: string) => !mineP.includes(x));
      if (forOthers && !canEdit(p, 'docket_assign')) throw new Error('Only supervisor, office or admin can assign dockets to someone else (Settings: Assign dockets and roster).');
      if (saved.assigned_phone_id || (saved.assigned_person_ids ?? []).length) { saved.assigned_at = now; saved.assigned_by = this.session?.userId; }
      if (saved.status === 'closed') { saved.completed_at ??= now; saved.review_status ??= 'to_review'; }
      return;
    }
    const changed = (saved.assigned_phone_id ?? null) !== (existing.assigned_phone_id ?? null)
      || JSON.stringify(saved.assigned_person_ids ?? []) !== JSON.stringify(existing.assigned_person_ids ?? []);
    if (changed) {
      if (!canEdit(p, 'docket_assign')) throw new Error('Only supervisor, office or admin can reassign or cancel a docket assignment (Settings: Assign dockets and roster).');
      saved.assigned_at = now; saved.assigned_by = this.session?.userId;
    }
    if (existing.review_status === 'reviewed' && !(admin || canEdit(p, 'docket_review'))) throw new Error('This docket has been reviewed and is locked. Ask a supervisor to reopen it.');
    if (saved.status === 'closed' && existing.status !== 'closed') {
      saved.completed_at = now;
      if ((saved.review_status ?? null) === (existing.review_status ?? null)) saved.review_status = 'to_review';
    } else if (saved.status !== 'closed' && existing.status === 'closed' && saved.review_status === existing.review_status && existing.review_status === 'to_review') saved.review_status = null;
    if (saved.review_status !== existing.review_status && ['reviewed', 'returned'].includes(saved.review_status)) {
      if (!canEdit(p, 'docket_review')) throw new Error('Only someone with Review completed dockets can review a docket.');
      const deps = this.myReviewDepartments();
      if (!admin && deps.length && !deps.includes(saved.department ?? '')) throw new Error(`This docket is for ${saved.department ?? 'no department'}, which is not one of your departments.`);
      saved.reviewed_by = this.session?.userId; saved.reviewed_at = now;
      if (saved.review_status === 'returned') { saved.status = 'open'; saved.completed_at = null; }
    }
  }
  // the database's docket_assignment_texts() trigger
  private docketTexts(existing: Row | undefined, saved: Row) {
    if (existing && (existing.assigned_phone_id ?? null) === (saved.assigned_phone_id ?? null)) return;
    const phone = (id?: string | null) => (id ? this.t('work_phones').find(w => w.id === id)?.phone : undefined);
    const loc = this.t('locations').find(l => l.id === saved.location_id)?.name;
    const day = saved.work_date ?? (saved.start_at ? new Date(saved.start_at).toISOString().slice(0, 10) : null);
    const label = `docket ${saved.docket_no ?? '?'}${day ? ` for ${day.slice(8, 10)}/${day.slice(5, 7)}` : ''}${loc ? ` at ${loc}` : ''}`;
    const out = this.t('sms_outbox');
    const add = (kind: string, wp: string, body: string) => out.push({ id: uuid(), kind, docket_id: saved.id, work_phone_id: wp, phone: phone(wp), body, status: 'pending', attempts: 0, created_at: new Date().toISOString(), created_by: this.session?.userId });
    if (saved.assigned_phone_id && phone(saved.assigned_phone_id)) add('docket_assigned', saved.assigned_phone_id, `Coho Drive: ${label} is assigned to your phone. Open Coho Drive to view it.`);
    if (existing?.assigned_phone_id && phone(existing.assigned_phone_id)) add(saved.assigned_phone_id ? 'docket_moved' : 'docket_cancelled', existing.assigned_phone_id,
      `Coho Drive: ${label} ${saved.assigned_phone_id ? 'has been moved to another crew' : 'has been cancelled for your phone'}. No action needed.`);
  }
  /** Demo stand-in for the docket-sms function: marks queued texts as sent (nothing is really texted). */
  async kickTexts() {
    let n = 0;
    for (const m of this.t('sms_outbox')) if (m.status === 'pending') { m.status = 'sent'; m.sent_at = new Date().toISOString(); m.provider_message_id = 'demo'; n++; this.emit('sms_outbox', m); }
    if (n) this.persist();
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
  // ---------- new drivers (same rules as the database's add/approve/pair_pending_driver) ----------
  private loginName() {
    const s = this.session; if (!s) return null;
    const l = this.t('app_logins').find(x => x.active !== false && ((x.email && s.email && x.email.toLowerCase() === s.email.toLowerCase()) || (x.phone && s.phone && samePhone(x.phone, s.phone))));
    return l?.label ?? l?.email ?? s.email ?? s.phone ?? null;
  }
  async addPendingDriver(fullName: string) {
    if (!this.role() || this.role() === 'undetermined') throw new Error('Sign in first.');
    const phone = this.myPhones()[0];
    if (!phone) throw new Error('Only a crew phone can add a new driver.');
    const name = cleanFullName(fullName);
    if (!name) throw new Error('Type your first name and surname.');
    const people = this.t('people');
    if (people.some(p => p.full_name?.toLowerCase() === name.toLowerCase() && p.active !== false && !p.pending)) throw new Error(`${name} is already a driver. Tap "I am a cover driver" and pick your name.`);
    const again = people.find(p => p.pending && p.added_phone_id === phone && p.full_name?.toLowerCase() === name.toLowerCase());
    if (again) return { ...again };
    const now = new Date().toISOString();
    const person = { id: uuid(), full_name: name, is_driver: true, active: true, pending: true, added_phone_id: phone, added_at: now, added_by: this.session?.userId,
      notes: 'Added on a crew phone. Waiting for a supervisor to check.', created_at: now, created_by: this.session?.userId };
    people.push(person);
    this.t('phone_assignments').push({ id: uuid(), work_phone_id: phone, person_id: person.id, created_at: now });
    this.audit('people', person.id, 'INSERT', null, person);
    this.persist(); this.emit('people', person);
    return { ...person };
  }
  private pendingReady(personId: string) {
    if (!canEdit(this.perms(), 'approvals')) throw new Error('Only people who approve timesheets can check a new driver.');
    const v = this.t('people').find(p => p.id === personId);
    if (!v?.pending) throw new Error('This driver is not waiting to be checked.');
    if (!this.t('timesheet_lines').some(l => l.person_id === personId && l.status === 'submitted')) throw new Error(`${v.full_name} has not sent a timesheet yet. Check them once they send it.`);
    return v;
  }
  async approvePendingDriver(personId: string) {
    const v = this.pendingReady(personId);
    Object.assign(v, { pending: false, review_outcome: 'approved', reviewed_by: this.session?.userId, reviewed_by_name: this.loginName(), reviewed_at: new Date().toISOString(),
      notes: 'Added on a crew phone. Approved as a new driver.' });
    this.audit('people', v.id, 'UPDATE', null, v);
    this.persist(); this.emit('people', v);
    return { ...v };
  }
  async pairPendingDriver(personId: string, targetId: string) {
    const v = this.pendingReady(personId);
    const t = this.t('people').find(p => p.id === targetId);
    if (!t || t.pending || t.active === false || t.id === personId) throw new Error('Pick an active driver to pair the hours to.');
    if (surname(t.full_name) !== surname(v.full_name)) throw new Error(`Hours can only be paired to someone with the same surname as ${v.full_name}.`);
    const lines = this.t('timesheet_lines');
    if (lines.some(l => l.person_id === personId && l.status === 'approved')) throw new Error(`Some of ${v.full_name}'s days are already approved. Ask an admin to reopen them first.`);
    let days = 0; const touched = new Set<string>();
    // a day the person already has is kept as a clash for the approver to resolve
    for (const l of lines.filter(x => x.person_id === personId)) {
      const own = lines.find(x => x.person_id === targetId && x.work_date === l.work_date && x.id !== l.id && !x.clash_with);
      Object.assign(l, { person_id: targetId, driver_comment: `${l.driver_comment ?? ''} (Sent as ${v.full_name})`.trim(), clash_with: own?.id ?? null, clash_from: own ? v.full_name : null });
      days++; if (l.work_date) touched.add(l.work_date);
    }
    for (const f of this.t('form_submissions').filter(x => x.person_id === personId && x.status !== 'approved'))
      if (!this.t('form_submissions').some(x => x.person_id === targetId && x.form_type === f.form_type && x.period_start === f.period_start)) f.person_id = targetId;
    for (const sh of this.t('shifts').filter(x => x.driver_id === personId)) { sh.driver_id = targetId; if (sh.shift_date) touched.add(sh.shift_date); }
    for (const d of this.t('dockets')) {
      const x = d.extras ?? {};
      if (!(d.assigned_person_ids ?? []).includes(personId) && x.s1_operator_id !== personId && x.s2_operator_id !== personId) continue;
      d.assigned_person_ids = (d.assigned_person_ids ?? []).map((id: string) => (id === personId ? targetId : id));
      d.extras = { ...x, ...(x.s1_operator_id === personId ? { s1_operator_id: targetId } : {}), ...(x.s2_operator_id === personId ? { s2_operator_id: targetId } : {}) };
      d.version = (d.version ?? 1) + 1;
      for (const pd of docketPeopleDays(d, this.t('shifts').find(s2 => s2.id === d.shift_id))) touched.add(pd.day);
    }
    const links = this.t('phone_assignments');
    for (const a of links.filter(x => x.person_id === personId)) {
      if (!links.some(x => x.work_phone_id === a.work_phone_id && x.person_id === targetId)) links.push({ id: uuid(), work_phone_id: a.work_phone_id, person_id: targetId });
      links.splice(links.indexOf(a), 1);
    }
    Object.assign(v, { pending: false, active: false, review_outcome: 'paired', paired_to: targetId, reviewed_by: this.session?.userId, reviewed_by_name: this.loginName(),
      reviewed_at: new Date().toISOString(), notes: `Added on a crew phone. Hours paired to ${t.full_name}.` });
    for (const day of touched) { this.refreshDay(targetId, day); this.refreshDay(personId, day); }
    this.audit('people', v.id, 'UPDATE', null, v);
    this.persist(); this.emit('people', v);
    return days;
  }
  async resolveTimesheetClash(keepId: string, removeId: string, amend: { total_hours?: number | null; work_diary_page?: string | null; comment?: string | null }) {
    if (!canEdit(this.perms(), 'approvals')) throw new Error('Only people who approve timesheets can resolve a clash.');
    const lines = this.t('timesheet_lines');
    const k = lines.find(l => l.id === keepId); const r = lines.find(l => l.id === removeId);
    if (!k || !r || !(k.clash_with === r.id || r.clash_with === k.id)) throw new Error('These two lines are not a clash.');
    if (k.status === 'approved' || r.status === 'approved') throw new Error('One of these lines is already approved. Ask an admin to reopen it first.');
    lines.splice(lines.indexOf(r), 1);
    const h = amend.total_hours;
    Object.assign(k, { clash_with: null, clash_from: null, updated_at: new Date().toISOString(),
      ...(h != null ? { total_hours: h, travel_hours: Math.round(Math.max(h - (Number(k.docket_hours) || 0), 0) * 100) / 100, hours_edited: true } : {}),
      ...(amend.work_diary_page ? { work_diary_page: amend.work_diary_page } : {}), ...(amend.comment ? { supervisor_comment: amend.comment } : {}) });
    this.audit('timesheet_lines', r.id, 'DELETE', r, null); this.audit('timesheet_lines', k.id, 'UPDATE', null, k);
    this.persist(); this.emit('timesheet_lines', k);
    return { ...k };
  }
  async peopleForMyPhone() {
    const phone = this.session?.phone;
    const phones = this.t('work_phones').filter(w => samePhone(w.phone, phone)).map(w => w.id);
    const ids = new Set(this.t('phone_assignments').filter(a => phones.includes(a.work_phone_id)).map(a => a.person_id));
    // people linked to login rows with the same email or mobile (a login shared by two people)
    const s = this.session;
    for (const l of this.t('app_logins')) {
      if (!l.person_id || l.active === false || !s) continue;
      if ((l.email && s.email && l.email.toLowerCase() === s.email.toLowerCase()) || (l.phone && s.phone && samePhone(l.phone, s.phone))) ids.add(l.person_id);
    }
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
    if (table === 'timesheet_lines') return canRead(p, 'all_work') || canRead(p, 'approvals')
      || ((own || this.myPeople().includes(r.person_id)) && (canRead(p, 'shifts') || canRead(p, 'forms')));
    if (DRIVER_TABLES.includes(table)) return canRead(p, 'all_work') || ((own || this.assigned(table, r)) && canRead(p, f!));
    if (table === 'form_submissions') return this.formVisible(r);
    if (table === 'app_settings') return true;
    if (table === 'sms_outbox') return canRead(p, 'docket_assign') || canRead(p, 'audit');
    if (table === 'dockets' && (canRead(p, 'docket_assign') || canRead(p, 'docket_review'))) return true;
    if (table === 'form_files') { const s = this.t('form_submissions').find(x => x.id === r.submission_id); return !!s && this.formVisible(s); }
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
    if (table === 'app_settings') return canEdit(p, 'settings');
    if (table === 'form_submissions') {
      if (!existing) return canEdit(p, 'forms') || canEdit(p, 'all_work') || canEdit(p, 'approvals');
      return canEdit(p, 'approvals') || (canEdit(p, 'all_work') && existing.form_type !== 'expense_reimbursement')
        || (canEdit(p, 'forms') && ['draft', 'returned'].includes(existing.status) && this.formMine(existing));
    }
    if (table === 'form_files') {
      const s = this.t('form_submissions').find(x => x.id === (existing?.submission_id ?? body?.submission_id));
      if (!s || !this.formVisible(s) || (s.status === 'approved' && role !== 'admin')) return false;
      if (existing) return existing.created_by === this.session?.userId || canEdit(p, 'approvals');
      return canEdit(p, 'forms') || canEdit(p, 'all_work') || canEdit(p, 'approvals');
    }
    if (table === 'sms_outbox') return false;
    if (table === 'dockets' && existing && (canEdit(p, 'docket_assign') || canEdit(p, 'docket_review'))) return true;
    if (DRIVER_TABLES.includes(table)) {
      if (table === 'timesheet_lines' && existing?.status === 'approved' && role !== 'admin') return false;
      const own = !existing || existing.created_by === this.session?.userId || this.assigned(table, existing)
        || (table === 'timesheet_lines' && this.myPeople().includes(existing.person_id) && (canEdit(p, 'shifts') || canEdit(p, 'forms')));
      return best(p, 'all_work') === 'edit' || (own && canEdit(p, f!)) || (table === 'timesheet_lines' && !!existing && canEdit(p, 'approvals'));
    }
    return f ? canEdit(p, f) : role === 'admin';
  }

  // the database's refresh_timesheet_day(): the driver's line for a day, worked out from their dockets
  private refreshDay(person?: string | null, day?: string | null) {
    if (!person || !day) return;
    const shiftOf = (id?: string | null) => (id ? this.t('shifts').find(x => x.id === id) : undefined);
    const entries = this.t('dockets').flatMap(d => docketEntries(d, shiftOf(d.shift_id))).filter(e => e.person_id === person && e.day === day);
    const lines = this.t('timesheet_lines');
    const existing = lines.filter(l => l.person_id === person && l.work_date === day && !l.clash_with).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];   // clash lines are left for the approver
    const plan = planDay(entries, existing, id => shiftOf(id), id => this.t('locations').find(l => l.id === id)?.name, person, day);
    if (plan === 'delete') { lines.splice(lines.indexOf(existing!), 1); this.emit('timesheet_lines', existing!); return; }
    if (!plan) return;
    const now = new Date().toISOString();
    const row = existing ? { ...plan, updated_at: now } : { id: uuid(), created_at: now, updated_at: now, created_by: this.session?.userId, ...plan };
    if (existing) lines[lines.indexOf(existing)] = row; else lines.push(row);
    this.emit('timesheet_lines', row);
  }
  private syncFromDocket(before: Row | undefined | null, after: Row | null) {
    const shiftOf = (d: Row | null | undefined) => (d?.shift_id ? this.t('shifts').find(x => x.id === d.shift_id) : undefined);
    const pairs = [...docketPeopleDays(before, shiftOf(before)), ...docketPeopleDays(after, shiftOf(after))];
    const seen = new Set<string>();
    for (const p of pairs) { const k = p.person_id + p.day; if (!seen.has(k)) { seen.add(k); this.refreshDay(p.person_id, p.day); } }
  }

  private formMine(s: Row): boolean {
    const mine = this.myPeople();
    return s.created_by === this.session?.userId || (!!s.person_id && mine.includes(s.person_id)) || (s.assigned_person_ids ?? []).some((x: string) => mine.includes(x));
  }
  // same rule as form_submissions_read: expense claims (bank details) only for the claimant and approvers
  private formVisible(s: Row): boolean {
    const p = this.perms();
    return canRead(p, 'approvals') || (canRead(p, 'all_work') && s.form_type !== 'expense_reimbursement') || (canRead(p, 'forms') && this.formMine(s));
  }
  // same rules as the form_guard trigger
  private formGuard(existing: Row | undefined, body: Row, saved: Row) {
    const p = this.perms();
    if (!existing) {
      if (!['draft', 'submitted'].includes(saved.status ?? 'draft') && !canEdit(p, 'approvals')) throw new Error('A new form starts as a draft.');
      saved.version = 1; saved.status ??= 'draft'; saved.data ??= {}; return;
    }
    if (body.version !== undefined && body.version !== (existing.version ?? 1)) throw Object.assign(new Error(STALE_FORM), { code: '40001' });
    if (existing.status === 'approved' && this.role() !== 'admin') throw new Error('This form is approved and locked. Only an admin can change it.');
    if (['approved', 'returned'].includes(saved.status) && saved.status !== existing.status && !canEdit(p, 'approvals')) throw new Error('Only someone with Timesheet approvals can approve or return a form.');
    if (saved.status === 'approved' && existing.status !== 'approved') { saved.approved_by = this.session?.userId; saved.approved_at = new Date().toISOString(); }
    saved.version = (existing.version ?? 1) + 1; saved.updated_by = this.session?.userId;
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
    if (table === 'timesheet_lines' && saved.status === 'approved' && existing?.status !== 'approved' && this.t('people').find(p => p.id === saved.person_id)?.pending)
      throw new Error('This is a new driver waiting to be checked. Approve them as a new driver, or pair their hours to an existing driver, first.');
    if (table === 'timesheet_lines' && saved.status === 'approved' && existing?.status !== 'approved' && (saved.clash_with || this.t('timesheet_lines').some(l => l.clash_with === saved.id)))
      throw new Error('This day has two timesheet lines (a new driver\'s hours were paired to this driver). Resolve the clash first.');
    if (table === 'form_submissions') this.formGuard(existing, body, saved);
    if (table === 'dockets') this.docketWorkflow(existing, saved);
    if (table === 'dockets') {
      if (existing) { saved.version = (existing.version ?? 1) + 1; saved.updated_by = this.session?.userId; }
      else {
        saved.version = 1; saved.assigned_person_ids ??= [];
        saved.docket_no ??= 1 + Math.max(100000, ...this.t('dockets').map(d => Number(d.docket_no) || 0));
      }
    }
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    this.audit(table, saved.id, existing ? 'UPDATE' : 'INSERT', existing, saved);
    if (table === 'dockets') { this.syncFromDocket(existing, saved); this.docketTexts(existing, saved); }
    if (table === 'shifts') for (const x of [saved, existing]) if (x) {
      const days = new Set([x.shift_date, ...(x.sign_in_at && x.sign_out_at && new Date(x.sign_out_at) > new Date(x.sign_in_at) ? daysCovered(x.sign_in_at, x.sign_out_at) : [])]);
      for (const dd of days) this.refreshDay(x.driver_id, dd);
    }
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
    if (table === 'dockets') this.syncFromDocket(gone, null);
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
