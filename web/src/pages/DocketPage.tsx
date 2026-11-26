import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { TABLES } from '../lib/schema';
import { applyRowRules, COMMON_FIELDS, formFor, FORMS, fromView, shiftFields, shiftKey, sortRows, TIME_FIELDS, toView } from '../lib/docketForms';
import { DEPARTMENT_EXTRAS } from '../lib/extras';
import { EditOnly, errText, FieldGrid, FieldInput, fmt, nowIso, Page, SignaturePad, useReadOnly, useToast } from '../components/ui';
import { ClonePanel, RowsBlock } from '../components/docket';
import { AssignmentBox } from '../components/assign';
import { useAccess, useApp } from '../state';
import { isLong } from '../lib/timesheetSync';
import { hoursBetween } from '../lib/timesheet';

const isConflict = (e: unknown) => (e as any)?.code === '40001' || /changed on another device/i.test(errText(e));

export default function DocketPage() {
  const { id } = useParams() as { id: string };
  const nav = useNavigate();
  const toast = useToast();
  const can = useAccess();
  const { person } = useApp();
  const readOnly = useReadOnly();
  const office = can.edit('all_work');                    // office, supervisors, admin: assign drivers, change form, clone

  const [d, setD] = useState<Row | null>(null);           // the docket as one flat object (columns + extras)
  const [rows, setRows] = useState<Row[]>([]);
  const [row, setRow] = useState<Row | null>(null);       // row being edited
  const [sign, setSign] = useState<Row>({});
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ text: string; conflict?: boolean } | null>(null);
  const [missing, setMissing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [myShift, setMyShift] = useState<Row | null>(null);
  const version = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const quietUntil = useRef(0);                           // ignore the echo of our own saves
  const quiet = () => { quietUntil.current = Date.now() + 2500; };

  const loadRows = useCallback(async () => setRows(sortRows(await backend().list('loads', { docket_id: id }))), [id]);
  const loadAll = useCallback(async () => {
    const x = await backend().get('dockets', id);
    if (!x) { setMissing(true); return; }
    setMissing(false);
    version.current = x.version;
    setD(toView(x));
    await loadRows();
    const s = (await backend().list('signoffs', { docket_id: id }))[0];
    setSign(s ?? { docket_id: id });
    setDirty(false); setNotice(null);
  }, [id, loadRows]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // Live updates: a change on any other device reloads this screen (or warns, if you have unsaved changes here).
  useEffect(() => {
    const stop = backend().watch([
      { table: 'dockets', column: 'id', value: id }, { table: 'loads', column: 'docket_id', value: id }, { table: 'signoffs', column: 'docket_id', value: id },
    ], (table, r) => {
      if (table === 'loads') { loadRows(); return; }
      if (table === 'dockets' && r?.version !== undefined && r.version === version.current) return;
      if (Date.now() < quietUntil.current) return;
      if (dirtyRef.current) setNotice({ text: 'Someone just changed this docket on another device. Reload to see their changes. Your unsaved changes here will be lost.' });
      else { loadAll(); toast.show('Updated with changes from another device'); }
    });
    // coming back to the app (phone unlocked, tab switched back): get the latest copy
    const onBack = () => { if (document.visibilityState === 'visible' && !dirtyRef.current) loadAll(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => { stop(); document.removeEventListener('visibilitychange', onBack); window.removeEventListener('focus', onBack); };
  }, [id, loadAll, loadRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // a driver with an open shift can add an office-prepared docket to it
  useEffect(() => {
    if (!person || !d || d.shift_id) { setMyShift(null); return; }
    backend().list('shifts', { driver_id: person.id }).then(s => setMyShift(s.find(x => x.status === 'open' || x.status === 'draft') ?? null)).catch(() => null);
  }, [person, d?.shift_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) return <Page title="Docket"><p>This docket was deleted, or it is not assigned to you.</p><Link className="button" to="/">Back to home</Link></Page>;
  if (!d) return <Page title="Docket"><p>Loading...</p></Page>;
  const form = formFor(d.form_type);
  const upd = (v: Row) => { setD(v); setDirty(true); };
  const updSign = (v: Row) => { setSign(v); setDirty(true); };
  const deptExtras = form.code === 'general' ? (DEPARTMENT_EXTRAS[d.department ?? ''] ?? []) : [];

  const save = async (opts: { exit?: boolean; close?: boolean; extra?: Row } = {}) => {
    try {
      const body = fromView({ ...d, ...opts.extra, last_step: 'docket' }, 'dockets');
      body.version = version.current;
      if (opts.close) { body.status = 'closed'; body.end_at = d.end_at ?? nowIso(); }
      else if (body.status === 'draft' && d.shift_id) body.status = 'open';
      quiet();
      const saved = await backend().save('dockets', body);
      version.current = saved.version;
      if (sign.client_name || sign.signature_png || sign.po || sign.id) {
        const s = await backend().save('signoffs', { ...sign, docket_id: d.id, signed_at: sign.signed_at ?? (sign.signature_png ? nowIso() : null) });
        setSign(s);
      }
      setD(toView(saved)); setDirty(false); setNotice(null);
      toast.show(saved.__queued ? (opts.close ? 'Docket closed on this device. It will send by itself when there is signal, then your timesheet updates.' : 'Saved on this device. It will send by itself when there is signal.')
        : opts.close ? 'Docket closed. Your timesheet for this day is updated.' : 'Saved. Everyone with this docket open now sees it.');
      if (opts.exit) nav(office ? '/dockets' : '/');
      else if (opts.close && d.shift_id) nav('/shift/' + d.shift_id);
    } catch (e) {
      if (isConflict(e)) setNotice({ text: errText(e), conflict: true });
      toast.show(errText(e), 'err');
    }
  };

  const saveRow = async () => {
    if (!row) return;
    try {
      const body = fromView({ ...row, docket_id: d.id, sort: row.sort ?? rows.length }, 'loads');
      const savedRow = await backend().save('loads', body);
      setRow(null); await loadRows(); toast.show(savedRow.__queued ? 'Row saved on this device. It will send when there is signal.' : 'Row saved');
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const deleteRow = async () => {
    if (!row?.id || !window.confirm('Delete this row?')) return;
    try { await backend().remove('loads', row.id); setRow(null); await loadRows(); } catch (e) { toast.show(errText(e), 'err'); }
  };
  const rowsBlock = (shift?: number) => (
    <RowsBlock form={form} rows={shift ? rows.filter(r => Number(r.extras?.shift ?? 1) === shift) : rows}
      editing={row && (!shift || Number(row.shift ?? 1) === shift) ? row : null}
      onOpen={r => setRow(toView(r))} onAdd={() => setRow({ shift: shift ?? null, ...(form.code === 'general' ? { depart_at: nowIso() } : {}) })}
      onChange={v => setRow(applyRowRules(form, row ?? {}, v))} onSave={saveRow} onCancel={() => setRow(null)} onDelete={deleteRow} />
  );

  const signFields = TABLES.signoffs.fields.filter(f => f.name !== 'signed_at')
    .map(f => f.name === 'client_name' && form.signoff ? { ...f, label: form.signoff.nameLabel } : f);

  return (
    <Page title={form.label} actions={<span className={'pill ' + (d.status ?? 'draft')}>{d.status ?? 'draft'}</span>} howTo={<ol>
      <li>This screen follows the paper form{form.ref ? <> (<b>{form.ref}</b>)</> : null}. Every field is optional: fill in what you know and <b>Save</b>.</li>
      <li>Add one row per load, hour or line with <b>{form.rows.addLabel}</b>, then <b>Save row</b>. Totals add up underneath.</li>
      {form.shifts && <li>Each shift has its own operator, notes, fuel and loads.</li>}
      <li>Changes reach every phone and computer with this docket open. If someone else saves while you are typing, you are asked to reload so nothing is overwritten.</li>
      {office && <li><b>Drivers on this docket</b>: tick who should see it on their phone. <b>Clone</b> makes a copy for another day.</li>}
      <li><b>Close docket</b> when the job is finished.</li>
    </ol>}>
      <div className="docket-meta">
        <span><b>Docket No.</b> {d.docket_no ?? '(new)'}</span>
        {form.ref && <span>{form.ref}</span>}
        <span>Last saved {fmt(d.updated_at ?? d.created_at)}</span>
        {d.__queued && <Link to="/outbox" className="pill draft">Not sent yet</Link>}
        {d.cloned_from && <Link to={'/docket/' + d.cloned_from}>Copied from an earlier docket</Link>}
        {d.shift_id && <Link to={'/shift/' + d.shift_id}>Open the shift</Link>}
        {person && (d.work_date || d.start_at) && <Link to={`/forms/timesheet?person=${person.id}&start=${d.work_date ?? String(d.start_at).slice(0, 10)}`}>My timesheet</Link>}
      </div>
      {notice && <div className="note live-note" role="alert">{notice.text} <button className="small" onClick={() => loadAll()}>Reload</button></div>}
      {dirty && !notice && <p className="unsaved" role="status">Unsaved changes</p>}

      {!d.shift_id && myShift && !readOnly && <div className="note">This docket is not on a shift yet.
        <button className="small" onClick={() => save({ extra: { shift_id: myShift.id, status: 'open', start_at: d.start_at ?? nowIso() } }).then(() => loadAll())}>Add it to my open shift</button></div>}

      {d.review_status === 'returned' && <div className="note" role="alert"><b>Returned by the supervisor{d.reviewed_at ? ` (${fmt(d.reviewed_at)})` : ''}:</b> {d.review_comment || 'please check and close it again.'}</div>}
      {d.review_status === 'reviewed' && <div className="note" role="status"><b>Reviewed {fmt(d.reviewed_at)}.</b> This docket is locked{can.edit('docket_review') ? ' for drivers' : ''}.{d.review_comment ? ` Comment: ${d.review_comment}` : ''}</div>}
      {d.review_status === 'to_review' && can.edit('docket_review') && <fieldset className="review-box"><legend>Review this completed docket</legend>
        <label className="field"><span className="field-label">Comment (needed to return it)</span>
          <textarea value={d.review_comment ?? ''} onChange={e => upd({ ...d, review_comment: e.target.value })} rows={2} /></label>
        <div className="row">
          <button className="primary" onClick={() => save({ extra: { review_status: 'reviewed' } })}>Mark reviewed</button>
          <button onClick={() => { if (!d.review_comment) { toast.show('Add a comment saying what to fix', 'err'); return; } save({ extra: { review_status: 'returned' } }); }}>Return to driver</button>
        </div>
        <small className="help">Completed {fmt(d.completed_at)}. Reviewed dockets are locked for drivers.</small>
      </fieldset>}
      <fieldset><legend>Assigned to</legend>
        <AssignmentBox docket={{ ...fromView(d, 'dockets'), version: version.current }} blocked={dirty ? 'Save your changes first, then you can reassign.' : undefined}
          onSaved={() => loadAll()} />
      </fieldset>
      <fieldset><legend>Docket</legend>
        {office && !readOnly && <label className="field" htmlFor="f-form_type"><span className="field-label">Form</span>
          <select id="f-form_type" value={form.code} onChange={e => upd({ ...d, form_type: e.target.value })}>
            {FORMS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
          <small className="help">Changing the form keeps what is already filled in; fields the new form does not use are kept but hidden.</small></label>}
        <FieldGrid fields={COMMON_FIELDS} value={d} onChange={upd} />
      </fieldset>

      <fieldset><legend>{form.shifts ? 'Truck, rig and well' : 'Details'}</legend>
        <FieldGrid fields={form.header} value={d} onChange={upd} />
      </fieldset>
      {!!deptExtras.length && <fieldset><legend>{d.department} extras</legend><FieldGrid fields={deptExtras} value={d} onChange={upd} /></fieldset>}

      {form.shifts ? form.shifts.defs.map(sd => (
        <fieldset key={sd.n} className="shift-block"><legend>{sd.label}</legend>
          <div className="grid">
            <FieldInput field={{ name: shiftKey(sd.n, 'band'), label: 'Shift time', type: 'select', options: sd.bands }} value={d[shiftKey(sd.n, 'band')]}
              onChange={v => upd({ ...d, [shiftKey(sd.n, 'band')]: v })} />
          </div>
          <FieldGrid fields={shiftFields(form, sd.n)} value={d} onChange={upd} />
          <h3>{form.rows.label}</h3>
          {rowsBlock(sd.n)}
        </fieldset>
      )) : <fieldset><legend>{form.rows.label}</legend>{rowsBlock()}</fieldset>}

      {!!form.footer.length && <fieldset><legend>{form.footerTitle ?? 'More'}</legend><FieldGrid fields={form.footer} value={d} onChange={upd} /></fieldset>}
      <fieldset><legend>Times (used for timesheets and km)</legend><FieldGrid fields={TIME_FIELDS} value={d} onChange={upd} />
        {isLong(d.start_at, d.end_at, d.over_24h) && <p className="note"><span className="pill long">24 h+</span> This shift runs from {fmt(d.start_at)} to {fmt(d.end_at)} ({hoursBetween(d.start_at, d.end_at).toFixed(1)} hours). Its hours are split across each day on the timesheet{!d.over_24h ? ', even though the box is not ticked' : ''}.</p>}
      </fieldset>

      {form.signoff && <fieldset><legend>{form.signoff.title}</legend>
        <FieldGrid fields={signFields} value={sign} onChange={updSign} />
        <SignaturePad key={sign.id ?? 'new'} value={sign.signature_png} onChange={v => updSign({ ...sign, signature_png: v })} />
        {sign.signed_at && <p className="muted">Signed at {fmt(sign.signed_at)}</p>}
      </fieldset>}

      {cloning && <ClonePanel src={{ ...fromView(d, 'dockets') }} rows={rows} onCancel={() => setCloning(false)}
        onDone={newId => { setCloning(false); toast.show('Copy created'); nav('/docket/' + newId); }} />}

      <div className="savebar">
        <EditOnly>
          <button className="primary" onClick={() => save()}>Save</button>
          <button onClick={() => save({ exit: true })}>Save and exit</button>
          {d.status !== 'closed' && <button onClick={() => save({ close: true })}>Close docket</button>}
          {office && <button onClick={() => setCloning(true)} disabled={dirty} title={dirty ? 'Save first' : ''}>Clone</button>}
        </EditOnly>
        <button onClick={() => loadAll()}>Reload</button>
        {d.shift_id ? <button onClick={() => nav('/shift/' + d.shift_id)}>Back to shift</button>
          : <button onClick={() => nav(can.read('all_work') ? '/dockets' : '/')}>Back</button>}
      </div>
      {toast.node}
    </Page>
  );
}
