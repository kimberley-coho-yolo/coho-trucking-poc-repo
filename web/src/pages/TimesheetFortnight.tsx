import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { addDays, DAY_NAMES, fortnightTotals, periodDays, periodEnd, periodLength, periodStart, SHIFT_BANDS, submitBy, WET, weekday, type PeriodView } from '../lib/forms';
import { usePeriodSettings } from '../lib/appSettings';
import { EditOnly, errText, fmt, nowIso, Page, ReadOnlyArea, SignaturePad, todayIso, useReadOnly, useRows, useToast } from '../components/ui';
import { NORMAL_SHIFT_HOURS } from '../lib/approvals';
import { useAccess, useApp } from '../state';

type DayKind = 'On shift' | 'R&R' | 'Not working';
const kindOf = (l?: Row): DayKind | '' => !l ? '' : l.rr ? 'R&R' : l.on_shift === false ? 'Not working' : 'On shift';

// The fortnightly Driver Timesheet (2024 Landspray Driver Timesheet Template), one row per day.
// Each day is a timesheet line, so end-of-shift timesheets, Approvals and the payroll export all see the same numbers.
export default function TimesheetFortnight() {
  const nav = useNavigate();
  const toast = useToast();
  const can = useAccess();
  const { person, session } = useApp();
  const approver = can.edit('approvals');
  const [params, setParams] = useSearchParams();
  const people = useRows('people'); const trucks = useRows('trucks');
  const personId = params.get('person') || person?.id || '';
  const ps = usePeriodSettings();
  const view: PeriodView = params.get('view') === 'week' || params.get('view') === 'fortnight' ? params.get('view') as PeriodView : ps.view;
  const start = periodStart(params.get('start') || todayIso(), ps, view);
  const days = useMemo(() => periodDays(start, view), [start, view]);
  const word = view === 'week' ? 'week' : 'fortnight';
  const [lines, setLines] = useState<Record<string, Row>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [sub, setSub] = useState<Row>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!personId) return;
    const all = await backend().list('timesheet_lines', { person_id: personId });
    const byDay: Record<string, Row> = {};
    // a clash line (a new driver's hours paired to this person, waiting for the approver) is shown on Approvals, not here
    for (const l of all) if (!l.clash_with && l.work_date >= days[0] && l.work_date <= days[days.length - 1] && !byDay[l.work_date]) byDay[l.work_date] = l;
    setLines(byDay); setChanged(new Set());
    const subs = (await backend().list('form_submissions', { form_type: 'driver_timesheet', person_id: personId })).filter(s => s.period_start === start);
    setSub(subs[0] ?? { form_type: 'driver_timesheet', person_id: personId, period_start: start, status: 'draft', data: {} });
  }, [personId, start, days]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!personId) return;
    const stop = backend().watch([{ table: 'timesheet_lines', column: 'person_id', value: personId }, { table: 'form_submissions', column: 'person_id', value: personId }],
      () => { if (!changed.size) load(); });
    return () => stop();
  }, [personId, load, changed.size]);

  const status: string = sub.status ?? 'draft';
  const sheetLocked = status === 'approved' || (status === 'submitted' && !approver);
  const list = days.map(d => lines[d]).filter(Boolean) as Row[];
  const totals = fortnightTotals(list);
  const setDay = (d: string, patch: Row) => {
    setLines({ ...lines, [d]: { person_id: personId, work_date: d, status: 'draft', ...(lines[d] ?? {}), ...patch } });
    setChanged(new Set(changed).add(d));
  };
  const setKind = (d: string, k: string) => setDay(d, k === 'R&R' ? { rr: true, on_shift: false } : k === 'Not working' ? { rr: false, on_shift: false } : { rr: false, on_shift: true });

  const saveAll = async (sheetPatch: Row, linePatch: Row | null, msg: string) => {
    setBusy(true);
    try {
      for (const d of days) {
        const l = lines[d];
        if (!l || l.status === 'approved') continue;
        if (!changed.has(d) && !linePatch) continue;
        await backend().save('timesheet_lines', { ...l, ...(linePatch ?? {}) });
      }
      const { id: _i, ...rest } = sub;
      const body = { ...(sub.id ? sub : rest), ...sheetPatch, data: { ...(sub.data ?? {}), totals: fortnightTotals(list), period_days: days.length } };
      const saved = await backend().save('form_submissions', body);
      toast.show(saved.__queued ? 'Saved on this device. It will send by itself when there is signal.' : msg); await load();
    } catch (e) { toast.show(errText(e), 'err'); }
    finally { setBusy(false); }
  };
  const submit = () => {
    if (!sub.signature_png) { toast.show('Please sign first', 'err'); return; }
    saveAll({ status: 'submitted', signed_at: sub.signed_at ?? nowIso() }, { status: 'submitted' }, 'Timesheet sent to your supervisor');
  };
  const approve = () => saveAll({ status: 'approved', approver_name: sub.approver_name || session?.email || null },
    { status: 'approved', approved_by: session?.userId ?? null, approved_at: nowIso(), supervisor_comment: sub.approver_comment ?? null }, `${word === 'week' ? 'Week' : 'Fortnight'} approved and locked`);
  const giveBack = () => {
    if (!sub.approver_comment) { toast.show('Add a comment saying what needs fixing', 'err'); return; }
    saveAll({ status: 'returned' }, { status: 'queried', supervisor_comment: sub.approver_comment }, 'Sent back to the driver');
  };
  const nav2 = (patch: Record<string, string>) => setParams({ ...(personId ? { person: personId } : {}), start, view, ...patch });
  const go = (n: number) => nav2({ start: addDays(start, n * periodLength(view)) });

  return (
    <Page title="Driver timesheet" actions={<span className={'pill ' + status}>{status}</span>} howTo={<ol>
      <li>One line per day, {DAY_NAMES[ps.weekStart]} to {DAY_NAMES[(ps.weekStart + 6) % 7]}. Switch between <b>Week</b> and <b>Fortnight</b> at the top. <b>It fills itself in from your dockets</b>: as soon as you start or close a docket, that day's hours, shift times, unit and rig appear here.</li>
      <li>You only add what dockets do not know: work diary page, wet days and R&R. If you change the hours yourself, your hours are kept.</li>
      <li>Pick <b>On shift</b>, <b>R&R</b> or <b>Not working</b>, the work diary page (or "Nd" if not driving), the shift times, any wet time, hours, unit and rig.</li>
      <li>Tick <b>Truck and dog</b> on days worked with a dog trailer. The totals at the bottom work out truck hours, truck and dog hours and infield days.</li>
      <li>A shift over 24 hours is split across the days it covers and marked <b>24 h+</b>.</li>
      <li>Sign and tap <b>Send to supervisor</b> before <b>09:00 {weekday(addDays(start, periodLength(view)))} {submitBy(start, view).slice(0, 10)}</b> to be paid in this pay cycle.</li>
    </ol>}>
      <div className="filters">
        {(approver || can.read('all_work') || !person) && <label className="field"><span className="field-label">Driver</span>
          <select value={personId} onChange={e => setParams({ person: e.target.value, start, view })}><option value="">(pick a driver)</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>}
        <div className="field"><span className="field-label">Show</span>
          <div className="seg" role="group" aria-label="Week or fortnight">
            <button className={view === 'week' ? 'on' : ''} aria-pressed={view === 'week'} onClick={() => nav2({ view: 'week', start: periodStart(start, ps, 'week') })}>Week</button>
            <button className={view === 'fortnight' ? 'on' : ''} aria-pressed={view === 'fortnight'} onClick={() => nav2({ view: 'fortnight', start: periodStart(start, ps, 'fortnight') })}>Fortnight</button>
          </div></div>
        <div className="field"><span className="field-label">{word === 'week' ? 'Week' : 'Pay fortnight'}</span>
          <div className="row"><button className="small" onClick={() => go(-1)} aria-label={`Previous ${word}`}>Previous</button>
            <b className="period-label">{weekday(start).slice(0, 3)} {start} to {weekday(periodEnd(start, view)).slice(0, 3)} {periodEnd(start, view)}</b>
            <button className="small" onClick={() => go(1)} aria-label={`Next ${word}`}>Next</button></div></div>
      </div>
      {!personId ? <p className="muted">Pick a driver to see their timesheet.</p> : <>
        {status === 'returned' && sub.approver_comment && <div className="note" role="status"><b>Returned:</b> {sub.approver_comment}</div>}
        {!!changed.size && <p className="unsaved" role="status">Unsaved changes on {changed.size} day{changed.size > 1 ? 's' : ''}</p>}
        <ReadOnlyArea on={sheetLocked}>
          <DayTable days={days} lines={lines} trucks={trucks} setDay={setDay} setKind={setKind} />
          {list.some(l => l.over_24h) && <p className="note">Days marked <b>24 h+</b> are part of a shift over 24 hours. Its hours are split across each day it covers.</p>}
          <div className="summary totals">
            <div><b>Total truck hours</b> {totals.truckHours}</div>
            <div><b>Total truck and dog hours</b> {totals.truckAndDogHours}</div>
            <div><b>Total infield days</b> {totals.infieldDays}</div>
          </div>
          <fieldset><legend>Operator</legend>
            <label className="field"><span className="field-label">Operator comments</span>
              <TextArea value={sub.data?.operator_comment} onChange={v => setSub({ ...sub, data: { ...(sub.data ?? {}), operator_comment: v } })} /></label>
            <SignaturePad key={'s' + (sub.id ?? 'new') + (sub.signature_png ? 1 : 0)} value={sub.signature_png} onChange={v => setSub({ ...sub, signature_png: v })} />
            {sub.signed_at && <p className="muted">Signed at {fmt(sub.signed_at)}</p>}
          </fieldset>
        </ReadOnlyArea>
        {(approver || sub.approver_name) && <ReadOnlyArea on={!approver || status === 'approved'}>
          <fieldset><legend>Supervisor</legend>
            <label className="field"><span className="field-label">Supervisor name</span>
              <Input value={sub.approver_name} onChange={v => setSub({ ...sub, approver_name: v })} /></label>
            <label className="field"><span className="field-label">Supervisor comments</span>
              <TextArea value={sub.approver_comment} onChange={v => setSub({ ...sub, approver_comment: v })} /></label>
            {sub.approved_at && <p className="muted">Approved {fmt(sub.approved_at)}</p>}
          </fieldset>
        </ReadOnlyArea>}
        <div className="savebar">
          <EditOnly>
            {!sheetLocked && <button className="primary" disabled={busy} onClick={() => saveAll({}, null, 'Saved')}>Save</button>}
            {!sheetLocked && (status === 'draft' || status === 'returned') && <button disabled={busy} onClick={submit}>Send to supervisor</button>}
            {approver && status === 'submitted' && <><button className="primary" disabled={busy} onClick={approve}>Approve {word}</button>
              <button disabled={busy} onClick={giveBack}>Return with comment</button></>}
          </EditOnly>
          <button onClick={() => load()}>Reload</button>
          <button onClick={() => nav('/forms')}>Back to forms</button>
        </div>
      </>}
      {toast.node}
    </Page>
  );
}

function Input({ value, onChange }: { value: any; onChange: (v: string) => void }) {
  const ro = useReadOnly();
  return <input type="text" value={value ?? ''} disabled={ro} onChange={e => onChange(e.target.value)} />;
}
function TextArea({ value, onChange }: { value: any; onChange: (v: string) => void }) {
  const ro = useReadOnly();
  return <textarea rows={2} value={value ?? ''} disabled={ro} onChange={e => onChange(e.target.value)} />;
}

function DayTable({ days, lines, trucks, setDay, setKind }: {
  days: string[]; lines: Record<string, Row>; trucks: Row[]; setDay: (d: string, p: Row) => void; setKind: (d: string, k: string) => void;
}) {
  const ro = useReadOnly();
  return (
    <div className="table-wrap"><table className="fortnight">
      <thead><tr><th>Day</th><th>On shift / R&R</th><th>Work diary page</th><th>Shift times</th><th>Wet</th><th>Total hours</th><th>Truck and dog</th><th>Unit</th><th>Rig or location</th></tr></thead>
      <tbody>
        {days.map((d, i) => {
          const l = lines[d]; const lockedDay = ro || l?.status === 'approved';
          return <tr key={d} className={i === 7 ? 'week2' : ''}>
            <td><b>{weekday(d).slice(0, 3)}</b> <small>{d.slice(8, 10)}/{d.slice(5, 7)}</small>{l?.status && l.status !== 'draft' && <><br /><span className={'pill ' + l.status}>{l.status}</span></>}
              {l?.over_24h && <><br /><span className="pill long" title={l.split_note ?? ''}>24 h+</span></>}</td>
            <td><select aria-label={`${d} on shift`} disabled={lockedDay} value={kindOf(l)} onChange={e => setKind(d, e.target.value)}>
              <option value="">-</option><option>On shift</option><option>R&R</option><option>Not working</option></select></td>
            <td><input aria-label={`${d} diary page`} disabled={lockedDay} value={l?.work_diary_page ?? ''} onChange={e => setDay(d, { work_diary_page: e.target.value })} /></td>
            <td><select aria-label={`${d} shift times`} disabled={lockedDay} value={l?.shift_band ?? ''} onChange={e => setDay(d, { shift_band: e.target.value || null })}>
              <option value="">-</option>{SHIFT_BANDS.map(b => <option key={b}>{b}</option>)}</select></td>
            <td><select aria-label={`${d} wet`} disabled={lockedDay} value={l?.wet_type ?? ''} onChange={e => setDay(d, { wet_type: e.target.value || null, wet_hours: e.target.value.startsWith('8') ? 8 : e.target.value.startsWith('6') ? 6 : null })}>
              <option value="">-</option>{WET.map(w => <option key={w}>{w}</option>)}</select></td>
            <td><input aria-label={`${d} hours`} type="number" inputMode="decimal" disabled={lockedDay} value={l?.total_hours ?? ''} onChange={e => setDay(d, { total_hours: e.target.value === '' ? null : Number(e.target.value), hours_edited: true })} />
              {Number(l?.total_hours) > NORMAL_SHIFT_HOURS && <small className="help over-normal" role="status">Over {NORMAL_SHIFT_HOURS} h: your supervisor will be asked to confirm these hours</small>}
              {l?.over_24h && l.split_note && <small className="help">{l.split_note}</small>}
              {l?.docket_hours != null && <small className="help from-dockets">Dockets {l.docket_hours} h{l.standby_hours ? ` · standby ${l.standby_hours} h` : ''}{l.hours_edited ? ' · your hours kept' : ''}</small>}</td>
            <td><input aria-label={`${d} truck and dog`} type="checkbox" disabled={lockedDay} checked={!!l?.with_dog} onChange={e => setDay(d, { with_dog: e.target.checked })} /></td>
            <td><select aria-label={`${d} unit`} disabled={lockedDay} value={l?.truck_id ?? ''} onChange={e => setDay(d, { truck_id: e.target.value || null })}>
              <option value="">-</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.unit_no ? 'Unit ' + t.unit_no : t.rego}</option>)}</select></td>
            <td><input aria-label={`${d} rig`} disabled={lockedDay} value={l?.location ?? ''} onChange={e => setDay(d, { location: e.target.value })} /></td>
          </tr>;
        })}
      </tbody>
    </table></div>
  );
}
