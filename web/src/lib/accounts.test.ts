import { describe, expect, it } from 'vitest';
import { compareTimesheets, docketLines, filterLines, groupTotals, overdueTimesheets, type Lookups } from './accounts';
import { DEFAULT_PERIOD } from './forms';

const people = [{ id: 'p1', full_name: 'Alex Driver' }, { id: 'p2', full_name: 'Sam Driver' }];
const lk: Lookups = {
  customers: [{ id: 'c1', name: 'Origin' }, { id: 'c2', name: 'Santos' }],
  locations: [{ id: 'l1', name: 'SAV 168' }],
  trucks: [{ id: 't1', unit_no: '04', rego: 'XB80KB' }, { id: 't2', unit_no: 'WB1', rego: 'XQ30AZ' }],
  people, phones: [{ id: 'w1', phone: '0491 570 006' }], shifts: [],
};
const dockets = [
  // a two-shift drilling report: 12 h for each operator
  { id: 'd1', docket_no: 101, status: 'closed', review_status: 'to_review', form_type: 'daily_report_drilling', work_date: '2026-11-20', customer_id: 'c1', location_id: 'l1', truck_id: 't1',
    start_at: '2026-11-19T20:00:00Z', end_at: '2026-11-20T20:00:00Z', assigned_phone_id: 'w1',
    extras: { s1_operator_id: '11111111-1111-1111-1111-111111111111', s1_band: '06:00 to 18:00', s2_operator_id: '22222222-2222-2222-2222-222222222222', s2_band: '18:00 to 06:00' } },
  // a potable water docket, 06:00 to 16:00
  { id: 'd2', docket_no: 102, status: 'closed', review_status: 'reviewed', form_type: 'potable_water', work_date: '2026-11-20', customer_id: 'c2', truck_id: 't2',
    start_at: '2026-11-19T20:00:00Z', end_at: '2026-11-20T06:00:00Z', assigned_person_ids: ['p1'] },
  // not started yet
  { id: 'd3', docket_no: 103, status: 'draft', form_type: 'potable_water', work_date: '2026-11-21', customer_id: 'c2', truck_id: 't2', assigned_person_ids: ['p2'] },
];
const ids = { a: '11111111-1111-1111-1111-111111111111', b: '22222222-2222-2222-2222-222222222222' };
const peopleU = [...people, { id: ids.a, full_name: 'Day Op' }, { id: ids.b, full_name: 'Night Op' }];
const loads = [{ docket_id: 'd1', volume_in_l: 12000 }, { docket_id: 'd1', volume_in_l: 8000 }, { docket_id: 'd2', volume_in_l: 14000 }];

describe('accounts reports', () => {
  const lines = docketLines(dockets, loads, { ...lk, people: peopleU });

  it('splits a two-shift report into one line per operator, without counting loads twice', () => {
    const d1 = lines.filter(l => l.docket_id === 'd1');
    expect(d1.map(l => [l.driver, l.hours])).toEqual([['Day Op', 12], ['Night Op', 12]]);
    expect(d1.reduce((s, l) => s + l.loads, 0)).toBe(2);
    expect(d1.reduce((s, l) => s + l.volume_l, 0)).toBe(20000);
    expect(d1[0].crew_phone).toBe('0491 570 006');
  });

  it('works out hours from start and end for other dockets, and 0 for ones not started', () => {
    expect(lines.find(l => l.docket_id === 'd2')!.hours).toBe(10);
    expect(lines.find(l => l.docket_id === 'd3')).toMatchObject({ hours: 0, driver: 'Sam Driver', stage: 'assigned' });
  });

  it('totals per customer, asset, user and status, counting each docket once', () => {
    const byCustomer = groupTotals(lines, 'customer');
    expect(byCustomer.find(g => g.label === 'Origin')).toMatchObject({ dockets: 1, hours: 24, loads: 2 });
    expect(byCustomer.find(g => g.label === 'Santos')).toMatchObject({ dockets: 2, hours: 10 });
    expect(groupTotals(lines, 'asset').find(g => g.label === 'Unit WB1 XQ30AZ')!.dockets).toBe(2);
    expect(groupTotals(lines, 'driver').find(g => g.label === 'Alex Driver')!.hours).toBe(10);
    const byStatus = groupTotals(lines, 'status');
    expect(byStatus.map(g => g.label).sort()).toEqual(['Assigned', 'Completed, to review', 'Reviewed']);
  });

  it('filters by date, customer, truck, driver, status and free text', () => {
    expect(filterLines(lines, { customer_id: 'c2' })).toHaveLength(2);
    expect(filterLines(lines, { truck_id: 't1' })).toHaveLength(2);
    expect(filterLines(lines, { from: '2026-11-21' }).map(l => l.docket_no)).toEqual([103]);
    expect(filterLines(lines, { stage: 'reviewed' }).map(l => l.docket_no)).toEqual([102]);
    expect(filterLines(lines, { text: 'xq30' })).toHaveLength(2);
    expect(filterLines(lines, { person_id: 'p1' })).toHaveLength(1);
  });

  it('lists timesheets not sent after their due date, per driver and period', () => {
    const ts = [
      { person_id: 'p1', work_date: '2026-11-12', status: 'draft', total_hours: 12 },     // fortnight 9-22 Nov, due Tue 24 Nov 19:00
      { person_id: 'p1', work_date: '2026-11-13', status: 'queried', total_hours: 11 },
      { person_id: 'p2', work_date: '2026-11-12', status: 'submitted', total_hours: 12 },
      { person_id: 'p2', work_date: '2026-11-26', status: 'draft', total_hours: 12 },   // this fortnight: not due yet
    ];
    const rows = overdueTimesheets(ts, people, '2026-11-26 10:00', DEFAULT_PERIOD);
    expect(rows).toEqual([{ person_id: 'p1', driver: 'Alex Driver', period_start: '2026-11-09', period_end: '2026-11-22', due: '2026-11-24 19:00',
      days: 2, hours: 23, sent_back: 1, days_overdue: 2 }]);
    // at 18:00 on the due Tuesday it is not overdue yet
    expect(overdueTimesheets(ts, people, '2026-11-24 18:00', DEFAULT_PERIOD)).toEqual([]);
  });

  it('compares the timesheets fed by one truck with their dockets', () => {
    const ts = [
      { person_id: 'p1', work_date: '2026-11-20', status: 'submitted', total_hours: 10.5, docket_hours: 10, truck_id: 't2' },
      { person_id: 'p2', work_date: '2026-11-20', status: 'draft', total_hours: 12, docket_hours: 12, truck_id: 't1' },
    ];
    const rows = compareTimesheets(ts, lines, peopleU, { truck_id: 't2' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driver: 'Alex Driver', timesheet_docket_hours: 10, dockets_hours: 10, difference: 0, assets: 'Unit WB1 XQ30AZ' });
    // a driver with a timesheet but no dockets shows the gap
    const sam = compareTimesheets(ts, lines, peopleU, { person_id: 'p2', from: '2026-11-20', to: '2026-11-20' });
    expect(sam[0]).toMatchObject({ dockets_hours: 0, difference: 12 });
  });
});
