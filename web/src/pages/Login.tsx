import { useState } from 'react';
import { backend } from '../lib/backend';
import { useApp } from '../state';
import { errText, HowTo } from '../components/ui';

export default function Login() {
  const { refresh } = useApp();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [target, setTarget] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const demo = backend().mode === 'demo';
  const t = mode === 'phone' ? { phone: target } : { email: target };

  const send = async () => {
    setBusy(true); setMsg('');
    try { await backend().sendCode(t); setSent(true); setMsg(demo ? 'Demo mode: the code is 123456' : 'Code sent. It can take a minute to arrive.'); }
    catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setMsg('');
    try { await backend().verifyCode(t, code); await refresh(); }
    catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const switchMode = (toDemo: boolean) => {
    try { localStorage.setItem('coho-poc-mode', toDemo ? 'demo' : 'live'); } catch { /* ignore */ }
    location.reload();
  };

  return (
    <section className="page narrow">
      <h1>Sign in</h1>
      <div className="tabs">
        <button className={mode === 'phone' ? 'on' : ''} onClick={() => { setMode('phone'); setSent(false); setTarget(''); }}>Work mobile</button>
        <button className={mode === 'email' ? 'on' : ''} onClick={() => { setMode('email'); setSent(false); setTarget(''); }}>Email</button>
      </div>
      <label className="field">
        <span className="field-label">{mode === 'phone' ? 'Work mobile number' : 'Email address'}</span>
        <input id="login-target" type={mode === 'phone' ? 'tel' : 'email'} inputMode={mode === 'phone' ? 'tel' : 'email'}
          value={target} onChange={e => setTarget(e.target.value)} placeholder={mode === 'phone' ? '0400 000 000' : 'name@coho.com.au'} />
      </label>
      {!sent && <button className="primary" disabled={busy || !target} onClick={send}>Send code</button>}
      {sent && (
        <>
          <label className="field"><span className="field-label">6-digit code</span>
            <input id="login-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label>
          <div className="row">
            <button className="primary" disabled={busy || !code} onClick={verify}>Sign in</button>
            <button onClick={() => setSent(false)}>Change number</button>
          </div>
        </>
      )}
      {msg && <p className="note">{msg}</p>}
      <hr />
      {demo
        ? <p className="muted">You are in <b>demo mode</b>: data stays in this browser. Try <b>0400 000 001</b> (driver), or <b>admin@demo.local</b>, <b>office@demo.local</b>, <b>supervisor@demo.local</b>. Code 123456.
            {import.meta.env.VITE_SUPABASE_URL && <> <button className="link" onClick={() => switchMode(false)}>Use the live database</button></>}</p>
        : <p className="muted">Connected to the live database. <button className="link" onClick={() => switchMode(true)}>Try demo mode instead</button></p>}
      <HowTo>
        <ol>
          <li>Drivers: choose <b>Work mobile</b>, type the truck crew phone number and press <b>Send code</b>.</li>
          <li>Type the 6-digit code from the text message and press <b>Sign in</b>.</li>
          <li>Office, supervisors and admin can use <b>Email</b> instead.</li>
          <li>If you see "no access" after signing in, ask an admin to add your mobile or email under Admin &gt; Logins and roles.</li>
        </ol>
      </HowTo>
    </section>
  );
}
