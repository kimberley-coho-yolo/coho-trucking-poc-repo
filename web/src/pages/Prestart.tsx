import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { EditOnly, errText, fmt, nowIso, Page, useToast } from '../components/ui';

export default function Prestart() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [shift, setShift] = useState<Row | null>(null);
  const [records, setRecords] = useState<Row[]>([]);
  const [ref, setRef] = useState('');
  const [faults, setFaults] = useState('');
  const load = async () => {
    const s = await backend().get('shifts', id!); setShift(s); setRef(s?.prestart_ref ?? '');
    if (s?.truck_id) {
      const since = Date.now() - 12 * 3.6e6;
      setRecords((await backend().list('prestart_records', { truck_id: s.truck_id })).filter(r => r.done_at && new Date(r.done_at).getTime() > since));
    }
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = async (result: 'passed' | 'failed', exit = false) => {
    if (!shift) return;
    try {
      await backend().save('shifts', { id: shift.id, prestart_status: result, prestart_ref: ref || null, last_step: 'shift' });
      if (result === 'failed') {
        await backend().save('faults', { shift_id: shift.id, truck_id: shift.truck_id, description: faults || 'Prestart failed', safe_to_run: false, status: 'open', reported_at: nowIso() });
        if (shift.truck_id) await backend().save('trucks', { id: shift.truck_id, status: 'Tagged out' }).catch(() => null);
        toast.show('Fault logged. Supervisor and HSE alert is simulated in the PoC.', 'err');
      }
      nav(exit ? '/' : '/shift/' + shift.id);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const found = records.find(r => r.result === 'passed');
  return (
    <Page title="Prestart" howTo={<ol>
      <li>Tap <b>Open Gearbox Prestart</b> and do the prestart there as usual.</li>
      <li>Come back to this screen. If a passed prestart for this truck shows below, tap <b>Use this prestart</b>.</li>
      <li>Until the Gearbox link is built, you can also mark the prestart yourself and type the Gearbox reference.</li>
      <li>If it failed, type the faults and tap <b>Prestart failed</b>. The truck is tagged out.</li>
    </ol>}>
      <p><a className="button" href="https://apps.apple.com/au/app/gearbox-prestart/id1253736049" target="_blank" rel="noreferrer">Open Gearbox Prestart</a>
        <span className="muted"> (the direct hand-off is to be tested with Gearbox)</span></p>
      <h2>Prestarts for this truck in the last 12 hours</h2>
      {records.length ? <ul>{records.map(r => <li key={r.id}>{fmt(r.done_at)} · <b>{r.result}</b> · {r.driver_name ?? ''} · {r.gearbox_ref ?? ''}</li>)}</ul>
        : <p className="muted">None found. Gearbox results arrive here once the integration is built, or when the office uploads a prestart spreadsheet.</p>}
      {found && <EditOnly><button className="primary" onClick={() => { setRef(found.gearbox_ref ?? ''); mark('passed'); }}>Use this prestart</button></EditOnly>}
      <div className="grid">
        <label className="field"><span className="field-label">Gearbox prestart reference</span><input value={ref} onChange={e => setRef(e.target.value)} /></label>
        <label className="field"><span className="field-label">Faults found (if failed)</span><textarea value={faults} onChange={e => setFaults(e.target.value)} /></label>
      </div>
      <div className="savebar">
        <EditOnly><button className="primary" onClick={() => mark('passed')}>Prestart passed</button>
        <button className="danger" onClick={() => mark('failed')}>Prestart failed</button></EditOnly>
        <button onClick={() => nav('/')}>Save and exit</button>
      </div>
      {toast.node}
    </Page>
  );
}
