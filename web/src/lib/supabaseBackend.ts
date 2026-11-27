import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, Filter, Role, Row, Session, WatchSpec } from './backend';
import { clean } from './backend';
import type { TableName } from './schema';
import { toE164 } from './phone';
import type { Perms } from './permissions';

export class SupabaseBackend implements Backend {
  mode = 'supabase' as const;
  sb: SupabaseClient;
  constructor(url: string, key: string) {
    // A save that hangs on a weak signal gives up after 20 seconds and goes to the outbox instead.
    const timedFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ?? (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(20_000) : undefined) });
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true }, global: { fetch: timedFetch } });
  }
  async getSession(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    return u ? { userId: u.id, email: u.email, phone: u.phone } : null;
  }
  async sendCode(t: { email?: string; phone?: string }) {
    const { error } = t.phone
      ? await this.sb.auth.signInWithOtp({ phone: toE164(t.phone) })
      : await this.sb.auth.signInWithOtp({ email: t.email!, options: { shouldCreateUser: true } });
    if (error) throw error;
  }
  async verifyCode(t: { email?: string; phone?: string }, code: string): Promise<Session> {
    const { data, error } = t.phone
      ? await this.sb.auth.verifyOtp({ phone: toE164(t.phone), token: code, type: 'sms' })
      : await this.sb.auth.verifyOtp({ email: t.email!, token: code, type: 'email' });
    if (error) throw error;
    const u = data.user!;
    return { userId: u.id, email: u.email, phone: u.phone };
  }
  async signOut() { await this.sb.auth.signOut(); }
  async myRole(): Promise<Role | null> {
    const { data, error } = await this.sb.rpc('app_role');
    if (error) throw error;
    return (data as Role) ?? null;
  }
  async myPermissions() {
    const { data, error } = await this.sb.rpc('my_permissions');
    if (error) throw error;
    return (data as Perms) ?? {};
  }
  async claimFirstAdmin() {
    const { data, error } = await this.sb.rpc('claim_first_admin', { p_label: 'First system admin' });
    if (error) throw error;
    return data as string;
  }
  async peopleForMyPhone() {
    const { data, error } = await this.sb.rpc('people_for_my_phone');
    if (error) throw error;
    return (data as Row[]) ?? [];
  }
  async list(table: TableName, filter?: Filter, order?: { column: string; ascending?: boolean }) {
    let q = this.sb.from(table).select('*');
    for (const [k, v] of Object.entries(filter ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
    if (order) q = q.order(order.column, { ascending: order.ascending ?? true });
    const { data, error } = await q.limit(5000);
    if (error) throw error;
    return data ?? [];
  }
  async get(table: TableName, id: string) {
    const { data, error } = await this.sb.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async save(table: TableName, row: Row) {
    const body = clean(row);
    const { data, error } = await this.sb.from(table).upsert(body).select().single();
    if (error) throw error;
    return data;
  }
  async saveMany(table: TableName, rows: Row[]) {
    if (!rows.length) return 0;
    const { error } = await this.sb.from(table).insert(rows.map(clean));
    if (error) throw error;
    return rows.length;
  }
  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq('id', id);
    if (error) throw error;
  }
  // Supabase Realtime: the database pushes changes to every open device. Row level security still applies.
  watch(specs: WatchSpec[], onChange: (table: TableName, row: Row | null) => void) {
    const ch = this.sb.channel('watch-' + Math.random().toString(36).slice(2));
    for (const s of specs) {
      ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: s.table, ...(s.column ? { filter: `${s.column}=eq.${s.value}` } : {}) },
        (p: any) => onChange(s.table, (p?.new && Object.keys(p.new).length ? p.new : p?.old) ?? null));
    }
    ch.subscribe();
    return () => { this.sb.removeChannel(ch); };
  }
  async kickTexts() {
    await this.sb.functions.invoke('docket-sms', { body: {} }).catch(() => null);
  }
  async addPendingDriver(fullName: string) {
    const { data, error } = await this.sb.rpc('add_pending_driver', { p_full_name: fullName });
    if (error) throw error;
    return data as Row;
  }
  async approvePendingDriver(personId: string) {
    const { data, error } = await this.sb.rpc('approve_pending_driver', { p_person: personId });
    if (error) throw error;
    return data as Row;
  }
  async pairPendingDriver(personId: string, targetId: string) {
    const { data, error } = await this.sb.rpc('pair_pending_driver', { p_person: personId, p_target: targetId });
    if (error) throw error;
    return Number(data) || 0;
  }
  async resolveTimesheetClash(keepId: string, removeId: string, amend: { total_hours?: number | null; work_diary_page?: string | null; comment?: string | null }) {
    const { data, error } = await this.sb.rpc('resolve_timesheet_clash', { p_keep: keepId, p_remove: removeId, p_total_hours: amend.total_hours ?? null,
      p_work_diary_page: amend.work_diary_page ?? null, p_comment: amend.comment ?? null });
    if (error) throw error;
    return data as Row;
  }
  async myReviewDepartments() {
    const { data, error } = await this.sb.rpc('my_review_departments');
    if (error) throw error;
    return (data as string[]) ?? [];
  }
  async runSelect(sql: string) {
    const { data, error } = await this.sb.rpc('run_select', { q: sql });
    if (error) throw error;
    return (data as Row[]) ?? [];
  }
}
