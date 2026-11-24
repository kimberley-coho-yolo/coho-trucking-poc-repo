import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend } from '../lib/backend';
import { useApp } from '../state';
import { errText, FieldInput, nowIso, Page, QrScanner, todayIso, useRows, useToast } from '../components/ui';
import { TABLES } from '../lib/schema';

export default function StartShift() {
  const { person, session } = useApp();
  const nav = useNavigate();
  const trucks = useRows('trucks');
  const toast = useToast();
  const hour = new Date().getHours();
  const [row, setRow] = useState<Record<string, any>>({ shift_date: todayIso(), day_night: hour >= 5 && hour < 17 ? 'Day' : 'Night', driver_id: person?.id ?? null, is_cover: !!person?.is_cover });
  const [qr, setQr] = useState('');
  const f = (n: string) => TABLES.shifts.fields.find(x => x.name === n)!;

  const useCode = (code: string) => {
    setQr(code);
    const t = trucks.find(x => x.qr_value && x.qr_value.trim().toLowerCase() === code.trim().toLowerCase());
    if (t) { setRow(r => ({ ...r, truck_id: t.id })); toast.show('Truck found: ' + TABLES.trucks.display(t)); }
    else toast.show('No truck has that QR code. Pick the truck from the list.', 'err');
  };
  const save = async (exit: boolean) => {
    try {
      const phones = await backend().list('work_phones');
      const wp = phones.find(p => session?.phone && p.phone && p.phone.replace(/\D/g, '').slice(-9) === session.phone.replace(/\D/g, '').slice(-9));
      const s = await backend().save('shifts', { ...row, status: 'open', sign_in_at: nowIso(), work_phone_id: wp?.id ?? null, last_step: 'prestart' });
      if (exit) { toast.show('Saved. Find it under My drafts.'); nav('/'); } else nav(`/shift/${s.id}/prestart`);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  return (
    <Page title="Start a shift" howTo={<ol>
      <li>Tap <b>Scan truck QR code</b> and point the camera at the code on the truck. If the camera does not work, type the code or pick the truck.</li>
      <li>Check the date, Day or Night, and the trailer.</li>
      <li>Tap <b>Next: prestart</b>. Or <b>Save and exit</b> to finish later.</li>
    </ol>}>
      <QrScanner onResult={useCode} />
      <div className="grid">
        <label className="field"><span className="field-label">QR code (typed)</span>
          <span className="row"><input value={qr} onChange={e => setQr(e.target.value)} placeholder="COHO-TRUCK-04" /><button className="small" onClick={() => useCode(qr)}>Find</button></span></label>
        {['truck_id', 'equipment_id', 'shift_date', 'day_night', 'driver_id', 'is_cover'].map(n =>
          <FieldInput key={n} field={f(n)} value={row[n]} onChange={v => setRow({ ...row, [n]: v })} />)}
      </div>
      <div className="savebar">
        <button className="primary" onClick={() => save(false)}>Next: prestart</button>
        <button onClick={() => save(true)}>Save and exit</button>
      </div>
      {toast.node}
    </Page>
  );
}
