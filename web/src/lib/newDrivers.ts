// New drivers added on a crew phone: matching to existing people (exact surname), flags, and the weekly report.
// The database (supabase/migrations/*_pending_drivers.sql) applies the same rules when approving or pairing.
import type { Row } from './backend';
import { periodStart, periodEnd, type PeriodSettings } from './forms';

/** The last word of a name, ignoring a nickname in brackets: "Simon Ennor (Tank)" -> "ennor". */
export function surname(name?: string | null): string {
  const words = String(name ?? '').replace(/\([^)]*\)/g, '').trim().split(/\s+/).filter(Boolean);
  return (words[words.length - 1] ?? '').toLowerCase();
}
/** First name and surname, 3 to 80 characters, spaces tidied. Null if not acceptable. */
export function cleanFullName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length >= 3 && n.length <= 80 && /\S+\s+\S+/.test(n) ? n : null;
}
/** Existing active people with exactly the same surname as the pending driver. */
export function matchesFor(pending: Row, people: Row[]): Row[] {
  const s = surname(pending.full_name);
  if (!s) return [];
  return people.filter(p => p.id !== pending.id && !p.pending && p.active !== false && surname(p.full_name) === s)
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
}
export const isPending = (people: Row[], id?: string | null) => !!id && !!people.find(p => p.id === id)?.pending;
/** Pending people on a docket (assigned or named as an operator on a two-shift report). */
export function pendingOnDocket(d: Row, people: Row[]): Row[] {
  const x = d.extras ?? {};
  const ids = new Set<string>([...(d.assigned_person_ids ?? []), x.s1_operator_id, x.s2_operator_id].filter(Boolean));
  return people.filter(p => p.pending && ids.has(p.id));
}
/** People hidden from pick lists (pending names, and names retired by pairing). */
export const pickable = (people: Row[]) => people.filter(p => !p.pending && p.active !== false);

// ---------- weekly report ----------
export type Outcome = 'waiting' | 'approved' | 'paired';
export interface NewDriverRow {
  person_id: string; name: string; crew_phone: string; added_at: string; week_start: string; week_end: string;
  outcome: Outcome; outcome_label: string; paired_to: string; checked_by: string; checked_at: string | null;
}
export interface NewDriverWeek { week_start: string; week_end: string; added: number; approved: number; paired: number; waiting: number; rows: NewDriverRow[] }
const local = (iso: string) => { const t = new Date(new Date(iso).getTime() + 10 * 3.6e6); return t.toISOString().slice(0, 10); };   // Queensland date

/** Every name added on a crew phone, grouped by the week it was added (weeks start on the day set in Settings). */
export function newDriverReport(people: Row[], phones: Row[], ps: PeriodSettings): NewDriverWeek[] {
  const rows: NewDriverRow[] = people.filter(p => p.added_at).map(p => {
    const ws = periodStart(local(p.added_at), ps, 'week');
    const outcome: Outcome = p.pending ? 'waiting' : p.review_outcome === 'paired' ? 'paired' : 'approved';
    const to = people.find(x => x.id === p.paired_to)?.full_name ?? '';
    return {
      person_id: p.id, name: p.full_name, crew_phone: phones.find(w => w.id === p.added_phone_id)?.phone ?? '', added_at: p.added_at,
      week_start: ws, week_end: periodEnd(ws, 'week'), outcome,
      outcome_label: outcome === 'waiting' ? 'Waiting to be checked' : outcome === 'paired' ? `Hours paired to ${to}` : 'Approved as a new driver',
      paired_to: to, checked_by: p.reviewed_by_name ?? '', checked_at: p.reviewed_at ?? null,
    };
  });
  const weeks = new Map<string, NewDriverWeek>();
  for (const r of rows) {
    const w = weeks.get(r.week_start) ?? { week_start: r.week_start, week_end: r.week_end, added: 0, approved: 0, paired: 0, waiting: 0, rows: [] };
    w.added++; w[r.outcome]++; w.rows.push(r); weeks.set(r.week_start, w);
  }
  for (const w of weeks.values()) w.rows.sort((a, b) => a.added_at.localeCompare(b.added_at));
  return [...weeks.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
}
