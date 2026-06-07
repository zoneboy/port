import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const d = await api.login(email, password);
      onSuccess(d.email);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="mark">Zilcycler</div>
        <p className="sub">Record Management System</p>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} autoComplete="username"
                 onChange={(e) => setEmail(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} autoComplete="current-password"
                 onChange={(e) => setPassword(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        {err && <p style={{ color: 'var(--danger)', fontSize: 13.5, margin: '0 0 14px' }}>{err}</p>}
        <button className="btn brass" style={{ width: '100%', justifyContent: 'center' }}
                onClick={submit} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
