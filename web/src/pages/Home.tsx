import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { useAccess, useApp } from '../state';
import { ADMIN_FEATURES, DATA_FEATURES } from '../lib/permissions';
import { DataTable, errText, Page, refLabel, useRows } from '../components/ui';
import { formFor } from '../lib/docketForms';

export default function Home() {
  const { role, person, refresh, session } = useApp();
  const can = useAccess();
  const nav = useNavigate();
  const [open, setOpen] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');
  const [forMe, setForMe] = useState<Row[]>([]);
  const trucks = useRows('trucks'); const locations = useRows('locations');
  // dockets the office prepared for this driver: refreshed live when the office adds or changes one
  useEffect(() => {
    if (!role || !person) { setForMe([]); return; }
    const load = () => backend().list('dockets').then(r => setForMe(r.filter(d => d.status !== 'closed' && (d.assigned_person_ids ?? []).includes(person.id)))).catch(() => null);
    load();
    const stop = backend().watch([{ table: 'dockets' }], () => load());
    const onBack = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onBack);
    return () => { stop(); document.removeEventListener('visibilitychange', onBack); };
  }, [role, person]);
  useEffect(() => {
    if (!role) return;
    backend().list('shifts', {}, { column: 'created_at', ascending: false }).then(r =>
      setOpen(r.filter(s => (s.status === 'open' || s.status === 'draft') && (!person || s.driver_id === person.id || can.read('all_work')))));
  }, [role, person]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!role) return (
    <Page title="No access yet">
      <p>You are signed in as <b>{session?.email ?? session?.phone}</b> but this login has no role.</p>
      <p>Ask an admin to add you under <b>Admin &gt; Logins and roles</b>. If this is a brand-new system with no admin yet, you can become the first admin.</p>
      <button onClick={async () => { try { setMsg(await backend().claimFirstAdmin()); await refresh(); } catch (e) { setMsg(errText(e)); } }}>Make me the first admin</button>
      {msg && <p className="note">{msg}</p>}
    </Page>
  );

  return (
    <Page title={person ? `Hi ${person.full_name.split(' ')[0]}` : 'Home'}
      howTo={<ol>
        <li><b>Start a shift</b> when you get to the truck. You can stop at any time with <b>Save and exit</b> and carry on later from <b>My drafts</b>.</li>
        <li>Open shifts are listed below. Tap <b>Open</b> to carry on.</li>
        {can.read('approvals') && <li>Approve timesheets under <b>Approvals</b>. Reports show hours and km per customer, rig and truck.</li>}
        {ADMIN_FEATURES.some(can.read) && <li>Set up people, phones, trucks, customers and jobs under <b>Admin</b>; upload spreadsheets and export data under <b>Data</b>.</li>}
        <li>What you can see depends on your role. Admins set this in <b>Settings</b>.</li>
      </ol>}>
      <div className="cards">
        {can.edit('shifts') && <button className="card primary" onClick={() => nav('/shift/start')}>Start a shift<small>Scan the truck, prestart, dockets</small></button>}
        {can.read('drafts') && <Link className="card" to="/drafts">My drafts<small>Carry on where you left off</small></Link>}
        {can.read('all_work') && <Link className="card" to="/dockets">Dockets<small>New, clone and edit dockets for any crew</small></Link>}
        {(can.read('forms') || can.read('approvals')) && <Link className="card" to="/forms">Forms<small>Timesheet, expenses, land and fire risk checklist</small></Link>}
        {can.edit('faults') && <Link className="card" to="/fault/new">Report a fault<small>Goes to supervisor and HSE</small></Link>}
        {can.read('approvals') && <Link className="card" to="/approvals">Approvals<small>Timesheets waiting</small></Link>}
        {can.read('reports') && <Link className="card" to="/reports">Reports<small>Per customer, rig, truck, travel</small></Link>}
        {ADMIN_FEATURES.some(can.read) && <Link className="card" to="/admin">Admin<small>People, phones, logins, lists</small></Link>}
        {DATA_FEATURES.some(can.read) && <Link className="card" to="/data">Data<small>Integrations, upload, export, query</small></Link>}
        {can.read('settings') && <Link className="card" to="/settings">Settings<small>Roles and what each can see</small></Link>}
      </div>
      {!!person && <><h2>Dockets for you</h2>
        {forMe.length ? <div className="stack">{forMe.map(d => <button key={d.id} className="big" onClick={() => nav('/docket/' + d.id)}>
          {formFor(d.form_type).label} · No. {d.docket_no ?? '-'}
          <small>{[d.work_date, refLabel('trucks', trucks, d.truck_id), refLabel('locations', locations, d.location_id), d.status].filter(Boolean).join(' · ')}</small>
        </button>)}</div> : <p className="muted">No dockets from the office for you right now.</p>}</>}
      {(can.read('shifts') || can.read('all_work')) && <><h2>Open shifts</h2>
      <DataTable table="shifts" rows={open} onOpen={r => nav('/shift/' + r.id)} columns={['status', 'shift_date', 'day_night', 'driver_id', 'truck_id', 'prestart_status']} /></>}
    </Page>
  );
}
