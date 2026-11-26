import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Access } from '../lib/permissions';
import { backend, type Row } from '../lib/backend';
import { TABLES, type Field, type TableName } from '../lib/schema';

// ---------- date helpers (datetime-local inputs work in local time) ----------
export function toLocalInput(iso?: string | null, dateOnly = false): string {
  if (!iso) return '';
  if (dateOnly) return String(iso).slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null { return v ? new Date(v).toISOString() : null; }
export function fmt(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
/** 24-hour time only, e.g. 18:30. */
export function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
/** Tidy typed times into 24-hour HH:MM: "630" -> "06:30", "18.5" -> null, "1830" -> "18:30", "7" -> "07:00". */
export function normTime(v: string): string | null {
  const t = v.trim().replace(/[.\s]/g, ':');
  let h: number, m: number;
  if (/^\d{1,2}$/.test(t)) { h = +t; m = 0; }
  else if (/^\d{3,4}$/.test(t)) { h = +t.slice(0, t.length - 2); m = +t.slice(-2); }
  else { const x = /^(\d{1,2}):(\d{2})$/.exec(t); if (!x) return null; h = +x[1]; m = +x[2]; }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** A time box that always works in 24-hour time, whatever the phone's settings. */
export function Time24({ id, value, onChange, disabled }: { id: string; value?: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value ?? '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value ?? ''); setBad(false); }, [value]);
  return <input id={id} type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} className={'time24' + (bad ? ' bad' : '')} disabled={disabled}
    aria-invalid={bad} title="24-hour time, e.g. 06:30 or 18:45" value={text}
    onChange={e => { setText(e.target.value); const n = normTime(e.target.value); if (n && e.target.value.length >= 4) { setBad(false); onChange(n); } }}
    onBlur={() => { if (!text) { setBad(false); onChange(null); return; } const n = normTime(text); setBad(!n); if (n) { setText(n); onChange(n); } }} />;
}
/** Date and 24-hour time, stored as one timestamp. */
export function DateTime24({ id, value, onChange }: { id: string; value?: string | null; onChange: (v: string | null) => void }) {
  const local = toLocalInput(value);
  const [date, setDate] = useState(local.slice(0, 10));
  const [time, setTime] = useState<string | null>(local.slice(11, 16) || null);
  useEffect(() => { const l = toLocalInput(value); setDate(l.slice(0, 10)); setTime(l.slice(11, 16) || null); }, [value]);
  const push = (d: string, t: string | null) => { if (!d) { onChange(null); return; } if (t) onChange(new Date(`${d}T${t}`).toISOString()); };
  return (
    <span className="row datetime24">
      <input id={id} type="date" value={date} onChange={e => { setDate(e.target.value); push(e.target.value, time ?? (e.target.value ? '00:00' : null)); }} />
      <Time24 id={id + '-time'} value={time} onChange={t => { setTime(t); if (date) push(date, t); }} />
      <button type="button" className="small" onClick={() => onChange(nowIso())}>Now</button>
    </span>);
}
export const nowIso = () => new Date().toISOString();
/** Today's date on this device (not UTC, so 6am in Roma is still today). */
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- reference lookups (cached per table) ----------
const refCache: Partial<Record<TableName, Promise<Row[]>>> = {};
export function clearRefCache() { for (const k of Object.keys(refCache)) delete refCache[k as TableName]; }
export function useRows(table: TableName, deps: unknown[] = []) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    (refCache[table] ??= backend().list(table).catch(() => [])).then(r => { if (live) setRows(r); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
  return rows;
}
export function refLabel(table: TableName, rows: Row[], id?: string | null) {
  if (!id) return '';
  const r = rows.find(x => x.id === id);
  return r ? TABLES[table].display(r) : '';
}

// ---------- one input for any field type ----------
export function FieldInput({ field, value, onChange }: { field: Field; value: any; onChange: (v: any) => void }) {
  const refRows = useRows(field.optionsFrom?.table ?? field.ref ?? 'integrations');
  const readOnly = useReadOnly();
  const id = 'f-' + field.name;
  let input: ReactNode;
  switch (field.type) {
    case 'textarea': input = <textarea id={id} value={value ?? ''} onChange={e => onChange(e.target.value)} rows={3} />; break;
    case 'number': input = <input id={id} type="number" inputMode="decimal" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />; break;
    case 'date': input = <input id={id} type="date" value={toLocalInput(value, true)} onChange={e => onChange(e.target.value || null)} />; break;
    case 'datetime': input = <DateTime24 id={id} value={value} onChange={onChange} />; break;
    case 'time': input = <Time24 id={id} value={value} onChange={onChange} />; break;
    case 'multi': {
      const cur: string[] = Array.isArray(value) ? value : [];
      input = (
        <span className="chips" id={id} role="group" aria-label={field.label}>
          {(field.options ?? []).map(o => {
            const on = cur.includes(o);
            return <label key={o} className={'chip-toggle' + (on ? ' on' : '')}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? cur.filter(x => x !== o) : [...cur, o])} />{o}</label>;
          })}
        </span>); break;
    }
    case 'bool': input = <input id={id} type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />; break;
    case 'select': {
      const from = field.optionsFrom;
      const opts = from && refRows.length
        ? refRows.filter(r => r.active !== false || r[from.value] === value).map(r => ({ v: String(r[from.value]), l: String(r[from.label] ?? r[from.value]) }))
        : field.options!.map(o => ({ v: o, l: o }));
      input = (
      <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">(none)</option>
        {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>); break;
    }
    case 'ref': input = (
      <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">(none)</option>
        {refRows.map(r => <option key={r.id} value={r.id}>{TABLES[field.ref!].display(r) || r.id}</option>)}
      </select>); break;
    case 'phone': input = <input id={id} type="tel" inputMode="tel" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder="0400 000 000" />; break;
    case 'email': input = <input id={id} type="email" value={value ?? ''} onChange={e => onChange(e.target.value)} />; break;
    default: input = <input id={id} type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
  return (
    <label className={'field ' + (field.type === 'bool' ? 'field-bool' : '')} htmlFor={id}>
      <span className="field-label">{field.label}</span>
      {readOnly ? <fieldset disabled className="ro">{input}</fieldset> : input}
      {field.help && <small className="help">{field.help}</small>}
    </label>
  );
}

export function FieldGrid({ fields, value, onChange }: { fields: Field[]; value: Row; onChange: (r: Row) => void }) {
  return (
    <div className="grid">
      {fields.map(f => <FieldInput key={f.name} field={f} value={value[f.name]} onChange={v => onChange({ ...value, [f.name]: v })} />)}
    </div>
  );
}

// ---------- table of rows ----------
export function DataTable({ table, rows, onOpen, columns }: { table: TableName; rows: Row[]; onOpen?: (r: Row) => void; columns?: string[] }) {
  const def = TABLES[table];
  const cols = def.fields.filter(f => !f.hideInTable && (!columns || columns.includes(f.name)));
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(c => <th key={c.name}>{c.label}</th>)}{onOpen && <th />}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              {cols.map(c => <td key={c.name}><Cell field={c} value={r[c.name]} /></td>)}
              {onOpen && <td><button className="small" onClick={() => onOpen(r)}>Open</button></td>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length + 1} className="muted">No records yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
function Cell({ field, value }: { field: Field; value: any }) {
  const refRows = useRows(field.ref ?? 'integrations');
  if (value === null || value === undefined || value === '') return <span className="muted">-</span>;
  if (field.type === 'ref') return <>{refLabel(field.ref!, refRows, value) || String(value).slice(0, 8)}</>;
  if (field.type === 'datetime') return <>{fmt(value)}</>;
  if (field.type === 'bool') return <>{value ? 'Yes' : 'No'}</>;
  return <>{String(value)}</>;
}

// ---------- page furniture ----------
export function Page({ title, howTo, children, actions }: { title: string; howTo?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head"><h1>{title}</h1><div className="row">{actions}</div></header>
      {howTo && <HowTo>{howTo}</HowTo>}
      {children}
    </section>
  );
}
export function HowTo({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="howto">
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide how to' : 'How to use this screen'}</button>
      {open && <div className="howto-body">{children}</div>}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setMsg({ text, kind }); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  };
  const node = msg ? <div role="status" className={'toast ' + msg.kind}>{msg.text}</div> : null;
  return { show, node };
}

export function errText(e: unknown) { return e instanceof Error ? e.message : (e as any)?.message ?? String(e); }

// ---------- signature pad ----------
export function SignaturePad({ value, onChange }: { value?: string | null; onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = value; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (ref.current!.width / r.width), (e.clientY - r.top) * (ref.current!.height / r.height)]; };
  return (
    <div>
      <canvas ref={ref} width={600} height={180} className="sig"
        onPointerDown={e => { drawing.current = true; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={e => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(ref.current!.toDataURL('image/png')); }}
        onPointerLeave={() => { if (drawing.current) { drawing.current = false; onChange(ref.current!.toDataURL('image/png')); } }} />
      <button type="button" className="small" onClick={() => { const c = ref.current!; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); onChange(null); }}>Clear signature</button>
    </div>
  );
}

// ---------- QR scanning: camera where the browser supports it, typing otherwise ----------
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState('');
  const supported = useMemo(() => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia, []);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null; let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current!.srcObject = stream; await video.current!.play();
        const det = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const codes = await det.detect(video.current!).catch(() => []);
          if (codes[0]?.rawValue) { onResult(codes[0].rawValue); setOn(false); break; }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) { setErr(errText(e)); setOn(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="qr">
      {supported
        ? <button type="button" onClick={() => setOn(!on)}>{on ? 'Stop camera' : 'Scan truck QR code'}</button>
        : <p className="muted">This browser cannot scan QR codes. Type the code or pick the truck below.</p>}
      {on && <video ref={video} className="qr-video" muted playsInline />}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

// ---------- access: hidden / read only / edit ----------
const ReadOnlyCtx = createContext(false);
export const useReadOnly = () => useContext(ReadOnlyCtx);

/** Makes part of a screen read only (e.g. a form once it is submitted). */
export function ReadOnlyArea({ on, children }: { on: boolean; children: ReactNode }) {
  const outer = useReadOnly();
  return <ReadOnlyCtx.Provider value={outer || on}>{children}</ReadOnlyCtx.Provider>;
}

/** Shows children only when the current screen is editable for this role. */
export function EditOnly({ children }: { children: ReactNode }) {
  return useReadOnly() ? null : <>{children}</>;
}

/** Wraps a screen: hidden = "not available" message, read = everything shown but nothing can be changed. */
export function Guard({ access, children }: { access: Access; children: ReactNode }) {
  if (access === 'hidden') return (
    <section className="page narrow">
      <h1>Not available</h1>
      <p>Your role does not have access to this screen. If you need it, ask an admin to change your role's access in <b>Settings</b>.</p>
      <Link className="button" to="/">Back to home</Link>
    </section>
  );
  return (
    <ReadOnlyCtx.Provider value={access === 'read'}>
      {access === 'read' && <p className="note readonly-note" role="status">Read only: your role can view this screen but not change it.</p>}
      {children}
    </ReadOnlyCtx.Provider>
  );
}
