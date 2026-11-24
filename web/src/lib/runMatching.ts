// Runs km matching for shifts and writes km_segments and docket km (design document section 9).
import { backend, type Row } from './backend';
import { matchKm, odometerFlag, summarise } from './kmMatch';

export function truckForRef(trucks: Row[], ref?: string | null): Row | undefined {
  if (!ref) return undefined;
  const k = String(ref).trim().toLowerCase().replace(/^unit\s*/, '');
  return trucks.find(t => [t.unit_no, t.rego, t.tracker_id, t.gearbox_id].some(v => v && String(v).trim().toLowerCase() === k));
}

export async function linkTrucks(table: 'gps_trips' | 'prestart_records'): Promise<number> {
  const trucks = await backend().list('trucks');
  const rows = (await backend().list(table)).filter(r => !r.truck_id && r.truck_ref);
  let n = 0;
  for (const r of rows) { const t = truckForRef(trucks, r.truck_ref); if (t) { await backend().save(table, { id: r.id, truck_id: t.id }); n++; } }
  return n;
}

export async function runMatching(shiftIds?: string[]) {
  await linkTrucks('gps_trips');
  const shifts = (await backend().list('shifts')).filter(s => s.truck_id && s.sign_in_at && (!shiftIds || shiftIds.includes(s.id)));
  const trips = await backend().list('gps_trips');
  const existing = await backend().list('km_segments');
  let segCount = 0; const flags: string[] = [];
  for (const s of shifts) {
    const end = s.sign_out_at ?? new Date(new Date(s.sign_in_at).getTime() + 12 * 3.6e6).toISOString();
    const dockets = await backend().list('dockets', { shift_id: s.id });
    const tripsForTruck = trips.filter(t => t.truck_id === s.truck_id && t.start_at && t.end_at);
    if (!tripsForTruck.length) continue;
    for (const old of existing.filter(k => k.shift_id === s.id)) await backend().remove('km_segments', old.id);
    const segs = matchKm({ start: s.sign_in_at, end }, dockets.map(d => ({ id: d.id, start: d.start_at, end: d.end_at ?? end })),
      tripsForTruck.map(t => ({ id: t.id, start: t.start_at, end: t.end_at, km: Number(t.km) || 0 })));
    const sum = summarise(segs);
    for (const g of segs) {
      await backend().save('km_segments', { shift_id: s.id, truck_id: s.truck_id, trip_id: g.tripId ?? null, docket_id: g.docketId, segment_type: g.type,
        start_at: g.start.toISOString(), end_at: g.end.toISOString(), km: g.km });
      segCount++;
    }
    for (const d of dockets) {
      const km = sum.byDocket.get(d.id) ?? 0;
      const flag = odometerFlag(km, d.odo_start, d.odo_end);
      if (flag) flags.push(flag);
      await backend().save('dockets', { id: d.id, km });
    }
  }
  return { shifts: shifts.length, segments: segCount, flags };
}
