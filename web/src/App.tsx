import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { backend, type Role, type Row, type Session } from './lib/backend';
import { AppCtx, isOffice, isStaff } from './state';
import Login from './pages/Login';
import PickName from './pages/PickName';
import Home from './pages/Home';
import StartShift from './pages/StartShift';
import ShiftHome from './pages/ShiftHome';
import Prestart from './pages/Prestart';
import DocketPage from './pages/DocketPage';
import FaultPage from './pages/FaultPage';
import EndShift from './pages/EndShift';
import Drafts from './pages/Drafts';
import Approvals from './pages/Approvals';
import AdminIndex, { AdminTable } from './pages/Admin';
import DataPage from './pages/DataPage';
import Reports from './pages/Reports';
import Help from './pages/Help';

const PERSON_KEY = 'coho-poc-person';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [person, setPersonState] = useState<Row | null>(() => { try { return JSON.parse(sessionStorage.getItem(PERSON_KEY) || 'null'); } catch { return null; } });
  const setPerson = (p: Row | null) => { setPersonState(p); try { sessionStorage.setItem(PERSON_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
  const refresh = useCallback(async () => {
    const s = await backend().getSession();
    setSession(s);
    setRole(s ? await backend().myRole().catch(() => null) : null);
    setReady(true);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const loc = useLocation(); const nav = useNavigate();

  if (!ready) return <p className="page">Loading...</p>;
  const signedIn = !!session;
  const needsName = signedIn && role === 'driver' && !person;
  const signOut = async () => { await backend().signOut(); setPerson(null); await refresh(); nav('/login'); };

  // Guards: signed-out people go to sign-in; drivers on a work phone pick their name first.
  if (!signedIn && loc.pathname !== '/login') return <Navigate to="/login" replace />;
  if (needsName && loc.pathname !== '/who') return <Navigate to="/who" replace />;

  return (
    <AppCtx.Provider value={{ session, role, person, setPerson, refresh }}>
      {signedIn && (
        <nav className="top">
          <Link to="/" className="brand">Coho Trucking <small>PoC{backend().mode === 'demo' ? ' (demo)' : ''}</small></Link>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/drafts">My drafts</Link>
            {isStaff(role) && <Link to="/approvals">Approvals</Link>}
            {isStaff(role) && <Link to="/reports">Reports</Link>}
            {isOffice(role) && <Link to="/data">Data</Link>}
            {isOffice(role) && <Link to="/admin">Admin</Link>}
            <Link to="/help">Help</Link>
            <button className="link" onClick={signOut}>Sign out</button>
          </div>
          <div className="who">{person?.full_name ?? session?.email ?? session?.phone} · {role ?? 'no access'}</div>
        </nav>
      )}
      <main>
        <Routes>
          <Route path="/login" element={signedIn ? <Navigate to="/" /> : <Login />} />
          <Route path="/who" element={<PickName />} />
          <Route path="/" element={<Home />} />
          <Route path="/shift/start" element={<StartShift />} />
          <Route path="/shift/:id" element={<ShiftHome />} />
          <Route path="/shift/:id/prestart" element={<Prestart />} />
          <Route path="/shift/:id/end" element={<EndShift />} />
          <Route path="/docket/:id" element={<DocketPage />} />
          <Route path="/fault/new" element={<FaultPage />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/admin" element={<AdminIndex />} />
          <Route path="/admin/:table" element={<AdminTable />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </AppCtx.Provider>
  );
}
