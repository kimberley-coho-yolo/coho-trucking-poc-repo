// Roster upload: one row per docket in an Excel template. Each row is checked against the lists
// (crew phones, trucks, drivers, customers, rigs, forms, departments) before anything is created.
import * as XLSX from 'xlsx';
import type { Row } from './backend';
import { DEPARTMENTS } from './schema';
import { FORMS, defaultFormFor } from './docketForms';
import { normPhone } from './phone';

export const ROSTER_COLUMNS = ['Date', 'Shift', 'Crew phone', 'Truck', 'Drivers', 'Customer', 'Rig / location', 'Form', 'Department', 'Project no', 'Task no', 'PO', 'Notes'] as const;
export interface RosterLists { phones: Row[]; trucks: Row[]; people: Row[]; customers: Row[]; locations: Row[] }
export interface RosterRow { line: number; raw: Record<string, unknown>; docket: Row | null; errors: string[]; summary: string }

const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const pad = (n: number) => String(n).padStart(2, '0');

/** Date from the sheet: an Excel date number, 2026-11-27, 27/11/2026 or 27/11/26. */
export function rosterDate(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return null;
}

const unitKey = (s: string) => key(s).replace(/^(unit|truck|u)/, '').replace(/^0+(?=\d)/, '');
export function findTruck(trucks: Row[], v: string): Row | undefined {
  const k = key(v); if (!k) return undefined;
  return trucks.find(t => key(t.rego) === k) ?? trucks.find(t => t.unit_no && unitKey(t.unit_no) === unitKey(v) && t.active !== false);
}
export function findPhone(phones: Row[], v: string): Row | undefined {
  const n = normPhone(v);
  return phones.find(w => n && normPhone(w.phone) === n) ?? phones.find(w => key(w.label) === key(v));
}

/** Check every row and build the dockets to create. Blank rows are skipped. */
export function checkRoster(sheet: Record<string, unknown>[], lists: RosterLists): RosterRow[] {
  const out: RosterRow[] = [];
  sheet.forEach((raw0, i) => {
    // match headers loosely: "rig/location", "Crew Phone" ...
    const raw: Record<string, unknown> = {};
    for (const [h, v] of Object.entries(raw0)) { const col = ROSTER_COLUMNS.find(c => key(c) === key(h)) ?? (key(h) === 'rig' || key(h) === 'location' ? 'Rig / location' : null); if (col) raw[col] = v; }
    if (!Object.values(raw).some(v => text(v))) return;
    const errors: string[] = [];
    const date = rosterDate(raw['Date']);
    if (!date) errors.push(`Date "${text(raw['Date'])}" is not a date (use 27/11/2026)`);
    const shift = text(raw['Shift']) || 'Day';
    if (!/^(day|night)$/i.test(shift)) errors.push(`Shift must be Day or Night, not "${shift}"`);
    const phoneTxt = text(raw['Crew phone']); const phone = phoneTxt ? findPhone(lists.phones, phoneTxt) : undefined;
    if (phoneTxt && !phone) errors.push(`No crew phone "${phoneTxt}"`);
    const truckTxt = text(raw['Truck']); const truck = truckTxt ? findTruck(lists.trucks, truckTxt) : undefined;
    if (truckTxt && !truck) errors.push(`No truck "${truckTxt}" (use the rego or unit number)`);
    const driverNames = text(raw['Drivers']).split(/[;,]/).map(s => s.trim()).filter(Boolean);
    const drivers = driverNames.map(n => ({ n, p: lists.people.find(p => key(p.full_name) === key(n) && p.active !== false && !p.pending) }));
    for (const d of drivers) if (!d.p) errors.push(`No driver "${d.n}"`);
    const custTxt = text(raw['Customer']); const cust = custTxt ? lists.customers.find(c => key(c.name) === key(custTxt) || key(c.short_name) === key(custTxt)) : undefined;
    if (custTxt && !cust) errors.push(`No customer "${custTxt}"`);
    const locTxt = text(raw['Rig / location']); const loc = locTxt ? lists.locations.find(l => key(l.name) === key(locTxt)) : undefined;
    if (locTxt && !loc) errors.push(`No rig or location "${locTxt}"`);
    const deptTxt = text(raw['Department']); const dept = deptTxt ? DEPARTMENTS.find(d => key(d) === key(deptTxt)) : undefined;
    if (deptTxt && !dept) errors.push(`Department must be one of: ${DEPARTMENTS.join(', ')}`);
    const formTxt = text(raw['Form']);
    const form = formTxt ? FORMS.find(f => key(f.label) === key(formTxt) || key(f.code) === key(formTxt) || (f.ref && key(f.ref) === key(formTxt))) : FORMS.find(f => f.code === defaultFormFor(dept));
    if (formTxt && !form) errors.push(`No form "${formTxt}"`);
    const night = /^night$/i.test(shift);
    const docket: Row | null = errors.length ? null : {
      form_type: form!.code, status: 'draft', work_date: date, truck_id: truck?.id ?? null, customer_id: cust?.id ?? null,
      location_id: loc?.id ?? null, department: dept ?? form!.departments[0] ?? null, assigned_phone_id: phone?.id ?? null,
      assigned_person_ids: drivers.map(d => d.p!.id), project_no: text(raw['Project no']) || null, task_no: text(raw['Task no']) || null,
      po: text(raw['PO']) || null, notes: text(raw['Notes']) || null,
      extras: { roster_shift: night ? 'Night' : 'Day', ...(form!.code === 'landspray_runsheet' ? { shift_band: night ? '6pm - 6am NIGHT Shift' : '6am - 6pm DAY Shift' } : {}) },
    };
    const summary = [date, night ? 'Night' : 'Day', form?.label, cust?.name, loc?.name, truck ? (truck.unit_no ? 'Unit ' + truck.unit_no : truck.rego) : null,
      phone ? phone.phone : 'not assigned', drivers.map(d => d.n).join(', ')].filter(Boolean).join(' · ');
    out.push({ line: i + 2, raw, docket, errors, summary });
  });
  return out;
}

/** The template: the roster sheet with two example rows, and a Lists sheet of everything it can match. */
export function rosterTemplate(lists: RosterLists): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ph = lists.phones.find(w => w.active !== false); const tr = lists.trucks.find(t => t.active !== false && t.rego);
  const examples = [
    { Date: '27/11/2026', Shift: 'Day', 'Crew phone': ph?.phone ?? '', Truck: tr?.rego ?? '', Drivers: '', Customer: lists.customers[0]?.name ?? '', 'Rig / location': lists.locations[0]?.name ?? '',
      Form: 'Drilling / CCC daily report', Department: 'Drilling', 'Project no': '', 'Task no': '', PO: '', Notes: 'Example row: replace or delete' },
    { Date: '27/11/2026', Shift: 'Night', 'Crew phone': '', Truck: '', Drivers: '', Customer: '', 'Rig / location': '', Form: 'Landspray 12 hour runsheet', Department: 'Landspray',
      'Project no': '', 'Task no': '', PO: '', Notes: 'Example: no crew phone yet = not assigned' },
  ];
  const ws = XLSX.utils.json_to_sheet(examples, { header: [...ROSTER_COLUMNS] });
  ws['!cols'] = ROSTER_COLUMNS.map(c => ({ wch: Math.max(12, c.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  const longest = Math.max(lists.phones.length, lists.trucks.length, lists.people.length, lists.customers.length, lists.locations.length, FORMS.length, DEPARTMENTS.length);
  const active = (r: Row[]) => r.filter(x => x.active !== false);
  const cols = {
    'Crew phones': active(lists.phones).map(w => w.phone), 'Trucks (rego)': active(lists.trucks).map(t => t.rego).filter(Boolean),
    'Unit no.': active(lists.trucks).map(t => t.unit_no ?? ''), 'Drivers': active(lists.people).filter(p => p.is_driver !== false && !p.pending).map(p => p.full_name),
    'Customers': active(lists.customers).map(c => c.name), 'Rigs / locations': active(lists.locations).map(l => l.name),
    'Forms': FORMS.map(f => f.label), 'Departments': DEPARTMENTS, 'Shift': ['Day', 'Night'],
  };
  const rows = Array.from({ length: longest }, (_, i) => Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v[i] ?? ''])));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Lists');
  return wb;
}

/** Read the uploaded roster (first sheet), keeping Excel dates as numbers so they are not misread. */
export async function readRoster(file: File): Promise<Record<string, unknown>[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true }) as Record<string, unknown>[];
}

/**
 * Roster search: does this docket match what was typed? Matches the truck (rego or unit number),
 * a driver's name (on the docket or sharing its crew phone) or the crew phone number.
 */
export function docketMatches(q: string, d: Row, lists: { trucks: Row[]; people: Row[]; phones: Row[] }, phonePeople: Row[] = []): boolean {
  const k = key(q); if (!k) return true;
  const truck = lists.trucks.find(t => t.id === d.truck_id);
  const phone = lists.phones.find(w => w.id === d.assigned_phone_id);
  const names = [...(d.assigned_person_ids ?? []).map((id: string) => lists.people.find(p => p.id === id)?.full_name), ...phonePeople.map(p => p.full_name)];
  const digits = q.replace(/\D/g, '');
  return (!!truck && (key(truck.rego).includes(k) || (!!truck.unit_no && unitKey(truck.unit_no) === unitKey(q))))
    || names.some(n => key(n).includes(k))
    || (!!phone && ((digits.length >= 3 && (normPhone(phone.phone) ?? '').includes(digits.replace(/^0/, ''))) || key(phone.label).includes(k)))
    || String(d.docket_no ?? '') === q.trim();
}
/** A crew phone row matches by its number, label or the people who share it. */
export function phoneMatches(q: string, w: Row, people: Row[]): boolean {
  const k = key(q); if (!k) return true;
  const digits = q.replace(/\D/g, '');
  return (digits.length >= 3 && (normPhone(w.phone) ?? '').includes(digits.replace(/^0/, ''))) || key(w.label).includes(k) || people.some(p => key(p.full_name).includes(k));
}
