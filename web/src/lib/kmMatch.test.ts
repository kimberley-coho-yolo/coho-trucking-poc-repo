import { describe, expect, it } from 'vitest';
import { matchKm, summarise, odometerFlag } from './kmMatch';

// Worked example from the design document: Truck 04, night shift 18:00 to 06:00.
const D = (h: number, m = 0, next = false) => new Date(2026, 10, next ? 25 : 24, h, m).toISOString();
const shift = { start: D(18), end: D(6, 0, true) };
const dockets = [
  { id: 'A', start: D(18, 30), end: D(1, 0, true) },   // Origin, SAV 168
  { id: 'B', start: D(1, 30, true), end: D(5, 30, true) }, // Santos, NIT 1
];
const trips = [
  { id: 'T1', start: D(18, 10), end: D(18, 30), km: 42 },
  { id: 'T2', start: D(18, 30), end: D(1, 0, true), km: 65 },
  { id: 'T3', start: D(1, 0, true), end: D(1, 30, true), km: 38 },
  { id: 'T4', start: D(1, 30, true), end: D(5, 30, true), km: 50 },
  { id: 'T5', start: D(5, 30, true), end: D(6, 0, true), km: 40 },
];

describe('km matching', () => {
  it('splits the worked example: Origin 65, Santos 50, travel 120', () => {
    const s = summarise(matchKm(shift, dockets, trips));
    expect(s.byDocket.get('A')).toBe(65);
    expect(s.byDocket.get('B')).toBe(50);
    expect(s.travelKm).toBe(120);
  });
  it('never attributes travel to a customer', () => {
    const segs = matchKm(shift, dockets, trips);
    for (const t of segs.filter(x => x.type === 'travel')) expect(t.docketId).toBeNull();
  });
  it('shares a trip that crosses a docket boundary by time', () => {
    const segs = matchKm(shift, [{ id: 'A', start: D(19), end: D(20) }], [{ id: 'X', start: D(18, 30), end: D(19, 30), km: 60 }]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ type: 'travel', km: 30 });
    expect(segs[1]).toMatchObject({ type: 'docket', docketId: 'A', km: 30 });
  });
  it('ignores trips outside the shift window', () => {
    expect(matchKm(shift, dockets, [{ start: D(10), end: D(11), km: 99 }])).toHaveLength(0);
  });
  it('keeps total km equal to the clipped trips', () => {
    const total = matchKm(shift, dockets, trips).reduce((s, x) => s + x.km, 0);
    expect(Math.round(total)).toBe(235);
  });
});

describe('odometer check', () => {
  it('flags a big gap between GPS and odometer', () => {
    expect(odometerFlag(100, 1000, 1150)).toMatch(/odometer/);
    expect(odometerFlag(100, 1000, 1105)).toBeUndefined();
    expect(odometerFlag(100, null, 1105)).toBeUndefined();
  });
});
