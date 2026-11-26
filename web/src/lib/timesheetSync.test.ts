import { beforeEach, describe, expect, it } from 'vitest';
import { docketEntries, isLong, planDay, qldDate, tsBand } from './timesheetSync';
import { DemoBackend } from './demoBackend';
import type { Row } from './backend';

describe('timesheet from dockets (same rules as the database)', () => {
  it('reads shift times the way each paper form writes them', () => {
    expect(tsBand('6am - 6pm DAY Shift')).toBe('06:00 to 18:00');
    expect(tsBand('6pm - 6am NIGHT Shift')).toBe('18:00 to 06:00');
    expect(tsBand('1800 - 0600')).toBe('18:00 to 06:00');
    expect(tsBand('12:00 to 00:00')).toBe('12:00 to 24:00');
    expect(qldDate('2026-11-19T20:00:00Z')).toBe('2026-11-20');   // 6am Friday in Roma
  });
  it('a docket that has not started gives no time', () => {
    expect(docketEntries({ status: 'draft', work_date: '2026-11-20', assigned_person_ids: ['p1'] })).toEqual([]);
  });
  it('a closed docket gives start to end to its driver', () => {
    const [e] = docketEntries({ status: 'closed', work_date: '2026-11-20', start_at: '2026-11-19T20:00:00Z', end_at: '2026-11-20T07:30:00Z', standby_minutes: 30, assigned_person_ids: ['p1'], extras: { shift_band: '6am - 6pm DAY Shift' } });
    expect(e).toMatchObject({ person_id: 'p1', day: '2026-11-20', hours: 11.5, standby: 0.5, band: '06:00 to 18:00' });
  });
  it('a two-shift daily report gives each operator 12 hours, the night band split 6 + 6 at midnight', () => {
    const es = docketEntries({ status: 'closed', work_date: '2026-11-19', extras: { s1_operator_id: 'p1', s1_band: '06:00 to 18:00', s1_truck_config: 'Dog', s2_operator_id: 'p2', s2_band: '18:00 to 06:00', s2_standby_hours: 12 } });
    expect(es.map(e => [e.person_id, e.day, e.hours, e.with_dog, e.standby])).toEqual([['p1', '2026-11-19', 12, true, null], ['p2', '2026-11-19', 6, null, 12], ['p2', '2026-11-20', 6, null, null]]);
  });
  it('keeps hours the driver typed, and leaves submitted lines alone', () => {
    const es = docketEntries({ status: 'closed', work_date: '2026-11-20', start_at: '2026-11-19T20:00:00Z', end_at: '2026-11-20T07:00:00Z', assigned_person_ids: ['p1'] });
    const kept = planDay(es, { id: 'l1', status: 'draft', total_hours: 12, hours_edited: true }, () => undefined, () => undefined, 'p1', '2026-11-20') as any;
    expect(kept.total_hours).toBe(12);
    expect(kept.docket_hours).toBe(11);
    expect(planDay(es, { id: 'l1', status: 'submitted' }, () => undefined, () => undefined, 'p1', '2026-11-20')).toBeNull();
    expect(planDay([], { id: 'l1', status: 'draft', source: 'dockets' }, () => undefined, () => undefined, 'p1', '2026-11-20')).toBe('delete');
  });
});

describe('demo: closing a docket updates the driver timesheet', () => {
  beforeEach(() => localStorage.clear());
  it('office prepares, driver closes, timesheet line appears with the hours', async () => {
    const office = new DemoBackend();
    await office.verifyCode({ email: 'office@demo.local' }, '123456');
    const sam = (await office.list('people')).find(p => p.full_name === 'Sam Driver')!;
    const d = await office.save('dockets', { form_type: 'landspray_runsheet', status: 'draft', work_date: '2026-11-20', assigned_person_ids: [sam.id], extras: { shift_band: '6am - 6pm DAY Shift' } });
    expect((await office.list('timesheet_lines', { person_id: sam.id })).filter(l => l.work_date === '2026-11-20')).toHaveLength(0);

    const phone = new DemoBackend();
    await phone.verifyCode({ phone: '0400 000 001' }, '123456');
    await phone.save('dockets', { ...d, status: 'closed', start_at: '2026-11-19T20:00:00Z', end_at: '2026-11-20T08:00:00Z' });
    const lines = (await phone.list('timesheet_lines', { person_id: sam.id })).filter(l => l.work_date === '2026-11-20');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ total_hours: 12, docket_hours: 12, shift_band: '06:00 to 18:00', status: 'draft', source: 'dockets' });
  });
});

describe('shifts over 24 hours', () => {
  it('splits a 30 hour shift at midnight and flags both days', () => {
    const es = docketEntries({ status: 'closed', start_at: '2026-11-22T20:00:00Z', end_at: '2026-11-24T02:00:00Z', assigned_person_ids: ['p1'] });   // Mon 06:00 to Tue 12:00 QLD
    expect(es.map(e => [e.day, e.hours, e.split])).toEqual([['2026-11-23', 18, true], ['2026-11-24', 12, true]]);
    expect(es[0].note).toBe('Part of a 30.0 h shift: 23/11 06:00 to 24/11 12:00');
  });
  it('a 6pm to 6am night shift keeps its hours on the day worked: 6 + 6, not flagged 24 h+', () => {
    const es = docketEntries({ status: 'closed', start_at: '2026-11-26T08:00:00Z', end_at: '2026-11-26T20:00:00Z', assigned_person_ids: ['p1'] });  // 18:00 to 06:00
    expect(es.map(e => [e.day, e.hours, e.split, e.note])).toEqual([['2026-11-26', 6, false, null], ['2026-11-27', 6, false, null]]);
    // no times, closed on the night band: also 6 + 6
    const nt = docketEntries({ status: 'closed', work_date: '2026-11-26', assigned_person_ids: ['p1'], extras: { shift_band: '6pm - 6am NIGHT Shift' } });
    expect(nt.map(e => [e.day, e.hours])).toEqual([['2026-11-26', 6], ['2026-11-27', 6]]);
    // ending exactly at midnight is not split
    expect(docketEntries({ status: 'closed', start_at: '2026-11-26T04:00:00Z', end_at: '2026-11-26T14:00:00Z', assigned_person_ids: ['p1'] }).map(e => [e.day, e.hours])).toEqual([['2026-11-26', 10]]);
  });
  it('a 14 hour night is not capped: 6 h on the first day and 8 h on the next', () => {
    const es = docketEntries({ status: 'closed', start_at: '2026-11-26T08:00:00Z', end_at: '2026-11-26T22:00:00Z', assigned_person_ids: ['p1'] });  // 18:00 to 08:00
    expect(es.map(e => [e.day, e.hours])).toEqual([['2026-11-26', 6], ['2026-11-27', 8]]);
  });
  it('the shift total on a day adds the tail of last night and the start of tonight', () => {
    const shifts = [
      { id: 's1', driver_id: 'p1', sign_in_at: '2026-11-26T07:30:00Z', sign_out_at: '2026-11-26T20:30:00Z' },   // Thu 17:30 to Fri 06:30
      { id: 's2', driver_id: 'p1', sign_in_at: '2026-11-27T07:30:00Z', sign_out_at: '2026-11-27T20:30:00Z' },   // Fri 17:30 to Sat 06:30
    ];
    const ds = [
      { id: 'd1', status: 'closed', shift_id: 's1', start_at: '2026-11-26T08:00:00Z', end_at: '2026-11-26T20:00:00Z' },
      { id: 'd2', status: 'closed', shift_id: 's2', start_at: '2026-11-27T08:00:00Z', end_at: '2026-11-27T20:00:00Z' },
    ];
    const shiftOf = (id: string) => shifts.find(s => s.id === id);
    const fri = ds.flatMap(d => docketEntries(d, shiftOf(d.shift_id))).filter(e => e.day === '2026-11-27');
    const plan = planDay(fri, undefined, shiftOf, () => undefined, 'p1', '2026-11-27', shifts) as Row;
    expect(plan).toMatchObject({ docket_hours: 12, total_hours: 13, travel_hours: 1, over_24h: false });   // 6 + 6 docket, 6.5 + 6.5 shift
    // Saturday has only the tail of Friday night
    const sat = ds.flatMap(d => docketEntries(d, shiftOf(d.shift_id))).filter(e => e.day === '2026-11-28');
    expect(planDay(sat, undefined, shiftOf, () => undefined, 'p1', '2026-11-28', shifts)).toMatchObject({ docket_hours: 6, total_hours: 6.5 });
  });
  it('ticking over 24 hours splits even a shorter shift', () => {
    const es = docketEntries({ status: 'closed', over_24h: true, start_at: '2026-11-22T20:00:00Z', end_at: '2026-11-23T16:00:00Z', assigned_person_ids: ['p1'] });
    expect(es.map(e => [e.day, e.hours])).toEqual([['2026-11-23', 18], ['2026-11-24', 2]]);
    expect(isLong('2026-11-22T20:00:00Z', '2026-11-23T16:00:00Z', false)).toBe(false);
  });
});
