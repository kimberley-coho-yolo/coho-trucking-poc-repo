import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { useApp } from '../state';
import { clearRefCache, errText, HowTo } from '../components/ui';
import { cleanFullName, pickable } from '../lib/newDrivers';

export default function PickName() {
  const { setPerson, role } = useApp();
  const driver = role === 'driver';
  const nav = useNavigate();
  const [mine, setMine] = useState<Row[]>([]);
  const [all, setAll] = useState<Row[]>([]);
  const [cover, setCover] = useState(false);
  const [chosen, setChosen] = useState<Row | null>(null);
  // a driver whose name is not on this phone adds it (checked later by a supervisor)
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    backend().peopleForMyPhone().then(setMine);
    backend().list('people', { active: true }, { column: 'full_name' }).then(r => setAll(pickable(r).filter(p => p.is_driver !== false)));
  }, []);
  const list = cover ? all : mine;
  const confirm = () => { if (!chosen) return; setPerson({ ...chosen, is_cover: cover }); nav('/'); };
  const addMe = async () => {
    const name = cleanFullName(newName);
    if (!name) { setErr('Type your first name and surname.'); return; }
    setBusy(true); setErr('');
    try { const p = await backend().addPendingDriver!(name); clearRefCache(); setAdding(false); setChosen(p); }
    catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  return (
    <section className="page narrow">
      <h1>{driver ? 'Who is driving?' : 'Which person are you?'}</h1>
      {adding ? (
        <>
          <p>Type your <b>full name</b> (first name and surname). It is added to this phone for your timesheet, and a supervisor checks it when you send your timesheet.</p>
          <label className="field"><span className="field-label">Your full name</span>
            <input id="new-driver-name" autoComplete="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Robert Nguyen" /></label>
          {err && <p className="note err" role="alert">{err}</p>}
          <div className="row"><button className="primary" disabled={busy} onClick={addMe}>{busy ? 'Adding...' : 'Add me as a new driver'}</button>
            <button onClick={() => { setAdding(false); setErr(''); }}>Back</button></div>
        </>
      ) : !chosen ? (
        <>
          <p className="muted">{cover ? 'All active drivers' : driver ? 'People assigned to this work phone' : 'This login is shared. Pick your own name so your work is recorded against you.'}</p>
          <div className="stack">
            {list.map(p => <button key={p.id} className="big" onClick={() => setChosen(p)}>{p.full_name}<small>{p.pending ? 'New driver, waiting to be checked' : p.crew}</small></button>)}
            {!list.length && <p className="muted">No names found. {cover ? '' : 'Ask the office to assign people to this phone, or use Cover driver.'}</p>}
          </div>
          {driver && <div className="row">
            <button className="link" onClick={() => setCover(!cover)}>{cover ? 'Back to this phone\'s names' : 'I am a cover driver'}</button>
            {!cover && <button className="link" onClick={() => { setAdding(true); setErr(''); }}>My name is not here</button>}
          </div>}
        </>
      ) : (
        <>
          <p className="big-text">{driver ? 'Signing in as' : 'You are'} <b>{chosen.full_name}</b>{cover ? ' (cover driver)' : ''}?</p>
          {cover && <p className="note">Cover sign-ins are recorded so the supervisor can check them. (PIN check is planned; not enforced in the PoC.)</p>}
          {chosen.pending && <p className="note">You are a new driver on this phone. Your dockets and timesheet are flagged so a supervisor can check your name when you send your timesheet.</p>}
          <div className="row"><button className="primary" onClick={confirm}>Yes, that's me</button><button onClick={() => setChosen(null)}>No, go back</button></div>
        </>
      )}
      <HowTo><ol>
        <li>Tap your name. Only the people who share this work phone or login are listed.</li>
        <li>Check the name and tap <b>Yes, that's me</b>.</li>
        {driver && <li>Covering for someone? Tap <b>I am a cover driver</b> and pick your name from all drivers.</li>}
        {driver && <li>Not in the list at all? Tap <b>My name is not here</b> and type your full name. You can work straight away; a supervisor checks your name when you send your timesheet.</li>}
      </ol></HowTo>
    </section>
  );
}
