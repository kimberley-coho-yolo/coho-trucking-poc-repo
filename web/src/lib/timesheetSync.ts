// The driver's timesheet fills itself in from their dockets.
// The real work happens in the database (supabase/migrations/*_timesheet_from_dockets.sql) so it works
// whichever device saves the docket; this file is the same set of rules for the demo backend and the tests.
import type { Row } from './backend';
import { hoursBetween } from './timesheet';

const BANDS = ['00:00 to 12:00', '12:00 to 24:00', '06:00 to 18:00', '18:00 to 06:00'];
/** The paper forms write shift times in different ways; the timesheet uses four. */
export function tsBand(p?: string | null): string | null {
  if (!p) return null;
  if (BANDS.includes(p)) return p;
  if (p === '12:00 to 00:00') return '12:00 to 24:00';
  if (/^6am/i.test(p) || p === '0600 - 1800') return '06:00 to 18:00';
  if (/^6pm/i.test(p) || p === '1800 - 0600') return '18:00 to 06:00';
  return p;
}
/** Calendar date in Queensland (no daylight saving: UTC+10). */
export const qldDate = (iso?: string | null) => iso ? new Date(new Date(iso).getTime() + 10 * 3.6e6).toISOString().slice(0, 10) : null;
const uuidish = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export interface Entry { person_id: string; day: string; hours: number | null; standby: number | null; band: string | null; truck_id: string | null; location_id: string | null; with_dog: boolean | null; shift_id: string | null; split?: boolean; note?: string | null }

// ---------- shifts over 24 hours: split at midnight (Queensland, UTC+10, no daylight saving) ----------
const QLD = 10 * 3.6e6;
const dayStartMs = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - QLD;
const nextDay = (day: string) => new Date(dayStartMs(day) + QLD + 86_400_000).toISOString().slice(0, 10);
/** Hours of [a, b) that fall on this Queensland calendar day. */
export function hoursOnDay(a: string, b: string, day: string): number {
  const s = Math.max(new Date(a).getTime(), dayStartMs(day));
  const e = Math.min(new Date(b).getTime(), dayStartMs(day) + 86_400_000);
  return Math.max(0, (e - s) / 3.6e6);
}
/** A shift counts as over 24 hours when it is ticked, or it really is longer than 24 hours. */
export const isLong = (a?: string | null, b?: string | null, flagged?: boolean | null) =>
  !!a && !!b && new Date(b) > new Date(a) && (!!flagged || hoursBetween(a, b) > 24);
/** Every Queensland day from a to b (at most 15). */
export function daysCovered(a: string, b: string): string[] {
  const out: string[] = []; let d = qldDate(a)!; const last = qldDate(b)!;
  while (d <= last && out.length < 15) { out.push(d); d = nextDay(d); }
  return out;
}
const two = (n: number) => String(n).padStart(2, '0');
const qldStamp = (iso: string) => { const t = new Date(new Date(iso).getTime() + QLD); return `${two(t.getUTCDate())}/${two(t.getUTCMonth() + 1)} ${two(t.getUTCHours())}:${two(t.getUTCMinutes())}`; };
export const longNote = (a: string, b: string) => `Part of a ${hoursBetween(a, b).toFixed(1)} h shift: ${qldStamp(a)} to ${qldStamp(b)}`;

export const docketStarted = (d: Row) => d.status === 'open' || d.status === 'closed' || !!d.start_at;
export const docketDay = (d: Row, shift?: Row | null) => d.work_date ?? qldDate(d.start_at) ?? shift?.shift_date ?? null;

/** Who a docket gives time to, and how much. */
export function docketEntries(d: Row, shift?: Row | null): Entry[] {
  if (!docketStarted(d)) return [];
  const x = d.extras ?? {};
  const day = docketDay(d, shift);
  if (!day) return [];
  if (uuidish(x.s1_operator_id) || uuidish(x.s2_operator_id)) {
    return [1, 2].filter(n => uuidish(x[`s${n}_operator_id`])).map(n => {
      const band = tsBand(x[`s${n}_band`]);
      return {
        person_id: x[`s${n}_operator_id`], day, hours: band ? 12 : null, standby: num(x[`s${n}_standby_hours`]), band,
        truck_id: uuidish(x[`s${n}_truck_id`]) ?? d.truck_id ?? null, location_id: d.location_id ?? null,
        with_dog: x[`s${n}_truck_config`] === 'Dog' ? true : null, shift_id: d.shift_id ?? null,
      };
    });
  }
  const band = tsBand(x.shift_band) ?? (shift?.day_night === 'Day' ? '06:00 to 18:00' : shift?.day_night === 'Night' ? '18:00 to 06:00' : null);
  const people0: string[] = shift?.driver_id ? [shift.driver_id] : (d.assigned_person_ids ?? []);
  if (isLong(d.start_at, d.end_at, d.over_24h)) {
    const firstDay = qldDate(d.start_at);
    const note = longNote(d.start_at, d.end_at);
    return people0.flatMap(p => daysCovered(d.start_at, d.end_at).filter(dd => hoursOnDay(d.start_at, d.end_at, dd) > 0).map(dd => ({
      person_id: p, day: dd, hours: hoursOnDay(d.start_at, d.end_at, dd),
      standby: dd === firstDay && d.standby_minutes != null ? Number(d.standby_minutes) / 60 : null, band,
      truck_id: d.truck_id ?? null, location_id: d.location_id ?? null, with_dog: null, shift_id: d.shift_id ?? null, split: true, note,
    })));
  }
  const hours = d.start_at && d.end_at && new Date(d.end_at) > new Date(d.start_at) ? hoursBetween(d.start_at, d.end_at)
    : d.status === 'closed' && band ? 12 : null;
  return people0.map(p => ({
    person_id: p, day, hours, standby: d.standby_minutes != null ? Number(d.standby_minutes) / 60 : null, band,
    truck_id: d.truck_id ?? null, location_id: d.location_id ?? null, with_dog: null, shift_id: d.shift_id ?? null,
  }));
}

/** Everyone the old or new version of a docket could give time to (to know which days to work out again). */
export function docketPeopleDays(d: Row | null | undefined, shift?: Row | null): { person_id: string; day: string }[] {
  if (!d) return [];
  const x = d.extras ?? {};
  const day = docketDay(d, shift);
  if (!day) return [];
  const ids = [shift?.driver_id, uuidish(x.s1_operator_id), uuidish(x.s2_operator_id), ...(d.assigned_person_ids ?? [])].filter(Boolean) as string[];
  const days = new Set([day, ...(d.start_at && d.end_at && new Date(d.end_at) > new Date(d.start_at) ? daysCovered(d.start_at, d.end_at) : [])]);
  return [...new Set(ids)].flatMap(person_id => [...days].map(dd => ({ person_id, day: dd })));
}

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const sumOrNull = (xs: (number | null)[]) => xs.some(v => v !== null) ? xs.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

/**
 * What the line for one driver and day should become.
 * Returns the row to insert or update, 'delete' to remove an untouched line we made, or null to leave it alone.
 */
export function planDay(entries: Entry[], existing: Row | undefined, shiftOf: (id: string) => Row | undefined, locationName: (id: string) => string | undefined,
  person_id: string, day: string): Row | 'delete' | null {
  if (!entries.length) {
    return existing && existing.source === 'dockets' && existing.status === 'draft' && !existing.hours_edited && !existing.work_diary_page ? 'delete' : null;
  }
  const hrs = sumOrNull(entries.map(e => e.hours));
  const sb = sumOrNull(entries.map(e => e.standby));
  const first = <K extends keyof Entry>(k: K) => (entries.find(e => e[k] !== null && e[k] !== undefined)?.[k] ?? null) as Entry[K] | null;
  const shiftId = first('shift_id');
  const dog = entries.some(e => e.with_dog === true) ? true : null;
  const locs = [...new Set(entries.map(e => (e.location_id ? locationName(e.location_id) : undefined)).filter(Boolean))].sort().join(', ') || null;
  const s = shiftId ? shiftOf(shiftId) : undefined;
  let split = entries.some(e => e.split);
  let note = entries.find(e => e.note)?.note ?? null;
  let span: number | null = null;
  if (s && isLong(s.sign_in_at, s.sign_out_at, s.over_24h)) {
    span = hoursOnDay(s.sign_in_at, s.sign_out_at, day); split = true; note = note ?? longNote(s.sign_in_at, s.sign_out_at);
  } else if (s?.sign_in_at && s?.sign_out_at && new Date(s.sign_out_at) > new Date(s.sign_in_at)) span = hoursBetween(s.sign_in_at, s.sign_out_at);
  const tot = span ?? hrs;
  const travel = r2(Math.max((tot ?? 0) - (hrs ?? 0), 0));
  if (!existing) {
    return { person_id, work_date: day, status: 'draft', on_shift: true, rr: false, shift_id: shiftId, docket_hours: r2(hrs), standby_hours: r2(sb),
      total_hours: r2(tot), travel_hours: travel, shift_band: first('band'), truck_id: first('truck_id'), with_dog: dog ?? false, location: locs, source: 'dockets',
      over_24h: split, split_note: note };
  }
  if (!['draft', 'queried'].includes(existing.status ?? 'draft')) return null;
  return {
    ...existing, shift_id: existing.shift_id ?? shiftId, docket_hours: r2(hrs), standby_hours: r2(sb),
    total_hours: existing.hours_edited ? existing.total_hours : r2(tot), travel_hours: existing.hours_edited ? existing.travel_hours : travel,
    shift_band: first('band') ?? existing.shift_band, truck_id: first('truck_id') ?? existing.truck_id,
    with_dog: dog ?? existing.with_dog, location: locs ?? existing.location, on_shift: true, rr: false, source: existing.source ?? 'dockets',
    over_24h: split, split_note: note,
  };
}
