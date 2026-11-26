// Assigning a docket to a crew phone (and optionally drivers on it), reassigning it, or cancelling the assignment.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { docketDay, jobsFor, phoneLabel, STAGE_LABEL, stageOf } from '../lib/assignment';
import { formFor } from '../lib/docketForms';
import { useAccess, useApp } from '../state';
import { errText, fmt, refLabel, todayIso, useRows } from './ui';

/** Drivers who use a crew phone (Admin > Who uses which phone). */
export function usePhonePeople() {
  const people = useRows('people'); const links = useRows('phone_assignments');
  return (phoneId?: string | null) => phoneId ? links.filter(l => l.work_phone_id === phoneId).map(l => people.find(p => p.id === l.person_id)).filter(Boolean) as Row[] : [];
}

/** Latest text about this docket (for people who can see the text log). */
function useLastText(docketId: string, show: boolean) {
  const [t, setT] = useState<Row | null>(null);
  useEffect(() => {
    if (!show) return;
    const load = () => backend().list('sms_outbox', { docket_id: docketId }).then(r => setT([...r].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null)).catch(() => null);
    load();
    const stop = backend().watch([{ table: 'sms_outbox', column: 'docket_id', value: docketId }], () => load());
    return () => stop();
  }, [docketId, show]);
  return t;
}

export function PhoneAndDrivers({ phoneId, personIds, onChange }: { phoneId: string | null; personIds: string[]; onChange: (phoneId: string | null, personIds: string[]) => void }) {
  const phones = useRows('work_phones').filter(w => w.active !== false || w.id === phoneId);
  const onPhone = usePhonePeople()(phoneId);
  return (
    <div className="grid">
      <label className="field" htmlFor="assign-phone"><span className="field-label">Crew phone</span>
        <select id="assign-phone" value={phoneId ?? ''} onChange={e => onChange(e.target.value || null, [])}>
          <option value="">(choose the crew phone)</option>
          {phones.map(w => <option key={w.id} value={w.id}>{phoneLabel(w)}</option>)}
        </select>
        <small className="help">A text goes to this mobile to say the docket is theirs.</small></label>
      {!!phoneId && <div className="field"><span className="field-label">Driver (optional)</span>
        <div className="chips">
          {onPhone.map(p => { const on = personIds.includes(p.id); return <label key={p.id} className={'chip-toggle' + (on ? ' on' : '')}>
            <input type="checkbox" checked={on} onChange={() => onChange(phoneId, on ? personIds.filter(x => x !== p.id) : [...personIds, p.id])} />{p.full_name}</label>; })}
          {!onPhone.length && <span className="muted">Nobody is linked to this phone yet (Admin &gt; Who uses which phone).</span>}
        </div>
        <small className="help">Leave blank for whoever is on that phone.</small></div>}
    </div>
  );
}

/** Shows who has the docket and gives supervisor, office and admin the Assign / Docket reassignment / Cancel docket assignment buttons. */
export function AssignmentBox({ docket, onSaved, blocked }: { docket: Row; onSaved: (d: Row) => void; blocked?: string }) {
  const can = useAccess();
  const canAssign = can.edit('docket_assign');
  const phones = useRows('work_phones'); const people = useRows('people');
  const [mode, setMode] = useState<'view' | 'assign'>('view');
  const [phoneId, setPhoneId] = useState<string | null>(docket.assigned_phone_id ?? null);
  const [personIds, setPersonIds] = useState<string[]>(docket.assigned_person_ids ?? []);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const lastText = useLastText(docket.id, can.read('docket_assign'));
  useEffect(() => { setPhoneId(docket.assigned_phone_id ?? null); setPersonIds(docket.assigned_person_ids ?? []); }, [docket.assigned_phone_id, docket.assigned_person_ids]);
  const phone = phones.find(w => w.id === docket.assigned_phone_id);
  const names = (docket.assigned_person_ids ?? []).map((id: string) => people.find(p => p.id === id)?.full_name ?? '?').join(', ');
  const reviewed = docket.review_status === 'reviewed';

  const save = async (patch: Row, msg: string) => {
    setBusy(true); setErr('');
    try {
      const saved = await backend().save('dockets', { id: docket.id, version: docket.version, ...patch });
      backend().kickTexts?.();
      setMode('view'); setDone(saved.__queued ? `${msg} on this device. The text goes when there is signal.` : `${msg}. A text is on its way to the crew phone.`); onSaved(saved);
      return msg;
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="assign-box">
      <div className="assign-now">
        <b>{phone ? phoneLabel(phone) : 'Not assigned to a crew phone'}</b>
        {names && <span> · {names}</span>}
        {docket.assigned_at && <span className="muted"> · assigned {fmt(docket.assigned_at)}</span>}
        <span className={'pill stage-' + stageOf(docket)}>{STAGE_LABEL[stageOf(docket)]}</span>
        {lastText && <span className={'muted text-' + lastText.status}> · text {lastText.status === 'sent' ? `sent ${fmt(lastText.sent_at)}` : lastText.status === 'failed' ? `not sent (${lastText.error ?? 'error'})` : 'waiting to send'}</span>}
      </div>
      {canAssign && !reviewed && mode === 'view' && <div className="row">
        {blocked ? <span className="muted">{blocked}</span> : !docket.assigned_phone_id
          ? <button className="primary" onClick={() => setMode('assign')}>Assign docket</button>
          : <>
            <button onClick={() => setMode('assign')}>Docket reassignment</button>
            <button className="danger" disabled={busy} onClick={() => {
              if (window.confirm(`Cancel the assignment of docket ${docket.docket_no ?? ''} to ${phoneLabel(phone)}? A text tells them it is cancelled.`))
                save({ assigned_phone_id: null, assigned_person_ids: [] }, 'Assignment cancelled');
            }}>Cancel docket assignment</button>
          </>}
      </div>}
      {mode === 'assign' && <div className="subform">
        <PhoneAndDrivers phoneId={phoneId} personIds={personIds} onChange={(w, p) => { setPhoneId(w); setPersonIds(p); }} />
        <div className="row">
          <button className="primary" disabled={busy || !phoneId || (phoneId === docket.assigned_phone_id && JSON.stringify(personIds) === JSON.stringify(docket.assigned_person_ids ?? []))}
            onClick={() => save({ assigned_phone_id: phoneId, assigned_person_ids: personIds }, docket.assigned_phone_id ? 'Reassigned' : 'Assigned')}>
            {docket.assigned_phone_id ? 'Reassign and text the crew' : 'Assign and text the crew'}</button>
          <button onClick={() => { setMode('view'); setPhoneId(docket.assigned_phone_id ?? null); setPersonIds(docket.assigned_person_ids ?? []); }}>Back</button>
        </div>
      </div>}
      {err && <p className="err">{err}</p>}
      {done && !err && <p className="note" role="status">{done}</p>}
    </div>
  );
}

/** The driver's jobs: today, late (earlier and not finished), and coming up. */
export function JobsToday({ onPick, pickLabel }: { onPick?: (d: Row) => void; pickLabel?: string }) {
  const { person, role } = useApp();
  const nav = useNavigate();
  const locations = useRows('locations'); const trucks = useRows('trucks');
  const [all, setAll] = useState<Row[]>([]);
  useEffect(() => {
    if (!role) return;
    const load = () => backend().list('dockets').then(setAll).catch(() => null);
    load();
    const stop = backend().watch([{ table: 'dockets' }], () => load());
    const onBack = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onBack);
    return () => { stop(); document.removeEventListener('visibilitychange', onBack); };
  }, [role]);
  const jobs = useMemo(() => jobsFor(all, person?.id, todayIso()), [all, person?.id]);
  const item = (d: Row) => (
    <button key={d.id} className={'big job stage-' + stageOf(d)} onClick={() => (onPick ? onPick(d) : nav('/docket/' + d.id))}>
      {formFor(d.form_type).label} · No. {d.docket_no ?? '-'}
      <small>{[docketDay(d), refLabel('trucks', trucks, d.truck_id), refLabel('locations', locations, d.location_id), STAGE_LABEL[stageOf(d)]].filter(Boolean).join(' · ')}</small>
      {d.review_status === 'returned' && d.review_comment && <small className="err">Supervisor: {d.review_comment}</small>}
      {onPick && <small><b>{pickLabel ?? 'Open'}</b></small>}
    </button>
  );
  return (
    <section className="jobs-today">
      <h2>Jobs for today</h2>
      {jobs.late.length > 0 && <><h3>Not finished from earlier</h3><div className="stack">{jobs.late.map(item)}</div></>}
      {jobs.today.length ? <div className="stack">{jobs.today.map(item)}</div> : <p className="muted">No dockets assigned to you for today.</p>}
      {jobs.upcoming.length > 0 && <details><summary>Coming up ({jobs.upcoming.length})</summary><div className="stack">{jobs.upcoming.map(item)}</div></details>}
    </section>
  );
}

/** Home page: where every assigned docket is up to, updated live. */
export function AssignedStatus() {
  const can = useAccess();
  const nav = useNavigate();
  const phones = useRows('work_phones'); const people = useRows('people'); const locations = useRows('locations');
  const [all, setAll] = useState<Row[]>([]);
  const [deps, setDeps] = useState<string[]>([]);
  useEffect(() => {
    const load = () => backend().list('dockets', {}, { column: 'updated_at', ascending: false }).then(setAll).catch(() => null);
    load();
    Promise.resolve(backend().myReviewDepartments?.() ?? []).then(setDeps).catch(() => null);
    const stop = backend().watch([{ table: 'dockets' }], () => load());
    return () => stop();
  }, []);
  const today = todayIso();
  const recent = all.filter(d => (d.assigned_phone_id || (d.assigned_person_ids ?? []).length || d.review_status) && (
    (docketDay(d) ?? today) >= new Date(Date.parse(today + 'T00:00:00Z') - 2 * 86_400_000).toISOString().slice(0, 10) || ['assigned', 'in_progress', 'returned', 'to_review'].includes(stageOf(d))));
  const counts = (['assigned', 'in_progress', 'returned', 'to_review', 'reviewed'] as const).map(s => [s, recent.filter(d => stageOf(d) === s).length] as const);
  const review = all.filter(d => d.review_status === 'to_review' && (!deps.length || deps.includes(d.department ?? '')));
  return (
    <section className="assigned-status">
      <div className="row spread"><h2>Assigned dockets</h2><Link to="/roster">Open the roster</Link></div>
      <div className="stage-counts">{counts.map(([s, n]) => <span key={s} className={'stage-count stage-' + s}><b>{n}</b> {STAGE_LABEL[s]}</span>)}</div>
      {can.read('docket_review') && review.length > 0 && <>
        <h3>Dockets to review{deps.length ? ` (${deps.join(', ')})` : ''}</h3>
        <div className="stack">{review.map(d => <button key={d.id} className="big" onClick={() => nav('/docket/' + d.id)}>
          No. {d.docket_no} · {formFor(d.form_type).label}<small>{[d.department, refLabel('locations', locations, d.location_id), 'completed ' + fmt(d.completed_at)].filter(Boolean).join(' · ')}</small></button>)}</div></>}
      <div className="table-wrap"><table>
        <thead><tr><th>No.</th><th>Date</th><th>Form</th><th>Crew phone</th><th>Driver</th><th>Rig</th><th>Status</th><th>Last change</th></tr></thead>
        <tbody>
          {recent.slice(0, 40).map(d => <tr key={d.id} className="clickable" onClick={() => nav('/docket/' + d.id)}>
            <td>{d.docket_no}</td><td>{docketDay(d)}</td><td>{formFor(d.form_type).label}</td>
            <td>{phoneLabel(phones.find(w => w.id === d.assigned_phone_id)) || <span className="muted">-</span>}</td>
            <td>{(d.assigned_person_ids ?? []).map((id: string) => people.find(p => p.id === id)?.full_name).filter(Boolean).join(', ') || <span className="muted">-</span>}</td>
            <td>{refLabel('locations', locations, d.location_id)}</td>
            <td><span className={'pill stage-' + stageOf(d)}>{STAGE_LABEL[stageOf(d)]}</span></td><td>{fmt(d.updated_at ?? d.created_at)}</td>
          </tr>)}
          {!recent.length && <tr><td colSpan={8} className="muted">No assigned dockets in the last few days.</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}
