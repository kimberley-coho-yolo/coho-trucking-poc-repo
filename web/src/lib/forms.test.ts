import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, DEFAULT_PERIOD, fortnightStart, fortnightTotals, linesTotal, periodDays, periodEnd, periodStart, SIMPLE_FORMS, submitBy, timesheetReminders, weekday } from './forms';
import { DemoBackend } from './demoBackend';

describe('timesheet periods (weeks start on Monday by default)', () => {
  it('fortnights run Monday to Sunday from the cycle anchor: 9-22 Nov 2026, then 23 Nov-6 Dec', () => {
    expect(fortnightStart('2026-11-09')).toBe('2026-11-09');
    expect(fortnightStart('2026-11-22')).toBe('2026-11-09');
    expect(periodEnd('2026-11-09', 'fortnight')).toBe('2026-11-22');
    expect(fortnightStart('2026-11-23')).toBe('2026-11-23');
    expect(fortnightStart('2026-12-06')).toBe('2026-11-23');
    expect(periodEnd('2026-11-23', 'fortnight')).toBe('2026-12-06');
    expect(fortnightStart('2026-11-08')).toBe('2026-10-26');
    expect(weekday(fortnightStart('2027-03-03'))).toBe('Monday');
  });
  it('a week runs from the start day; changing it to Thursday moves every period', () => {
    expect(periodStart('2026-11-25', DEFAULT_PERIOD, 'week')).toBe('2026-11-23');
    expect(periodStart('2026-11-22', DEFAULT_PERIOD, 'week')).toBe('2026-11-16');
    const thu = { ...DEFAULT_PERIOD, weekStart: 4 };
    expect(periodStart('2026-11-25', thu, 'week')).toBe('2026-11-19');
    expect(weekday(periodStart('2026-11-25', thu, 'fortnight'))).toBe('Thursday');
    expect(periodDays('2026-11-25', 'week')).toHaveLength(7);
    expect(periodEnd('2026-11-25', 'fortnight')).toBe('2026-12-08');
  });
  it('is due 19:00 on the Tuesday after the period ends', () => {
    expect(submitBy('2026-11-09')).toBe('2026-11-24 19:00');
    expect(submitBy('2026-11-23')).toBe('2026-12-08 19:00');
    expect(weekday('2026-11-24')).toBe('Tuesday');
    expect(submitBy('2026-11-23', 'week')).toBe('2026-12-01 19:00');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('reminds about days sent back, overdue periods, and a period due tomorrow', () => {
    const lines = [
      { work_date: '2026-11-10', status: 'draft' }, { work_date: '2026-11-11', status: 'draft' },   // fortnight 9-22 Nov, due Tue 24 Nov 19:00
      { work_date: '2026-11-17', status: 'queried' },                                                // sent back
      { work_date: '2026-11-25', status: 'draft' },                                                  // current fortnight, not due yet
      { work_date: '2026-11-12', status: 'submitted' },
    ];
    const r = timesheetReminders(lines, '2026-11-25', DEFAULT_PERIOD);
    expect(r.map(x => [x.kind, x.start, x.days])).toEqual([['returned', '2026-11-09', 1], ['overdue', '2026-11-09', 2]]);
    // ended Sunday 22 Nov, due Tuesday 24 Nov 19:00: on the Monday and Tuesday it is due soon, not overdue
    expect(timesheetReminders([{ work_date: '2026-11-10', status: 'draft' }], '2026-11-23', DEFAULT_PERIOD).map(x => x.kind)).toEqual(['due_soon']);
    expect(timesheetReminders([{ work_date: '2026-11-10', status: 'draft' }], '2026-11-24', DEFAULT_PERIOD).map(x => x.kind)).toEqual(['due_soon']);
  });
  it('works out the totals like the paper sheet (example: 9 x 12 h + 6 h with dog, 4 R&R)', () => {
    const lines = [
      ...Array.from({ length: 9 }, () => ({ on_shift: true, total_hours: 12, with_dog: true })),
      { on_shift: true, total_hours: 6, with_dog: true },
      ...Array.from({ length: 4 }, () => ({ rr: true, on_shift: false })),
    ];
    expect(fortnightTotals(lines)).toEqual({ truckHours: 0, truckAndDogHours: 114, infieldDays: 10, totalHours: 114 });
  });
});

describe('expense claims and checklists', () => {
  beforeEach(() => localStorage.clear());
  it('adds up expense lines', () => {
    expect(linesTotal([{ amount: 55.5 }, { amount: '20.25' }, {}], 'amount')).toBe(75.75);
  });
  it('every simple form has a sign-off and an approval step', () => {
    for (const f of SIMPLE_FORMS) { expect(f.signoff.title).toBeTruthy(); expect(f.approval.verb).toBeTruthy(); }
  });
  it('a driver cannot approve their own claim; once approved it is locked; others cannot see the claim', async () => {
    const driver = new DemoBackend();
    await driver.verifyCode({ phone: '0400 000 001' }, '123456');
    const alex = (await driver.peopleForMyPhone()).find(p => p.full_name === 'Alex Driver')!;
    const claim = await driver.save('form_submissions', { form_type: 'expense_reimbursement', status: 'draft', person_id: alex.id, data: { lines: [{ item: 'Fuel', amount: 55.5 }] } });
    await driver.save('form_files', { submission_id: claim.id, kind: 'receipt', data_url: 'data:image/jpeg;base64,AAAA' });
    await expect(driver.save('form_submissions', { ...claim, status: 'approved' })).rejects.toThrow(/approvals/);
    const sent = await driver.save('form_submissions', { ...claim, status: 'submitted' });
    await expect(driver.save('form_submissions', { ...sent, title: 'changed' })).rejects.toThrow();     // submitted: driver can no longer change it

    const sup = new DemoBackend();
    await sup.verifyCode({ email: 'supervisor@demo.local' }, '123456');
    expect(await sup.list('form_files', { submission_id: claim.id })).toHaveLength(1);
    await expect(sup.save('form_submissions', { ...sent, approver_name: 'x', version: 1 })).rejects.toThrow(/another device/);
    const ok = await sup.save('form_submissions', { ...sent, status: 'approved', approver_name: 'Lindsay Harris' });
    expect(ok.approved_at).toBeTruthy();
    await expect(sup.save('form_submissions', { ...ok, approver_comment: 'late change' })).rejects.toThrow(/locked/);
  });
});
