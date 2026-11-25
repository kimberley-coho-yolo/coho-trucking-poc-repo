// Made-up demo data. Mirrors supabase/seed.sql and adds a worked example
// (Truck 04 night shift: Origin then Santos) so every screen has something to show.
import type { Row } from './backend';
import { defaultAccess, FEATURES, SYSTEM_ROLES } from './permissions';

const C1 = '11111111-0000-0000-0000-000000000001', C2 = '11111111-0000-0000-0000-000000000002';
const L1 = '22222222-0000-0000-0000-000000000001', L2 = '22222222-0000-0000-0000-000000000002', L3 = '22222222-0000-0000-0000-000000000003';
const T4 = '33333333-0000-0000-0000-000000000004', T87 = '33333333-0000-0000-0000-000000000087';
const P1 = '44444444-0000-0000-0000-000000000001', P2 = '44444444-0000-0000-0000-000000000002', P3 = '44444444-0000-0000-0000-000000000003';
const W1 = '55555555-0000-0000-0000-000000000001';
const J1 = '66666666-0000-0000-0000-000000000001', J2 = '66666666-0000-0000-0000-000000000002';
const EQ = '77777777-0000-0000-0000-000000000001';
const DRIVER_USER = 'demo-61400000001';

function at(dayOffset: number, hh: number, mm = 0): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayOffset); d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}
function dateOnly(dayOffset: number): string {
  const d = new Date(); d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

export function demoSeed(): Record<string, Row[]> {
  const y = -1; // the example shift ran last night
  return {
    app_logins: [
      { id: 'l1', label: 'Demo admin', email: 'admin@demo.local', role: 'admin', active: true },
      { id: 'l2', label: 'Demo office', email: 'office@demo.local', role: 'office', active: true },
      { id: 'l3', label: 'Demo supervisor', email: 'supervisor@demo.local', role: 'supervisor', active: true },
      { id: 'l4', label: 'Crew phone 1', phone: '0400 000 001', role: 'driver', active: true },
    ],
    people: [
      { id: P1, full_name: 'Alex Driver', crew: 'Shift 1 Day', department: 'Completions', is_driver: true, active: true },
      { id: P2, full_name: 'Sam Driver', crew: 'Shift 2 Day', department: 'Completions', is_driver: true, active: true },
      { id: P3, full_name: 'Jo Cover', crew: 'Shift 1 Night', department: 'Drilling', is_driver: true, active: true },
    ],
    work_phones: [{ id: W1, phone: '0400 000 001', label: 'Crew phone 1 (Shift 1 / Shift 2 Day)', active: true }],
    phone_assignments: [
      { id: 'pa1', work_phone_id: W1, person_id: P1 },
      { id: 'pa2', work_phone_id: W1, person_id: P2 },
    ],
    trucks: [
      { id: T4, unit_no: '04', rego: 'XB80KB', truck_type: 'Prime mover', ownership: 'Owned', qr_value: 'COHO-TRUCK-04', tracker_system: 'MyGeotab', status: 'In use', active: true },
      { id: T87, unit_no: '87', rego: 'XB28PZ', truck_type: 'Water truck', ownership: 'Owned', qr_value: 'COHO-TRUCK-87', tracker_system: 'Fleet Complete', status: 'Available', active: true },
    ],
    equipment: [{ id: EQ, rego: 'TR12AB', equipment_type: 'Water tanker trailer', capacity: '30000 L', active: true }],
    customers: [
      { id: C1, name: 'Origin Energy', short_name: 'Origin', billing_company: 'Coho Resources', active: true },
      { id: C2, name: 'Santos', short_name: 'Santos', billing_company: 'Coho Resources', active: true },
    ],
    locations: [
      { id: L1, name: 'SAV 168', kind: 'rig', customer_id: C1, active: true },
      { id: L2, name: 'NIT 1', kind: 'rig', customer_id: C2, active: true },
      { id: L3, name: 'Roma yard', kind: 'yard', active: true },
    ],
    jobs: [
      { id: J1, job_date: dateOnly(0), customer_id: C1, billing_company: 'Coho Resources', location_id: L1, project_no: 'P-1001', task_no: 'T-01', po: 'PO-5501', department: 'Completions' },
      { id: J2, job_date: dateOnly(0), customer_id: C2, billing_company: 'Coho Resources', location_id: L2, project_no: 'P-2002', task_no: 'T-07', po: 'PO-7702', department: 'Completions' },
    ],
    allocations: [
      { id: 'a1', job_id: J1, truck_id: T4, equipment_id: EQ, shift_date: dateOnly(0), day_night: 'Night' },
      { id: 'a2', job_id: J2, truck_id: T4, equipment_id: EQ, shift_date: dateOnly(0), day_night: 'Night' },
      { id: 'a3', job_id: J1, truck_id: T4, equipment_id: EQ, shift_date: dateOnly(y), day_night: 'Night' },
      { id: 'a4', job_id: J2, truck_id: T4, equipment_id: EQ, shift_date: dateOnly(y), day_night: 'Night' },
    ],
    shifts: [
      { id: 's1', status: 'submitted', shift_date: dateOnly(y), day_night: 'Night', truck_id: T4, equipment_id: EQ, driver_id: P1, work_phone_id: W1, is_cover: false,
        sign_in_at: at(y, 18), sign_out_at: at(0, 6), prestart_status: 'passed', prestart_ref: 'GB-PS-1042', created_by: DRIVER_USER, last_step: 'end' },
    ],
    dockets: [
      { id: 'd1', status: 'closed', shift_id: 's1', job_id: J1, customer_id: C1, location_id: L1, department: 'Completions', project_no: 'P-1001', task_no: 'T-01', po: 'PO-5501',
        start_at: at(y, 18, 30), end_at: at(0, 1), fuel_l: 85, km: 65, created_by: DRIVER_USER, extras: {} },
      { id: 'd2', status: 'closed', shift_id: 's1', job_id: J2, customer_id: C2, location_id: L2, department: 'Completions', project_no: 'P-2002', task_no: 'T-07', po: 'PO-7702',
        start_at: at(0, 1, 30), end_at: at(0, 5, 30), standby_minutes: 30, standby_reason: 'Waiting on rig', fuel_l: 60, km: 50, created_by: DRIVER_USER, extras: {} },
    ],
    loads: [
      { id: 'ld1', docket_id: 'd1', depart_at: at(y, 19), return_at: at(y, 21), task: 'Water cartage', material: 'Produced water', volume_out_l: 28000, source: 'SAV 168 pond', destination: 'Disposal point A', docket_no: 'D-3301', waste_tracking_no: 'WT-77821', created_by: DRIVER_USER },
      { id: 'ld2', docket_id: 'd2', depart_at: at(0, 2), return_at: at(0, 4), task: 'Water cartage', material: 'Fresh water', volume_in_l: 30000, source: 'Bore 3', destination: 'NIT 1 tank', docket_no: 'D-3302', created_by: DRIVER_USER },
    ],
    signoffs: [
      { id: 'so1', docket_id: 'd1', client_name: 'R. Client (Origin WSR)', po: 'PO-5501', signed_at: at(0, 1), created_by: DRIVER_USER },
      { id: 'so2', docket_id: 'd2', client_name: 'K. Client (Santos)', po: 'PO-7702', signed_at: at(0, 5, 30), created_by: DRIVER_USER },
    ],
    faults: [],
    timesheet_lines: [
      { id: 'ts1', status: 'submitted', person_id: P1, shift_id: 's1', work_date: dateOnly(y), on_shift: true, rr: false,
        docket_hours: 10.5, travel_hours: 1.5, standby_hours: 0.5, total_hours: 12, work_diary_page: '214', location: 'SAV 168, NIT 1', created_by: DRIVER_USER },
    ],
    gps_trips: [
      { id: 'g1', truck_id: T4, truck_ref: '04', start_at: at(y, 18, 10), end_at: at(y, 18, 30), km: 42, source_system: 'MyGeotab' },
      { id: 'g2', truck_id: T4, truck_ref: '04', start_at: at(y, 18, 30), end_at: at(0, 1), km: 65, source_system: 'MyGeotab' },
      { id: 'g3', truck_id: T4, truck_ref: '04', start_at: at(0, 1), end_at: at(0, 1, 30), km: 38, source_system: 'MyGeotab' },
      { id: 'g4', truck_id: T4, truck_ref: '04', start_at: at(0, 1, 30), end_at: at(0, 5, 30), km: 50, source_system: 'MyGeotab' },
      { id: 'g5', truck_id: T4, truck_ref: '04', start_at: at(0, 5, 30), end_at: at(0, 6), km: 40, source_system: 'MyGeotab' },
    ],
    prestart_records: [
      { id: 'pr1', truck_id: T4, truck_ref: '04', done_at: at(y, 18, 5), result: 'passed', driver_name: 'Alex Driver', gearbox_ref: 'GB-PS-1042' },
    ],
    km_segments: [],
    import_batches: [],
    integrations: [
      { id: 'i1', system: 'MyGeotab (Securatrak / Geotrack?)', purpose: 'GPS trips and odometer for km matching', direction: 'In', api_status: 'Published API, access to request', stand_in: 'Upload GPS trips spreadsheet (Data > Import > GPS trips)', sort_order: 1 },
      { id: 'i2', system: 'Fleet Complete (Powerfleet)', purpose: 'GPS trips and odometer', direction: 'In', api_status: 'Published API, token to request', stand_in: 'Upload GPS trips spreadsheet', sort_order: 2 },
      { id: 'i3', system: 'Gearbox / Gearbox Prestart', purpose: 'Prestart results in, faults out', direction: 'In and out', api_status: 'API on request; webhook', stand_in: 'Upload prestart spreadsheet; driver confirms prestart', sort_order: 3 },
      { id: 'i4', system: 'MYOB AccountRight', purpose: 'Approved hours to payroll; invoice lines', direction: 'Out', api_status: 'Published API', stand_in: 'Export approved timesheet lines and daily customer report', sort_order: 4 },
      { id: 'i5', system: 'SMS provider: Mobile Message', purpose: 'Sign-in codes to work mobiles', direction: 'Out', api_status: 'Connected via Supabase Send SMS hook', status: 'Connected', stand_in: 'Email sign-in', sort_order: 5 },
      { id: 'i6', system: 'Microsoft 365', purpose: '07:30 and approval emails', direction: 'Out', api_status: 'Published API', stand_in: 'Reports screen, export', sort_order: 6 },
      { id: 'i7', system: 'Fabric lakehouse / Power BI', purpose: 'Management reporting', direction: 'Out', api_status: 'Published API', stand_in: 'Export to CSV or Excel', sort_order: 7 },
      { id: 'i8', system: 'Momentum IoT', purpose: 'Camera event links', direction: 'In', api_status: 'API on request', stand_in: 'Not in PoC', sort_order: 8 },
      { id: 'i9', system: 'Jotform', purpose: 'Existing forms during transition', direction: 'In', api_status: 'Published API', stand_in: 'Replaced by dockets in the app', sort_order: 9 },
    ],
    audit_log: [],
    ...demoSettings(),
  };
}

/** Roles, the list of functions and the starting access settings (same defaults as the database). */
export function demoSettings(): Record<string, Row[]> {
  return {
    roles: SYSTEM_ROLES.map(r => ({ id: 'role-' + r.code, ...r, is_system: true, active: true })),
    features: FEATURES.map(f => ({ id: 'feat-' + f.code, ...f })),
    role_permissions: SYSTEM_ROLES.flatMap(r => FEATURES.map(f => ({ id: `rp-${r.code}-${f.code}`, role: r.code, feature: f.code, access: defaultAccess(r.code, f) }))),
  };
}
