import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend } from './demoBackend';
describe('demo backend access rules', () => {
  beforeEach(() => localStorage.clear());
  it('driver phone sees its two assigned names and cannot edit trucks', async () => {
    const b = new DemoBackend();
    await b.verifyCode({ phone: '0400 000 001' }, '123456');
    expect(await b.myRole()).toBe('driver');
    expect((await b.peopleForMyPhone()).map(p => p.full_name).sort()).toEqual(['Alex Driver', 'Sam Driver']);
    await expect(b.save('trucks', { unit_no: '99' })).rejects.toThrow();
  });
  it('admin can add a login with an email and a mobile', async () => {
    const b = new DemoBackend();
    await b.verifyCode({ email: 'admin@demo.local' }, '123456');
    const saved = await b.save('app_logins', { label: 'New supervisor', email: 'sup2@demo.local', phone: '0411 111 111', role: 'supervisor' });
    expect(saved.id).toBeTruthy();
  });
  it('approved timesheet lines are locked for non-admins', async () => {
    const b = new DemoBackend();
    await b.verifyCode({ email: 'supervisor@demo.local' }, '123456');
    const line = await b.save('timesheet_lines', { status: 'approved', total_hours: 12 });
    await expect(b.save('timesheet_lines', { id: line.id, total_hours: 13 })).rejects.toThrow();
  });
  it('rejects the wrong demo code', async () => {
    await expect(new DemoBackend().verifyCode({ email: 'admin@demo.local' }, '000000')).rejects.toThrow();
  });
});
