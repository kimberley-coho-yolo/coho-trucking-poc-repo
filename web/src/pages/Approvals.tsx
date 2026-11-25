import { useEffect, useMemo, useState } from 'react';
import { backend, type Row } from '../lib/backend';
import { EditOnly, errText, nowIso, Page, refLabel, useReadOnly, useRows, useToast } from '../components/ui';
import { downloadRows } from '../lib/importExport';
import { bulkApprovable, groupByDriver, type DriverGroup } from '../lib/approvals';
import { useApp } from '../state';

export default function Approvals() {
  const { session } = useApp();
  const toast = useToast();
  const people = useRows('people');
  const readOnly = useReadOnly();
  const [status, setStatus] = useState('submitted');
  const [rows, setRows] = useState<Row[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);   // driver group being bulk approved
  const load = async () => setRows((await backend().list('timesheet_lines', status ? { status } : {}, { column: 'work_date' })));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Travel distance per shift, from km matching (travel segments). Empty if km matching has not run or the role cannot see it.
  const [travelKm, setTravelKm] = useState<Record<string, number>>({});
  useEffect(() => {
    backend().list('km_segments', { segment_type: 'travel' }).then(segs => {
      const m: Record<string, number> = {};
      for (const s of segs) if (s.shift_id) m[s.shift_id] = Math.round(((m[s.shift_id] ?? 0) + (Number(s.km) || 0)) * 10) / 10;
      setTravelKm(m);
    }).catch(() => setTravelKm({}));
  }, [rows]);
  const groups = useMemo(() => groupByDriver(rows, id => refLabel('people', people, id)), [rows, people]);

  const approveBody = (r: Row, decision: 'approved' | 'queried') => ({
    id: r.id, status: decision, supervisor_comment: comments[r.id] ?? r.supervisor_comment ?? null,
    approved_by: decision === 'approved' ? session?.userId : null, approved_at: decision === 'approved' ? nowIso() : null,
  });
  const decide = async (r: Row, decision: 'approved' | 'queried') => {
    try {
      await backend().save('timesheet_lines', approveBody(r, decision));
      toast.show(decision === 'approved' ? 'Approved and locked' : 'Sent back to the driver'); load();
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  // Approve every line waiting for ONE driver. Lines from other drivers are never included.
  const approveAll = async (g: DriverGroup) => {
    const todo = bulkApprovable(g);
    if (!todo.length) return;
    const hours = todo.reduce((s, l) => s + (Number(l.total_hours) || 0), 0);
    if (!window.confirm(`Approve ${todo.length} timesheet line${todo.length === 1 ? '' : 's'} for ${g.name} (${Math.round(hours * 100) / 100} hours)? Approved lines are locked.`)) return;
    setBusy(g.personId ?? 'none');
    const failed: string[] = [];
    for (const r of todo) {
      try { await backend().save('timesheet_lines', approveBody(r, 'approved')); }
      catch (e) { failed.push(`${r.work_date ?? 'no date'}: ${errText(e)}`); }
    }
    setBusy(null);
    if (failed.length) toast.show(`Approved ${todo.length - failed.length} of ${todo.length} for ${g.name}. Not approved: ${failed.join('; ')}`, 'err');
    else toast.show(`Approved ${todo.length} line${todo.length === 1 ? '' : 's'} for ${g.name}`);
    load();
  };
  const exportPayroll = async () => {
    const approved = await backend().list('timesheet_lines', { status: 'approved' }, { column: 'work_date' });
    downloadRows(approved.map(r => ({ driver: refLabel('people', people, r.person_id), date: r.work_date, total_hours: r.total_hours, docket_hours: r.docket_hours,
      travel_hours: r.travel_hours, standby_hours: r.standby_hours, rr: r.rr ? 'Y' : '', wet_hours: r.wet_hours, wet_type: r.wet_type, work_diary_page: r.work_diary_page })), 'approved-hours-for-myob', 'csv');
  };
  const range = (g: DriverGroup) => !g.firstDate ? '' : g.firstDate === g.lastDate ? g.firstDate : `${g.firstDate} to ${g.lastDate}`;

  return (
    <Page title="Timesheet approvals" actions={<button onClick={exportPayroll}>Export approved hours (MYOB)</button>} howTo={<ol>
      <li>Timesheet lines are grouped by driver, with each driver's total hours and dates. Tap a driver's name to show or hide their lines.</li>
      <li>Check the hours against the dockets. Tap <b>Approve</b> on one line, or <b>Approve all for</b> a driver to approve every line of theirs that is waiting. It only ever approves that one driver's lines.</li>
      <li>Times are decimal hours (0.5 = 30 minutes). <b>Travel time</b> is hours driving outside any customer docket; <b>Travel distance</b> is the km for that travel from km matching (blank until GPS trips are uploaded and matched).</li>
      <li>To send a line back, type a comment and tap <b>Query</b>. Queried lines are left out of "Approve all".</li>
      <li>Approved lines are locked and can only be changed by an admin. Every change is logged.</li>
      <li><b>Export approved hours</b> gives a CSV for MYOB AccountRight payroll until the MYOB link is built.</li>
    </ol>}>
      <div className="row"><label>Show <select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="submitted">Waiting for approval</option><option value="queried">Queried</option><option value="approved">Approved</option><option value="">All</option></select></label>
        <span className="muted">Times are in decimal hours (0.5 = 30 minutes). Travel is time and distance outside any customer docket.</span>
        <span className="muted">{groups.length} driver{groups.length === 1 ? '' : 's'}, {rows.length} line{rows.length === 1 ? '' : 's'}</span></div>
      {!groups.length && <p className="muted">Nothing here</p>}
      {groups.map(g => {
        const todo = bulkApprovable(g);
        const key = g.personId ?? 'none';
        return <details key={key} className="driver-group" open>
          <summary>
            <span className="dg-name">{g.name}</span>
            <span className="dg-meta">{g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {g.totalHours} hrs total{range(g) && ` · ${range(g)}`}{g.waiting ? ` · ${g.waiting} waiting` : ''}</span>
          </summary>
          <EditOnly>{todo.length > 0 && <div className="row dg-actions">
            <button className="primary" disabled={busy !== null} onClick={() => approveAll(g)}>
              {busy === key ? 'Approving...' : `Approve all for ${g.name} (${todo.length})`}</button></div>}</EditOnly>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Status</th><th>Total time (hrs)</th><th>Docket time (hrs)</th><th>Travel time (hrs)</th><th>Travel distance (km)</th><th>Standby (hrs)</th><th>R&R</th><th>Wet time (hrs)</th><th>Diary page</th><th>Comment</th><th /></tr></thead>
            <tbody>{g.lines.map(r => <tr key={r.id}>
              <td>{r.work_date}</td><td><span className={'pill ' + r.status}>{r.status}</span></td><td>{r.total_hours}</td><td>{r.docket_hours}</td><td>{r.travel_hours}</td><td>{r.shift_id && travelKm[r.shift_id] !== undefined ? travelKm[r.shift_id] : <span className="muted">-</span>}</td>
              <td>{r.standby_hours}</td><td>{r.rr ? 'Yes' : ''}</td><td>{r.wet_hours}</td><td>{r.work_diary_page}</td>
              <td><input disabled={readOnly || r.status === 'approved'} value={comments[r.id] ?? r.supervisor_comment ?? ''} onChange={e => setComments({ ...comments, [r.id]: e.target.value })} /></td>
              <td className="row">{r.status !== 'approved' && <EditOnly><button className="small primary" disabled={busy !== null} onClick={() => decide(r, 'approved')}>Approve</button>
                <button className="small" disabled={busy !== null} onClick={() => decide(r, 'queried')}>Query</button></EditOnly>}</td>
            </tr>)}</tbody>
          </table></div>
        </details>;
      })}
      {toast.node}
    </Page>
  );
}
