import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { docketDay, phoneLabel, STAGE_LABEL, stageOf } from '../lib/assignment';
import { checkRoster, docketMatches, phoneMatches, readRoster, rosterTemplate, type RosterRow } from '../lib/rosterImport';
import { downloadDocketPdfs, when } from '../lib/docketPdf';
import { downloadRows } from '../lib/importExport';
import { formFor } from '../lib/docketForms';
import { addDays, periodDays, periodStart, weekday } from '../lib/forms';
import { usePeriodSettings } from '../lib/appSettings';
import { EditOnly, errText, Page, refLabel, todayIso, useRows, useToast } from '../components/ui';
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
  const trucks = useRows('trucks'); const customers = useRows('customers');
  const phonePeople = usePhonePeople();
  const [q, setQ] = useState('');
  const [upload, setUpload] = useState<{ file: string; rows: RosterRow[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [which, setWhich] = useState<'all' | 'completed' | 'incomplete'>('all');
  const fileRef = useRef<HTMLInputElement>(null);
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
  // search: crew phone number, truck rego or unit, driver name, docket number
  const lists = { trucks, people, phones };
  const hit = (d: Row) => docketMatches(q, d, lists, phonePeople(d.assigned_phone_id));
  const shownPhones = q.trim() ? phones.filter(w => phoneMatches(q, w, phonePeople(w.id)) || inWeek.some(d => d.assigned_phone_id === w.id && hit(d))) : phones;
  const phoneWhole = (w: Row) => !q.trim() || phoneMatches(q, w, phonePeople(w.id));
  const cell = (phoneId: string | null, day: string) => inWeek.filter(d => (d.assigned_phone_id ?? null) === phoneId && docketDay(d) === day)
    .filter(d => !q.trim() || hit(d) || (phoneId !== null && phoneWhole(phones.find(w => w.id === phoneId)!)))
    .sort((a, b) => Number(a.docket_no ?? 0) - Number(b.docket_no ?? 0));
  const chip = (d: Row) => (
    <button key={d.id} className={'roster-chip stage-' + stageOf(d) + (sel?.id === d.id ? ' on' : '') + (q.trim() && hit(d) ? ' match' : '')} onClick={() => setSel(d)} title={STAGE_LABEL[stageOf(d)]}>
      <b>{d.docket_no}</b> {formFor(d.form_type).label.split(' ')[0]}
      <small>{refLabel('locations', locations, d.location_id) || ' '}</small>
      <small>{STAGE_LABEL[stageOf(d)]}{(d.assigned_person_ids ?? []).length ? ' · ' + (d.assigned_person_ids ?? []).map((id: string) => people.find(p => p.id === id)?.full_name?.split(' ')[0]).join(', ') : ''}</small>
    </button>);
  const go = (n: number) => setParams({ start: addDays(start, n * 7) });

  // ---------- upload a roster from Excel ----------
  const rosterLists = { phones, trucks, people, customers, locations };
  const getTemplate = () => XLSX.writeFile(rosterTemplate(rosterLists), 'Coho-Drive-roster-template.xlsx');
  const onFile = async (f?: File | null) => {
    if (!f) return;
    try { setUpload({ file: f.name, rows: checkRoster(await readRoster(f), rosterLists) }); }
    catch (e) { toast.show('Could not read that file: ' + errText(e), 'err'); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const good = upload?.rows.filter(r => r.docket) ?? [];
  const createAll = async () => {
    if (!good.length) return;
    setBusy('Creating dockets...');
    let made = 0; const failed: string[] = [];
    for (const r of good) {
      try { await backend().save('dockets', r.docket!); made++; } catch (e) { failed.push(`Row ${r.line}: ${errText(e)}`); }
    }
    if (good.some(r => r.docket!.assigned_phone_id)) backend().kickTexts?.();
    setBusy(''); setUpload(null); await load();
    toast.show(failed.length ? `${made} dockets created. Not created: ${failed.join('; ')}` : `${made} dockets created from the roster`, failed.length ? 'err' : 'ok');
  };

  // ---------- download this week's dockets ----------
  const done = (d: Row) => ['to_review', 'completed', 'reviewed'].includes(stageOf(d));
  const picked = inWeek.filter(d => (which === 'all' || (which === 'completed') === done(d)) && (!q.trim() || hit(d)))
    .sort((a, b) => String(docketDay(a)).localeCompare(String(docketDay(b))) || Number(a.docket_no ?? 0) - Number(b.docket_no ?? 0));
  const scope = `${which === 'all' ? 'all' : which}-${days[0]}`;
  const toExcel = async () => {
    const loads = await backend().list('loads');
    downloadRows(picked.map(d => ({
      'Docket No.': d.docket_no, Date: docketDay(d), Shift: d.extras?.roster_shift ?? '', Form: formFor(d.form_type).label, Department: d.department ?? '',
      Customer: refLabel('customers', customers, d.customer_id), Rig: refLabel('locations', locations, d.location_id), Truck: refLabel('trucks', trucks, d.truck_id),
      'Crew phone': phones.find(w => w.id === d.assigned_phone_id)?.phone ?? '', Drivers: (d.assigned_person_ids ?? []).map((id: string) => people.find(p => p.id === id)?.full_name).join(', '),
      Status: STAGE_LABEL[stageOf(d)], Started: d.start_at ? when(d.start_at) : '', Finished: d.end_at ? when(d.end_at) : '',
      Loads: loads.filter(l => l.docket_id === d.id).length, 'Project no': d.project_no ?? '', PO: d.po ?? '',
    })), 'roster-dockets-' + scope, 'xlsx');
  };
  const toPdfs = async () => {
    if (!picked.length) return;
    setBusy(`Making ${picked.length} PDF${picked.length > 1 ? 's' : ''}...`);
    try {
      const [loads, signoffs] = await Promise.all([backend().list('loads'), backend().list('signoffs')]);
      const name = await downloadDocketPdfs(picked, id => loads.filter(l => l.docket_id === id), id => signoffs.find(x => x.docket_id === id),
        { customers, locations, trucks, people, work_phones: phones }, 'roster-dockets-' + scope);
      toast.show('Downloaded ' + name);
    } catch (e) { toast.show(errText(e), 'err'); }
    setBusy('');
  };

  return (
    <Page title="Roster" howTo={<ol>
      <li>Each row is a crew phone, each column a day ({weekday(days[0])} to {weekday(days[6])}). Dockets show where they are up to: assigned, in progress, completed, reviewed.</li>
      <li>Tap <b>+</b> in a cell to make a docket for that phone and day. It is assigned straight away and the phone gets a text.</li>
      <li>Tap a docket to <b>Assign</b>, use <b>Docket reassignment</b> to move it to another crew phone, or <b>Cancel docket assignment</b>. The phones concerned get a text.</li>
      <li>Dockets not assigned yet are in the bottom row.</li>
      <li>Completed dockets go to the department's supervisors to review (Home &gt; Dockets to review).</li>
      <li><b>Search crews</b> by truck rego or unit number, driver name or mobile number. Matching dockets are outlined in red.</li>
      <li><b>Roster template</b> downloads the Excel template (its Lists sheet shows the phones, trucks, drivers, customers, rigs and forms it accepts). Fill in one row per docket and use <b>Upload roster</b>. Every row is checked first; nothing is created until you press <b>Create</b>.</li>
      <li><b>Download</b> this week's dockets (all, completed or not completed, and only the ones matching your search) as an Excel list or as PDFs (one PDF per docket, in a zip).</li>
    </ol>}>
      <div className="row">
        <button className="small" onClick={() => go(-1)} aria-label="Previous week">Previous</button>
        <b>{weekday(days[0]).slice(0, 3)} {days[0]} to {weekday(days[6]).slice(0, 3)} {days[6]}</b>
        <button className="small" onClick={() => go(1)} aria-label="Next week">Next</button>
        <button className="small" onClick={() => setParams({})}>This week</button>
      </div>

      <div className="roster-tools">
        <label className="field"><span className="field-label">Search crews</span>
          <input type="search" placeholder="Rego, unit, driver or mobile number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search crews" /></label>
        <label className="field"><span className="field-label">Download</span>
          <select value={which} onChange={e => setWhich(e.target.value as typeof which)} aria-label="Which dockets to download">
            <option value="all">All this week</option><option value="completed">Completed this week</option><option value="incomplete">Not completed this week</option></select></label>
        <button className="small" disabled={!picked.length} onClick={toExcel}>Excel ({picked.length})</button>
        <button className="small" disabled={!picked.length || !!busy} onClick={toPdfs}>PDFs ({picked.length})</button>
        <EditOnly>
          <button className="small" onClick={getTemplate}>Roster template</button>
          <label className="button small">Upload roster<input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden aria-label="Upload roster" onChange={e => onFile(e.target.files?.[0])} /></label>
        </EditOnly>
      </div>
      {busy && <p className="note" role="status">{busy}</p>}

      {upload && <div className="subform roster-upload">
        <div className="row spread"><b>{upload.file}: {upload.rows.length} rows, {good.length} ready{upload.rows.length - good.length ? `, ${upload.rows.length - good.length} with problems` : ''}</b>
          <span className="row"><button className="primary" disabled={!good.length || !!busy} onClick={createAll}>Create {good.length} docket{good.length === 1 ? '' : 's'}</button>
            <button className="small" onClick={() => setUpload(null)}>Cancel</button></span></div>
        {good.some(r => r.docket!.assigned_phone_id) && <p className="note">Each crew phone named in the roster gets a text when its dockets are created.</p>}
        {upload.rows.length > good.length && <p className="note">Rows with problems are not created. Fix them in the spreadsheet and upload it again, or create only the rows that are ready.</p>}
        <div className="table-wrap"><table>
          <thead><tr><th>Row</th><th>Docket</th><th>Problems</th></tr></thead>
          <tbody>{upload.rows.map(r => <tr key={r.line}><td>{r.line}</td><td>{r.summary}</td><td className={r.errors.length ? 'err' : ''}>{r.errors.join('; ') || 'Ready'}</td></tr>)}
            {!upload.rows.length && <tr><td colSpan={3} className="muted">No rows found. Use the Roster template.</td></tr>}</tbody></table></div>
      </div>}

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
          {shownPhones.map(w => <tr key={w.id}>
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
