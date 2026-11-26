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
/** Runs past midnight (Queensland): its hours go on each day they were worked (UAT 26/11/2026). */
export const crossesMidnight = (a?: string | null, b?: string | null) =>
  !!a && !!b && new Date(b) > new Date(a) && qldDate(a) !== qldDate(b) && hoursOnDay(a, b, qldDate(b)!) > 0;
/** The night band runs 18:00 to 06:00, so a 12 hour night is 6 hours on the day it starts and 6 on the next. */
const NIGHT = '18:00 to 06:00';
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
    return [1, 2].filter(n => uuidish(x[`s${n}_operator_id`])).flatMap(n => {
      const band = tsBand(x[`s${n}_band`]);
      const base = {
        person_id: x[`s${n}_operator_id`], band,
        truck_id: uuidish(x[`s${n}_truck_id`]) ?? d.truck_id ?? null, location_id: d.location_id ?? null,
        with_dog: x[`s${n}_truck_config`] === 'Dog' ? true : null, shift_id: d.shift_id ?? null,
      };
      if (band === NIGHT) return [{ ...base, day, hours: 6, standby: num(x[`s${n}_standby_hours`]) }, { ...base, day: nextDay(day), hours: 6, standby: null }];
      return [{ ...base, day, hours: band ? 12 : null, standby: num(x[`s${n}_standby_hours`]) }];
    });
  }
  const band = tsBand(x.shift_band) ?? (shift?.day_night === 'Day' ? '06:00 to 18:00' : shift?.day_night === 'Night' ? '18:00 to 06:00' : null);
  const people0: string[] = shift?.driver_id ? [shift.driver_id] : (d.assigned_person_ids ?? []);
  const long = isLong(d.start_at, d.end_at, d.over_24h);
  if (long || crossesMidnight(d.start_at, d.end_at)) {
    // hours stay on the day they were worked: split at midnight
    const firstDay = qldDate(d.start_at);
    const note = long ? longNote(d.start_at, d.end_at) : null;
    return people0.flatMap(p => daysCovered(d.start_at, d.end_at).filter(dd => hoursOnDay(d.start_at, d.end_at, dd) > 0).map(dd => ({
      person_id: p, day: dd, hours: hoursOnDay(d.start_at, d.end_at, dd),
      standby: dd === firstDay && d.standby_minutes != null ? Number(d.standby_minutes) / 60 : null, band,
      truck_id: d.truck_id ?? null, location_id: d.location_id ?? null, with_dog: null, shift_id: d.shift_id ?? null, split: long, note,
    })));
  }
  const timed = !!d.start_at && !!d.end_at && new Date(d.end_at) > new Date(d.start_at);
  const standby = d.standby_minutes != null ? Number(d.standby_minutes) / 60 : null;
  const common = { band, truck_id: d.truck_id ?? null, location_id: d.location_id ?? null, with_dog: null, shift_id: d.shift_id ?? null };
  // no times, closed on the night band: 6 hours on each day
  if (!timed && d.status === 'closed' && band === NIGHT) {
    return people0.flatMap(p => [{ ...common, person_id: p, day, hours: 6, standby }, { ...common, person_id: p, day: nextDay(day), hours: 6, standby: null }]);
  }
  const hours = timed ? hoursBetween(d.start_at, d.end_at) : d.status === 'closed' && band ? 12 : null;
  return people0.map(p => ({ ...common, person_id: p, day, hours, standby }));
}

/** Everyone the old or new version of a docket could give time to (to know which days to work out again). */
export function docketPeopleDays(d: Row | null | undefined, shift?: Row | null): { person_id: string; day: string }[] {
  if (!d) return [];
  const x = d.extras ?? {};
  const day = docketDay(d, shift);
  if (!day) return [];
  const ids = [shift?.driver_id, uuidish(x.s1_operator_id), uuidish(x.s2_operator_id), ...(d.assigned_person_ids ?? [])].filter(Boolean) as string[];
  // the next day too: a night shift can put hours on it
  const days = new Set([day, nextDay(day), ...(d.start_at && d.end_at && new Date(d.end_at) > new Date(d.start_at) ? daysCovered(d.start_at, d.end_at) : [])]);
  return [...new Set(ids)].flatMap(person_id => [...days].map(dd => ({ person_id, day: dd })));
}

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const sumOrNull = (xs: (number | null)[]) => xs.some(v => v !== null) ? xs.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

/**
 * What the line for one driver and day should become.
 * Returns the row to insert or update, 'delete' to remove an untouched line we made, or null to leave it alone.
 */
export function planDay(entries: Entry[], existing: Row | undefined, shiftOf: (id: string) => Row | undefined, locationName: (id: string) => string | undefined,
  person_id: string, day: string, carriedShifts: Row[] = []): Row | 'delete' | null {
  // the shifts worked on this day: those its dockets belong to, plus any shift (with dockets) that ran past midnight into it
  const shiftIds = [...new Set(entries.map(e => e.shift_id).filter(Boolean) as string[])];
  const shifts = [...shiftIds.map(id => shiftOf(id)).filter(Boolean) as Row[],
    ...carriedShifts.filter(s => !shiftIds.includes(s.id) && (isLong(s.sign_in_at, s.sign_out_at, s.over_24h) || crossesMidnight(s.sign_in_at, s.sign_out_at)) && hoursOnDay(s.sign_in_at, s.sign_out_at, day) > 0)];
  const spanOf = (s: Row) => isLong(s.sign_in_at, s.sign_out_at, s.over_24h) || crossesMidnight(s.sign_in_at, s.sign_out_at) ? hoursOnDay(s.sign_in_at, s.sign_out_at, day)
    : s.sign_in_at && s.sign_out_at && new Date(s.sign_out_at) > new Date(s.sign_in_at) ? hoursBetween(s.sign_in_at, s.sign_out_at) : null;
  const span = sumOrNull(shifts.map(spanOf));
  if (!entries.length && !span) {
    return existing && existing.source === 'dockets' && existing.status === 'draft' && !existing.hours_edited && !existing.work_diary_page ? 'delete' : null;
  }
  const hrs = sumOrNull(entries.map(e => e.hours));
  const sb = sumOrNull(entries.map(e => e.standby));
  const first = <K extends keyof Entry>(k: K) => (entries.find(e => e[k] !== null && e[k] !== undefined)?.[k] ?? null) as Entry[K] | null;
  // the day's band is the band of the entry with the most hours (a day can hold the end of last night and a new shift)
  const band = [...entries].filter(e => e.band).sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1))[0]?.band ?? null;
  const shiftId = first('shift_id') ?? shifts[0]?.id ?? null;
  const dog = entries.some(e => e.with_dog === true) ? true : null;
  const locs = [...new Set(entries.map(e => (e.location_id ? locationName(e.location_id) : undefined)).filter(Boolean))].sort().join(', ') || null;
  const longShift = shifts.find(s => isLong(s.sign_in_at, s.sign_out_at, s.over_24h));
  const split = entries.some(e => e.split) || !!longShift;
  const note = entries.find(e => e.note)?.note ?? (longShift ? longNote(longShift.sign_in_at, longShift.sign_out_at) : null);
  // dockets not on any shift add their own hours to the shift time
  const tot = span !== null ? span + (sumOrNull(entries.filter(e => !e.shift_id).map(e => e.hours)) ?? 0) : hrs;
  const travel = r2(Math.max((tot ?? 0) - (hrs ?? 0), 0));
  if (!existing) {
    return { person_id, work_date: day, status: 'draft', on_shift: true, rr: false, shift_id: shiftId, docket_hours: r2(hrs), standby_hours: r2(sb),
      total_hours: r2(tot), travel_hours: travel, shift_band: band, truck_id: first('truck_id') ?? shifts[0]?.truck_id ?? null, with_dog: dog ?? false, location: locs, source: 'dockets',
      over_24h: split, split_note: note };
  }
  if (!['draft', 'queried'].includes(existing.status ?? 'draft')) return null;
  return {
    ...existing, shift_id: existing.shift_id ?? shiftId, docket_hours: r2(hrs), standby_hours: r2(sb),
    total_hours: existing.hours_edited ? existing.total_hours : r2(tot), travel_hours: existing.hours_edited ? existing.travel_hours : travel,
    shift_band: band ?? existing.shift_band, truck_id: first('truck_id') ?? shifts[0]?.truck_id ?? existing.truck_id,
    with_dog: dog ?? existing.with_dog, location: locs ?? existing.location, on_shift: true, rr: false, source: existing.source ?? 'dockets',
    over_24h: split, split_note: note,
  };
}
