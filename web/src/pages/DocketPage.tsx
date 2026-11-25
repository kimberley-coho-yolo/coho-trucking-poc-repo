import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { TABLES } from '../lib/schema';
import { DEPARTMENT_EXTRAS } from '../lib/extras';
import { DataTable, EditOnly, errText, FieldGrid, nowIso, Page, SignaturePad, useToast } from '../components/ui';

const F = (names: string[], t: 'dockets' | 'loads' | 'signoffs' = 'dockets') => TABLES[t].fields.filter(f => names.includes(f.name));

export default function DocketPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState<Row | null>(null);
  const [loads, setLoads] = useState<Row[]>([]);
  const [load, setLoad] = useState<Row | null>(null);
  const [sign, setSign] = useState<Row>({});
  const refresh = async () => {
    const x = await backend().get('dockets', id!); setD(x);
    setLoads(await backend().list('loads', { docket_id: id! }, { column: 'depart_at' }));
    const s = (await backend().list('signoffs', { docket_id: id! }))[0]; setSign(s ?? { docket_id: id });
  };
  useEffect(() => { refresh(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Page title="Docket"><p>Loading...</p></Page>;
  const extras = DEPARTMENT_EXTRAS[d.department ?? ''] ?? [];

  const save = async (opts: { exit?: boolean; close?: boolean } = {}) => {
    try {
      const body: Row = { ...d, last_step: 'docket' };
      if (opts.close) { body.status = 'closed'; body.end_at = d.end_at ?? nowIso(); }
      const saved = await backend().save('dockets', body);
      if (sign.client_name || sign.signature_png || sign.po || sign.id) await backend().save('signoffs', { ...sign, docket_id: d.id, signed_at: sign.signed_at ?? (sign.signature_png ? nowIso() : null) });
      setD(saved);
      toast.show(opts.close ? 'Docket closed' : 'Saved');
      if (opts.exit) nav('/');
      else if (opts.close) nav('/shift/' + d.shift_id);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  const saveLoad = async () => {
    try { await backend().save('loads', { ...load, docket_id: d.id }); setLoad(null); setLoads(await backend().list('loads', { docket_id: d.id }, { column: 'depart_at' })); toast.show('Load saved'); }
    catch (e) { toast.show(errText(e), 'err'); }
  };

  return (
    <Page title={'Docket' + (d.status === 'closed' ? ' (closed)' : '')} howTo={<ol>
      <li><b>Job</b>: customer, rig, project, task and PO come from the allocation. Change them if they are wrong. Every field is optional.</li>
      <li><b>Times</b>: start was stamped when you opened the docket. Record standby and the reason.</li>
      <li><b>Loads and tasks</b>: tap <b>Add a load</b> for each load or task, fill what you know, then <b>Save load</b>.</li>
      <li><b>Department extras</b> appear when a department is chosen (e.g. potable sampling, landspray sprayfield).</li>
      <li><b>Client sign-off</b>: hand the device to the client representative to type their name and sign.</li>
      <li>Tap <b>Close docket</b> when the job ends. <b>Save</b> keeps it open; <b>Save and exit</b> takes you home and the docket waits in My drafts.</li>
    </ol>}>
      <fieldset><legend>Job</legend><FieldGrid fields={F(['customer_id', 'location_id', 'department', 'contract', 'project_no', 'task_no', 'po'])} value={d} onChange={setD} /></fieldset>
      <fieldset><legend>Times</legend><FieldGrid fields={F(['start_at', 'end_at', 'standby_minutes', 'standby_reason'])} value={d} onChange={setD} /></fieldset>
      {!!extras.length && <fieldset><legend>{d.department} extras</legend>
        <FieldGrid fields={extras} value={d.extras ?? {}} onChange={x => setD({ ...d, extras: x })} /></fieldset>}
      <fieldset><legend>Loads and tasks</legend>
        <DataTable table="loads" rows={loads} onOpen={r => setLoad(r)} columns={['depart_at', 'task', 'material', 'volume_in_l', 'volume_out_l', 'docket_no']} />
        {load ? (<div className="subform">
          <FieldGrid fields={TABLES.loads.fields} value={load} onChange={setLoad} />
          <div className="row"><EditOnly><button className="primary" onClick={saveLoad}>Save load</button></EditOnly><button onClick={() => setLoad(null)}>Cancel</button>
            <EditOnly>{load.id && <button className="danger" onClick={async () => { await backend().remove('loads', load.id); setLoad(null); refresh(); }}>Delete load</button>}</EditOnly></div>
        </div>) : <EditOnly><button onClick={() => setLoad({ depart_at: nowIso() })}>Add a load</button></EditOnly>}
      </fieldset>
      <fieldset><legend>End of job</legend><FieldGrid fields={F(['fuel_l', 'odo_start', 'odo_end', 'km', 'equipment_on_site', 'notes'])} value={d} onChange={setD} /></fieldset>
      <fieldset><legend>Client sign-off</legend>
        <FieldGrid fields={TABLES.signoffs.fields.filter(f => f.name !== 'signed_at')} value={sign} onChange={setSign} />
        <SignaturePad value={sign.signature_png} onChange={v => setSign({ ...sign, signature_png: v })} />
      </fieldset>
      <div className="savebar">
        <EditOnly><button onClick={() => save()}>Save</button>
        <button onClick={() => save({ exit: true })}>Save and exit</button>
        {d.status !== 'closed' && <button className="primary" onClick={() => save({ close: true })}>Close docket</button>}</EditOnly>
        <button onClick={() => nav('/shift/' + d.shift_id)}>Back to shift</button>
      </div>
      {toast.node}
    </Page>
  );
}
