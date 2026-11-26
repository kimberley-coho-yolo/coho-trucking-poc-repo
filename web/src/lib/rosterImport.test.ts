import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { checkRoster, docketMatches, phoneMatches, rosterDate, rosterTemplate, ROSTER_COLUMNS, type RosterLists } from './rosterImport';
import { docketPdf } from './docketPdf';

const lists: RosterLists = {
  phones: [{ id: 'w1', phone: '0491 570 006', label: 'Crew phone U04' }],
  trucks: [{ id: 't1', unit_no: '04', rego: 'XB80KB' }, { id: 't2', unit_no: 'WB1', rego: 'XQ30AZ' }],
  people: [{ id: 'p1', full_name: 'Alex Driver' }, { id: 'p2', full_name: 'Sam Driver' }],
  customers: [{ id: 'c1', name: 'Santos', short_name: 'Santos' }, { id: 'c2', name: 'Origin Energy', short_name: 'Origin' }],
  locations: [{ id: 'l1', name: 'ENS 968' }],
};

describe('roster upload', () => {
  it('reads dates written different ways, and Excel dates', () => {
    expect(rosterDate('27/11/2026')).toBe('2026-11-27');
    expect(rosterDate('2026-11-27')).toBe('2026-11-27');
    expect(rosterDate('7/1/27')).toBe('2027-01-07');
    expect(rosterDate(46353)).toBe('2026-11-27');
    expect(rosterDate('next week')).toBeNull();
    expect(rosterDate('13/13/2026')).toBeNull();
  });

  it('turns a good row into a docket and matches by rego, unit, phone and names', () => {
    const [r] = checkRoster([{ Date: '27/11/2026', Shift: 'Night', 'Crew phone': '0491570006', Truck: 'unit 4', Drivers: 'alex driver; Sam Driver',
      Customer: 'origin', 'Rig / location': 'ENS 968', Form: 'Landspray 12 hour runsheet', Department: 'landspray', PO: 'PO-1' }], lists);
    expect(r.errors).toEqual([]);
    expect(r.docket).toMatchObject({ form_type: 'landspray_runsheet', work_date: '2026-11-27', truck_id: 't1', assigned_phone_id: 'w1', customer_id: 'c2',
      location_id: 'l1', department: 'Landspray', assigned_person_ids: ['p1', 'p2'], po: 'PO-1', status: 'draft',
      extras: { roster_shift: 'Night', shift_band: '6pm - 6am NIGHT Shift' } });
    // rego works too, and the form defaults from the department
    const [r2] = checkRoster([{ Date: '27/11/2026', Truck: 'xq30az', Department: 'Drilling' }], lists);
    expect(r2.docket).toMatchObject({ truck_id: 't2', form_type: 'daily_report_drilling', assigned_phone_id: null, extras: { roster_shift: 'Day' } });
  });

  it('lists every problem on a row and creates nothing for it; blank rows are skipped', () => {
    const rows = checkRoster([
      { Date: 'tomorrow', Shift: 'Arvo', 'Crew phone': '0400 999 999', Truck: 'ZZ99ZZ', Drivers: 'Nobody', Customer: 'Acme', 'Rig / location': 'Mars', Form: 'Timesheet', Department: 'Fishing' },
      { Date: null, Truck: '' },
    ], lists);
    expect(rows).toHaveLength(1);
    expect(rows[0].docket).toBeNull();
    expect(rows[0].errors).toHaveLength(9);
    expect(rows[0].line).toBe(2);
  });

  it('makes a template with the right columns and a Lists sheet', () => {
    const wb = rosterTemplate(lists);
    expect(wb.SheetNames).toEqual(['Roster', 'Lists']);
    const head = XLSX.utils.sheet_to_json(wb.Sheets.Roster, { header: 1 })[0];
    expect(head).toEqual([...ROSTER_COLUMNS]);
    // the template's own example rows pass the check
    const rows = checkRoster(XLSX.utils.sheet_to_json(wb.Sheets.Roster, { defval: null, raw: true }), lists);
    expect(rows.every(r => r.errors.length === 0)).toBe(true);
  });
});

describe('roster search', () => {
  const d = { id: 'd1', docket_no: 2041, truck_id: 't2', assigned_phone_id: 'w1', assigned_person_ids: ['p2'] };
  const l = { trucks: lists.trucks, people: lists.people, phones: lists.phones };
  it('finds a docket by rego, unit, driver, mobile number or docket number', () => {
    for (const q of ['XQ30', 'xq30az', 'WB1', 'unit wb1', 'sam', '0491 570', '491570006', '2041']) expect(docketMatches(q, d, l)).toBe(true);
    for (const q of ['XB80', 'alex', '0400']) expect(docketMatches(q, d, l)).toBe(false);
    expect(docketMatches('alex', d, l, [lists.people[0]])).toBe(true);   // Alex shares the crew phone
  });
  it('finds a crew phone by number, label or the people sharing it', () => {
    const w = lists.phones[0];
    expect(phoneMatches('0491 570 006', w, [])).toBe(true);
    expect(phoneMatches('U04', w, [])).toBe(true);
    expect(phoneMatches('alex', w, [lists.people[0]])).toBe(true);
    expect(phoneMatches('0400', w, [])).toBe(false);
  });
});

describe('docket PDF', () => {
  it('makes a PDF for a two-shift report with its loads and sign-off', () => {
    const d = { id: 'd1', docket_no: 2041, form_type: 'daily_report_drilling', status: 'closed', review_status: 'to_review', work_date: '2026-11-20', truck_id: 't1', customer_id: 'c1',
      extras: { s1_band: '06:00 to 18:00', s1_operator_id: 'p1', s1_fuel_used_l: 120, well: 'ENS 968 well 4' } };
    const rows = [{ id: 'r1', docket_id: 'd1', material: 'Water based mud', volume_in_l: 12000, destination: 'LWD pit', extras: { shift: 1, washout_complete: 'Yes' } }];
    const pdf = docketPdf(d, rows, { client_name: 'R. Mason', signed_at: '2026-11-20T08:05:00Z' }, { trucks: lists.trucks, customers: lists.customers, people: lists.people });
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.getNumberOfPages()).toBe(1);
  });
});
