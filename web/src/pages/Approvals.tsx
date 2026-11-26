import { useEffect, useMemo, useState } from 'react';
import { backend, type Row } from '../lib/backend';
import { clearRefCache, EditOnly, errText, fmt, nowIso, Page, refLabel, useReadOnly, useRows, useToast } from '../components/ui';
import { matchesFor } from '../lib/newDrivers';
import { downloadRows } from '../lib/importExport';
import { bulkApprovable, groupByDriver, inRange, NORMAL_SHIFT_HOURS, overNormal, rangeFor, type DriverGroup, type RangeKind } from '../lib/approvals';
import { usePeriodSettings } from '../lib/appSettings';
import { todayIso } from '../components/ui';
import type { PeriodView } from '../lib/forms';
import { useApp } from '../state';

export default function Approvals() {
  const { session } = useApp();
  const toast = useToast();
  const [peopleTick, setPeopleTick] = useState(0);
  const people = useRows('people', [peopleTick]);
  const phones = useRows('work_phones');
  const readOnly = useReadOnly();
  const [status, setStatus] = useState('submitted');
  const [all, setAll] = useState<Row[]>([]);
  const ps = usePeriodSettings();
  const [view, setView] = useState<PeriodView | null>(null);
  const v: PeriodView = view ?? ps.view;
  const [kind, setKind] = useState<RangeKind>('all');
  const range = rangeFor(kind, todayIso(), ps, v);
  const rows = useMemo(() => all.filter(r => inRange(r.work_date, range)), [all, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);   // driver group being bulk approved
  const load = async () => setAll((await backend().list('timesheet_lines', status ? { status } : {}, { column: 'work_date' })));
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
    if (decision === 'approved' && overNormal(r) && !window.confirm(`${refLabel('people', people, r.person_id)} recorded ${r.total_hours} hours on ${r.work_date}, more than ${NORMAL_SHIFT_HOURS} hours. Confirm these hours and approve?`)) return;
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
    const long = todo.filter(overNormal);
    if (!window.confirm(`${long.length ? `${long.length} day${long.length === 1 ? ' is' : 's are'} over ${NORMAL_SHIFT_HOURS} hours (${long.map(l => `${l.work_date}: ${l.total_hours} h`).join(', ')}). Approving confirms ${long.length === 1 ? 'it' : 'them'}.\n\n` : ''}Approve ${todo.length} timesheet line${todo.length === 1 ? '' : 's'} for ${g.name} (${Math.round(hours * 100) / 100} hours, ${range.label.toLowerCase()}${range.from ? `: ${range.from} to ${range.to}` : ''})? Approved lines are locked.`)) return;
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
  // ---------- new drivers added on a crew phone ----------
  const pendingPeople = people.filter(p => p.pending);
  const [allLines, setAllLines] = useState<Row[]>([]);
  useEffect(() => { backend().list('timesheet_lines').then(setAllLines).catch(() => setAllLines([])); }, [all]);
  // clash days: a new driver's line paired to someone who already had that day. Both kept until resolved here.
  const clashes = allLines.filter(l => l.clash_with).map(l => ({ fresh: l, own: allLines.find(x => x.id === l.clash_with) })).filter(c => c.own) as { fresh: Row; own: Row }[];
  const inClash = (r: Row) => !!r.clash_with || allLines.some(l => l.clash_with === r.id);
  const [keep, setKeep] = useState<Record<string, 'own' | 'fresh'>>({});
  const [amend, setAmend] = useState<Record<string, { total_hours?: string; work_diary_page?: string; comment?: string }>>({});
  const resolve = async (c: { fresh: Row; own: Row }) => {
    const which = keep[c.fresh.id] ?? 'own'; const k = which === 'own' ? c.own : c.fresh; const r = which === 'own' ? c.fresh : c.own;
    const a = amend[c.fresh.id] ?? {};
    const hours = a.total_hours !== undefined && a.total_hours !== '' ? Number(a.total_hours) : null;
    if (hours !== null && (Number.isNaN(hours) || hours < 0 || hours > 24)) { toast.show('Hours must be a number from 0 to 24', 'err'); return; }
    if (!window.confirm(`Keep the ${which === 'own' ? 'existing' : `"sent as ${c.fresh.clash_from ?? 'new driver'}"`} line for ${refLabel('people', people, k.person_id)} on ${k.work_date}${hours !== null ? `, amended to ${hours} hours` : ''}? The other line is removed.`)) return;
    setChecking(c.fresh.id);
    try {
      await backend().resolveTimesheetClash!(k.id, r.id, { total_hours: hours, work_diary_page: a.work_diary_page || null, comment: a.comment || null });
      toast.show(`Clash resolved for ${k.work_date}`); load();
    } catch (e) { toast.show(errText(e), 'err'); }
    setChecking(null);
  };
  const [checking, setChecking] = useState<string | null>(null);
  const afterCheck = (msg: string) => { clearRefCache(); setPeopleTick(t => t + 1); toast.show(msg); load(); };
  const approveNew = async (p: Row) => {
    if (!window.confirm(`Approve ${p.full_name} as a new driver? They are added to the people list and their days can then be approved.`)) return;
    setChecking(p.id);
    try { await backend().approvePendingDriver!(p.id); afterCheck(`${p.full_name} approved as a new driver`); } catch (e) { toast.show(errText(e), 'err'); }
    setChecking(null);
  };
  const pair = async (p: Row, to: Row) => {
    if (!window.confirm(`Move ${p.full_name}'s shifts, dockets and timesheet days to ${to.full_name}? ${p.full_name} is then removed from the crew phone.`)) return;
    setChecking(p.id);
    try {
      const n = await backend().pairPendingDriver!(p.id, to.id);
      const c = (await backend().list('timesheet_lines', { person_id: to.id })).filter(l => l.clash_from === p.full_name && l.clash_with).length;
      afterCheck(`${n} day${n === 1 ? '' : 's'} moved from ${p.full_name} to ${to.full_name}${c ? `. ${c} day${c === 1 ? '' : 's'} clash with ${to.full_name}'s own: resolve below` : ''}`);
    } catch (e) { toast.show(errText(e), 'err'); }
    setChecking(null);
  };
  const span = (g: DriverGroup) => !g.firstDate ? '' : g.firstDate === g.lastDate ? g.firstDate : `${g.firstDate} to ${g.lastDate}`;

  return (
    <Page title="Timesheet approvals" actions={<button onClick={exportPayroll}>Export approved hours (MYOB)</button>} howTo={<ol>
      <li>Pick the dates to review: <b>this or the previous week/fortnight</b> (from Settings: weeks start on the set day), <b>last 7 days</b>, <b>last 14 days</b> or <b>this month to today</b>. <b>Approve all</b> then only covers those dates.</li>
      <li>Days marked <b>24 h+</b> are part of a shift over 24 hours, split across the days it covered. Check them together.</li>
      <li>Timesheet lines are grouped by driver, with each driver's total hours and dates. Tap a driver's name to show or hide their lines.</li>
      <li>Check the hours against the dockets. Tap <b>Approve</b> on one line, or <b>Approve all for</b> a driver to approve every line of theirs that is waiting. It only ever approves that one driver's lines.</li>
      <li>Times are decimal hours (0.5 = 30 minutes). <b>Travel time</b> is hours driving outside any customer docket; <b>Travel distance</b> is the km for that travel from km matching (blank until GPS trips are uploaded and matched).</li>
      <li>To send a line back, type a comment and tap <b>Query</b>. Queried lines are left out of "Approve all".</li>
      <li>Approved lines are locked and can only be changed by an admin. Every change is logged.</li>
      <li><b>New drivers to check</b> (top of the screen): names added on a crew phone. Once they send their timesheet, <b>pair their hours</b> to an existing driver with the same surname, or <b>approve</b> them as a new driver. Until then their days cannot be approved.</li>
      <li><b>Timesheet clashes</b>: when paired hours land on a day the driver already had, both lines are kept. Pick the one to keep, amend the hours, diary page or comment if needed, and tap <b>Keep this line</b>.</li>
      <li>Days recorded at more than {NORMAL_SHIFT_HOURS} hours are kept as recorded and marked <b>Over {NORMAL_SHIFT_HOURS} h</b>. Approving one asks you to confirm the hours.</li>
      <li><b>Export approved hours</b> gives a CSV for MYOB AccountRight payroll until the MYOB link is built.</li>
    </ol>}>
      <div className="row approval-range" role="group" aria-label="Dates">
        {(['period', 'previous', 'last7', 'last14', 'month', 'all'] as RangeKind[]).map(k =>
          <button key={k} className={'small' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{rangeFor(k, todayIso(), ps, v).label}</button>)}
        <span className="seg" role="group" aria-label="Week or fortnight">
          <button className={v === 'week' ? 'on' : ''} aria-pressed={v === 'week'} onClick={() => setView('week')}>Week</button>
          <button className={v === 'fortnight' ? 'on' : ''} aria-pressed={v === 'fortnight'} onClick={() => setView('fortnight')}>Fortnight</button>
        </span>
      </div>
      {pendingPeople.length > 0 && <section className="new-drivers" aria-label="New drivers to check">
        <h2>New drivers to check ({pendingPeople.length})</h2>
        <p className="muted">Added on a crew phone because their name was not in the list. Their days cannot be approved until you approve them as a new driver, or pair their hours to an existing driver with the same surname.</p>
        {pendingPeople.map(p => {
          const sent = allLines.filter(l => l.person_id === p.id && l.status === 'submitted');
          const matches = matchesFor(p, people);
          return <div key={p.id} className="new-driver">
            <div className="row spread"><b>{p.full_name}</b>
              <span className="muted">Added {p.added_at ? fmt(p.added_at) : ''} on {phones.find(w => w.id === p.added_phone_id)?.phone ?? 'a crew phone'} · {sent.length ? `${sent.length} day${sent.length === 1 ? '' : 's'} sent` : 'timesheet not sent yet'}</span></div>
            {!sent.length ? <p className="muted">Check once they send their timesheet.</p> : <>
              <p>{matches.length ? `Existing driver${matches.length === 1 ? '' : 's'} with the same surname:` : 'No existing driver has the same surname.'}</p>
              <EditOnly><div className="row">
                {matches.map(m => <button key={m.id} className="small" disabled={checking !== null} onClick={() => pair(p, m)}>Pair hours to {m.full_name}</button>)}
                <button className="small primary" disabled={checking !== null} onClick={() => approveNew(p)}>Approve {p.full_name} as a new driver</button>
              </div></EditOnly>
            </>}
          </div>;
        })}
      </section>}
      {clashes.length > 0 && <section className="new-drivers clashes" aria-label="Timesheet clashes to resolve">
        <h2>Timesheet clashes to resolve ({clashes.length})</h2>
        <p className="muted">A new driver's hours were paired to a driver who already had a timesheet for that day. Both lines are kept. Pick the line to keep, amend it if needed, and tap <b>Keep this line</b>. The other line is removed. Until then neither can be approved.</p>
        {clashes.map(c => {
          const which = keep[c.fresh.id] ?? 'own'; const a = amend[c.fresh.id] ?? {};
          const card = (l: Row, k: 'own' | 'fresh', title: string) => <label className={'clash-card' + (which === k ? ' on' : '')}>
            <span className="row"><input type="radio" name={'keep-' + c.fresh.id} checked={which === k} onChange={() => setKeep({ ...keep, [c.fresh.id]: k })} /> <b>{title}</b></span>
            <span>Status: {l.status} · Total {l.total_hours ?? '-'} h · Dockets {l.docket_hours ?? '-'} h · Travel {l.travel_hours ?? '-'} h</span>
            <span>Diary page: {l.work_diary_page || '-'}{l.driver_comment ? ` · Comment: ${l.driver_comment}` : ''}</span>
          </label>;
          return <div key={c.fresh.id} className="new-driver clash">
            <b>{refLabel('people', people, c.own.person_id)} · {c.own.work_date}</b>
            <div className="clash-cards">{card(c.own, 'own', 'Existing line')}{card(c.fresh, 'fresh', `Sent as ${c.fresh.clash_from ?? 'new driver'}`)}</div>
            <EditOnly><div className="filters">
              <label className="field"><span className="field-label">Amend total hours (optional)</span>
                <input type="number" inputMode="decimal" step="0.25" aria-label={`Amend hours ${c.own.work_date}`} value={a.total_hours ?? ''} onChange={e => setAmend({ ...amend, [c.fresh.id]: { ...a, total_hours: e.target.value } })} /></label>
              <label className="field"><span className="field-label">Diary page (optional)</span>
                <input value={a.work_diary_page ?? ''} onChange={e => setAmend({ ...amend, [c.fresh.id]: { ...a, work_diary_page: e.target.value } })} /></label>
              <label className="field"><span className="field-label">Comment (optional)</span>
                <input value={a.comment ?? ''} onChange={e => setAmend({ ...amend, [c.fresh.id]: { ...a, comment: e.target.value } })} /></label>
            </div>
            <button className="small primary" disabled={checking !== null} onClick={() => resolve(c)}>Keep this line</button></EditOnly>
          </div>;
        })}
      </section>}
      {range.from && <p className="muted">Showing {range.from} to {range.to}.</p>}
      <div className="row"><label>Show <select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="submitted">Waiting for approval</option><option value="queried">Queried</option><option value="approved">Approved</option><option value="">All</option></select></label>
        <span className="muted">Times are in decimal hours (0.5 = 30 minutes). Travel is time and distance outside any customer docket.</span>
        <span className="muted">{groups.length} driver{groups.length === 1 ? '' : 's'}, {rows.length} line{rows.length === 1 ? '' : 's'}</span></div>
      {!groups.length && <p className="muted">Nothing here</p>}
      {groups.map(g => {
        const pend = people.find(p => p.id === g.personId)?.pending;
        const todo = pend ? [] : bulkApprovable(g).filter(r => !inClash(r));
        const key = g.personId ?? 'none';
        return <details key={key} className="driver-group" open>
          <summary>
            <span className="dg-name">{g.name}{pend && <> <span className="pill new-driver-flag">New driver: check</span></>}</span>
            <span className="dg-meta">{g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {g.totalHours} hrs total{span(g) && ` · ${span(g)}`}{g.waiting ? ` · ${g.waiting} waiting` : ''}</span>
          </summary>
          <EditOnly>{todo.length > 0 && <div className="row dg-actions">
            <button className="primary" disabled={busy !== null} onClick={() => approveAll(g)}>
              {busy === key ? 'Approving...' : `Approve all for ${g.name}${range.from ? ` (${range.label.toLowerCase()})` : ''} (${todo.length})`}</button></div>}</EditOnly>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Status</th><th>Total time (hrs)</th><th>Docket time (hrs)</th><th>Travel time (hrs)</th><th>Travel distance (km)</th><th>Standby (hrs)</th><th>R&R</th><th>Wet time (hrs)</th><th>Diary page</th><th>Comment</th><th /></tr></thead>
            <tbody>{g.lines.map(r => <tr key={r.id}>
              <td>{r.work_date}{r.over_24h && <> <span className="pill long" title={r.split_note ?? ''}>24 h+</span></>}{inClash(r) && <> <span className="pill new-driver-flag">Clash: resolve above</span></>}</td><td><span className={'pill ' + r.status}>{r.status}</span></td><td>{r.total_hours}{overNormal(r) && <> <span className="pill over-normal" title={`More than ${NORMAL_SHIFT_HOURS} hours: confirm when approving`}>Over {NORMAL_SHIFT_HOURS} h</span></>}</td><td>{r.docket_hours}</td><td>{r.travel_hours}</td><td>{r.shift_id && travelKm[r.shift_id] !== undefined ? travelKm[r.shift_id] : <span className="muted">-</span>}</td>
              <td>{r.standby_hours}</td><td>{r.rr ? 'Yes' : ''}</td><td>{r.wet_hours}</td><td>{r.work_diary_page}</td>
              <td><input disabled={readOnly || r.status === 'approved'} value={comments[r.id] ?? r.supervisor_comment ?? ''} onChange={e => setComments({ ...comments, [r.id]: e.target.value })} /></td>
              <td className="row">{r.status !== 'approved' && <EditOnly><button className="small primary" disabled={busy !== null || !!pend || inClash(r)} title={pend ? 'Check the new driver first (top of this screen)' : inClash(r) ? 'Resolve the clash first (top of this screen)' : undefined} onClick={() => decide(r, 'approved')}>Approve</button>
                <button className="small" disabled={busy !== null} onClick={() => decide(r, 'queried')}>Query</button></EditOnly>}</td>
            </tr>)}</tbody>
          </table></div>
        </details>;
      })}
      {toast.node}
    </Page>
  );
}
