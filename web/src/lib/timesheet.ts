// Builds a draft timesheet line from a shift and its dockets (design document section 10).
import { round2 } from './kmMatch';

export interface DocketTimes { start_at?: string | null; end_at?: string | null; standby_minutes?: number | null }

export function hoursBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const h = (new Date(b).getTime() - new Date(a).getTime()) / 3.6e6;
  return h > 0 ? h : 0;
}

export function draftTimesheet(shift: { sign_in_at?: string | null; sign_out_at?: string | null }, dockets: DocketTimes[]) {
  const total = hoursBetween(shift.sign_in_at, shift.sign_out_at);
  const docket = dockets.reduce((s, d) => s + hoursBetween(d.start_at, d.end_at), 0);
  const standby = dockets.reduce((s, d) => s + (Number(d.standby_minutes) || 0) / 60, 0);
  // Standby is recorded inside a docket window, so it is shown separately but not added again.
  const travel = Math.max(0, total - docket);
  return {
    total_hours: round2(total),
    docket_hours: round2(docket),
    travel_hours: round2(travel),
    standby_hours: round2(standby),
  };
}
