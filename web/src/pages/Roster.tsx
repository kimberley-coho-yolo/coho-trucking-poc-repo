import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { docketDay, phoneLabel, STAGE_LABEL, stageOf } from '../lib/assignment';
import { formFor } from '../lib/docketForms';
import { addDays, periodDays, periodStart, weekday } from '../lib/forms';
import { usePeriodSettings } from '../lib/appSettings';
import { EditOnly, Page, refLabel, todayIso, useRows, useToast } from '../components/ui';
import { AssignmentBox, usePhonePeople } from '../components/assign';
import { NewDocketPanel } from '../components/docket';

// The roster: crew phones down the side, days across the top (week starts on the day set in Settings).
// Each cell shows the dockets assigned to that phone for that day. Tap one to assign, reassign or cancel.
export default function Roster() {
  const nav = useNavigate();
  const toast = useToast();
  const ps = usePeriodSettings();
  const [params, setParams] = useSearchParams();
  const start = periodStart(params.get('start') || todayIso(), ps, 'week');
  const days = useMemo(() => periodDays(start, 'week'), [start]);
  const phones = useRows('work_phones').filter(w => w.active !== false);
  const people = useRows('people'); const locations = useRows('locations');
  const phonePeople = usePhonePeople();
  const [all, setAll] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [creating, setCreating] = useState<{ phoneId: string | null; date: string } | null>(null);

  const load = useCallback(async () => setAll(await backend().list('dockets')), []);
  useEffect(() => {
    load();
    const stop = backend().watch([{ table: 'dockets' }], () => load());
    return () => stop();
  }, [load]);
  useEffect(() => { if (sel) setSel(all.find(d => d.id === sel.id) ?? null); }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const inWeek = all.filter(d => { const dd = docketDay(d); return dd && dd >= days[0] && dd <= days[6]; });
  const cell = (phoneId: string | null, day: string) => inWeek.filter(d => (d.assigned_phone_id ?? null) === phoneId && docketDay(d) === day)
    .sort((a, b) => Number(a.docket_no ?? 0) - Number(b.docket_no ?? 0));
  const chip = (d: Row) => (
    <button key={d.id} className={'roster-chip stage-' + stageOf(d) + (sel?.id === d.id ? ' on' : '')} onClick={() => setSel(d)} title={STAGE_LABEL[stageOf(d)]}>
      <b>{d.docket_no}</b> {formFor(d.form_type).label.split(' ')[0]}
      <small>{refLabel('locations', locations, d.location_id) || ' '}</small>
      <small>{STAGE_LABEL[stageOf(d)]}{(d.assigned_person_ids ?? []).length ? ' · ' + (d.assigned_person_ids ?? []).map((id: string) => people.find(p => p.id === id)?.full_name?.split(' ')[0]).join(', ') : ''}</small>
    </button>);
  const go = (n: number) => setParams({ start: addDays(start, n * 7) });

  return (
    <Page title="Roster" howTo={<ol>
      <li>Each row is a crew phone, each column a day ({weekday(days[0])} to {weekday(days[6])}). Dockets show where they are up to: assigned, in progress, completed, reviewed.</li>
      <li>Tap <b>+</b> in a cell to make a docket for that phone and day. It is assigned straight away and the phone gets a text.</li>
      <li>Tap a docket to <b>Assign</b>, use <b>Docket reassignment</b> to move it to another crew phone, or <b>Cancel docket assignment</b>. The phones concerned get a text.</li>
      <li>Dockets not assigned yet are in the bottom row.</li>
      <li>Completed dockets go to the department's supervisors to review (Home &gt; Dockets to review).</li>
    </ol>}>
      <div className="row">
        <button className="small" onClick={() => go(-1)} aria-label="Previous week">Previous</button>
        <b>{weekday(days[0]).slice(0, 3)} {days[0]} to {weekday(days[6]).slice(0, 3)} {days[6]}</b>
        <button className="small" onClick={() => go(1)} aria-label="Next week">Next</button>
        <button className="small" onClick={() => setParams({})}>This week</button>
      </div>

      {creating && <NewDocketPanel defaults={{ work_date: creating.date, assigned_phone_id: creating.phoneId }} onCancel={() => setCreating(null)}
        onDone={id => { setCreating(null); toast.show('Docket created'); nav('/docket/' + id); }} />}

      {sel && <div className="subform roster-sel">
        <div className="row spread"><b>Docket No. {sel.docket_no} · {formFor(sel.form_type).label} · {docketDay(sel)}</b>
          <span className="row"><Link className="button small" to={'/docket/' + sel.id}>Open docket</Link><button className="small" onClick={() => setSel(null)}>Close</button></span></div>
        <AssignmentBox docket={sel} onSaved={() => load()} />
      </div>}

      <div className="table-wrap"><table className="roster">
        <thead><tr><th>Crew phone</th>{days.map(d => <th key={d} className={d === todayIso() ? 'today' : ''}>{weekday(d).slice(0, 3)} {d.slice(8, 10)}/{d.slice(5, 7)}</th>)}</tr></thead>
        <tbody>
          {phones.map(w => <tr key={w.id}>
            <th><b>{w.label || 'Crew phone'}</b><small>{w.phone}</small><small>{phonePeople(w.id).map(p => p.full_name).join(', ')}</small></th>
            {days.map(d => <td key={d} className={d === todayIso() ? 'today' : ''}>
              {cell(w.id, d).map(chip)}
              <EditOnly><button className="small roster-add" aria-label={`New docket for ${phoneLabel(w)} on ${d}`} onClick={() => setCreating({ phoneId: w.id, date: d })}>+</button></EditOnly>
            </td>)}
          </tr>)}
          <tr className="unassigned"><th><b>Not assigned</b><small>Tap a docket to assign it</small></th>
            {days.map(d => <td key={d} className={d === todayIso() ? 'today' : ''}>{cell(null, d).map(chip)}
              <EditOnly><button className="small roster-add" aria-label={`New unassigned docket on ${d}`} onClick={() => setCreating({ phoneId: null, date: d })}>+</button></EditOnly></td>)}</tr>
        </tbody>
      </table></div>
      {toast.node}
    </Page>
  );
}
