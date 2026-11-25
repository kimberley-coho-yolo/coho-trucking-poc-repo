import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { TABLES, TABLE_LIST, type TableName } from '../lib/schema';
import { clearRefCache, DataTable, EditOnly, errText, FieldGrid, Page, useReadOnly, useToast } from '../components/ui';
import { TABLE_FEATURE } from '../lib/permissions';
import { useAccess } from '../state';
import { downloadRows } from '../lib/importExport';

const ADMIN_TABLES: TableName[] = ['app_logins', 'people', 'work_phones', 'phone_assignments', 'trucks', 'equipment', 'customers', 'locations', 'jobs', 'allocations'];
const HELP: Partial<Record<TableName, string>> = {
  app_logins: 'Who can sign in and what they can do. Add an email and/or a mobile and pick a role: driver, supervisor, office or admin. A work phone shared by a crew is one login with role driver.',
  people: 'Everyone who can be picked as a driver or named on a timesheet.',
  work_phones: 'Each truck crew work mobile. Also add the same number under Logins and roles (role driver) so it can sign in.',
  phone_assignments: 'Which people share which work phone. These names are the only ones shown after signing in on that phone.',
  trucks: 'Every truck. The QR code value must match the code on the truck. Gearbox and tracker IDs link the integrations.',
  jobs: 'A job is one customer piece of work: customer, rig, project, task and PO. Drivers pick it when they start a docket.',
  allocations: 'Which truck (and trailer) does which job on which date and shift. Drivers see these as "Today\'s jobs".',
};

export default function AdminIndex() {
  const can = useAccess();
  const groups = ['Access', 'Reference', 'Planning'] as const;
  return (
    <Page title="Admin" howTo={<ol>
      <li><b>Add a work mobile</b>: Work phones &gt; New, then Logins and roles &gt; New with the same mobile and role <b>driver</b>, then Who uses which phone &gt; New for each person on that phone.</li>
      <li><b>Give someone access by email or mobile</b>: Logins and roles &gt; New, enter the email and/or mobile and choose a role.</li>
      <li><b>Set up the day</b>: Jobs &gt; New for each customer job, then Allocations &gt; New to put a truck on it.</li>
      <li>Every list can be uploaded from a spreadsheet and downloaded (Data screen, or the buttons on each list).</li>
    </ol>}>
      {groups.map(g => <div key={g}><h2>{g}</h2><div className="cards">
        {TABLE_LIST.filter(t => t.group === g && ADMIN_TABLES.includes(t.name) && can.read(TABLE_FEATURE[t.name]!)).map(t =>
          <Link key={t.name} className="card" to={'/admin/' + t.name}>{t.label}<small>{HELP[t.name]?.slice(0, 70) ?? ''}</small></Link>)}
      </div></div>)}
    </Page>
  );
}

export function AdminTable() {
  const { table } = useParams() as { table: TableName };
  const def = TABLES[table];
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  const readOnly = useReadOnly();
  const load = async () => { try { setRows(await backend().list(table, {}, { column: 'created_at', ascending: false })); } catch (e) { toast.show(errText(e), 'err'); } };
  useEffect(() => { setEdit(null); load(); }, [table]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!def) return <Page title="Not found"><p>Unknown list.</p></Page>;
  const save = async () => {
    try { await backend().save(table, edit!); clearRefCache(); setEdit(null); toast.show('Saved'); load(); } catch (e) { toast.show(errText(e), 'err'); }
  };
  const del = async () => {
    if (!edit?.id || !window.confirm('Delete this record? This cannot be undone.')) return;
    try { await backend().remove(table, edit.id); clearRefCache(); setEdit(null); toast.show('Deleted'); load(); } catch (e) { toast.show(errText(e), 'err'); }
  };
  const shown = filter ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(filter.toLowerCase())) : rows;
  return (
    <Page title={def.label}
      actions={<><EditOnly><button className="primary" onClick={() => setEdit({ active: true })}>New</button></EditOnly>
        <button onClick={() => downloadRows(rows, table, 'xlsx')}>Download</button>
        <EditOnly><button onClick={() => nav('/data?tab=import&table=' + table)}>Upload spreadsheet</button></EditOnly></>}
      howTo={<><p>{HELP[table] ?? 'Add, edit or remove records in this list.'}</p><ol>
        <li>Tap <b>New</b>, fill in what you know (every field is optional) and tap <b>Save</b>.</li>
        <li>Tap <b>Open</b> on a row to edit or delete it.</li>
        <li>Use <b>Upload spreadsheet</b> to add many at once, and <b>Download</b> to get an Excel copy.</li></ol></>}>
      {edit && <div className="subform"><h2>{readOnly ? 'View' : edit.id ? 'Edit' : 'New'} {def.label.toLowerCase()}</h2>
        <FieldGrid fields={def.fields} value={edit} onChange={setEdit} />
        <div className="savebar"><EditOnly><button className="primary" onClick={save}>Save</button></EditOnly><button onClick={() => setEdit(null)}>{readOnly ? 'Close' : 'Cancel'}</button>
          <EditOnly>{edit.id && <button className="danger" onClick={del}>Delete</button>}</EditOnly></div></div>}
      <input className="search" placeholder="Search this list" value={filter} onChange={e => setFilter(e.target.value)} />
      <DataTable table={table} rows={shown} onOpen={r => setEdit(r)} />
      {toast.node}
    </Page>
  );
}
