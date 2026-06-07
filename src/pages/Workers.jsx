import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useToast } from '../App.jsx';

const blank = { full_name: '', role: 'Sorter', bank_name: '', account_number: '' };

export default function Workers() {
  const notify = useToast();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // worker object or 'new'

  const load = useCallback(() => {
    api.listWorkers(false).then(setRows).catch((e) => notify(e.message, 'err'));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (w) => {
    try { await api.setWorkerActive(w.id, !w.is_active); notify(w.is_active ? 'Deactivated' : 'Reactivated'); load(); }
    catch (e) { notify(e.message, 'err'); }
  };

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Directory</p><h1>Workers</h1></div>
        <button className="btn brass" onClick={() => setEditing('new')}>+ Add worker</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Name</th><th>Role</th><th>Bank</th><th>Account No.</th><th>Status</th><th className="r">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><div className="empty">No workers yet. Add your first sorter or baler.</div></td></tr>}
            {rows.map((w) => (
              <tr key={w.id} style={{ opacity: w.is_active ? 1 : 0.55 }}>
                <td>{w.full_name}</td>
                <td><span className={`pill ${w.role.toLowerCase()}`}>{w.role}</span></td>
                <td>{w.bank_name}</td>
                <td className="mono">{w.account_number}</td>
                <td>{w.is_active ? <span className="pill" style={{ background: 'rgba(78,141,91,0.16)', color: 'var(--leaf)' }}>Active</span>
                                 : <span className="pill off">Inactive</span>}</td>
                <td className="r">
                  <button className="btn sm ghost" onClick={() => setEditing(w)}>Edit</button>{' '}
                  <button className="btn sm ghost" onClick={() => toggle(w)}>{w.is_active ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <WorkerModal worker={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function WorkerModal({ worker, onClose, onSaved }) {
  const notify = useToast();
  const [form, setForm] = useState(worker ? {
    full_name: worker.full_name, role: worker.role,
    bank_name: worker.bank_name, account_number: worker.account_number,
  } : blank);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      if (worker) await api.updateWorker(worker.id, form);
      else await api.addWorker(form);
      notify('Saved');
      onSaved();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{worker ? 'Edit worker' : 'Add worker'}</h3>
        <label className="field"><span>Full name</span>
          <input value={form.full_name} onChange={set('full_name')} /></label>
        <label className="field"><span>Role</span>
          <select value={form.role} onChange={set('role')}>
            <option>Sorter</option><option>Baler</option>
          </select></label>
        <label className="field"><span>Bank name</span>
          <input value={form.bank_name} onChange={set('bank_name')} /></label>
        <label className="field"><span>Account number (10-digit NUBAN)</span>
          <input className="num" inputMode="numeric" maxLength={10} value={form.account_number}
                 onChange={(e) => setForm({ ...form, account_number: e.target.value.replace(/\D/g, '') })} /></label>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>Bank details are encrypted at rest.</p>
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
