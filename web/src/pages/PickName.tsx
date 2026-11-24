import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { useApp } from '../state';
import { HowTo } from '../components/ui';

export default function PickName() {
  const { setPerson } = useApp();
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
      <h1>Who is driving?</h1>
      {!chosen ? (
        <>
          <p className="muted">{cover ? 'All active drivers' : 'People assigned to this work phone'}</p>
          <div className="stack">
            {list.map(p => <button key={p.id} className="big" onClick={() => setChosen(p)}>{p.full_name}<small>{p.crew}</small></button>)}
            {!list.length && <p className="muted">No names found. {cover ? '' : 'Ask the office to assign people to this phone, or use Cover driver.'}</p>}
          </div>
          <button className="link" onClick={() => setCover(!cover)}>{cover ? 'Back to this phone\'s names' : 'I am a cover driver'}</button>
        </>
      ) : (
        <>
          <p className="big-text">Signing in as <b>{chosen.full_name}</b>{cover ? ' (cover driver)' : ''}?</p>
          {cover && <p className="note">Cover sign-ins are recorded so the supervisor can check them. (PIN check is planned; not enforced in the PoC.)</p>}
          <div className="row"><button className="primary" onClick={confirm}>Yes, that's me</button><button onClick={() => setChosen(null)}>No, go back</button></div>
        </>
      )}
      <HowTo><ol>
        <li>Tap your name. Only the people who share this work phone are listed.</li>
        <li>Check the name and tap <b>Yes, that's me</b>.</li>
        <li>Covering for someone? Tap <b>I am a cover driver</b> and pick your name from all drivers.</li>
      </ol></HowTo>
    </section>
  );
}
