import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backend } from '../lib/backend';
import { TABLES } from '../lib/schema';
import { errText, FieldGrid, nowIso, Page, useToast } from '../components/ui';

export default function FaultPage() {
  const [q] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [row, setRow] = useState<Record<string, any>>({ shift_id: q.get('shift') || null, truck_id: q.get('truck') || null, reported_at: nowIso(), status: 'open' });
  const save = async () => {
    try {
      await backend().save('faults', row);
      if (row.safe_to_run === false && row.truck_id) await backend().save('trucks', { id: row.truck_id, status: 'Tagged out' }).catch(() => null);
      toast.show('Fault saved. Supervisor and HSE alert is simulated in the PoC.');
      setTimeout(() => nav(row.shift_id ? '/shift/' + row.shift_id : '/'), 800);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  return (
    <Page title="Report a fault" howTo={<ol>
      <li>Pick the truck and describe the fault.</li>
      <li>Untick <b>Safe to run</b> if the truck must not be used. It is tagged out.</li>
      <li>Tap <b>Save fault</b>. In the full build this alerts the trucking supervisor and HSE and creates a Gearbox work order.</li>
    </ol>}>
      <FieldGrid fields={TABLES.faults.fields} value={row} onChange={setRow} />
      <div className="savebar"><button className="primary" onClick={save}>Save fault</button><button onClick={() => nav(-1)}>Cancel</button></div>
      {toast.node}
    </Page>
  );
}
