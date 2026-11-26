import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { useApp } from '../state';
import { HowTo } from '../components/ui';

export default function PickName() {
  const { setPerson, role } = useApp();
  const driver = role === 'driver';
  const nav = useNavigate();
  const [mine, setMine] = useState<Row[]>([]);
  const [all, setAll] = useState<Row[]>([]);
  const [cover, setCover] = useState(false);
  const [chosen, setChosen] = useState<Row | null>(null);
  useEffect(() => { backend().peopleForMyPhone().then(setMine); backend().list('people', { active: true }, { column: 'full_name' }).then(r => setAll(r.filter(p => p.is_driver !== false))); }, []);
  const list = cover ? all : mine;
  const confirm = () => { if (!chosen) return; setPerson({ ...chosen, is_cover: cover }); nav('/'); };
  return (
    <section className="page narrow">
      <h1>{driver ? 'Who is driving?' : 'Which person are you?'}</h1>
      {!chosen ? (
        <>
          <p className="muted">{cover ? 'All active drivers' : driver ? 'People assigned to this work phone' : 'This login is shared. Pick your own name so your work is recorded against you.'}</p>
          <div className="stack">
            {list.map(p => <button key={p.id} className="big" onClick={() => setChosen(p)}>{p.full_name}<small>{p.crew}</small></button>)}
            {!list.length && <p className="muted">No names found. {cover ? '' : 'Ask the office to assign people to this phone, or use Cover driver.'}</p>}
          </div>
          {driver && <button className="link" onClick={() => setCover(!cover)}>{cover ? 'Back to this phone\'s names' : 'I am a cover driver'}</button>}
        </>
      ) : (
        <>
          <p className="big-text">{driver ? 'Signing in as' : 'You are'} <b>{chosen.full_name}</b>{cover ? ' (cover driver)' : ''}?</p>
          {cover && <p className="note">Cover sign-ins are recorded so the supervisor can check them. (PIN check is planned; not enforced in the PoC.)</p>}
          <div className="row"><button className="primary" onClick={confirm}>Yes, that's me</button><button onClick={() => setChosen(null)}>No, go back</button></div>
        </>
      )}
      <HowTo><ol>
        <li>Tap your name. Only the people who share this work phone or login are listed.</li>
        <li>Check the name and tap <b>Yes, that's me</b>.</li>
        {driver && <li>Covering for someone? Tap <b>I am a cover driver</b> and pick your name from all drivers.</li>}
      </ol></HowTo>
    </section>
  );
}
