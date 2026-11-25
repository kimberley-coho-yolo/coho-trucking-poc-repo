import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { TABLES } from '../lib/schema';
import { draftTimesheet } from '../lib/timesheet';
import { EditOnly, errText, FieldGrid, nowIso, Page, useToast } from '../components/ui';
import { useApp } from '../state';
import { isLong } from '../lib/timesheetSync';

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
    // the line usually exists already (filled in from the dockets); refresh the hours unless the driver typed their own
    // a shift over 24 hours: the database splits it across days, so do not put the whole span on one line
    const long = isLong(s.sign_in_at, s.sign_out_at ?? nowIso(), s.over_24h);
    const fresh = long ? {} : calc;
    setLine(existing ? { ...existing, ...(existing.hours_edited ? {} : fresh) } : { shift_id: s.id, person_id: s.driver_id, work_date: s.shift_date, on_shift: true, status: 'draft', source: 'end_shift', ...fresh });
    await backend().save('shifts', { id: s.id, last_step: 'end' }).catch(() => null);
  })(); }, [id]);
  if (!shift) return <Page title="End shift"><p>Loading...</p></Page>;

  const save = async (submit: boolean) => {
    try {
      await backend().save('timesheet_lines', { ...line, status: submit ? 'submitted' : line.status ?? 'draft' });
      if (submit) {
        await backend().save('shifts', { id: shift.id, status: 'submitted', sign_out_at: shift.sign_out_at ?? nowIso(), over_24h: !!shift.over_24h });
        toast.show('Timesheet submitted for approval');
        if (role === 'driver') setPerson(null);   // hand over the phone
        setTimeout(() => nav('/'), 800);
      } else { toast.show('Saved. Find it under My drafts.'); nav('/'); }
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const fields = TABLES.timesheet_lines.fields.filter(f => !['status', 'supervisor_comment', 'person_id'].includes(f.name));
  return (
    <Page title="End shift and timesheet" howTo={<ol>
      <li>The hours are worked out from your sign-in time and your dockets. <b>Travel time</b> is hours (not distance) outside any docket and is not charged to a customer. Times are decimal hours: 0.5 = 30 minutes.</li>
      <li>Add R&R, wet hours and your work diary page. Change anything that is wrong and add a comment.</li>
      <li>Tap <b>Submit and sign out</b>. Your supervisor gets it for approval, and the phone is ready for the next crew.</li>
    </ol>}>
      <label className="field field-bool"><span className="field-label">This shift was over 24 hours</span>
        <input type="checkbox" checked={!!shift.over_24h || isLong(shift.sign_in_at, shift.sign_out_at ?? nowIso(), false)} disabled={isLong(shift.sign_in_at, shift.sign_out_at ?? nowIso(), false)}
          onChange={e => setShift({ ...shift, over_24h: e.target.checked })} />
        <small className="help">Ticked automatically when you have been signed in for more than 24 hours. The hours are split across each day on your timesheet.</small></label>
      <FieldGrid fields={fields} value={line} onChange={v => setLine(['total_hours', 'docket_hours', 'travel_hours', 'standby_hours'].some(k => v[k] !== line[k]) ? { ...v, hours_edited: true } : v)} />
      <div className="savebar">
        <EditOnly><button className="primary" onClick={() => save(true)}>Submit and sign out</button>
        <button onClick={() => save(false)}>Save and exit</button></EditOnly>
        <button onClick={() => nav('/shift/' + shift.id)}>Back to shift</button>
      </div>
      {toast.node}
    </Page>
  );
}
