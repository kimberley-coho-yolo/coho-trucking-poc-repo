import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { DataTable, errText, fmt, nowIso, Page, refLabel, useReadOnly, useRows, useToast } from '../components/ui';
import { defaultFormFor, FORMS, formFor } from '../lib/docketForms';

export default function ShiftHome() {
  const { id } = useParams();
  const nav = useNavigate();
  const readOnly = useReadOnly();
  const toast = useToast();
  const [shift, setShift] = useState<Row | null>(null);
  const [dockets, setDockets] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [prepared, setPrepared] = useState<Row[]>([]);   // dockets the office made for this driver, not on a shift yet
  const [blankForm, setBlankForm] = useState('');
  const trucks = useRows('trucks'); const people = useRows('people'); const customers = useRows('customers'); const locations = useRows('locations');
  useEffect(() => { (async () => {
    const s = await backend().get('shifts', id!); setShift(s);
    setDockets(await backend().list('dockets', { shift_id: id! }, { column: 'start_at' }));
    if (s?.truck_id) {
      const allocs = (await backend().list('allocations', { truck_id: s.truck_id })).filter(a => !s.shift_date || a.shift_date === s.shift_date);
      const allJobs = await backend().list('jobs');
      setJobs(allocs.map(a => allJobs.find(j => j.id === a.job_id)).filter(Boolean) as Row[]);
    }
    if (s?.driver_id) setPrepared((await backend().list('dockets')).filter(d => !d.shift_id && d.status !== 'closed' && (d.assigned_person_ids ?? []).includes(s.driver_id)));
    if (s) await backend().save('shifts', { id: s.id, last_step: 'shift' }).catch(() => null);
  })(); }, [id]);
  if (!shift) return <Page title="Shift"><p>Loading, or this shift is not visible to you.</p></Page>;

  const startDocket = async (job?: Row, formType?: string) => {
    try {
      const d = await backend().save('dockets', {
        shift_id: shift.id, status: 'open', start_at: nowIso(), job_id: job?.id ?? null,
        form_type: formType || defaultFormFor(job?.department), work_date: shift.shift_date ?? null, truck_id: shift.truck_id ?? null,
        assigned_person_ids: shift.driver_id ? [shift.driver_id] : [],
        customer_id: job?.customer_id ?? null, location_id: job?.location_id ?? null, department: job?.department ?? null,
        project_no: job?.project_no ?? null, task_no: job?.task_no ?? null, po: job?.po ?? null, contract: job?.contract ?? null, extras: {},
      });
      nav('/docket/' + d.id);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const open = dockets.find(d => d.status !== 'closed');
  const pre = shift.prestart_status ?? 'not done';
  return (
    <Page title={`Shift ${shift.shift_date ?? ''} ${shift.day_night ?? ''}`} howTo={<ol>
      <li>Check the prestart is <b>passed</b>. If not, tap <b>Do prestart</b>.</li>
      <li>Tap a job under <b>Today's jobs</b> to start a docket for it. Customer, rig, project, task and PO fill in for you. No job listed? Use <b>Blank docket</b>.</li>
      <li>When the truck moves to another customer or rig, close the docket and start a new one.</li>
      <li>At the end of the shift tap <b>End shift and timesheet</b>.</li>
      <li><b>Save and exit</b> any time; the shift stays in My drafts.</li>
    </ol>}>
      <div className="summary">
        <div><b>Driver</b> {refLabel('people', people, shift.driver_id) || '-'}{shift.is_cover ? ' (cover)' : ''}</div>
        <div><b>Truck</b> {refLabel('trucks', trucks, shift.truck_id) || '-'}</div>
        <div><b>Signed in</b> {fmt(shift.sign_in_at) || '-'}</div>
        <div><b>Prestart</b> <span className={'pill ' + pre.replace(' ', '-')}>{pre}</span> <Link to={`/shift/${shift.id}/prestart`}>Do prestart</Link></div>
      </div>
      {pre === 'failed' && <p className="err">Prestart failed: the truck is tagged out. The supervisor and HSE have been told.</p>}
      <h2>Today's jobs for this truck</h2>
      <div className="stack">
        {jobs.map(j => <button key={j.id} className="big" disabled={!!open || readOnly} onClick={() => startDocket(j)}>
          {refLabel('customers', customers, j.customer_id) || 'Customer ?'} · {refLabel('locations', locations, j.location_id) || 'Rig ?'}
          <small>Project {j.project_no ?? '-'} · Task {j.task_no ?? '-'} · PO {j.po ?? '-'}</small></button>)}
        {!jobs.length && <p className="muted">No jobs allocated to this truck for this date.</p>}
        <div className="row">
          <select aria-label="Form for a blank docket" value={blankForm} onChange={e => setBlankForm(e.target.value)} disabled={!!open || readOnly}>
            <option value="">Form: usual for my department</option>
            {FORMS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
          <button disabled={!!open || readOnly} onClick={() => startDocket(undefined, blankForm || defaultFormFor(people.find(p => p.id === shift.driver_id)?.department))}>Blank docket</button>
        </div>
        {open && <p className="note">Docket in progress. <Link to={'/docket/' + open.id}>Open it</Link> and close it before starting another.</p>}
      </div>
      {!!prepared.length && <><h2>Prepared by the office for you</h2>
        <div className="stack">{prepared.map(p => <button key={p.id} className="big" disabled={!!open || readOnly} onClick={async () => {
          try {
            await backend().save('dockets', { id: p.id, version: p.version, shift_id: shift.id, status: 'open', start_at: p.start_at ?? nowIso() });
            nav('/docket/' + p.id);
          } catch (e) { toast.show(errText(e), 'err'); }
        }}>{formFor(p.form_type).label} · No. {p.docket_no ?? '-'}<small>{[p.work_date, refLabel('customers', customers, p.customer_id), refLabel('locations', locations, p.location_id)].filter(Boolean).join(' · ')} · tap to use it for this shift</small></button>)}</div></>}
      <h2>Dockets this shift</h2>
      <DataTable table="dockets" rows={dockets} onOpen={r => nav('/docket/' + r.id)} columns={['status', 'customer_id', 'location_id', 'start_at', 'end_at', 'km']} />
      <div className="savebar">
        <Link className="button" to={`/fault/new?shift=${shift.id}&truck=${shift.truck_id ?? ''}`}>Report a fault</Link>
        <Link className="button primary" to={`/shift/${shift.id}/end`}>End shift and timesheet</Link>
        <button onClick={() => nav('/')}>Save and exit</button>
      </div>
      {toast.node}
    </Page>
  );
}
