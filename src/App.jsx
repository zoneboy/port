import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Entry from './pages/Entry.jsx';
import Records from './pages/Records.jsx';
import Adjustments from './pages/Adjustments.jsx';
import Workers from './pages/Workers.jsx';
import Settings from './pages/Settings.jsx';
import ExportPage from './pages/Export.jsx';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

const NAV = [
  { id: 'dashboard', label: 'Dashboard', ico: '◧' },
  { id: 'entry', label: 'Daily Entry', ico: '✎' },
  { id: 'records', label: 'Records', ico: '▤' },
  { id: 'adjustments', label: 'Advances', ico: '⇄' },
  { id: 'workers', label: 'Workers', ico: '◎' },
  { id: 'settings', label: 'Pricing', ico: '₦' },
  { id: 'export', label: 'Export', ico: '↧' },
];

const IDLE_MS = 20 * 60 * 1000; // auto-logout after 20 min idle

export default function App() {
  const [auth, setAuth] = useState({ loading: true, email: null });
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    setAuth({ loading: false, email: null });
  }, []);

  // session check on load
  useEffect(() => {
    api.session()
      .then((d) => setAuth({ loading: false, email: d.email }))
      .catch(() => setAuth({ loading: false, email: null }));
  }, []);

  // idle auto-logout
  useEffect(() => {
    if (!auth.email) return;
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { notify('Signed out due to inactivity', 'err'); signOut(); }, IDLE_MS);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { events.forEach((e) => window.removeEventListener(e, reset)); clearTimeout(timer.current); };
  }, [auth.email, notify, signOut]);

  if (auth.loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#6f7b71' }}>Loading…</div>;
  }

  if (!auth.email) {
    return (
      <ToastCtx.Provider value={notify}>
        <Login onSuccess={(email) => setAuth({ loading: false, email })} />
        {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
      </ToastCtx.Provider>
    );
  }

  const Page = { dashboard: Dashboard, entry: Entry, records: Records, adjustments: Adjustments,
    workers: Workers, settings: Settings, export: ExportPage }[page];

  return (
    <ToastCtx.Provider value={notify}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand"><span className="dot" /><span className="mark">Zilcycler</span></div>
          <p className="brand-sub">Record Management</p>
          <nav className="nav">
            {NAV.map((n) => (
              <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
                <span className="ico">{n.ico}</span>{n.label}
              </button>
            ))}
            <div className="spacer" />
          </nav>
          <div className="whoami">Signed in as<br /><strong>{auth.email}</strong></div>
          <button className="signout" onClick={signOut}>↪ Sign out</button>
        </aside>
        <main className="main">
          <Page go={setPage} />
        </main>
      </div>
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </ToastCtx.Provider>
  );
}
