import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, DEFAULT_PERIOD, fortnightStart, fortnightTotals, linesTotal, periodDays, periodEnd, periodStart, SIMPLE_FORMS, submitBy, timesheetReminders, weekday } from './forms';
import { DemoBackend } from './demoBackend';

describe('timesheet periods (weeks start on Wednesday by default)', () => {
  it('fortnights run Wednesday to Tuesday from the cycle anchor', () => {
    expect(fortnightStart('2026-11-11')).toBe('2026-11-11');
    expect(fortnightStart('2026-11-24')).toBe('2026-11-11');
    expect(fortnightStart('2026-11-25')).toBe('2026-11-25');
    expect(fortnightStart('2026-11-10')).toBe('2026-10-28');
    expect(weekday(fortnightStart('2027-03-03'))).toBe('Wednesday');
  });
  it('a week runs from the start day; changing it to Thursday moves every period', () => {
    expect(periodStart('2026-11-25', DEFAULT_PERIOD, 'week')).toBe('2026-11-25');
    expect(periodStart('2026-11-24', DEFAULT_PERIOD, 'week')).toBe('2026-11-18');
    const thu = { ...DEFAULT_PERIOD, weekStart: 4 };
    expect(periodStart('2026-11-25', thu, 'week')).toBe('2026-11-19');
    expect(weekday(periodStart('2026-11-25', thu, 'fortnight'))).toBe('Thursday');
    expect(periodDays('2026-11-25', 'week')).toHaveLength(7);
    expect(periodEnd('2026-11-25', 'fortnight')).toBe('2026-12-08');
  });
  it('is due 09:00 on the first day of the next period', () => {
    expect(submitBy('2026-11-11')).toBe('2026-11-25 09:00');
    expect(submitBy('2026-11-25', 'week')).toBe('2026-12-02 09:00');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('reminds about days sent back, overdue periods, and a period due tomorrow', () => {
    const lines = [
      { work_date: '2026-11-12', status: 'draft' }, { work_date: '2026-11-13', status: 'draft' },   // fortnight 11-24 Nov, ended
      { work_date: '2026-11-20', status: 'queried' },                                                // sent back
      { work_date: '2026-11-26', status: 'draft' },                                                  // current fortnight, not due yet
      { work_date: '2026-11-14', status: 'submitted' },
    ];
    const r = timesheetReminders(lines, '2026-11-27', DEFAULT_PERIOD);
    expect(r.map(x => [x.kind, x.start, x.days])).toEqual([['returned', '2026-11-11', 1], ['overdue', '2026-11-11', 2]]);
    expect(timesheetReminders([{ work_date: '2026-12-07', status: 'draft' }], '2026-12-08', DEFAULT_PERIOD).map(x => x.kind)).toEqual(['due_soon']);
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
