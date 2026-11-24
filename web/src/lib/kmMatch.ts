// Splits GPS trips for one shift into docket km and travel km (design document section 9).
// Rules: clip trips to the shift window; time inside a docket goes to that docket; any time outside
// a docket is travel with no customer (decided 24 Nov 2026). Km is shared by time when a trip spans a boundary.
export interface Window { id?: string; start: string | Date; end: string | Date }
export interface Trip { id?: string; start: string | Date; end: string | Date; km: number }
export interface Segment {
  tripId?: string; docketId: string | null; type: 'docket' | 'travel';
  start: Date; end: Date; km: number; flag?: string;
}

const ms = (d: string | Date) => new Date(d).getTime();

export function matchKm(shift: Window, dockets: Window[], trips: Trip[]): Segment[] {
  const s0 = ms(shift.start), s1 = ms(shift.end);
  const ds = dockets
    .filter(d => d.start && d.end)
    .map(d => ({ id: d.id ?? null, a: ms(d.start), b: ms(d.end) }))
    .sort((x, y) => x.a - y.a);
  const out: Segment[] = [];
  for (const t of trips) {
    const ta = ms(t.start), tb = ms(t.end);
    const a = Math.max(ta, s0), b = Math.min(tb, s1);
    if (!(b > a) || !(tb > ta)) continue;
    const kmPerMs = (t.km || 0) / (tb - ta);
    // cut points inside the clipped trip
    const cuts = new Set<number>([a, b]);
    for (const d of ds) { if (d.a > a && d.a < b) cuts.add(d.a); if (d.b > a && d.b < b) cuts.add(d.b); }
    const pts = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], mid = (p + q) / 2;
      const d = ds.find(x => mid >= x.a && mid < x.b);
      const seg: Segment = {
        tripId: t.id, docketId: d ? d.id : null, type: d ? 'docket' : 'travel',
        start: new Date(p), end: new Date(q), km: round1(kmPerMs * (q - p)),
      };
      const prev = out[out.length - 1];
      if (prev && prev.tripId === seg.tripId && prev.docketId === seg.docketId && prev.end.getTime() === p) {
        prev.end = seg.end; prev.km = round1(prev.km + seg.km);
      } else out.push(seg);
    }
  }
  return out;
}

export function summarise(segments: Segment[]) {
  const byDocket = new Map<string, number>();
  let travelKm = 0, travelMs = 0;
  for (const s of segments) {
    if (s.type === 'travel') { travelKm += s.km; travelMs += s.end.getTime() - s.start.getTime(); }
    else byDocket.set(s.docketId!, round1((byDocket.get(s.docketId!) ?? 0) + s.km));
  }
  return { byDocket, travelKm: round1(travelKm), travelHours: round2(travelMs / 3.6e6) };
}

// Odometer check (rule 6): flag when GPS and odometer km differ by more than the threshold.
export function odometerFlag(gpsKm: number, odoStart?: number | null, odoEnd?: number | null, thresholdPct = 10): string | undefined {
  if (odoStart == null || odoEnd == null) return undefined;
  const odo = odoEnd - odoStart;
  if (odo <= 0) return 'Odometer end is not after start';
  const diff = Math.abs(gpsKm - odo) / odo * 100;
  return diff > thresholdPct ? `GPS ${gpsKm} km vs odometer ${odo} km (${diff.toFixed(0)}% apart)` : undefined;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;
