import { describe, expect, it } from 'vitest';
import { draftTimesheet } from './timesheet';
const D = (h: number, m = 0, next = false) => new Date(2026, 10, next ? 25 : 24, h, m).toISOString();
describe('draft timesheet', () => {
  it('splits a 12 hour shift into docket and travel hours', () => {
    const t = draftTimesheet({ sign_in_at: D(18), sign_out_at: D(6, 0, true) }, [
      { start_at: D(18, 30), end_at: D(1, 0, true) },
      { start_at: D(1, 30, true), end_at: D(5, 30, true), standby_minutes: 30 },
    ]);
    expect(t).toEqual({ total_hours: 12, docket_hours: 10.5, travel_hours: 1.5, standby_hours: 0.5 });
  });
  it('copes with missing times (all data optional)', () => {
    expect(draftTimesheet({}, [{}])).toEqual({ total_hours: 0, docket_hours: 0, travel_hours: 0, standby_hours: 0 });
  });
});
