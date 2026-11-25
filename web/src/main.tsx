import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import { setBackend } from './lib/backend';
import { SupabaseBackend } from './lib/supabaseBackend';
import { DemoBackend } from './lib/demoBackend';
import { OfflineBackend } from './lib/outbox';
import { openStore } from './lib/offlineStore';

// Demo mode when no Supabase settings are present, or when the person chose "Try demo" (?demo=1 or saved choice).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
let wantDemo = false;
try { wantDemo = localStorage.getItem('coho-poc-mode') === 'demo' || location.search.includes('demo=1'); } catch { /* ignore */ }
const real = url && key && !wantDemo;
// Every change goes through the outbox, so the app keeps working with no signal (see lib/outbox.ts).
const offline = new OfflineBackend(real ? new SupabaseBackend(url!, key!) : new DemoBackend(), openStore(real ? 'coho-drive-offline' : 'coho-drive-offline-demo'));
setBackend(offline);

offline.init().catch(() => null).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter><App /></HashRouter>
    </React.StrictMode>,
  );
});
