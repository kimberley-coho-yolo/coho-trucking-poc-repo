import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { fmt, Page } from '../components/ui';
import { useApp } from '../state';
import { formFor } from '../lib/docketForms';

interface Item { kind: string; when?: string; detail: string; to: string; status: string }

// Everything not finished, newest first, with the screen it was left on.
export default function Drafts() {
  const { session, role } = useApp();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { (async () => {
    const mine = (r: Row) => role !== 'driver' ? r.created_by === session?.userId : true;
    const shifts = (await backend().list('shifts')).filter(s => ['draft', 'open'].includes(s.status) && mine(s));
    const dockets = (await backend().list('dockets')).filter(d => d.status !== 'closed' && mine(d));
    const ts = (await backend().list('timesheet_lines')).filter(t => ['draft', 'queried'].includes(t.status) && mine(t));
    const stepTo = (s: Row) => s.last_step === 'prestart' ? `/shift/${s.id}/prestart` : s.last_step === 'end' ? `/shift/${s.id}/end` : `/shift/${s.id}`;
    const out: Item[] = [
      ...shifts.map(s => ({ kind: 'Shift', when: s.updated_at ?? s.created_at, detail: `${s.shift_date ?? ''} ${s.day_night ?? ''} · left at: ${s.last_step ?? 'start'}`, to: stepTo(s), status: s.status })),
      ...dockets.map(d => ({ kind: 'Docket', when: d.updated_at ?? d.created_at, detail: [d.docket_no ? 'No. ' + d.docket_no : '', formFor(d.form_type).label, d.project_no, d.po].filter(Boolean).join(' · '), to: '/docket/' + d.id, status: d.status })),
      ...ts.map(t => ({ kind: 'Timesheet', when: t.updated_at ?? t.created_at, detail: `${t.work_date ?? ''} ${t.supervisor_comment ? '· supervisor: ' + t.supervisor_comment : ''}`, to: t.shift_id ? `/shift/${t.shift_id}/end` : '/approvals', status: t.status })),
    ];
    out.sort((a, b) => String(b.when).localeCompare(String(a.when)));
    setItems(out);
  })(); }, [session, role]);
  return (
    <Page title="My drafts" howTo={<ol>
      <li>Anything you started and have not finished is listed here: shifts, dockets and timesheets.</li>
      <li>Tap <b>Resume</b> to go straight back to the screen you left.</li>
      <li>A timesheet marked <b>queried</b> has a question from your supervisor. Open it, fix it and submit again.</li>
    </ol>}>
      <div className="table-wrap"><table>
        <thead><tr><th>Type</th><th>Status</th><th>Details</th><th>Last saved</th><th /></tr></thead>
        <tbody>
          {items.map((i, n) => <tr key={n}><td>{i.kind}</td><td><span className={'pill ' + i.status}>{i.status}</span></td><td>{i.detail}</td><td>{fmt(i.when)}</td>
            <td><button className="small" onClick={() => nav(i.to)}>Resume</button></td></tr>)}
          {!items.length && <tr><td colSpan={5} className="muted">Nothing in progress</td></tr>}
        </tbody>
      </table></div>
    </Page>
  );
}
