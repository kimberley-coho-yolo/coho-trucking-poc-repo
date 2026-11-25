import { describe, expect, it } from 'vitest';
import type { Backend, Row } from './backend';
import { changedPaths, classifyError, mergeOnConflict, OfflineBackend } from './outbox';
import { memoryStore } from './offlineStore';

// A pretend database: can be switched offline, and can have someone else change a record.
function fakeServer() {
  const db: Record<string, Record<string, Row>> = {};
  const state = { up: true };
  const net = () => { if (!state.up) throw new TypeError('Failed to fetch'); };
  const t = (n: string) => (db[n] ??= {});
  const b: Backend = {
    mode: 'demo',
    async getSession() { return { userId: 'u1' }; },
    async sendCode() { net(); }, async verifyCode() { net(); return { userId: 'u1' }; }, async signOut() {},
    async myRole() { net(); return 'driver'; }, async myPermissions() { net(); return { dockets: 'edit' }; },
    async claimFirstAdmin() { return ''; }, async peopleForMyPhone() { net(); return []; },
    async list(table, filter) { net(); return Object.values(t(table)).filter(r => Object.entries(filter ?? {}).every(([k, v]) => r[k] === v)).map(r => ({ ...r })); },
    async get(table, id) { net(); return t(table)[id] ? { ...t(table)[id] } : null; },
    async save(table, row) {
      net();
      const old = t(table)[row.id];
      if (table === 'dockets' && old && row.version !== undefined && row.version !== old.version) throw Object.assign(new Error('This docket was changed on another device'), { code: '40001' });
      if (row.notes === 'forbidden') throw Object.assign(new Error('new row violates row-level security policy'), { code: '42501' });
      const saved = { ...old, ...row, version: (old?.version ?? 0) + 1 };
      t(table)[row.id] = saved; return { ...saved };
    },
    async saveMany() { return 0; }, async remove(table, id) { net(); delete t(table)[id]; }, async runSelect() { return []; },
    watch() { return () => {}; },
  };
  return { b, db, state };
}
async function setup() {
  const s = fakeServer();
  const off = new OfflineBackend(s.b, memoryStore(), { isOnline: () => s.state.up });
  await off.init(false);
  return { ...s, off };
}

describe('outbox: works with no signal', () => {
  it('sorts errors into no signal, clash, sign in and refused', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyError({ name: 'TimeoutError', message: 'signal timed out' })).toBe('network');
    expect(classifyError({ code: '40001', message: 'x' })).toBe('conflict');
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' })).toBe('sign_in');
    expect(classifyError({ code: '42501', message: 'row-level security' })).toBe('rejected');
  });
  it('finds changed fields, looking inside extras', () => {
    expect(changedPaths({ po: 'A', extras: { well: 'X', s1: 1 }, version: 1 }, { po: 'B', extras: { well: 'X', s1: 2 }, version: 2 }).sort()).toEqual(['extras.s1', 'po']);
  });
  it('keeps both changes when they touch different fields, and reports a clash when they touch the same field', () => {
    const base = { id: 'd', po: 'A', notes: 'n', version: 1, extras: { well: 'W' } };
    const ok = mergeOnConflict(base, { ...base, po: 'MINE' }, { ...base, notes: 'THEIRS', version: 2 });
    expect(ok.clashes).toEqual([]);
    expect(ok.merged).toMatchObject({ po: 'MINE', notes: 'THEIRS', version: 2 });
    const clash = mergeOnConflict(base, { ...base, po: 'MINE' }, { ...base, po: 'THEIRS', version: 2 });
    expect(clash.clashes).toEqual(['po']);
  });

  it('saves with no signal, shows the record from this device, and sends it when signal is back', async () => {
    const { off, db, state } = await setup();
    state.up = false;
    const d = await off.save('dockets', { form_type: 'landspray_runsheet', notes: 'offline' });
    expect(d.__queued).toBe(true);
    await off.save('loads', { docket_id: d.id, material: 'Dirty mud' });
    expect((await off.get('dockets', d.id))!.notes).toBe('offline');
    expect(await off.list('loads', { docket_id: d.id })).toHaveLength(1);
    expect(off.outbox().map(q => q.status)).toEqual(['queued', 'queued']);
    expect(db.dockets).toBeUndefined();
    state.up = true;
    await off.flush();
    expect(off.outbox()).toEqual([]);
    expect(db.dockets[d.id].notes).toBe('offline');
    expect(Object.values(db.loads)[0].docket_id).toBe(d.id);   // sent in order: docket first, then its row
  });
  it('two saves of the same record while offline send as one', async () => {
    const { off, state } = await setup();
    state.up = false;
    const d = await off.save('dockets', { notes: 'one' });
    await off.save('dockets', { ...d, notes: 'two', po: 'P1' });
    expect(off.outbox()).toHaveLength(1);
    expect(off.outbox()[0].row).toMatchObject({ notes: 'two', po: 'P1' });
  });
  it('someone else changed other fields meanwhile: both changes are kept without asking', async () => {
    const { off, db, state } = await setup();
    const d = await off.save('dockets', { id: 'd1', po: 'A', notes: 'n' });          // version 1 on the server
    await off.get('dockets', 'd1');
    state.up = false;
    await off.save('dockets', { ...d, po: 'MINE' });                                   // still says version 1
    db.dockets.d1 = { ...db.dockets.d1, notes: 'supervisor', version: 2 };             // changed on site meanwhile
    state.up = true;
    await off.flush();
    expect(off.outbox()).toEqual([]);
    expect(db.dockets.d1).toMatchObject({ po: 'MINE', notes: 'supervisor' });
  });
  it('someone else changed the same field: not sent, explained, and can be pushed through', async () => {
    const { off, db, state } = await setup();
    const d = await off.save('dockets', { id: 'd1', po: 'A' });
    state.up = false;
    await off.save('dockets', { ...d, po: 'MINE' });
    db.dockets.d1 = { ...db.dockets.d1, po: 'THEIRS', version: 2 };
    state.up = true;
    await off.flush();
    const [q] = off.outbox();
    expect(q.status).toBe('failed');
    expect(q.kind).toBe('conflict');
    expect(off.describe(q)).toMatch(/po/);
    await off.pushThrough(q.id);
    expect(off.outbox()).toEqual([]);
    expect(db.dockets.d1.po).toBe('MINE');
  });
  it('a refused change is reported and can be discarded, going back to what the system has', async () => {
    const { off, db, state } = await setup();
    await off.save('dockets', { id: 'd1', notes: 'fine' });
    state.up = false;
    await off.save('dockets', { id: 'd1', notes: 'forbidden', version: 1 });
    state.up = true;
    await off.flush();
    const [q] = off.outbox();
    expect(q.status).toBe('failed');
    expect(off.describe(q)).toMatch(/did not accept/);
    await off.discard(q.id);
    expect(off.outbox()).toEqual([]);
    expect((await off.get('dockets', 'd1'))!.notes).toBe('fine');
    expect(db.dockets.d1.notes).toBe('fine');
  });
  it('still opens offline: role and access come from this device', async () => {
    const { off, state } = await setup();
    expect(await off.myRole()).toBe('driver');
    await off.myPermissions();
    state.up = false;
    expect(await off.myRole()).toBe('driver');
    expect((await off.myPermissions()).dockets).toBe('edit');
  });
  it('a network drop in the middle of a save goes to the outbox instead of failing', async () => {
    const { off, state } = await setup();
    const isOnline = off.isOnline;
    off.isOnline = () => true;                 // the phone thinks it has signal...
    state.up = false;                          // ...but the request fails
    const d = await off.save('dockets', { notes: 'weak signal' });
    expect(d.__queued).toBe(true);
    off.isOnline = isOnline;
  });
});
