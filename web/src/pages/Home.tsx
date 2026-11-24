import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { isOffice, isStaff, useApp } from '../state';
import { DataTable, errText, Page } from '../components/ui';

export default function Home() {
  const { role, person, refresh, session } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!role) return;
    backend().list('shifts', {}, { column: 'created_at', ascending: false }).then(r =>
      setOpen(r.filter(s => (s.status === 'open' || s.status === 'draft') && (!person || s.driver_id === person.id || isStaff(role)))));
  }, [role, person]);

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
        {isStaff(role) && <li>Supervisors: approve timesheets under <b>Approvals</b>. Reports show hours and km per customer, rig and truck.</li>}
        {isOffice(role) && <li>Office and admin: set up people, phones, trucks, customers and jobs under <b>Admin</b>; upload spreadsheets and export data under <b>Data</b>.</li>}
      </ol>}>
      <div className="cards">
        <button className="card primary" onClick={() => nav('/shift/start')}>Start a shift<small>Scan the truck, prestart, dockets</small></button>
        <Link className="card" to="/drafts">My drafts<small>Carry on where you left off</small></Link>
        <Link className="card" to="/fault/new">Report a fault<small>Goes to supervisor and HSE</small></Link>
        {isStaff(role) && <Link className="card" to="/approvals">Approvals<small>Timesheets waiting</small></Link>}
        {isStaff(role) && <Link className="card" to="/reports">Reports<small>Per customer, rig, truck, travel</small></Link>}
        {isOffice(role) && <Link className="card" to="/admin">Admin<small>People, phones, logins, lists</small></Link>}
        {isOffice(role) && <Link className="card" to="/data">Data<small>Upload, export, query</small></Link>}
      </div>
      <h2>Open shifts</h2>
      <DataTable table="shifts" rows={open} onOpen={r => nav('/shift/' + r.id)} columns={['status', 'shift_date', 'day_night', 'driver_id', 'truck_id', 'prestart_status']} />
    </Page>
  );
}
