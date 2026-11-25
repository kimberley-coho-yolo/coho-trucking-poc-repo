import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Row } from '../lib/backend';
import { changedPaths, type OutboxItem } from '../lib/outbox';
import { TABLES } from '../lib/schema';
import { errText, fmt, Page, useToast } from '../components/ui';
import { useOutbox } from '../components/OutboxBar';

const WHAT: Partial<Record<string, string>> = {
  dockets: 'Docket', loads: 'Docket row', signoffs: 'Client sign-off', timesheet_lines: 'Timesheet day', form_submissions: 'Form',
  form_files: 'Form photo', shifts: 'Shift', faults: 'Fault report',
};
function linkFor(q: OutboxItem): string | null {
  const r: Row = q.row ?? q.base ?? {};
  switch (q.table) {
    case 'dockets': return '/docket/' + q.rowId;
    case 'loads': case 'signoffs': return r.docket_id ? '/docket/' + r.docket_id : null;
    case 'shifts': return '/shift/' + q.rowId;
    case 'form_submissions': return r.form_type === 'driver_timesheet' ? `/forms/timesheet?person=${r.person_id ?? ''}&start=${r.period_start ?? ''}` : '/forms/' + q.rowId;
    case 'timesheet_lines': return r.work_date ? `/forms/timesheet?person=${r.person_id ?? ''}&start=${r.work_date}` : null;
    default: return null;
  }
}
function label(q: OutboxItem) {
  const r: Row = q.row ?? q.base ?? {};
  const what = WHAT[q.table] ?? TABLES[q.table]?.label ?? q.table;
  const detail = q.table === 'dockets' ? (r.docket_no ? 'No. ' + r.docket_no : 'new') : q.table === 'timesheet_lines' ? r.work_date : '';
  return `${q.op === 'remove' ? 'Delete ' + what.toLowerCase() : what}${detail ? ' ' + detail : ''}`;
}
const HIDDEN = new Set(['last_step', 'id']);
/** Field names people recognise, from the screens' own labels. */
function fieldLabel(table: string, path: string): string {
  const name = path.replace(/^(extras|data)\./, '');
  const f = TABLES[table as keyof typeof TABLES]?.fields.find(x => x.name === name);
  return f?.label ?? name.replace(/^s([12])_/, 'shift $1 ').replace(/_/g, ' ');
}
const STATUS: Record<string, string> = { queued: 'Waiting to send', sending: 'Sending', failed: 'Not sent', sign_in: 'Sign in again' };

export default function Outbox() {
  const { api, items, online } = useOutbox();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!api) return <Page title="Changes waiting to send"><p>Nothing to show.</p></Page>;
  const act = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id);
    try { await fn(); toast.show(ok); } catch (e) { toast.show(errText(e), 'err'); } finally { setBusy(null); }
  };
  const alerts = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

  return (
    <Page title="Changes waiting to send" howTo={<ol>
      <li>With no signal, everything you save is kept on this device and listed here. It sends by itself, in order, when signal comes back.</li>
      <li><b>Not sent</b> means the system did not accept it. The reason is shown. Usually someone else changed the same fields while you were offline.</li>
      <li><b>Send my version anyway</b> keeps your values for the fields you changed and keeps everyone else's other changes.</li>
      <li><b>Discard my change</b> throws your change away and goes back to what is in the system. Open the record first if you want to copy anything.</li>
      <li>Do not sign out or clear the browser while changes are waiting.</li>
    </ol>}>
      <div className="summary">
        <div><b>Signal</b> {online ? 'Yes' : 'No signal'}</div>
        <div><b>Waiting</b> {items.filter(i => i.status === 'queued' || i.status === 'sending').length}</div>
        <div><b>Not sent</b> {items.filter(i => i.status === 'failed' || i.status === 'sign_in').length}</div>
      </div>
      <div className="row" style={{ margin: '10px 0' }}>
        <button className="primary" disabled={!online || !items.length} onClick={() => act('all', () => api.flush(), 'Sent what could be sent')}>Send now</button>
        {alerts === 'default' && <button onClick={() => Notification.requestPermission()}>Alert me on this phone if something is not sent</button>}
      </div>
      {!items.length && <p className="note">Everything is sent. Nothing is waiting on this device.</p>}
      <div className="stack">
        {items.map(q => {
          const link = linkFor(q);
          const fields = q.op === 'save' ? changedPaths(q.base, { ...(q.base ?? {}), ...q.row }).filter(p => !HIDDEN.has(p)).map(p => fieldLabel(q.table, p)) : [];
          const reason = q.kind === 'conflict' && q.conflictFields?.length
            ? `Someone else changed the same thing while this was waiting: ${q.conflictFields.map(p => fieldLabel(q.table, p)).join(', ')}.` : api.describe(q);
          return (
            <div key={q.id} className={'outbox-item ' + q.status}>
              <div className="row spread">
                <b>{label(q)}</b>
                <span className={'pill ' + (q.status === 'failed' || q.status === 'sign_in' ? 'failed' : 'draft')}>{STATUS[q.status]}</span>
              </div>
              <div className="muted">Saved on this device {fmt(q.queuedAt)}{q.attempts ? ` · tried ${q.attempts} time${q.attempts > 1 ? 's' : ''}` : ''}</div>
              {!!fields.length && <div className="muted">Changed: {fields.slice(0, 8).join(', ')}{fields.length > 8 ? ` and ${fields.length - 8} more` : ''}</div>}
              {(q.status === 'failed' || q.status === 'sign_in') && <p className="err">{reason}</p>}
              {q.status === 'sign_in' && <p className="muted">Your sign-in has expired. Sign out, sign back in on this device, then tap Send now. Your changes stay here.</p>}
              <div className="row">
                {link && <Link className="button small" to={link}>Open</Link>}
                {q.status === 'failed' && <button className="small primary" disabled={busy === q.id || !online}
                  onClick={() => act(q.id, () => api.pushThrough(q.id), 'Sent')}>{q.kind === 'conflict' ? 'Send my version anyway' : 'Try again'}</button>}
                {(q.status === 'queued' || q.status === 'sign_in') && <button className="small" disabled={!online} onClick={() => act(q.id, () => api.flush(), 'Sent what could be sent')}>Send now</button>}
                {q.status !== 'sending' && <button className="small danger" disabled={busy === q.id} onClick={() => {
                  if (window.confirm('Discard this change? It has not been sent and cannot be got back.')) act(q.id, () => api.discard(q.id), 'Change discarded');
                }}>Discard my change</button>}
              </div>
            </div>
          );
        })}
      </div>
      {toast.node}
    </Page>
  );
}
