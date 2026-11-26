import { beforeEach, describe, expect, it } from 'vitest';
import { allowedLevels, best, defaultAccess, effectiveAccess, FEATURES } from './permissions';
import { DemoBackend } from './demoBackend';
import { roleCode } from '../pages/Settings';

const f = (code: string) => FEATURES.find(x => x.code === code)!;

describe('access rules', () => {
  it('drivers get the basics only by default', () => {
    const edit = FEATURES.filter(x => defaultAccess('driver', x) === 'edit').map(x => x.code).sort();
    expect(edit).toEqual(['dockets', 'faults', 'forms', 'shifts']);
    expect(defaultAccess('driver', f('reports'))).toBe('hidden');
    expect(defaultAccess('driver', f('integrations'))).toBe('hidden');
  });
  it('only admin can ever edit integrations, logins and settings', () => {
    for (const code of ['integrations', 'logins', 'settings']) {
      expect(effectiveAccess('office', f(code), 'edit')).toBe('read');
      expect(effectiveAccess('admin', f(code), 'hidden')).toBe('edit');
      expect(allowedLevels('office', f(code))).toEqual(['hidden', 'read']);
    }
  });
  it('admin can do everything, including reports', () => {
    for (const x of FEATURES) expect(effectiveAccess('admin', x, 'hidden')).toBe('edit');
  });
  it('read-only functions never become editable for other roles', () => {
    expect(effectiveAccess('supervisor', f('reports'), 'edit')).toBe('read');
  });
  it('the higher of two settings wins for shared screens', () => {
    expect(best({ dockets: 'read', all_work: 'edit' }, 'dockets', 'all_work')).toBe('edit');
    expect(best({}, 'dockets')).toBe('hidden');
  });
  it('role names become safe codes', () => {
    expect(roleCode('HSE Manager')).toBe('hse_manager');
    expect(roleCode('3rd party')).toBe('r_3rd_party');
  });
});

describe('demo backend follows the settings', () => {
  beforeEach(() => localStorage.clear());
  it('admin creates a read-only role and it is enforced', async () => {
    const admin = new DemoBackend();
    await admin.verifyCode({ email: 'admin@demo.local' }, '123456');
    await admin.save('roles', { code: 'hse', label: 'HSE', rank: 40, active: true });
    for (const x of FEATURES) await admin.save('role_permissions', { role: 'hse', feature: x.code, access: x.code === 'faults' ? 'read' : 'hidden' });
    await admin.save('app_logins', { label: 'HSE', email: 'hse@demo.local', role: 'hse', active: true });
    await expect(admin.save('role_permissions', { role: 'admin', feature: 'reports', access: 'hidden' })).rejects.toThrow();

    const hse = new DemoBackend();
    await hse.verifyCode({ email: 'hse@demo.local' }, '123456');
    const p = await hse.myPermissions();
    expect(p.faults).toBe('read');
    expect(p.reports).toBe('hidden');
    await expect(hse.save('faults', { description: 'x' })).rejects.toThrow();
    await expect(hse.save('role_permissions', { role: 'hse', feature: 'reports', access: 'read' })).rejects.toThrow();
  });
  it('office can view but not edit integrations; admin can edit', async () => {
    const office = new DemoBackend();
    await office.verifyCode({ email: 'office@demo.local' }, '123456');
    const rows = await office.list('integrations');
    expect(rows.length).toBeGreaterThan(0);
    await expect(office.save('integrations', { id: rows[0].id, owner: 'x' })).rejects.toThrow();
    const admin = new DemoBackend();
    await admin.verifyCode({ email: 'admin@demo.local' }, '123456');
    expect((await admin.save('integrations', { id: rows[0].id, owner: 'Kim' })).owner).toBe('Kim');
  });
  it('built-in roles cannot be deleted and roles in use are kept', async () => {
    const admin = new DemoBackend();
    await admin.verifyCode({ email: 'admin@demo.local' }, '123456');
    const driver = (await admin.list('roles')).find(r => r.code === 'driver')!;
    await expect(admin.remove('roles', driver.id)).rejects.toThrow();
  });
});

describe('undetermined role and shared logins', () => {
  beforeEach(() => localStorage.clear());
  it('an undetermined login sees nothing at all', () => {
    for (const f of FEATURES) expect(defaultAccess('undetermined', f)).toBe('hidden');
  });
  it('a login shared by two people offers both names and the role waits for the admin', async () => {
    const b = new DemoBackend();
    await b.verifyCode({ email: 'admin@demo.local' }, '123456');
    const max = await b.save('people', { full_name: 'Max Example', is_driver: false, active: true });
    const tom = await b.save('people', { full_name: 'Tom Example', is_driver: false, active: true });
    await b.save('app_logins', { label: 'Max Example', email: 'fieldsup@demo.local', role: 'undetermined', person_id: max.id, active: true });
    await b.save('app_logins', { label: 'Tom Example', email: 'fieldsup@demo.local', role: 'undetermined', person_id: tom.id, active: true });
    await b.signOut();
    await b.verifyCode({ email: 'fieldsup@demo.local' }, '123456');
    expect(await b.myRole()).toBe('undetermined');
    expect(Object.values(await b.myPermissions()).every(a => a === 'hidden')).toBe(true);
    expect((await b.peopleForMyPhone()).map(p => p.full_name).sort()).toEqual(['Max Example', 'Tom Example']);
  });
});
