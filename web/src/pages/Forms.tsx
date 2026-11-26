import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { FORM_LABELS, linesTotal, SIMPLE_FORMS } from '../lib/forms';
import { EditOnly, errText, fmt, Page, refLabel, todayIso, useRows, useToast } from '../components/ui';
import { useAccess, useApp } from '../state';

// Timesheets, expense claims and checklists: start one, carry on, and (approvers) see what is waiting.
export default function Forms() {
  const nav = useNavigate();
  const toast = useToast();
  const can = useAccess();
  const { person, session } = useApp();
  const approver = can.read('approvals');
  const people = useRows('people');
  const [all, setAll] = useState<Row[]>([]);
  const [tab, setTab] = useState<'mine' | 'waiting' | 'all'>(approver ? 'waiting' : 'mine');

  const load = useCallback(async () => setAll(await backend().list('form_submissions', {}, { column: 'updated_at', ascending: false })), []);
  useEffect(() => {
    load();
    const stop = backend().watch([{ table: 'form_submissions' }], () => load());
    return () => stop();
  }, [load]);

  const mine = (s: Row) => s.created_by === session?.userId || (!!person && s.person_id === person.id);
  const shown = useMemo(() => all.filter(s => tab === 'all' ? true : tab === 'waiting' ? s.status === 'submitted' : mine(s)), [all, tab, person, session]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (s: Row) => s.form_type === 'driver_timesheet'
    ? nav(`/forms/timesheet?person=${s.person_id ?? ''}&start=${s.period_start ?? ''}${s.data?.period_days === 7 ? '&view=week' : s.data?.period_days === 14 ? '&view=fortnight' : ''}`)
    : nav('/forms/' + s.id);
  const start = async (code: string) => {
    if (code === 'driver_timesheet') { nav(`/forms/timesheet?${person ? 'person=' + person.id + '&' : ''}start=${todayIso()}`); return; }
    try {
      const s = await backend().save('form_submissions', {
        form_type: code, status: 'draft', person_id: person?.id ?? null, period_start: todayIso(),
        data: { claimant_name: person?.full_name ?? '', signed_name: person?.full_name ?? '' },
      });
      nav('/forms/' + s.id);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const detail = (s: Row) => s.form_type === 'expense_reimbursement' ? `$${linesTotal(s.data?.lines, 'amount').toFixed(2)}`
    : s.form_type === 'land_fire_risk' ? [s.data?.property_name, s.data?.idp_number && 'IDP ' + s.data.idp_number].filter(Boolean).join(' · ')
      : s.data?.totals ? `${s.data.totals.totalHours} hrs · ${s.data.totals.infieldDays} infield days` : '';

  return (
    <Page title="Forms" howTo={<ol>
      <li><b>Driver timesheet</b>: your fortnight, one line per day. Send it before 19:00 Tuesday to be paid this cycle.</li>
      <li><b>Expense reimbursement</b>: add each item and a photo of each receipt.</li>
      <li><b>Land pre-inspection and fire risk</b>: the compliance checklist before land preparation and spraying.</li>
      <li>Everything saves as a draft until you sign and send it. {approver ? 'Forms sent to you are under Waiting for approval.' : 'Your supervisor approves it.'}</li>
    </ol>}>
      <EditOnly><div className="cards">
        <button className="card primary" onClick={() => start('driver_timesheet')}>Driver timesheet<small>Fortnight, one line per day</small></button>
        {SIMPLE_FORMS.map(f => <button key={f.code} className="card" onClick={() => start(f.code)}>{f.label}<small>{f.summary}</small></button>)}
      </div></EditOnly>
      <div className="role-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My forms</button>
        {approver && <button role="tab" aria-selected={tab === 'waiting'} className={tab === 'waiting' ? 'on' : ''} onClick={() => setTab('waiting')}>
          Waiting for approval ({all.filter(s => s.status === 'submitted').length})</button>}
        {(approver || can.read('all_work')) && <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Form</th><th>Person</th><th>Date</th><th>Details</th><th>Status</th><th>Last change</th><th /></tr></thead>
        <tbody>
          {shown.map(s => <tr key={s.id}>
            <td>{FORM_LABELS[s.form_type] ?? s.form_type}</td>
            <td>{refLabel('people', people, s.person_id) || s.data?.claimant_name || s.data?.signed_name || '-'}</td>
            <td>{s.period_start ?? '-'}</td><td>{detail(s)}</td>
            <td><span className={'pill ' + s.status}>{s.status}</span></td><td>{fmt(s.updated_at ?? s.created_at)}</td>
            <td><button className="small" onClick={() => open(s)}>Open</button></td>
          </tr>)}
          {!shown.length && <tr><td colSpan={7} className="muted">Nothing here</td></tr>}
        </tbody>
      </table></div>
      {toast.node}
    </Page>
  );
}
