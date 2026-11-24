import { useEffect, useState } from 'react';
import { backend, type Row } from '../lib/backend';
import { Page, refLabel, useRows } from '../components/ui';
import { downloadRows } from '../lib/importExport';
import { hoursBetween } from '../lib/timesheet';
import { round1, round2 } from '../lib/kmMatch';

// Reports are worked out in the browser from the same tables, so they work in demo mode too.
export default function Reports() {
  const customers = useRows('customers'); const locations = useRows('locations'); const trucks = useRows('trucks'); const people = useRows('people');
  const [kind, setKind] = useState<'customer' | 'truck' | 'travel'>('customer');
  const [data, setData] = useState<{ dockets: Row[]; shifts: Row[]; segs: Row[] }>({ dockets: [], shifts: [], segs: [] });
  useEffect(() => { (async () => setData({ dockets: await backend().list('dockets'), shifts: await backend().list('shifts'), segs: await backend().list('km_segments').catch(() => []) }))(); }, []);
  const day = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-CA') : '';
  let rows: Row[] = [];
  if (kind === 'customer') {
    const m = new Map<string, Row>();
    for (const d of data.dockets) {
      const k = [day(d.start_at), d.customer_id, d.location_id, d.po].join('|');
      const r = m.get(k) ?? { date: day(d.start_at), customer: refLabel('customers', customers, d.customer_id), rig: refLabel('locations', locations, d.location_id), project: d.project_no, task: d.task_no, po: d.po, dockets: 0, hours: 0, km: 0, fuel_l: 0 };
      r.dockets++; r.hours = round2(r.hours + hoursBetween(d.start_at, d.end_at)); r.km = round1(r.km + (Number(d.km) || 0)); r.fuel_l += Number(d.fuel_l) || 0; m.set(k, r);
    }
    rows = [...m.values()];
  } else if (kind === 'truck') {
    rows = data.dockets.map(d => { const s = data.shifts.find(x => x.id === d.shift_id) ?? {};
      return { date: s.shift_date, shift: s.day_night, truck: refLabel('trucks', trucks, s.truck_id), driver: refLabel('people', people, s.driver_id), customer: refLabel('customers', customers, d.customer_id),
        rig: refLabel('locations', locations, d.location_id), hours: round2(hoursBetween(d.start_at, d.end_at)), km: d.km, standby_min: d.standby_minutes, fuel_l: d.fuel_l, status: d.status }; });
  } else {
    const m = new Map<string, Row>();
    for (const g of data.segs.filter(x => x.segment_type === 'travel')) {
      const s = data.shifts.find(x => x.id === g.shift_id) ?? {};
      const k = [day(g.start_at), g.truck_id, s.driver_id].join('|');
      const r = m.get(k) ?? { date: day(g.start_at), truck: refLabel('trucks', trucks, g.truck_id), driver: refLabel('people', people, s.driver_id), travel_hours: 0, travel_km: 0 };
      r.travel_hours = round2(r.travel_hours + hoursBetween(g.start_at, g.end_at)); r.travel_km = round1(r.travel_km + (Number(g.km) || 0)); m.set(k, r);
    }
    rows = [...m.values()];
  }
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <Page title="Reports" actions={<button onClick={() => downloadRows(rows, 'report-' + kind, 'xlsx')}>Download Excel</button>} howTo={<ol>
      <li><b>Per customer and rig per day</b>: hours and km inside dockets only. This is what each customer is charged for.</li>
      <li><b>Per truck</b>: every docket with driver, hours, km, standby and fuel.</li>
      <li><b>Travel</b>: time and km outside dockets, per truck and driver, not charged to any customer. Run Km matching first (Data screen).</li>
      <li>Download any report to Excel. Scheduled emails (07:30 daily) come in the full build.</li>
    </ol>}>
      <div className="tabs">
        <button className={kind === 'customer' ? 'on' : ''} onClick={() => setKind('customer')}>Per customer and rig</button>
        <button className={kind === 'truck' ? 'on' : ''} onClick={() => setKind('truck')}>Per truck</button>
        <button className={kind === 'travel' ? 'on' : ''} onClick={() => setKind('travel')}>Travel (no customer)</button>
      </div>
      <div className="table-wrap"><table><thead><tr>{cols.map(c => <th key={c}>{c.replace('_', ' ')}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}
          {!rows.length && <tr><td className="muted">No data yet{kind === 'travel' ? '. Run Km matching on the Data screen.' : ''}</td></tr>}</tbody></table></div>
    </Page>
  );
}
