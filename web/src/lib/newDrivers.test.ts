import { beforeEach, describe, expect, it } from 'vitest';
import { cleanFullName, matchesFor, newDriverReport, pendingOnDocket, pickable, surname } from './newDrivers';
import { DEFAULT_PERIOD } from './forms';
import { DemoBackend } from './demoBackend';

const people = [
  { id: 'a', full_name: 'Robert Nguyen', active: true }, { id: 'b', full_name: 'Anh Nguyen', active: true },
  { id: 'c', full_name: 'Old Nguyen', active: false }, { id: 'd', full_name: 'Sam Driver', active: true },
  { id: 'p', full_name: 'Bob  Nguyen', pending: true, active: true, added_at: '2026-11-25T22:00:00Z', added_phone_id: 'w1' },
  { id: 'q', full_name: 'Kim Quinlan', active: true, review_outcome: 'approved', reviewed_by_name: 'Pay office', reviewed_at: '2026-11-26T01:00:00Z', added_at: '2026-11-19T20:00:00Z', added_phone_id: 'w1' },
  { id: 'r', full_name: 'Jo Smith', active: false, review_outcome: 'paired', paired_to: 'd', reviewed_by_name: 'Demo supervisor', reviewed_at: '2026-11-26T02:00:00Z', added_at: '2026-11-26T00:30:00Z' },
];

describe('new drivers', () => {
  it('reads the surname, ignoring nicknames, and needs a first name and surname', () => {
    expect(surname('Simon Ennor (Tank)')).toBe('ennor');
    expect(surname(' Bob   Nguyen ')).toBe('nguyen');
    expect(cleanFullName('  bob   nguyen ')).toBe('bob nguyen');
    expect(cleanFullName('Bob')).toBeNull();
  });
  it('offers only active people with exactly the same surname', () => {
    expect(matchesFor(people[4], people).map(p => p.full_name)).toEqual(['Anh Nguyen', 'Robert Nguyen']);
    expect(matchesFor({ id: 'x', full_name: 'Bob Ngyuen' }, people)).toEqual([]);
  });
  it('flags dockets that have a pending driver, and hides pending names from pick lists', () => {
    expect(pendingOnDocket({ assigned_person_ids: ['d'], extras: { s2_operator_id: 'p' } }, people).map(p => p.id)).toEqual(['p']);
    expect(pendingOnDocket({ assigned_person_ids: ['d'] }, people)).toEqual([]);
    expect(pickable(people).map(p => p.id)).toEqual(['a', 'b', 'd', 'q']);
  });
  it('reports each week: how many were added, approved, paired or waiting, by whom and when', () => {
    const weeks = newDriverReport(people, [{ id: 'w1', phone: '0400 000 001' }], DEFAULT_PERIOD);
    expect(weeks.map(w => [w.week_start, w.added, w.approved, w.paired, w.waiting])).toEqual([['2026-11-23', 2, 0, 1, 1], ['2026-11-16', 1, 1, 0, 0]]);
    expect(weeks[1].rows[0]).toMatchObject({ name: 'Kim Quinlan', crew_phone: '0400 000 001', outcome_label: 'Approved as a new driver', checked_by: 'Pay office' });
    expect(weeks[0].rows.find(r => r.name === 'Jo Smith')).toMatchObject({ outcome_label: 'Hours paired to Sam Driver', checked_by: 'Demo supervisor' });
  });
});

describe('new drivers in demo mode (same rules as the database)', () => {
  beforeEach(() => localStorage.clear());
  it('a crew phone adds a pending driver; an approver pairs or approves once the timesheet is sent', async () => {
    const b = new DemoBackend();
    await b.verifyCode({ phone: '0400 000 001' }, '123456');
    await expect(b.addPendingDriver('Bob')).rejects.toThrow('first name and surname');
    await expect(b.addPendingDriver('Alex Driver')).rejects.toThrow('already a driver');
    const bob = await b.addPendingDriver(' Bob   Driver ');
    expect(bob).toMatchObject({ full_name: 'Bob Driver', pending: true });
    expect((await b.peopleForMyPhone()).map(p => p.full_name)).toContain('Bob Driver');
    const line = await b.save('timesheet_lines', { person_id: bob.id, work_date: '2026-11-20', status: 'submitted', total_hours: 12 });
    // a second day on a date Alex already has a line for: a clash
    const alexDay = (await b.list('timesheet_lines', { person_id: '44444444-0000-0000-0000-000000000001' }))[0];
    const clashLine = await b.save('timesheet_lines', { person_id: bob.id, work_date: alexDay.work_date, status: 'submitted', total_hours: 9, work_diary_page: '55' });
    await b.signOut();
    await b.verifyCode({ email: 'supervisor@demo.local' }, '123456');
    await expect(b.save('timesheet_lines', { id: line.id, status: 'approved' })).rejects.toThrow('new driver waiting to be checked');
    await expect(b.pairPendingDriver(bob.id, '44444444-0000-0000-0000-000000000003')).rejects.toThrow('same surname');
    expect(await b.pairPendingDriver(bob.id, '44444444-0000-0000-0000-000000000001')).toBe(2);   // Alex Driver
    const moved = await b.get('timesheet_lines', line.id);
    expect(moved).toMatchObject({ person_id: '44444444-0000-0000-0000-000000000001', status: 'submitted', clash_with: null });
    // the clash day keeps both lines; neither can be approved until the approver keeps one
    expect(await b.get('timesheet_lines', clashLine.id)).toMatchObject({ person_id: '44444444-0000-0000-0000-000000000001', clash_with: alexDay.id, clash_from: 'Bob Driver' });
    expect(await b.get('timesheet_lines', alexDay.id)).toMatchObject({ total_hours: alexDay.total_hours });
    await expect(b.save('timesheet_lines', { id: alexDay.id, status: 'approved' })).rejects.toThrow('Resolve the clash first');
    const kept = await b.resolveTimesheetClash(clashLine.id, alexDay.id, { total_hours: 11.5, comment: 'Bob was right' });
    expect(kept).toMatchObject({ clash_with: null, total_hours: 11.5, hours_edited: true, work_diary_page: '55', supervisor_comment: 'Bob was right' });
    expect(await b.get('timesheet_lines', alexDay.id)).toBeNull();
    await b.save('timesheet_lines', { id: clashLine.id, status: 'approved' });
    expect(await b.get('people', bob.id)).toMatchObject({ pending: false, active: false, review_outcome: 'paired', reviewed_by_name: 'Demo supervisor' });
  });
});
