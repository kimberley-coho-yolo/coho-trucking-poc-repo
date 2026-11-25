// Building blocks for timesheets, expense claims and checklists.
import { useState } from 'react';
import type { Field } from '../lib/schema';
import { backend, type Row } from '../lib/backend';
import { shrinkImage, type FilesDef } from '../lib/forms';
import { EditOnly, errText, FieldInput, useReadOnly } from './ui';

/** Repeating lines (e.g. expense items) edited in place, with a running total. */
export function LinesEditor({ fields, lines, onChange, addLabel, max, totalField }: {
  fields: Field[]; lines: Row[]; onChange: (lines: Row[]) => void; addLabel: string; max: number; totalField?: string;
}) {
  const readOnly = useReadOnly();
  const total = totalField ? Math.round(lines.reduce((s, l) => s + (Number(l[totalField]) || 0), 0) * 100) / 100 : null;
  return (
    <div className="lines">
      {lines.map((l, i) => (
        <div key={i} className="line-row">
          <span className="line-no">{i + 1}</span>
          <div className="grid">
            {fields.map(f => <FieldInput key={f.name} field={{ ...f, name: `${f.name}-${i}` }} value={l[f.name]}
              onChange={v => onChange(lines.map((x, j) => (j === i ? { ...x, [f.name]: v } : x)))} />)}
          </div>
          <EditOnly><button className="small danger" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>Remove</button></EditOnly>
        </div>
      ))}
      {!lines.length && <p className="muted">Nothing added yet.</p>}
      {total !== null && <p className="lines-total"><b>Total:</b> ${total.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
      {!readOnly && lines.length < max && <button onClick={() => onChange([...lines, {}])}>{addLabel}</button>}
    </div>
  );
}

/** Photos and receipts: taken on the phone camera or picked from files, shrunk, saved straight away. */
export function ImageFiles({ submissionId, def, files, onChanged, locked }: {
  submissionId: string; def: FilesDef; files: Row[]; onChanged: () => void; locked: boolean;
}) {
  const readOnly = useReadOnly() || locked;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mine = files.filter(f => f.kind === def.kind);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setErr('');
    try {
      for (const file of Array.from(list).slice(0, def.max - mine.length)) {
        if (!file.type.startsWith('image/')) { setErr(`${file.name} is not a photo. Take a photo of the receipt or page instead.`); continue; }
        const data_url = await shrinkImage(file);
        await backend().save('form_files', { submission_id: submissionId, kind: def.kind, file_name: file.name, mime_type: 'image/jpeg', data_url });
      }
      onChanged();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="image-files">
      <h3>{def.title}</h3>
      <small className="help">{def.help} (up to {def.max})</small>
      <div className="thumbs">
        {mine.map(f => (
          <figure key={f.id} className="thumb">
            <a href={f.data_url} target="_blank" rel="noreferrer"><img src={f.data_url} alt={f.caption || f.file_name || def.title} /></a>
            <figcaption>{f.caption || f.file_name}</figcaption>
            {!readOnly && <button className="small danger" onClick={async () => {
              if (!window.confirm('Remove this photo?')) return;
              try { await backend().remove('form_files', f.id); onChanged(); } catch (e) { setErr(errText(e)); }
            }}>Remove</button>}
          </figure>
        ))}
        {!mine.length && <p className="muted">None yet.</p>}
      </div>
      {!readOnly && mine.length < def.max && (
        <label className="button file-button">{busy ? 'Saving...' : 'Add photos'}
          <input type="file" accept="image/*" multiple disabled={busy} onChange={e => { add(e.target.files); e.target.value = ''; }} />
        </label>)}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
