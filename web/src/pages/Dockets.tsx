import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { FORMS, formFor, sortRows } from '../lib/docketForms';
import { EditOnly, fmt, Page, refLabel, useRows, useToast } from '../components/ui';
import { ClonePanel, NewDocketPanel } from '../components/docket';
import { phoneLabel, STAGE_LABEL, stageOf } from '../lib/assignment';

// Office, supervisors and admin: every docket in one list. New, clone, open to edit.
export default function Dockets() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [all, setAll] = useState<Row[]>([]);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [cloneOf, setCloneOf] = useState<{ src: Row; rows: Row[] } | null>(null);
  const [f, setF] = useState({ q: '', form: '', status: 'not closed', from: '', to: '' });
  const phones = useRows('work_phones');
  const people = useRows('people'); const trucks = useRows('trucks'); const customers = useRows('customers'); const locations = useRows('locations');

  const load = useCallback(async () => setAll(await backend().list('dockets', {}, { column: 'updated_at', ascending: false })), []);
  useEffect(() => {
    load();
    const stop = backend().watch([{ table: 'dockets' }], () => load());      // live: new and changed dockets appear straight away
    const onBack = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onBack);
    return () => { stop(); document.removeEventListener('visibilitychange', onBack); };
  }, [load]);

  const names = (ids?: string[]) => (ids ?? []).map(id => { const p = people.find(x => x.id === id); return (p?.full_name ?? '?') + (p?.pending ? ' (new driver: check)' : ''); }).join(', ');
  const shown = useMemo(() => all.filter(d => {
    if (f.form && (d.form_type ?? 'general') !== f.form) return false;
    if (f.status === 'not closed' && d.status === 'closed') return false;
    if (f.status === 'to_review') return d.review_status === 'to_review';
    if (f.status && f.status !== 'not closed' && f.status !== 'to_review' && (d.status ?? 'draft') !== f.status) return false;
    const day = d.work_date ?? String(d.start_at ?? d.created_at ?? '').slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.q) {
      const hay = [d.docket_no, d.project_no, d.task_no, d.po, d.department, d.notes, names(d.assigned_person_ids),
        refLabel('trucks', trucks, d.truck_id), refLabel('customers', customers, d.customer_id), refLabel('locations', locations, d.location_id),
        d.extras?.well].join(' ').toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }), [all, f, people, trucks, customers, locations]); // eslint-disable-line react-hooks/exhaustive-deps

  const startClone = async (d: Row) => {
    setCreating(false);
    setCloneOf({ src: d, rows: sortRows(await backend().list('loads', { docket_id: d.id })) });
  };

  return (
    <Page title="Dockets" howTo={<ol>
      <li><b>New docket</b>: pick the form (Landspray runsheet, daily reports, frac support, potable, septic, rig support ticket), the date, truck and drivers.</li>
      <li>Ticked drivers see the docket on their phone under <b>Dockets for you</b>, and can fill it in.</li>
      <li><b>Clone</b> copies a docket to another day: same customer, rig, well, truck and job numbers, with times and signatures left blank.</li>
      <li><b>Open</b> to edit. When anyone saves, every screen with that docket open updates, including drivers' phones.</li>
      <li>This list updates by itself when a docket is added or changed anywhere.</li>
    </ol>} actions={<EditOnly><button className="primary" onClick={() => { setCloneOf(null); setCreating(true); }}>New docket</button></EditOnly>}>
      {creating && <NewDocketPanel onCancel={() => setCreating(false)} onDone={id => { setCreating(false); nav('/docket/' + id); }} />}
      {cloneOf && <ClonePanel src={cloneOf.src} rows={cloneOf.rows} onCancel={() => setCloneOf(null)}
        onDone={id => { setCloneOf(null); toast.show('Copy created'); nav('/docket/' + id); }} />}

      <div className="filters">
        <label className="field"><span className="field-label">Search</span>
          <input type="search" placeholder="No., driver, truck, customer, rig, PO" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></label>
        <label className="field"><span className="field-label">Form</span>
          <select value={f.form} onChange={e => setF({ ...f, form: e.target.value })}><option value="">All forms</option>
            {FORMS.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}</select></label>
        <label className="field"><span className="field-label">Status</span>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
            <option value="not closed">Not closed</option><option value="">All</option><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option><option value="to_review">Completed, to review</option></select></label>
        <label className="field"><span className="field-label">From</span><input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
        <label className="field"><span className="field-label">To</span><input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></label>
      </div>

      <div className="table-wrap"><table className="dockets-table">
        <thead><tr><th>No.</th><th>Form</th><th>Date</th><th>Truck</th><th>Crew phone</th><th>Drivers</th><th>Customer</th><th>Rig</th><th>Status</th><th>Last change</th><th /></tr></thead>
        <tbody>
          {shown.map(d => <tr key={d.id}>
            <td>{d.docket_no ?? '-'}</td><td>{formFor(d.form_type).label}</td><td>{d.work_date ?? String(d.start_at ?? '').slice(0, 10)}</td>
            <td>{refLabel('trucks', trucks, d.truck_id) || '-'}</td><td>{phoneLabel(phones.find(w => w.id === d.assigned_phone_id)) || <span className="muted">not assigned</span>}</td><td>{names(d.assigned_person_ids) || <span className="muted">-</span>}</td>
            <td>{refLabel('customers', customers, d.customer_id) || '-'}</td><td>{refLabel('locations', locations, d.location_id) || '-'}</td>
            <td><span className={'pill stage-' + stageOf(d)}>{STAGE_LABEL[stageOf(d)]}</span></td><td>{fmt(d.updated_at ?? d.created_at)}</td>
            <td className="row nowrap"><button className="small" onClick={() => nav('/docket/' + d.id)}>Open</button>
              <EditOnly><button className="small" onClick={() => startClone(d)}>Clone</button></EditOnly></td>
          </tr>)}
          {!shown.length && <tr><td colSpan={11} className="muted">No dockets match</td></tr>}
        </tbody>
      </table></div>
      <p className="muted">{shown.length} of {all.length} dockets</p>
      {toast.node}
    </Page>
  );
}
