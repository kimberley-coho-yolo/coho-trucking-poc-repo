import { useEffect, useState } from 'react';
import { backend, type Row } from '../lib/backend';
import { errText, nowIso, Page, refLabel, useRows, useToast } from '../components/ui';
import { downloadRows } from '../lib/importExport';
import { useApp } from '../state';

export default function Approvals() {
  const { session } = useApp();
  const toast = useToast();
  const people = useRows('people');
  const [status, setStatus] = useState('submitted');
  const [rows, setRows] = useState<Row[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const load = async () => setRows((await backend().list('timesheet_lines', status ? { status } : {}, { column: 'work_date' })));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (r: Row, decision: 'approved' | 'queried') => {
    try {
      await backend().save('timesheet_lines', { id: r.id, status: decision, supervisor_comment: comments[r.id] ?? r.supervisor_comment ?? null,
        approved_by: decision === 'approved' ? session?.userId : null, approved_at: decision === 'approved' ? nowIso() : null });
      toast.show(decision === 'approved' ? 'Approved and locked' : 'Sent back to the driver'); load();
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const exportPayroll = async () => {
    const approved = await backend().list('timesheet_lines', { status: 'approved' }, { column: 'work_date' });
    downloadRows(approved.map(r => ({ driver: refLabel('people', people, r.person_id), date: r.work_date, total_hours: r.total_hours, docket_hours: r.docket_hours,
      travel_hours: r.travel_hours, standby_hours: r.standby_hours, rr: r.rr ? 'Y' : '', wet_hours: r.wet_hours, wet_type: r.wet_type, work_diary_page: r.work_diary_page })), 'approved-hours-for-myob', 'csv');
  };
  return (
    <Page title="Timesheet approvals" actions={<button onClick={exportPayroll}>Export approved hours (MYOB)</button>} howTo={<ol>
      <li>Lines submitted by drivers are listed. Check the hours against the dockets.</li>
      <li>Tap <b>Approve</b> to lock the line, or type a comment and tap <b>Query</b> to send it back to the driver.</li>
      <li>Approved lines can only be changed by an admin, and every change is logged.</li>
      <li><b>Export approved hours</b> gives a CSV for MYOB AccountRight payroll until the MYOB link is built.</li>
    </ol>}>
      <div className="row"><label>Show <select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="submitted">Waiting for approval</option><option value="queried">Queried</option><option value="approved">Approved</option><option value="">All</option></select></label></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Driver</th><th>Date</th><th>Total</th><th>Docket</th><th>Travel</th><th>Standby</th><th>R&R</th><th>Wet</th><th>Diary</th><th>Comment</th><th /></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td>{refLabel('people', people, r.person_id)}</td><td>{r.work_date}</td><td>{r.total_hours}</td><td>{r.docket_hours}</td><td>{r.travel_hours}</td>
          <td>{r.standby_hours}</td><td>{r.rr ? 'Yes' : ''}</td><td>{r.wet_hours}</td><td>{r.work_diary_page}</td>
          <td><input value={comments[r.id] ?? r.supervisor_comment ?? ''} onChange={e => setComments({ ...comments, [r.id]: e.target.value })} /></td>
          <td className="row">{r.status !== 'approved' && <><button className="small primary" onClick={() => decide(r, 'approved')}>Approve</button>
            <button className="small" onClick={() => decide(r, 'queried')}>Query</button></>}{r.status === 'approved' && <span className="pill approved">approved</span>}</td>
        </tr>)}{!rows.length && <tr><td colSpan={11} className="muted">Nothing here</td></tr>}</tbody>
      </table></div>
      {toast.node}
    </Page>
  );
}
