import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { simpleForm } from '../lib/forms';
import { EditOnly, errText, FieldGrid, FieldInput, fmt, nowIso, Page, ReadOnlyArea, SignaturePad, useToast } from '../components/ui';
import { ImageFiles, LinesEditor } from '../components/forms';
import { useAccess } from '../state';

const isConflict = (e: unknown) => (e as any)?.code === '40001' || /changed on another device/i.test(errText(e));

// Expense reimbursement and the land pre-inspection / fire risk checklist (and any later simple form).
export default function FormPage() {
  const { id } = useParams() as { id: string };
  const nav = useNavigate();
  const toast = useToast();
  const can = useAccess();
  const approver = can.edit('approvals');
  const [sub, setSub] = useState<Row | null>(null);
  const [files, setFiles] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [missing, setMissing] = useState(false);
  const version = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const quietUntil = useRef(0);

  const loadFiles = useCallback(async () => setFiles(await backend().list('form_files', { submission_id: id }, { column: 'created_at' })), [id]);
  const load = useCallback(async () => {
    const s = await backend().get('form_submissions', id);
    if (!s) { setMissing(true); return; }
    version.current = s.version; setSub(s); setDirty(false); setNotice('');
    await loadFiles();
  }, [id, loadFiles]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const stop = backend().watch([{ table: 'form_submissions', column: 'id', value: id }, { table: 'form_files', column: 'submission_id', value: id }], (table, r) => {
      if (table === 'form_files') { loadFiles(); return; }
      if (r?.version !== undefined && r.version === version.current) return;
      if (Date.now() < quietUntil.current) return;
      if (dirtyRef.current) setNotice('Someone just changed this form on another device. Reload to see their changes. Your unsaved changes here will be lost.');
      else { load(); toast.show('Updated with changes from another device'); }
    });
    const onBack = () => { if (document.visibilityState === 'visible' && !dirtyRef.current) load(); };
    document.addEventListener('visibilitychange', onBack);
    return () => { stop(); document.removeEventListener('visibilitychange', onBack); };
  }, [id, load, loadFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) return <Page title="Form"><p>This form was deleted, or you do not have access to it.</p><Link className="button" to="/forms">Back to forms</Link></Page>;
  if (!sub) return <Page title="Form"><p>Loading...</p></Page>;
  const def = simpleForm(sub.form_type);
  if (!def) return <Page title="Form"><p>Unknown form type {sub.form_type}.</p></Page>;
  const data: Row = sub.data ?? {};
  const setData = (d: Row) => { setSub({ ...sub, data: d }); setDirty(true); };
  const set = (patch: Row) => { setSub({ ...sub, ...patch }); setDirty(true); };
  const status: string = sub.status ?? 'draft';
  const locked = status === 'approved' || (status === 'submitted' && !approver);     // the owner cannot change it once sent

  const save = async (patch: Row = {}, msg = 'Saved') => {
    try {
      quietUntil.current = Date.now() + 2500;
      const saved = await backend().save('form_submissions', { ...sub, ...patch, version: version.current });
      version.current = saved.version; setSub(saved); setDirty(false); setNotice('');
      toast.show(saved.__queued ? 'Saved on this device. It will send by itself when there is signal.' : msg);
      return true;
    } catch (e) {
      if (isConflict(e)) setNotice(errText(e));
      toast.show(errText(e), 'err');
      return false;
    }
  };
  const submit = () => {
    if (!sub.signature_png) { toast.show('Please sign in the Completed by box first', 'err'); return; }
    save({ status: 'submitted', signed_at: sub.signed_at ?? nowIso() }, 'Sent for approval');
  };
  const decide = (decision: 'approved' | 'returned') => {
    if (decision === 'returned' && !sub.approver_comment) { toast.show('Add a comment saying what needs fixing', 'err'); return; }
    save({ status: decision }, decision === 'approved' ? `${def.approval.verb}d and locked` : 'Sent back with your comment');
  };

  return (
    <Page title={def.label} actions={<span className={'pill ' + status}>{status}</span>} howTo={<ol>
      <li>Same questions as the paper form ({def.ref}). Fill in what you know and tap <b>Save</b>; come back any time from <b>Forms</b>.</li>
      {def.lines && <li>Add one line per item with <b>{def.lines.addLabel}</b>. The total adds up for you.</li>}
      {def.sections.some(s => s.files) && <li>Photos save as soon as you add them. They are shrunk to keep the form quick on a phone signal.</li>}
      <li>Sign in the <b>{def.signoff.title}</b> box, then tap <b>Send for approval</b>. After that only an approver can change it.</li>
      <li>If it comes back as <b>returned</b>, read the comment, fix it and send it again.</li>
    </ol>}>
      <div className="docket-meta">
        <span>{def.ref}</span><span>Last saved {fmt(sub.updated_at ?? sub.created_at)}</span>
        {sub.signed_at && <span>Signed {fmt(sub.signed_at)}</span>}
      </div>
      {notice && <div className="note live-note" role="alert">{notice} <button className="small" onClick={() => load()}>Reload</button></div>}
      {status === 'returned' && sub.approver_comment && <div className="note" role="status"><b>Returned:</b> {sub.approver_comment}</div>}
      {dirty && !notice && <p className="unsaved" role="status">Unsaved changes</p>}

      <ReadOnlyArea on={locked}>
        <fieldset><legend>Who</legend>
          <FieldInput field={{ name: 'person_id', label: 'Person (if on the people list)', type: 'ref', ref: 'people' }} value={sub.person_id} onChange={v => set({ person_id: v })} />
          <FieldInput field={{ name: 'period_start', label: 'Date', type: 'date' }} value={sub.period_start} onChange={v => set({ period_start: v })} />
        </fieldset>
        {def.sections.map(sec => (
          <fieldset key={sec.title}><legend>{sec.title}</legend>
            {sec.help && <p className="muted">{sec.help}</p>}
            <FieldGrid fields={sec.fields} value={data} onChange={setData} />
            {sec.files && <ImageFiles submissionId={sub.id} def={sec.files} files={files} onChanged={loadFiles} locked={locked} />}
          </fieldset>
        ))}
        {def.lines && <fieldset><legend>{def.lines.title}</legend>
          <LinesEditor fields={def.lines.fields} lines={data.lines ?? []} onChange={l => setData({ ...data, lines: l })}
            addLabel={def.lines.addLabel} max={def.lines.max} totalField={def.lines.totalField} />
        </fieldset>}
        {def.code === 'expense_reimbursement' && <fieldset><legend>Receipts</legend>
          <ImageFiles submissionId={sub.id} def={{ kind: 'receipt', title: 'Receipt photos', help: 'One photo per receipt', max: 20 }} files={files} onChanged={loadFiles} locked={locked} />
        </fieldset>}
        <fieldset><legend>{def.signoff.title}</legend>
          <FieldInput field={{ name: 'signed_name', label: def.signoff.nameLabel, type: 'text' }} value={data.signed_name} onChange={v => setData({ ...data, signed_name: v })} />
          <SignaturePad key={'s' + (sub.signature_png ? 1 : 0) + sub.id} value={sub.signature_png} onChange={v => set({ signature_png: v })} />
        </fieldset>
      </ReadOnlyArea>

      {(approver || status === 'approved' || sub.approver_name) && (
        <ReadOnlyArea on={!approver || status === 'approved'}>
          <fieldset><legend>{def.approval.title}</legend>
            <FieldInput field={{ name: 'approver_name', label: def.approval.nameLabel, type: 'text' }} value={sub.approver_name} onChange={v => set({ approver_name: v })} />
            <FieldInput field={{ name: 'approver_comment', label: 'Comment', type: 'textarea' }} value={sub.approver_comment} onChange={v => set({ approver_comment: v })} />
            <SignaturePad key={'a' + (sub.approver_signature_png ? 1 : 0) + sub.id} value={sub.approver_signature_png} onChange={v => set({ approver_signature_png: v })} />
            {sub.approved_at && <p className="muted">{def.approval.verb}d {fmt(sub.approved_at)}</p>}
          </fieldset>
        </ReadOnlyArea>)}

      <div className="savebar">
        <EditOnly>
          {!locked && <button className="primary" onClick={() => save()}>Save</button>}
          {!locked && (status === 'draft' || status === 'returned') && <button onClick={submit}>Send for approval</button>}
          {approver && status === 'submitted' && <>
            <button className="primary" onClick={() => decide('approved')}>{def.approval.verb}</button>
            <button onClick={() => decide('returned')}>Return with comment</button></>}
        </EditOnly>
        <button onClick={() => load()}>Reload</button>
        <button onClick={() => nav('/forms')}>Back to forms</button>
      </div>
      {toast.node}
    </Page>
  );
}
