import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, Filter, Role, Row, Session } from './backend';
import { clean } from './backend';
import type { TableName } from './schema';
import { toE164 } from './phone';
import type { Perms } from './permissions';

export class SupabaseBackend implements Backend {
  mode = 'supabase' as const;
  sb: SupabaseClient;
  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
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
    const { data, error } = await this.sb.rpc('claim_first_admin', { p_label: 'First admin' });
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
  async runSelect(sql: string) {
    const { data, error } = await this.sb.rpc('run_select', { q: sql });
    if (error) throw error;
    return (data as Row[]) ?? [];
  }
}
