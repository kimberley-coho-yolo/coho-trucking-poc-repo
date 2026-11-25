import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { TABLES } from '../lib/schema';
import { draftTimesheet } from '../lib/timesheet';
import { EditOnly, errText, FieldGrid, nowIso, Page, useToast } from '../components/ui';
import { useApp } from '../state';

export default function EndShift() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { setPerson, role } = useApp();
  const [shift, setShift] = useState<Row | null>(null);
  const [line, setLine] = useState<Row>({});
  useEffect(() => { (async () => {
    const s = await backend().get('shifts', id!); if (!s) return; setShift(s);
    const dockets = await backend().list('dockets', { shift_id: s.id });
    const existing = (await backend().list('timesheet_lines', { shift_id: s.id }))[0];
    const calc = draftTimesheet({ sign_in_at: s.sign_in_at, sign_out_at: s.sign_out_at ?? nowIso() }, dockets);
    setLine(existing ?? { shift_id: s.id, person_id: s.driver_id, work_date: s.shift_date, on_shift: true, status: 'draft', ...calc });
    await backend().save('shifts', { id: s.id, last_step: 'end' }).catch(() => null);
  })(); }, [id]);
  if (!shift) return <Page title="End shift"><p>Loading...</p></Page>;

  const save = async (submit: boolean) => {
    try {
      await backend().save('timesheet_lines', { ...line, status: submit ? 'submitted' : line.status ?? 'draft' });
      if (submit) {
        await backend().save('shifts', { id: shift.id, status: 'submitted', sign_out_at: shift.sign_out_at ?? nowIso() });
        toast.show('Timesheet submitted for approval');
        if (role === 'driver') setPerson(null);   // hand over the phone
        setTimeout(() => nav('/'), 800);
      } else { toast.show('Saved. Find it under My drafts.'); nav('/'); }
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const fields = TABLES.timesheet_lines.fields.filter(f => !['status', 'supervisor_comment', 'person_id'].includes(f.name));
  return (
    <Page title="End shift and timesheet" howTo={<ol>
      <li>The hours are worked out from your sign-in time and your dockets. <b>Travel hours</b> are time outside any docket and are not charged to a customer.</li>
      <li>Add R&R, wet hours and your work diary page. Change anything that is wrong and add a comment.</li>
      <li>Tap <b>Submit and sign out</b>. Your supervisor gets it for approval, and the phone is ready for the next crew.</li>
    </ol>}>
      <FieldGrid fields={fields} value={line} onChange={setLine} />
      <div className="savebar">
        <EditOnly><button className="primary" onClick={() => save(true)}>Submit and sign out</button>
        <button onClick={() => save(false)}>Save and exit</button></EditOnly>
        <button onClick={() => nav('/shift/' + shift.id)}>Back to shift</button>
      </div>
      {toast.node}
    </Page>
  );
}
