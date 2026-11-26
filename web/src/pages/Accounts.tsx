import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { compareTimesheets, docketLines, filterLines, groupTotals, overdueTimesheets, truckName, type DocketFilter, type GroupBy } from '../lib/accounts';
import { STAGE_LABEL, STAGE_ORDER } from '../lib/assignment';
import { usePeriodSettings } from '../lib/appSettings';
import { downloadRows } from '../lib/importExport';
import { fmt, Page, todayIso, useRows } from '../components/ui';
import { newDriverReport } from '../lib/newDrivers';

type Tab = 'overdue' | 'totals' | 'compare' | 'newdrivers';
const nowLocal = () => { const d = new Date(); return `${todayIso()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const nice = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const hrs = (n: number | null | undefined) => (n === null || n === undefined ? '-' : String(n));

// Accounts (payroll and invoicing): overdue timesheets, docket totals, and timesheets checked against their dockets.
export default function Accounts() {
  const ps = usePeriodSettings();
  const customers = useRows('customers'); const locations = useRows('locations'); const trucks = useRows('trucks');
  const people = useRows('people'); const phones = useRows('work_phones');
  const [tab, setTab] = useState<Tab>('overdue');
  const [data, setData] = useState<{ dockets: Row[]; loads: Row[]; shifts: Row[]; ts: Row[] } | null>(null);
  useEffect(() => {
    (async () => {
      const [dockets, loads, shifts, ts] = await Promise.all(['dockets', 'loads', 'shifts', 'timesheet_lines'].map(t => backend().list(t as 'dockets')));
      setData({ dockets, loads, shifts, ts });
    })();
  }, []);
  const lines = useMemo(() => data ? docketLines(data.dockets, data.loads, { customers, locations, trucks, people, phones, shifts: data.shifts }) : [],
    [data, customers, locations, trucks, people, phones]);

  return (
    <Page title="Accounts" howTo={<ol>
      <li><b>Overdue timesheets</b>: days not sent, or sent back, after the period's due time (09:00 the day after the period ends).</li>
      <li><b>Docket totals</b>: totals per customer, asset (truck), user (driver) or status. Filter by date, customer, truck, driver, department, form, status or any text. Tap a total to list its dockets.</li>
      <li><b>Timesheets vs dockets</b>: pick a truck (for example a water truck) or a driver and dates. Each line is one driver and day: the timesheet's docket hours against what that day's dockets add up to.</li>
      <li>Hours are driver hours: a two-shift report counts 12 hours for each operator. Loads and litres are counted once per docket.</li>
      <li><b>New drivers</b>: names drivers added on a crew phone, per week: how many, and whether each was approved as a new driver or had their hours paired to an existing driver, by whom and when.</li>
      <li>Every table downloads to Excel.</li>
    </ol>}>
      <div className="tabs" role="tablist">
        {([['overdue', 'Overdue timesheets'], ['totals', 'Docket totals'], ['compare', 'Timesheets vs dockets'], ['newdrivers', 'New drivers']] as [Tab, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!data ? <p className="muted">Loading...</p>
        : tab === 'overdue' ? <Overdue ts={data.ts} people={people} ps={ps} />
        : tab === 'newdrivers' ? <NewDrivers people={people} phones={phones} ps={ps} />
        : tab === 'totals' ? <Totals lines={lines} customers={customers} trucks={trucks} people={people} />
        : <Compare ts={data.ts} lines={lines} trucks={trucks} people={people} />}
    </Page>
  );
}

function Overdue({ ts, people, ps }: { ts: Row[]; people: Row[]; ps: ReturnType<typeof usePeriodSettings> }) {
  const rows = overdueTimesheets(ts, people, nowLocal(), ps);
  const out = rows.map(r => ({ Driver: r.driver, 'Period from': r.period_start, 'Period to': r.period_end, 'Was due': r.due, 'Days overdue': r.days_overdue,
    'Days not sent': r.days, 'Of which sent back': r.sent_back, 'Hours on those days': r.hours }));
  return <>
    <div className="row spread"><p className="muted">{rows.length ? `${rows.length} driver period${rows.length > 1 ? 's' : ''} overdue` : 'Nothing overdue.'}</p>
      <button className="small" disabled={!rows.length} onClick={() => downloadRows(out, 'overdue-timesheets', 'xlsx')}>Download Excel</button></div>
    <div className="table-wrap"><table className="accounts-overdue">
      <thead><tr><th>Driver</th><th>Period</th><th>Was due</th><th>Days overdue</th><th>Days not sent</th><th>Sent back</th><th>Hours</th><th /></tr></thead>
      <tbody>{rows.map(r => <tr key={r.person_id + r.period_start}>
        <td>{r.driver}</td><td>{nice(r.period_start)} to {nice(r.period_end)}</td><td>{nice(r.due.slice(0, 10))} {r.due.slice(11)}</td>
        <td><b>{r.days_overdue}</b></td><td>{r.days}</td><td>{r.sent_back || ''}</td><td>{r.hours}</td>
        <td><Link className="button small" to={`/forms/timesheet?person=${r.person_id}&start=${r.period_start}&view=${ps.view}`}>Open</Link></td>
      </tr>)}</tbody></table></div>
  </>;
}

function Totals({ lines, customers, trucks, people }: { lines: ReturnType<typeof docketLines>; customers: Row[]; trucks: Row[]; people: Row[] }) {
  const [by, setBy] = useState<GroupBy>('customer');
  const [f, setF] = useState<DocketFilter>({});
  const [open, setOpen] = useState<string | null>(null);
  const shown = filterLines(lines, f);
  const groups = groupTotals(shown, by);
  const keyOf = (l: (typeof lines)[number]) => by === 'customer' ? l.customer_id ?? '' : by === 'asset' ? l.truck_id ?? '' : by === 'driver' ? l.person_id ?? '' : l.stage;
  const detail = open === null ? [] : shown.filter(l => keyOf(l) === open);
  const departments = [...new Set(lines.map(l => l.department).filter(Boolean))].sort();
  const forms = [...new Set(lines.map(l => l.form))].sort();
  const set = (k: keyof DocketFilter) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value || undefined }); setOpen(null); };
  const totalOut = groups.map(g => ({ [by === 'asset' ? 'Asset' : by === 'driver' ? 'User' : by === 'status' ? 'Status' : 'Customer']: g.label, Dockets: g.dockets, Hours: g.hours,
    'Standby hours': g.standby, Loads: g.loads, Litres: g.volume_l, ...Object.fromEntries(STAGE_ORDER.map(s => [STAGE_LABEL[s], g.stages[s] ?? 0])) }));
  const lineOut = shown.map(l => ({ 'Docket No.': l.docket_no, Date: l.date, Form: l.form, Department: l.department, Customer: l.customer, Rig: l.rig, Asset: l.asset,
    User: l.driver, 'Crew phone': l.crew_phone, Status: l.status, Hours: l.hours, 'Standby hours': l.standby, Loads: l.loads, Litres: l.volume_l }));
  return <>
    <div className="row"><span className="field-label">Totals per</span>
      <div className="seg" role="group" aria-label="Totals per">
        {([['customer', 'Customer'], ['asset', 'Asset'], ['driver', 'User'], ['status', 'Status']] as [GroupBy, string][]).map(([k, l]) =>
          <button key={k} className={by === k ? 'on' : ''} aria-pressed={by === k} onClick={() => { setBy(k); setOpen(null); }}>{l}</button>)}
      </div></div>
    <div className="filters">
      <label className="field"><span className="field-label">Search</span><input type="search" placeholder="No., customer, rig, truck, driver" value={f.text ?? ''} onChange={set('text')} /></label>
      <label className="field"><span className="field-label">From</span><input type="date" value={f.from ?? ''} onChange={set('from')} /></label>
      <label className="field"><span className="field-label">To</span><input type="date" value={f.to ?? ''} onChange={set('to')} /></label>
      <label className="field"><span className="field-label">Customer</span><select value={f.customer_id ?? ''} onChange={set('customer_id')}><option value="">All</option>
        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span className="field-label">Asset</span><select value={f.truck_id ?? ''} onChange={set('truck_id')}><option value="">All</option>
        {trucks.filter(t => t.active !== false).map(t => <option key={t.id} value={t.id}>{truckName(t)}</option>)}</select></label>
      <label className="field"><span className="field-label">User</span><select value={f.person_id ?? ''} onChange={set('person_id')}><option value="">All</option>
        {people.filter(p => p.is_driver !== false).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      <label className="field"><span className="field-label">Department</span><select value={f.department ?? ''} onChange={set('department')}><option value="">All</option>
        {departments.map(d => <option key={d}>{d}</option>)}</select></label>
      <label className="field"><span className="field-label">Form</span><select value={f.form ?? ''} onChange={set('form')}><option value="">All</option>
        {forms.map(d => <option key={d}>{d}</option>)}</select></label>
      <label className="field"><span className="field-label">Status</span><select value={f.stage ?? ''} onChange={set('stage')}><option value="">All</option>
        {STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></label>
    </div>
    <div className="row spread"><p className="muted">{new Set(shown.map(l => l.docket_id)).size} dockets match.</p>
      <span className="row"><button className="small" onClick={() => downloadRows(totalOut, 'docket-totals-' + by, 'xlsx')}>Download totals</button>
        <button className="small" onClick={() => downloadRows(lineOut, 'docket-lines', 'xlsx')}>Download dockets</button></span></div>
    <div className="table-wrap"><table className="accounts-totals">
      <thead><tr><th>{by === 'asset' ? 'Asset' : by === 'driver' ? 'User' : by === 'status' ? 'Status' : 'Customer'}</th><th>Dockets</th><th>Hours</th><th>Standby</th><th>Loads</th><th>Litres</th><th>Where they are up to</th></tr></thead>
      <tbody>{groups.map(g => <tr key={g.key} className={open === g.key ? 'on' : ''}>
        <td><button className="link" onClick={() => setOpen(open === g.key ? null : g.key)}>{g.label}</button></td>
        <td>{g.dockets}</td><td>{g.hours}</td><td>{g.standby || ''}</td><td>{g.loads}</td><td>{g.volume_l.toLocaleString('en-AU')}</td>
        <td>{STAGE_ORDER.filter(s => g.stages[s]).map(s => <span key={s} className={'pill stage-' + s}>{STAGE_LABEL[s]} {g.stages[s]}</span>)}</td>
      </tr>)}
        {!groups.length && <tr><td colSpan={7} className="muted">No dockets match these filters</td></tr>}</tbody></table></div>
    {open !== null && <>
      <h2>{groups.find(g => g.key === open)?.label}: {new Set(detail.map(l => l.docket_id)).size} dockets</h2>
      <div className="table-wrap"><table className="accounts-detail">
        <thead><tr><th>No.</th><th>Date</th><th>Form</th><th>Customer</th><th>Rig</th><th>Asset</th><th>User</th><th>Status</th><th>Hours</th></tr></thead>
        <tbody>{detail.map((l, i) => <tr key={l.docket_id + i}>
          <td><Link to={'/docket/' + l.docket_id}>{l.docket_no}</Link></td><td>{nice(l.date)}</td><td>{l.form}</td><td>{l.customer}</td><td>{l.rig}</td>
          <td>{l.asset}</td><td>{l.driver}</td><td><span className={'pill stage-' + l.stage}>{l.status}</span></td><td>{l.hours}</td></tr>)}</tbody></table></div>
    </>}
  </>;
}

function Compare({ ts, lines, trucks, people }: { ts: Row[]; lines: ReturnType<typeof docketLines>; trucks: Row[]; people: Row[] }) {
  const [f, setF] = useState<{ truck_id?: string; person_id?: string; from?: string; to?: string }>({});
  const [onlyGaps, setOnlyGaps] = useState(false);
  const ready = !!(f.truck_id || f.person_id);
  const all = ready ? compareTimesheets(ts, lines, people, f) : [];
  const rows = onlyGaps ? all.filter(r => r.difference !== 0) : all;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || undefined });
  const out = rows.map(r => ({ Date: r.date, Driver: r.driver, 'Timesheet status': r.timesheet_status, 'Timesheet total hours': r.timesheet_total,
    'Timesheet docket hours': r.timesheet_docket_hours, 'Dockets add up to': r.dockets_hours, Difference: r.difference, Assets: r.assets,
    Dockets: r.dockets.map(d => d.docket_no).join(', ') }));
  return <>
    <div className="filters">
      <label className="field"><span className="field-label">Asset (truck)</span><select value={f.truck_id ?? ''} onChange={set('truck_id')}><option value="">Any</option>
        {trucks.map(t => <option key={t.id} value={t.id}>{truckName(t)}{t.truck_type ? ` (${t.truck_type})` : ''}</option>)}</select></label>
      <label className="field"><span className="field-label">Driver</span><select value={f.person_id ?? ''} onChange={set('person_id')}><option value="">Any</option>
        {people.filter(p => p.is_driver !== false).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      <label className="field"><span className="field-label">From</span><input type="date" value={f.from ?? ''} onChange={set('from')} /></label>
      <label className="field"><span className="field-label">To</span><input type="date" value={f.to ?? ''} onChange={set('to')} /></label>
      <label className="field field-bool"><span className="field-label">Only where they differ</span><input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} /></label>
    </div>
    {!ready ? <p className="muted">Pick a truck or a driver to compare their timesheets with their dockets.</p> : <>
      <div className="row spread"><p className="muted">{rows.length} driver days{onlyGaps ? ' that differ' : ''}.</p>
        <button className="small" disabled={!rows.length} onClick={() => downloadRows(out, 'timesheets-vs-dockets', 'xlsx')}>Download Excel</button></div>
      <div className="table-wrap"><table className="accounts-compare">
        <thead><tr><th>Date</th><th>Driver</th><th>Timesheet</th><th>Total h</th><th>Timesheet docket h</th><th>Dockets add up to</th><th>Difference</th><th>Dockets</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.person_id + r.date} className={r.difference ? 'differs' : ''}>
          <td>{nice(r.date)}</td><td>{r.driver}</td><td><span className={'pill ' + r.timesheet_status}>{r.timesheet_status}</span></td>
          <td>{hrs(r.timesheet_total)}</td><td>{hrs(r.timesheet_docket_hours)}</td><td>{r.dockets_hours}</td>
          <td>{r.difference === null ? '-' : r.difference === 0 ? 'Agrees' : <b>{r.difference > 0 ? '+' : ''}{r.difference}</b>}</td>
          <td>{r.dockets.map(d => <Link key={d.id} className="docket-link" to={'/docket/' + d.id} title={`${d.asset} · ${d.stage} · ${d.hours} h`}>{d.docket_no}</Link>)}</td>
        </tr>)}
          {!rows.length && <tr><td colSpan={8} className="muted">No timesheets or dockets for this choice</td></tr>}</tbody></table></div>
    </>}
  </>;
}

function NewDrivers({ people, phones, ps }: { people: Row[]; phones: Row[]; ps: ReturnType<typeof usePeriodSettings> }) {
  const weeks = newDriverReport(people, phones, ps);
  const out = weeks.flatMap(w => w.rows.map(r => ({ 'Week from': w.week_start, 'Week to': w.week_end, 'Name typed': r.name, 'Crew phone': r.crew_phone,
    'Added (date and time)': fmt(r.added_at), Outcome: r.outcome_label, 'Checked by': r.checked_by, 'Checked (date and time)': r.checked_at ? fmt(r.checked_at) : '' })));
  return <>
    <div className="row spread"><p className="muted">{weeks.length ? `${weeks.reduce((s, w) => s + w.added, 0)} names added on crew phones, over ${weeks.length} week${weeks.length > 1 ? 's' : ''}.` : 'No names have been added on crew phones.'}</p>
      <button className="small" disabled={!out.length} onClick={() => downloadRows(out, 'new-drivers', 'xlsx')}>Download Excel</button></div>
    {weeks.map(w => <section key={w.week_start} className="new-driver-week">
      <h2>Week {nice(w.week_start)} to {nice(w.week_end)}: {w.added} added</h2>
      <p className="muted">{w.approved} approved as new driver{w.approved === 1 ? '' : 's'} · {w.paired} paired to an existing driver · {w.waiting} waiting to be checked</p>
      <div className="table-wrap"><table className="accounts-newdrivers">
        <thead><tr><th>Name typed</th><th>Crew phone</th><th>Added</th><th>Outcome</th><th>Checked by</th><th>Checked</th></tr></thead>
        <tbody>{w.rows.map(r => <tr key={r.person_id}><td>{r.name}</td><td>{r.crew_phone}</td><td>{fmt(r.added_at)}</td>
          <td><span className={'pill ' + (r.outcome === 'waiting' ? 'draft' : 'approved')}>{r.outcome_label}</span></td><td>{r.checked_by}</td><td>{r.checked_at ? fmt(r.checked_at) : ''}</td></tr>)}</tbody>
      </table></div>
    </section>)}
  </>;
}
