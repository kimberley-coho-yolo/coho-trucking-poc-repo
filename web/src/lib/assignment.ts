// Where a docket is in its journey: not assigned -> assigned -> in progress -> completed (to review) -> reviewed,
// or returned to the driver. Used by the roster, the home page status board and the driver's jobs for today.
import type { Row } from './backend';
import { qldDate } from './timesheetSync';

export type DocketStage = 'unassigned' | 'assigned' | 'in_progress' | 'to_review' | 'returned' | 'reviewed' | 'completed';
export const STAGE_LABEL: Record<DocketStage, string> = {
  unassigned: 'Not assigned', assigned: 'Assigned', in_progress: 'In progress', to_review: 'Completed, to review',
  returned: 'Returned to driver', reviewed: 'Reviewed', completed: 'Completed',
};
export const STAGE_ORDER: DocketStage[] = ['unassigned', 'assigned', 'in_progress', 'returned', 'to_review', 'completed', 'reviewed'];

export function stageOf(d: Row): DocketStage {
  if (d.review_status === 'reviewed') return 'reviewed';
  if (d.review_status === 'returned') return 'returned';
  if (d.review_status === 'to_review') return 'to_review';
  if (d.status === 'closed') return 'completed';
  const assigned = !!d.assigned_phone_id || (d.assigned_person_ids ?? []).length > 0;
  if (d.status === 'open' || d.start_at || d.shift_id) return 'in_progress';
  return assigned ? 'assigned' : 'unassigned';
}
/** The day a docket belongs to on the roster. */
export const docketDay = (d: Row): string | null => d.work_date ?? qldDate(d.start_at) ?? null;

/**
 * A driver's jobs: dockets assigned to their phone or to them, not finished, up to today (late ones included),
 * plus the next 7 days. A docket for a named driver on a shared phone only shows for that driver.
 */
export function jobsFor(dockets: Row[], personId: string | null | undefined, today: string, ahead = 7) {
  const limit = new Date(Date.parse(today + 'T00:00:00Z') + ahead * 86_400_000).toISOString().slice(0, 10);
  const mine = dockets.filter(d => {
    const people: string[] = d.assigned_person_ids ?? [];
    const assigned = !!d.assigned_phone_id || people.length > 0;
    if (!assigned) return false;
    if (people.length && personId && !people.includes(personId)) return false;
    const st = stageOf(d);
    return st === 'assigned' || st === 'in_progress' || st === 'returned';
  });
  const byDay = (d: Row) => docketDay(d) ?? today;
  const sort = (a: Row, b: Row) => byDay(a).localeCompare(byDay(b)) || Number(a.docket_no ?? 0) - Number(b.docket_no ?? 0);
  return {
    today: mine.filter(d => byDay(d) === today).sort(sort),
    late: mine.filter(d => byDay(d) < today).sort(sort),
    upcoming: mine.filter(d => byDay(d) > today && byDay(d) <= limit).sort(sort),
  };
}

/** Completed dockets waiting for this reviewer (their departments; none = all). */
export const toReview = (dockets: Row[], departments: string[]) =>
  dockets.filter(d => d.review_status === 'to_review' && (!departments.length || departments.includes(d.department ?? '')))
    .sort((a, b) => String(a.completed_at ?? '').localeCompare(String(b.completed_at ?? '')));

export const phoneLabel = (w?: Row | null) => (w ? `${w.label || 'Crew phone'} (${w.phone ?? ''})` : '');
