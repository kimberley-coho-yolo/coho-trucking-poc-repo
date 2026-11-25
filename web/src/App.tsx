import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { backend, type Role, type Row, type Session } from './lib/backend';
import { AppCtx } from './state';
import { ADMIN_FEATURES, best, canRead, DATA_FEATURES, TABLE_FEATURE, type Perms } from './lib/permissions';
import { Guard } from './components/ui';
import Settings from './pages/Settings';
import type { TableName } from './lib/schema';
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
import { APP_NAME } from './brand';

const PERSON_KEY = 'coho-poc-person';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [perms, setPerms] = useState<Perms>({});
  const [person, setPersonState] = useState<Row | null>(() => { try { return JSON.parse(sessionStorage.getItem(PERSON_KEY) || 'null'); } catch { return null; } });
  const setPerson = (p: Row | null) => { setPersonState(p); try { sessionStorage.setItem(PERSON_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
  const refresh = useCallback(async () => {
    const s = await backend().getSession();
    setSession(s);
    setRole(s ? await backend().myRole().catch(() => null) : null);
    setPerms(s ? await backend().myPermissions().catch(() => ({})) : {});
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
    <AppCtx.Provider value={{ session, role, perms, person, setPerson, refresh }}>
      {signedIn && (
        <nav className="top">
          <Link to="/" className="brand"><img src="./brand/coho-fish-reverse.png" alt="" />{APP_NAME} <small>PoC{backend().mode === 'demo' ? ' (demo)' : ''}</small></Link>
          <div className="nav-links">
            <Link to="/">Home</Link>
            {canRead(perms, 'drafts') && <Link to="/drafts">My drafts</Link>}
            {canRead(perms, 'approvals') && <Link to="/approvals">Approvals</Link>}
            {canRead(perms, 'reports') && <Link to="/reports">Reports</Link>}
            {DATA_FEATURES.some(f => canRead(perms, f)) && <Link to="/data">Data</Link>}
            {ADMIN_FEATURES.some(f => canRead(perms, f)) && <Link to="/admin">Admin</Link>}
            {canRead(perms, 'settings') && <Link to="/settings">Settings</Link>}
            {canRead(perms, 'help') && <Link to="/help">Help</Link>}
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
          <Route path="/shift/start" element={<Guard access={best(perms, 'shifts')}><StartShift /></Guard>} />
          <Route path="/shift/:id" element={<Guard access={best(perms, 'shifts', 'all_work')}><ShiftHome /></Guard>} />
          <Route path="/shift/:id/prestart" element={<Guard access={best(perms, 'shifts', 'all_work')}><Prestart /></Guard>} />
          <Route path="/shift/:id/end" element={<Guard access={best(perms, 'shifts', 'all_work')}><EndShift /></Guard>} />
          <Route path="/docket/:id" element={<Guard access={best(perms, 'dockets', 'all_work')}><DocketPage /></Guard>} />
          <Route path="/fault/new" element={<Guard access={best(perms, 'faults')}><FaultPage /></Guard>} />
          <Route path="/drafts" element={<Guard access={best(perms, 'drafts')}><Drafts /></Guard>} />
          <Route path="/approvals" element={<Guard access={best(perms, 'approvals')}><Approvals /></Guard>} />
          <Route path="/reports" element={<Guard access={best(perms, 'reports')}><Reports /></Guard>} />
          <Route path="/data" element={<Guard access={best(perms, ...DATA_FEATURES) === 'hidden' ? 'hidden' : 'edit'}><DataPage /></Guard>} />
          <Route path="/admin" element={<Guard access={best(perms, ...ADMIN_FEATURES) === 'hidden' ? 'hidden' : 'edit'}><AdminIndex /></Guard>} />
          <Route path="/admin/:table" element={<AdminRoute perms={perms} />} />
          <Route path="/settings" element={<Guard access={best(perms, 'settings')}><Settings /></Guard>} />
          <Route path="/help" element={<Guard access={best(perms, 'help')}><Help /></Guard>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <footer className="site">
        <div className="split-bar" />
        <div className="foot">{APP_NAME} · Coho Group</div>
      </footer>
    </AppCtx.Provider>
  );
}

/** Admin lists follow the function that owns each table (e.g. Trucks follows "Trucks, trailers and equipment"). */
function AdminRoute({ perms }: { perms: Perms }) {
  const { table } = useParams() as { table: TableName };
  return <Guard access={best(perms, TABLE_FEATURE[table] ?? 'settings')}><AdminTable /></Guard>;
}
