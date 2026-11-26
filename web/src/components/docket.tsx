// Building blocks for the docket forms: driver picker, rows table with totals, clone and new-docket panels.
import { useState } from 'react';
import type { Field } from '../lib/schema';
import { backend, type Row } from '../lib/backend';
import { cloneDocket, COMMON_FIELDS, defaultFormFor, FORMS, formFor, toView, total, type FormDef } from '../lib/docketForms';
import { EditOnly, errText, FieldGrid, FieldInput, fmt, refLabel, todayIso, useReadOnly, useRows } from './ui';
import { PhoneAndDrivers } from './assign';

/** Tick the drivers who should see this docket on their phone. */
export function PeoplePicker({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const people = useRows('people').filter(p => p.active !== false || value.includes(p.id));
  const [q, setQ] = useState('');
  const shown = people.filter(p => !q || String(p.full_name ?? '').toLowerCase().includes(q.toLowerCase()) || value.includes(p.id));
  if (disabled) return (
    <div className="field"><span className="field-label">Drivers on this docket</span>
      <div>{value.length ? value.map(id => <span key={id} className="pill chip">{people.find(p => p.id === id)?.full_name ?? 'Unknown'}</span>) : <span className="muted">None</span>}</div>
    </div>);
  return (
    <div className="field people-picker">
      <span className="field-label">Drivers on this docket</span>
      <small className="help">Ticked drivers see this docket on their phone and can fill it in.</small>
      {people.length > 8 && <input type="search" placeholder="Search names" value={q} onChange={e => setQ(e.target.value)} />}
      <div className="chips">
        {shown.map(p => {
          const on = value.includes(p.id);
          return <label key={p.id} className={'chip-toggle' + (on ? ' on' : '')}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter(x => x !== p.id) : [...value, p.id])} />
            {p.full_name}{p.department ? <small> · {p.department}</small> : null}
          </label>;
        })}
      </div>
    </div>
  );
}

function CellValue({ field, value }: { field: Field; value: any }) {
  const ref = useRows(field.ref ?? 'integrations');
  if (value === null || value === undefined || value === '') return <span className="muted">-</span>;
  if (field.type === 'ref') return <>{refLabel(field.ref!, ref, value)}</>;
  if (field.type === 'datetime') return <>{fmt(value)}</>;
  if (field.type === 'number') return <>{Number(value).toLocaleString('en-AU')}</>;
  return <>{String(value)}</>;
}

/** The rows of a form (loads, hourly log, invoice lines) as a table with totals, plus the row editor. */
export function RowsBlock({ form, rows, editing, onOpen, onAdd, onChange, onSave, onCancel, onDelete }: {
  form: FormDef; rows: Row[]; editing: Row | null;
  onOpen: (r: Row) => void; onAdd: () => void; onChange: (r: Row) => void; onSave: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const cols = form.rows.columns.map(c => form.rows.fields.find(f => f.name === c)!).filter(Boolean);
  const views = rows.map(toView);
  return (
    <div className="rows-block">
      <div className="table-wrap"><table>
        <thead><tr><th>#</th>{cols.map(c => <th key={c.name}>{c.label}</th>)}<th /></tr></thead>
        <tbody>
          {views.map((r, i) => <tr key={r.id}><td>{i + 1}</td>{cols.map(c => <td key={c.name}><CellValue field={c} value={r[c.name]} /></td>)}
            <td><button className="small" onClick={() => onOpen(rows[i])}>Open</button></td></tr>)}
          {!rows.length && <tr><td colSpan={cols.length + 2} className="muted">Nothing yet</td></tr>}
        </tbody>
        {!!rows.length && !!form.rows.totals?.length && <tfoot><tr><th>Total</th>
          {cols.map(c => <th key={c.name}>{form.rows.totals!.includes(c.name) ? total(rows, c.name).toLocaleString('en-AU') : ''}</th>)}<th /></tr></tfoot>}
      </table></div>
      {editing ? (
        <div className="subform">
          <FieldGrid fields={form.rows.fields} value={editing} onChange={onChange} />
          <div className="row">
            <EditOnly><button className="primary" onClick={onSave}>Save row</button></EditOnly>
            <button onClick={onCancel}>Cancel</button>
            <EditOnly>{editing.id && <button className="danger" onClick={onDelete}>Delete row</button>}</EditOnly>
          </div>
        </div>
      ) : <EditOnly><button onClick={onAdd}>{form.rows.addLabel}</button></EditOnly>}
    </div>
  );
}

/** Copy a docket into a new draft: same job details, new date, no signatures or measurements. */
export function ClonePanel({ src, rows, onDone, onCancel }: { src: Row; rows: Row[]; onDone: (id: string) => void; onCancel: () => void }) {
  const [opts, setOpts] = useState({ workDate: todayIso(), includeRows: false, keepDrivers: true });
  const [err, setErr] = useState('');
  const go = async () => {
    try {
      const { docket, rows: copyRows } = cloneDocket(src, rows, opts);
      const saved = await backend().save('dockets', docket);
      for (const r of copyRows) await backend().save('loads', { ...r, docket_id: saved.id });
      onDone(saved.id);
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <div className="subform" role="dialog" aria-label="Clone docket">
      <h3>Clone docket No. {src.docket_no}</h3>
      <p className="muted">Copies the form, customer, rig, well, truck, project, task and PO into a new draft. Times, signatures, fuel and km are left blank.</p>
      <div className="grid">
        <FieldInput field={{ name: 'clone_date', label: 'Date for the new docket', type: 'date' }} value={opts.workDate} onChange={v => setOpts({ ...opts, workDate: v })} />
        <FieldInput field={{ name: 'clone_rows', label: 'Also copy the rows (loads / lines)', type: 'bool' }} value={opts.includeRows} onChange={v => setOpts({ ...opts, includeRows: v })} />
        <FieldInput field={{ name: 'clone_drivers', label: 'Keep the same drivers', type: 'bool' }} value={opts.keepDrivers} onChange={v => setOpts({ ...opts, keepDrivers: v })} />
      </div>
      {err && <p className="err">{err}</p>}
      <div className="row"><button className="primary" onClick={go}>Create the copy</button><button onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/** Office / supervisor: start a new docket from one of the forms. */
export function NewDocketPanel({ onDone, onCancel, defaults }: { onDone: (id: string) => void; onCancel: () => void; defaults?: Row }) {
  const readOnly = useReadOnly();
  const [v, setV] = useState<Row>({ form_type: 'landspray_runsheet', work_date: todayIso(), assigned_person_ids: [], assigned_phone_id: null, ...(defaults ?? {}) });
  const [err, setErr] = useState('');
  const form = formFor(v.form_type);
  const go = async () => {
    try {
      const saved = await backend().save('dockets', {
        form_type: form.code, status: 'draft', work_date: v.work_date ?? null, truck_id: v.truck_id ?? null, customer_id: v.customer_id ?? null,
        location_id: v.location_id ?? null, department: v.department ?? form.departments[0] ?? null, assigned_person_ids: v.assigned_person_ids ?? [],
        assigned_phone_id: v.assigned_phone_id ?? null, extras: {},
      });
      if (v.assigned_phone_id) backend().kickTexts?.();
      onDone(saved.id);
    } catch (e) { setErr(errText(e)); }
  };
  if (readOnly) return null;
  return (
    <div className="subform" role="dialog" aria-label="New docket">
      <h3>New docket</h3>
      <div className="form-picker">
        {FORMS.map(f => <label key={f.code} className={'form-option' + (f.code === form.code ? ' on' : '')}>
          <input type="radio" name="form_type" checked={f.code === form.code} onChange={() => setV({ ...v, form_type: f.code, department: f.departments[0] ?? v.department })} />
          <b>{f.label}</b><small>{f.ref ? f.ref + ' · ' : ''}{f.summary}</small>
        </label>)}
      </div>
      <FieldGrid fields={[COMMON_FIELDS[0], COMMON_FIELDS[1], COMMON_FIELDS[2],
        { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' }, { name: 'location_id', label: 'Rig / location', type: 'ref', ref: 'locations' }]}
        value={v} onChange={setV} />
      <PhoneAndDrivers phoneId={v.assigned_phone_id ?? null} personIds={v.assigned_person_ids ?? []} onChange={(w, p) => setV({ ...v, assigned_phone_id: w, assigned_person_ids: p })} />
      <p className="muted">{v.assigned_phone_id ? 'The crew phone gets a text when you create the docket.' : 'Not assigned yet: you can assign it later from the docket or the roster.'}</p>
      {err && <p className="err">{err}</p>}
      <div className="row"><button className="primary" onClick={go}>Create docket</button><button onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

export { defaultFormFor };
