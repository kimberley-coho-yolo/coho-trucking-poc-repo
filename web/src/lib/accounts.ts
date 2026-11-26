// Accounts reports: overdue timesheets, docket totals and timesheets compared with their dockets.
// Worked out in the browser from tables Accounts can already read, so they work in demo mode too.
import type { Row } from './backend';
import { docketEntries, docketDay } from './timesheetSync';
import { stageOf, STAGE_LABEL, type DocketStage } from './assignment';
import { formFor } from './docketForms';
import { periodEnd, periodStart, submitBy, type PeriodSettings } from './forms';

export interface Lookups { customers: Row[]; locations: Row[]; trucks: Row[]; people: Row[]; phones: Row[]; shifts: Row[] }
const r2 = (n: number) => Math.round(n * 100) / 100;
const byId = (rows: Row[], id?: string | null) => (id ? rows.find(r => r.id === id) : undefined);
export const truckName = (t?: Row) => (t ? [t.unit_no ? 'Unit ' + t.unit_no : null, t.rego].filter(Boolean).join(' ') : '');

// ---------- overdue timesheets ----------
export interface OverdueRow {
  person_id: string; driver: string; period_start: string; period_end: string; due: string;
  days: number; hours: number; sent_back: number; days_overdue: number;
}
/**
 * Timesheet days not sent (draft) or sent back (queried) whose period was due before now.
 * "now" is local "YYYY-MM-DD HH:MM"; a period is due at 19:00 on the second day after it ends.
 */
export function overdueTimesheets(lines: Row[], people: Row[], now: string, ps: PeriodSettings): OverdueRow[] {
  const groups = new Map<string, OverdueRow>();
  for (const l of lines) {
    if (!l.work_date || !l.person_id || (l.status !== 'draft' && l.status !== 'queried')) continue;
    const start = periodStart(l.work_date, ps, ps.view);
    const due = submitBy(start, ps.view);
    if (due >= now) continue;
    const k = l.person_id + '|' + start;
    const g = groups.get(k) ?? {
      person_id: l.person_id, driver: byId(people, l.person_id)?.full_name ?? '(unknown)', period_start: start, period_end: periodEnd(start, ps.view),
      due, days: 0, hours: 0, sent_back: 0,
      days_overdue: Math.floor((Date.parse(now.slice(0, 10)) - Date.parse(due.slice(0, 10))) / 86_400_000),
    };
    g.days += 1; g.hours = r2(g.hours + (Number(l.total_hours) || 0)); if (l.status === 'queried') g.sent_back += 1;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.days_overdue - a.days_overdue || a.driver.localeCompare(b.driver));
}

// ---------- docket lines (one per docket per driver) ----------
export interface DocketLine {
  docket_id: string; docket_no: number | null; date: string | null; form: string; department: string;
  customer_id: string | null; customer: string; rig: string; truck_id: string | null; asset: string;
  person_id: string | null; driver: string; crew_phone: string; stage: DocketStage; status: string;
  hours: number; standby: number; loads: number; volume_l: number;
}
/** Every docket broken into one line per driver it gives time to (a two-shift report gives two). */
export function docketLines(dockets: Row[], loads: Row[], lk: Lookups): DocketLine[] {
  const loadsBy = new Map<string, Row[]>();
  for (const l of loads) { const a = loadsBy.get(l.docket_id) ?? []; a.push(l); loadsBy.set(l.docket_id, a); }
  const out: DocketLine[] = [];
  for (const d of dockets) {
    const shift = byId(lk.shifts, d.shift_id);
    // one line per driver per docket: hours split across days (night shifts) are added back together here
    const entries: { person_id: string | null; hours: number | null; standby: number | null; truck_id: string | null }[] = [];
    for (const e of docketEntries(d, shift)) {
      const same = entries.find(x => x.person_id === e.person_id && x.truck_id === e.truck_id);
      if (!same) { entries.push({ person_id: e.person_id, hours: e.hours, standby: e.standby, truck_id: e.truck_id }); continue; }
      if (e.hours != null) same.hours = (same.hours ?? 0) + e.hours;
      if (e.standby != null) same.standby = (same.standby ?? 0) + e.standby;
    }
    const ls = loadsBy.get(d.id) ?? [];
    const base = {
      docket_id: d.id, docket_no: d.docket_no ?? null, date: docketDay(d, shift), form: formFor(d.form_type).label, department: d.department ?? '',
      customer_id: d.customer_id ?? null, customer: byId(lk.customers, d.customer_id)?.name ?? '', rig: byId(lk.locations, d.location_id)?.name ?? '',
      crew_phone: byId(lk.phones, d.assigned_phone_id)?.phone ?? '', stage: stageOf(d), status: STAGE_LABEL[stageOf(d)],
    };
    // loads and volume belong to the docket, so they go on its first line only (totals are not counted twice)
    const loadCount = ls.length; const volume = ls.reduce((s, l) => s + (Number(l.volume_in_l) || 0), 0);
    const people = entries.length ? entries : (d.assigned_person_ids ?? [null]).map((p: string | null) => ({ person_id: p, hours: 0, standby: 0, truck_id: d.truck_id ?? null }));
    people.forEach((e: { person_id: string | null; hours: number | null; standby: number | null; truck_id: string | null }, i: number) => {
      const truck = byId(lk.trucks, e.truck_id ?? d.truck_id);
      out.push({ ...base, truck_id: truck?.id ?? null, asset: truckName(truck), person_id: e.person_id, driver: byId(lk.people, e.person_id)?.full_name ?? '',
        hours: r2(e.hours ?? 0), standby: r2(e.standby ?? 0), loads: i === 0 ? loadCount : 0, volume_l: i === 0 ? volume : 0 });
    });
  }
  return out;
}

export interface DocketFilter {
  from?: string; to?: string; customer_id?: string; truck_id?: string; person_id?: string;
  department?: string; form?: string; stage?: string; text?: string;
}
export function filterLines(lines: DocketLine[], f: DocketFilter): DocketLine[] {
  const t = (f.text ?? '').trim().toLowerCase();
  return lines.filter(l =>
    (!f.from || (l.date ?? '') >= f.from) && (!f.to || (l.date ?? '') <= f.to)
    && (!f.customer_id || l.customer_id === f.customer_id) && (!f.truck_id || l.truck_id === f.truck_id)
    && (!f.person_id || l.person_id === f.person_id) && (!f.department || l.department === f.department)
    && (!f.form || l.form === f.form) && (!f.stage || l.stage === f.stage)
    && (!t || [l.docket_no, l.customer, l.rig, l.asset, l.driver, l.crew_phone, l.form, l.status].some(v => String(v ?? '').toLowerCase().includes(t))));
}

export type GroupBy = 'customer' | 'asset' | 'driver' | 'status';
export interface GroupTotal { key: string; label: string; dockets: number; hours: number; standby: number; loads: number; volume_l: number; stages: Partial<Record<DocketStage, number>> }
/** Totals per customer, asset (truck), user (driver) or status. Dockets are counted once per group. */
export function groupTotals(lines: DocketLine[], by: GroupBy): GroupTotal[] {
  const m = new Map<string, GroupTotal & { ids: Set<string>; stageIds: Map<DocketStage, Set<string>> }>();
  for (const l of lines) {
    const [key, label] = by === 'customer' ? [l.customer_id ?? '', l.customer || '(no customer)']
      : by === 'asset' ? [l.truck_id ?? '', l.asset || '(no truck)']
      : by === 'driver' ? [l.person_id ?? '', l.driver || '(no driver)']
      : [l.stage, l.status];
    const g = m.get(key) ?? { key, label, dockets: 0, hours: 0, standby: 0, loads: 0, volume_l: 0, stages: {}, ids: new Set<string>(), stageIds: new Map() };
    g.ids.add(l.docket_id); g.hours = r2(g.hours + l.hours); g.standby = r2(g.standby + l.standby); g.loads += l.loads; g.volume_l += l.volume_l;
    const s = g.stageIds.get(l.stage) ?? new Set<string>(); s.add(l.docket_id); g.stageIds.set(l.stage, s);
    m.set(key, g);
  }
  return [...m.values()].map(({ ids, stageIds, ...g }) => ({ ...g, dockets: ids.size, stages: Object.fromEntries([...stageIds].map(([k, v]) => [k, v.size])) }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label));
}

// ---------- timesheets compared with their dockets ----------
export interface CompareRow {
  person_id: string; driver: string; date: string; timesheet_status: string; timesheet_total: number | null;
  timesheet_docket_hours: number | null; dockets_hours: number; difference: number | null;
  dockets: { id: string; docket_no: number | null; hours: number; asset: string; stage: string }[]; assets: string;
}
/**
 * One row per driver and day: what the timesheet says against what that day's dockets add up to.
 * Pick a truck (all timesheets that truck's dockets feed), a driver, or both, and a date range.
 * Difference = the timesheet's docket hours minus the dockets' hours (0 means they agree).
 */
export function compareTimesheets(tsLines: Row[], lines: DocketLine[], people: Row[], f: { truck_id?: string; person_id?: string; from?: string; to?: string }): CompareRow[] {
  const inDates = (d?: string | null) => !!d && (!f.from || d >= f.from) && (!f.to || d <= f.to);
  // only dockets that have started give time to a timesheet
  const dl = lines.filter(l => l.person_id && inDates(l.date) && l.stage !== 'assigned' && l.stage !== 'unassigned');
  // which driver-days belong in the comparison
  const keys = new Set<string>();
  for (const l of dl) if ((!f.truck_id || l.truck_id === f.truck_id) && (!f.person_id || l.person_id === f.person_id)) keys.add(l.person_id + '|' + l.date);
  for (const t of tsLines) {
    if (!t.person_id || !inDates(t.work_date)) continue;
    if (f.person_id && t.person_id !== f.person_id) continue;
    if (f.truck_id && t.truck_id !== f.truck_id) continue;
    keys.add(t.person_id + '|' + t.work_date);
  }
  const rows: CompareRow[] = [];
  for (const k of keys) {
    const [pid, date] = k.split('|');
    const ts = tsLines.find(t => t.person_id === pid && t.work_date === date);
    const ds = dl.filter(l => l.person_id === pid && l.date === date);
    const sum = r2(ds.reduce((s, l) => s + l.hours, 0));
    const tsDocket = ts?.docket_hours != null ? Number(ts.docket_hours) : null;
    rows.push({
      person_id: pid, driver: byId(people, pid)?.full_name ?? '(unknown)', date, timesheet_status: ts?.status ?? 'no timesheet',
      timesheet_total: ts?.total_hours != null ? Number(ts.total_hours) : null, timesheet_docket_hours: tsDocket, dockets_hours: sum,
      difference: tsDocket === null ? null : r2(tsDocket - sum),
      dockets: ds.map(l => ({ id: l.docket_id, docket_no: l.docket_no, hours: l.hours, asset: l.asset, stage: l.status })),
      assets: [...new Set(ds.map(l => l.asset).filter(Boolean))].join(', '),
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.driver.localeCompare(b.driver));
}
