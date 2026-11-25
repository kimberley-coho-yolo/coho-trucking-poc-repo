// Docket forms, laid out like the paper and Jotform dockets the departments use today.
// Source: the examples the Landspray Supervisor sent on 19 Nov 2026 (one per department).
// Each form only describes its fields. Values that have a column on the dockets or loads table
// are stored there (so reports, km matching and timesheets keep working); everything else is kept
// in the row's "extras" (JSON), so adding or changing a field here needs no database change.
import type { Field } from './schema';
import { TABLES } from './schema';
import type { Row } from './backend';

export interface ShiftDef { n: 1 | 2; label: string; bands: string[] }

export interface FormDef {
  code: string;
  label: string;           // what people call it
  ref?: string;            // the paper form number, so people recognise it
  departments: string[];   // departments that use it (sets the default form for a job)
  summary: string;
  header: Field[];         // top of the form (after the common docket fields)
  shifts?: { defs: ShiftDef[]; fields: Field[] };  // two-shift forms: these fields repeat per shift (stored as s1_..., s2_...)
  rows: { label: string; addLabel: string; fields: Field[]; columns: string[]; totals?: string[] };
  footer: Field[];
  footerTitle?: string;
  signoff?: { title: string; nameLabel: string };
  noClone: string[];       // per-day values that a clone starts without
}

// ---------- shared pieces ----------
const t = (name: string, label: string, help?: string): Field => ({ name, label, type: 'text', help });
const n = (name: string, label: string, help?: string): Field => ({ name, label, type: 'number', help });
const tm = (name: string, label: string): Field => ({ name, label, type: 'time' });
const sel = (name: string, label: string, options: string[], help?: string): Field => ({ name, label, type: 'select', options, help });
const area = (name: string, label: string, help?: string): Field => ({ name, label, type: 'textarea', help });
const col = (table: 'dockets' | 'loads', name: string, label?: string, help?: string): Field => {
  const f = TABLES[table].fields.find(x => x.name === name);
  if (!f) throw new Error(`No ${table}.${name} field`);
  return { ...f, label: label ?? f.label, help: help ?? f.help };
};

const RIG_TYPE = sel('rig_type', 'Rig / IOR / United / Other', ['Rig', 'IOR', 'United', 'Other']);
const OPERATOR: Field = { name: 'operator_id', label: 'Truck operator', type: 'ref', ref: 'people' };
const OPERATOR_SIGNED: Field = { name: 'operator_signed_at', label: 'Operator signed at', type: 'datetime', help: 'Tap Now when the operator confirms the shift' };
const FUEL = n('fuel_used_l', 'Fuel used (L)');
const SHIFT_NOTES = area('notes', 'Operational notes');
const DAY_SHIFTS: ShiftDef[] = [
  { n: 1, label: 'Shift 1', bands: ['00:00 to 12:00', '06:00 to 18:00'] },
  { n: 2, label: 'Shift 2', bands: ['12:00 to 00:00', '18:00 to 06:00'] },
];
const equipment = (withFlowback: boolean): Field[] => [
  n('eq_125bbl', '125bbl tanks'), n('eq_160bbl', '160bbl tanks'), n('eq_250bbl', '250bbl tanks'), n('eq_frac_tank', 'Frac tanks'),
  ...(withFlowback ? [n('eq_flowback_tank', 'Flow back tanks')] : []),
  n('eq_centrifuge', 'Centrifuges'), n('eq_tautliner', 'Tautliners'), t('eq_other', 'Other equipment'),
];
const LOCATION = (help?: string) => col('dockets', 'location_id', 'Rig name and number', help);
const WELL = t('well', 'Well name and number');
const LAT_LONG = [t('latitude', 'Latitude'), t('longitude', 'Longitude')];

// ---------- the forms ----------
export const FORMS: FormDef[] = [
  {
    code: 'landspray_runsheet', label: 'Landspray 12 hour runsheet', ref: 'Santos LWD Daily Report (V2)', departments: ['Landspray'],
    summary: 'One row per load: fluid, volume, actual weight, pick-up, discharge and sprayfield.',
    header: [
      sel('shift_band', 'Shift', ['6am - 6pm DAY Shift', '6pm - 6am NIGHT Shift']),
      t('truck_email', 'Truck email'), col('dockets', 'customer_id'), LOCATION('e.g. ENS 968 Scotia 78'),
      t('well', 'Rig and well (full)', 'e.g. ENS 968 Scotia 78 - PL1088 - EPPG03515915'), t('well_section', 'Well section'),
    ],
    rows: {
      label: 'Work completed', addLabel: 'Add a load',
      fields: [
        col('loads', 'material', 'Fluid type'),
        col('loads', 'volume_in_l', 'Volume in litres', 'Use the conversion chart for accurate litres'),
        n('volume_m3', 'Volume in m3', 'Litres divided by 1000. Fills in for you; this column must be filled in'),
        n('actual_weight_t', 'Actual weight (t)', 'Scale reading minus tare'),
        tm('loaded_time', 'Loaded time'), col('loads', 'source', 'Pick-up location'), tm('pickup_time', 'Pick-up time'),
        col('loads', 'destination', 'Discharge location'), tm('discharge_time', 'Discharge time'), t('sprayfield', 'Sprayfield (if used)'),
      ],
      columns: ['material', 'volume_in_l', 'volume_m3', 'actual_weight_t', 'source', 'destination', 'sprayfield'],
      totals: ['volume_in_l', 'volume_m3', 'actual_weight_t'],
    },
    footer: [col('dockets', 'notes', 'Operational notes', 'Please note Westrex docket numbers')], footerTitle: 'Operational notes',
    noClone: ['truck_email'],
  },
  {
    code: 'daily_report_workover', label: 'Workover / Completions daily report', ref: 'COHO-ADM-FOR-015 Rev 3.0', departments: ['Workover', 'Completions'],
    summary: 'Two shifts per truck per day, loads in and out, equipment on site and client sign-off.',
    header: [t('trailer_rego', 'Trailer rego'), col('dockets', 'customer_id'), LOCATION(), WELL, ...LAT_LONG],
    shifts: { defs: DAY_SHIFTS, fields: [OPERATOR, OPERATOR_SIGNED, SHIFT_NOTES, FUEL, RIG_TYPE] },
    rows: {
      label: 'Loads', addLabel: 'Add a load',
      fields: [
        col('loads', 'source'), col('loads', 'volume_in_l', 'Volume (L)'), sel('in_out', 'IN / OUT', ['IN', 'OUT', 'Disposal']),
        tm('time_departed', 'Time departed'), col('loads', 'destination', 'Destination'), col('loads', 'waste_tracking_no', 'Waste tracking no.'),
        tm('time_returned', 'Time returned'), col('loads', 'docket_no', 'Docket no.'), n('loads_count', 'Number of loads'),
      ],
      columns: ['source', 'volume_in_l', 'in_out', 'destination', 'waste_tracking_no', 'docket_no', 'loads_count'],
      totals: ['volume_in_l', 'loads_count'],
    },
    footer: [...equipment(true)], footerTitle: 'Additional equipment on site (quantity)',
    signoff: { title: 'Client sign off', nameLabel: 'Client name' },
    noClone: [],
  },
  {
    code: 'daily_report_drilling', label: 'Drilling daily report', ref: 'COHO-ADM-FOR-015 Rev 3.0', departments: ['Drilling'],
    summary: 'Two shifts per truck per day, material to LWD or disposal, washout, equipment and WSR sign-off.',
    header: [t('trailer_rego', 'Trailer rego'), col('dockets', 'customer_id'), LOCATION(), WELL, t('supervisor_name', 'Supervisor name'), ...LAT_LONG],
    shifts: { defs: DAY_SHIFTS, fields: [OPERATOR, OPERATOR_SIGNED, sel('truck_config', 'Truck set-up', ['Truck', 'Dog', 'Semi', 'WC', 'RT']), SHIFT_NOTES, FUEL, RIG_TYPE] },
    rows: {
      label: 'Loads', addLabel: 'Add a load',
      fields: [
        col('loads', 'material', 'Material type'), col('loads', 'volume_in_l', 'Volume (L)'), tm('time_departed', 'Time departed'),
        col('loads', 'destination', 'LWD / disposal'), col('loads', 'source', 'Source'), tm('time_returned', 'Time returned'),
        col('loads', 'docket_no', 'Docket no.'), sel('washout_complete', 'Washout complete', ['Yes', 'No']),
      ],
      columns: ['material', 'volume_in_l', 'destination', 'source', 'docket_no', 'washout_complete'],
      totals: ['volume_in_l'],
    },
    footer: [...equipment(false)], footerTitle: 'Additional equipment on site (quantity)',
    signoff: { title: 'Client sign-off', nameLabel: 'WSR name' },
    noClone: [],
  },
  {
    code: 'frac_support', label: 'Frac support / Flowback daily report', ref: 'COHO-ADM-FOR-027', departments: ['Frac support', 'Flowback'],
    summary: 'Hour-by-hour task log per shift with litres in and out and the load risk rating.',
    header: [col('dockets', 'customer_id'), LOCATION('e.g. Condor Frac'), WELL],
    shifts: {
      defs: [{ n: 1, label: 'Day', bands: ['0600 - 1800'] }, { n: 2, label: 'Night', bands: ['1800 - 0600'] }],
      fields: [OPERATOR, { name: 'truck_id', label: 'Truck unit', type: 'ref', ref: 'trucks' }, t('trailer_regos', "Trailer regos"),
        n('disposal_vol_l', 'Disposal volume (L)'), t('waste_tracking_no', 'Waste tracking no.'), t('docket_number', 'Docket number'), FUEL],
    },
    rows: {
      label: 'Hourly log', addLabel: 'Add an hour',
      fields: [
        sel('hour', 'Time', ['0600', '0700', '0800', '0900', '1000', '1100', '1200', '1300', '1400', '1500', '1600', '1700',
          '1800', '1900', '2000', '2100', '2200', '2300', '0000', '0100', '0200', '0300', '0400', '0500']),
        col('loads', 'task'), t('location', 'Location'), col('loads', 'volume_in_l', 'In (L)'), col('loads', 'volume_out_l', 'Out (L)'),
        sel('risk_rating', 'Load risk rating (slosh)', ['1 - Low risk (0-15% load)', '2 - Medium risk (85-100% load)', '3 - High risk (15-85% load)']),
      ],
      columns: ['hour', 'task', 'location', 'volume_in_l', 'volume_out_l', 'risk_rating'],
      totals: ['volume_in_l', 'volume_out_l'],
    },
    footer: [],
    signoff: { title: 'Client approval', nameLabel: 'Client representative' },
    noClone: [],
  },
  {
    code: 'potable_water', label: 'Potable water daily report', ref: 'COHO-ADM-FOR-018 Rev 1.1', departments: ['Potable and septic'],
    summary: 'Water carted: sample results, meter readings, chlorine, load and unload volumes.',
    header: [t('tanker_rego', 'Tanker rego'), t('potable_licence_no', 'Potable licence number'), col('dockets', 'customer_id', 'Company')],
    rows: {
      label: 'Loads', addLabel: 'Add a load',
      fields: [
        { name: 'row_date', label: 'Date', type: 'date' }, col('loads', 'source', 'Source location'), t('sample_result_source', 'Sample result (source)'),
        n('meter_start', 'Meter reading (start)'), col('loads', 'volume_in_l', 'Load volume (L)'), n('meter_end', 'Meter reading (end)'),
        t('chlorine_source', 'Chlorine added at source (nil / mg)'), col('loads', 'destination', 'Destination location'),
        t('sample_result_dest', 'Sample result (destination)'), t('chlorine_dest', 'Chlorine added at destination (nil / mg)'),
        col('loads', 'volume_out_l', 'Unload volume (L)'), n('hours', 'Hours'), t('driver_initials', 'Driver initials'),
      ],
      columns: ['row_date', 'source', 'volume_in_l', 'destination', 'volume_out_l', 'hours'],
      totals: ['volume_in_l', 'volume_out_l', 'hours'],
    },
    footerTitle: 'Rejection of water',
    footer: [sel('water_rejected', 'Rejection of water', ['No', 'Yes']), area('rejection_details', 'Rejection details')],
    signoff: { title: 'Client approval', nameLabel: 'Rep name' },
    noClone: [],
  },
  {
    code: 'septic', label: 'Septic daily report', ref: 'Paper book (layout assumed, check with Drilling)', departments: ['Potable and septic'],
    summary: 'Septic pump-outs: source, meter readings, volumes, disposal point and waste tracking.',
    header: [t('tanker_rego', 'Tanker rego'), col('dockets', 'customer_id', 'Company')],
    rows: {
      label: 'Loads', addLabel: 'Add a load',
      fields: [
        { name: 'row_date', label: 'Date', type: 'date' }, col('loads', 'source', 'Pump-out location'), n('meter_start', 'Meter reading (start)'),
        col('loads', 'volume_in_l', 'Load volume (L)'), n('meter_end', 'Meter reading (end)'), col('loads', 'destination', 'Disposal location'),
        col('loads', 'waste_tracking_no', 'Waste tracking no.'), col('loads', 'volume_out_l', 'Unload volume (L)'), n('hours', 'Hours'),
        t('driver_initials', 'Driver initials'),
      ],
      columns: ['row_date', 'source', 'volume_in_l', 'destination', 'waste_tracking_no', 'hours'],
      totals: ['volume_in_l', 'volume_out_l', 'hours'],
    },
    footer: [],
    signoff: { title: 'Client approval', nameLabel: 'Rep name' },
    noClone: [],
  },
  {
    code: 'rig_support_ticket', label: 'Rig support ad hoc ticket', ref: 'Coho Group ticket', departments: ['Rig support'],
    summary: 'Invoice-style lines (hours, loads, fuel levy) for ad hoc rig support work.',
    header: [col('dockets', 'customer_id', 'Bill to'), col('dockets', 'contract', 'Contract', 'e.g. Contract 10715 - Rig Support 1'),
      LOCATION('e.g. Ensign 968'), WELL, t('site_location', 'Location', 'e.g. Sunshine Ranch 4'), t('approver', 'Approver')],
    rows: {
      label: 'Lines', addLabel: 'Add a line',
      fields: [area('description', 'Description', 'e.g. Adhoc Item 8: Water Tanker (single-24000l)'), t('truck_rego', 'Truck rego'),
        n('qty', 'Quantity'), sel('unit', 'Unit', ['Hour', 'Day', 'Load', 'Each', '%'])],
      columns: ['description', 'truck_rego', 'qty', 'unit'],
    },
    footer: [],
    signoff: { title: 'Client sign-off', nameLabel: 'Client representative (OCR name)' },
    noClone: [],
  },
  {
    code: 'general', label: 'General docket', departments: [],
    summary: 'Any other job: loads and tasks, times, fuel and client sign-off.',
    header: [col('dockets', 'customer_id'), col('dockets', 'location_id'), col('dockets', 'contract')],
    rows: {
      label: 'Loads and tasks', addLabel: 'Add a load',
      fields: TABLES.loads.fields,
      columns: ['depart_at', 'task', 'material', 'volume_in_l', 'volume_out_l', 'docket_no'],
      totals: ['volume_in_l', 'volume_out_l'],
    },
    footerTitle: 'End of job',
    footer: [col('dockets', 'fuel_l'), col('dockets', 'odo_start'), col('dockets', 'odo_end'), col('dockets', 'equipment_on_site'), col('dockets', 'notes')],
    signoff: { title: 'Client sign-off', nameLabel: 'Client representative' },
    noClone: [],
  },
];

export const formFor = (code?: string | null): FormDef => FORMS.find(f => f.code === code) ?? FORMS.find(f => f.code === 'general')!;
/** The usual form for a department (first match), e.g. Landspray -> Landspray runsheet. */
export const defaultFormFor = (department?: string | null): string => FORMS.find(f => department && f.departments.includes(department))?.code ?? 'general';

// Common docket fields shown on every form.
export const COMMON_FIELDS: Field[] = [
  { name: 'work_date', label: 'Date', type: 'date' },
  { name: 'truck_id', label: 'Truck', type: 'ref', ref: 'trucks' },
  { name: 'department', label: 'Department', type: 'select', options: (TABLES.dockets.fields.find(f => f.name === 'department')!.options ?? []) },
  { name: 'project_no', label: 'Project number', type: 'text' },
  { name: 'task_no', label: 'Task number', type: 'text' },
  { name: 'po', label: 'PO number', type: 'text' },
];
export const TIME_FIELDS: Field[] = ['start_at', 'end_at', 'standby_minutes', 'standby_reason'].map(x => col('dockets', x));

// ---------- columns vs extras ----------
const DOCKET_COLS = new Set([...TABLES.dockets.fields.map(f => f.name), 'id', 'shift_id', 'job_id', 'status', 'extras', 'last_step', 'assigned_person_ids',
  'cloned_from', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by']);
const LOAD_COLS = new Set([...TABLES.loads.fields.map(f => f.name), 'id', 'docket_id', 'extras', 'sort', 'created_at', 'created_by', 'updated_at']);

/** A flat object for the form: table columns plus everything in extras. */
export function toView(row: Row | null | undefined): Row {
  if (!row) return {};
  const { extras, ...rest } = row;
  return { ...(extras ?? {}), ...rest };
}
/** Back to a database row: known columns stay as columns, the rest goes into extras. */
export function fromView(view: Row, table: 'dockets' | 'loads'): Row {
  const cols = table === 'dockets' ? DOCKET_COLS : LOAD_COLS;
  const out: Row = {}; const extras: Row = {};
  for (const [k, v] of Object.entries(view)) (cols.has(k) ? out : extras)[k] = v;
  out.extras = extras;
  return out;
}

/** Shift fields are stored with a prefix: s1_operator_id, s2_notes ... */
export const shiftKey = (n: number, name: string) => `s${n}_${name}`;
export const shiftFields = (form: FormDef, n: number): Field[] =>
  (form.shifts?.fields ?? []).map(f => ({ ...f, name: shiftKey(n, f.name) }));

/** Landspray: m3 is litres / 1000, filled in automatically when litres change. */
export function applyRowRules(form: FormDef, before: Row, after: Row): Row {
  if (form.code === 'landspray_runsheet' && after.volume_in_l !== before.volume_in_l && after.volume_in_l != null) {
    return { ...after, volume_m3: Math.round((Number(after.volume_in_l) / 1000) * 1000) / 1000 };
  }
  return after;
}

export function total(rows: Row[], key: string): number {
  return Math.round(rows.reduce((s, r) => s + (Number(toView(r)[key]) || 0), 0) * 1000) / 1000;
}

// ---------- clone ----------
export interface CloneOptions { workDate: string | null; includeRows: boolean; keepDrivers: boolean }
const NEVER_CLONE = ['id', 'docket_no', 'version', 'status', 'shift_id', 'start_at', 'end_at', 'standby_minutes', 'standby_reason', 'km', 'fuel_l',
  'odo_start', 'odo_end', 'created_at', 'created_by', 'updated_at', 'updated_by', 'last_step', 'cloned_from', 'work_date'];

/**
 * A new draft docket from an existing one: same form, customer, rig, truck, project, task and PO,
 * but none of the day's measurements, signatures or times. Rows are copied only when asked.
 */
export function cloneDocket(src: Row, srcRows: Row[], opts: CloneOptions): { docket: Row; rows: Row[] } {
  const form = formFor(src.form_type);
  const view = toView(src);
  const skip = new Set([...NEVER_CLONE, ...form.noClone]);
  for (const k of Object.keys(view)) {
    if (/^s[12]_(operator_signed_at|fuel_used_l|notes|disposal_vol_l|waste_tracking_no|docket_number)$/.test(k)) skip.add(k);
  }
  const copy: Row = {};
  for (const [k, v] of Object.entries(view)) if (!skip.has(k)) copy[k] = v;
  copy.status = 'draft';
  copy.work_date = opts.workDate;
  copy.cloned_from = src.id;
  copy.form_type = form.code;
  if (!opts.keepDrivers) copy.assigned_person_ids = [];
  const docket = fromView(copy, 'dockets');
  const rows = opts.includeRows
    ? srcRows.map((r, i) => {
      const { id: _id, docket_id: _d, created_at: _c, created_by: _b, updated_at: _u, ...rest } = r;
      return { ...rest, sort: r.sort ?? i };
    })
    : [];
  return { docket, rows };
}

/** Rows in a stable order: shift, then the order they were added. */
export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) =>
    (Number(a.extras?.shift ?? 0) - Number(b.extras?.shift ?? 0))
    || (Number(a.sort ?? 0) - Number(b.sort ?? 0))
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}
