import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api, naira, intf } from '../api.js';
import { useToast } from '../App.jsx';

export default function Records() {
  const notify = useToast();
  const [rows, setRows] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', worker_id: '', material: '' });
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.listRecords(filters).then(setRows).catch((e) => notify(e.message, 'err'));
  }, [filters, notify]);

  useEffect(() => { api.listWorkers(false).then(setWorkers).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  // Paginate one day at a time. Rows arrive newest-first, so index 0 is the
  // most recent day; "Older" advances the index, "Newer" steps back.
  const [dayIndex, setDayIndex] = useState(0);
  const days = useMemo(() => [...new Set(rows.map((r) => String(r.date).slice(0, 10)))], [rows]);
  useEffect(() => { setDayIndex(0); }, [filters]);               // new filter -> jump to newest day
  useEffect(() => { setDayIndex((i) => Math.min(i, Math.max(0, days.length - 1))); }, [days.length]); // clamp after deletes
  const currentDay = days[dayIndex];
  const dayRows = useMemo(
    () => rows.filter((r) => String(r.date).slice(0, 10) === currentDay),
    [rows, currentDay],
  );
  const dayTotal = useMemo(() => dayRows.reduce((s, r) => s + (Number(r.payout) || 0), 0), [dayRows]);

  const del = async (id) => {
    if (!confirm('Delete this record? It will be removed from reports but kept in the audit log.')) return;
    try { await api.deleteRecord(id); notify('Record deleted'); load(); }
    catch (e) { notify(e.message, 'err'); }
  };

  const fmtQty = (r) => {
    if (r.role === 'Baler') return `${intf(r.bales_produced)} bales`;
    const parts = [];
    if (Number(r.pet_kg)) parts.push(`${r.pet_kg} kg PET`);
    if (Number(r.cover_kg)) parts.push(`${r.cover_kg} kg cover`);
    return parts.join(' · ') || '—';
  };

  return (
    <>
      <div className="page-head"><div><p className="eyebrow">History</p><h1>Records</h1></div></div>

      <div className="toolbar">
        <label className="field"><span>From</span>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="field"><span>To</span>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label className="field"><span>Worker</span>
          <select value={filters.worker_id} onChange={(e) => setFilters({ ...filters, worker_id: e.target.value })}>
            <option value="">All</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
          </select></label>
        <label className="field"><span>Material</span>
          <select value={filters.material} onChange={(e) => setFilters({ ...filters, material: e.target.value })}>
            <option value="">All</option><option value="PET">PET</option>
            <option value="Cover">Cover</option><option value="Bale">Bale</option>
          </select></label>
        <button className="btn ghost" onClick={() => setFilters({ from: '', to: '', worker_id: '', material: '' })}>Reset</button>
      </div>

      {days.length > 0 && (
        <div className="pager">
          <button className="btn sm ghost" disabled={dayIndex >= days.length - 1} onClick={() => setDayIndex((i) => i + 1)}>← Older</button>
          <div className="pager-info">
            <strong className="mono">{currentDay}</strong>
            <span className="muted">
              Day {dayIndex + 1} of {days.length} · {dayRows.length} record{dayRows.length === 1 ? '' : 's'} · {naira(dayTotal)}
            </span>
          </div>
          <button className="btn sm ghost" disabled={dayIndex <= 0} onClick={() => setDayIndex((i) => i - 1)}>Newer →</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Date</th><th>Worker</th><th>Role</th><th>Output</th>
            <th className="r">Payout</th><th className="r">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><div className="empty">No records match these filters.</div></td></tr>}
            {dayRows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{String(r.date).slice(0, 10)}</td>
                <td>{r.full_name}</td>
                <td><span className={`pill ${r.role.toLowerCase()}`}>{r.role}</span></td>
                <td className="mono">{fmtQty(r)}</td>
                <td className="r mono">{naira(r.payout)}</td>
                <td className="r">
                  <button className="btn sm ghost" onClick={() => setEditing(r)}>Edit</button>{' '}
                  <button className="btn sm danger" onClick={() => del(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <EditModal rec={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function EditModal({ rec, onClose, onSaved }) {
  const notify = useToast();
  const [pet, setPet] = useState(rec.pet_kg ?? '');
  const [cover, setCover] = useState(rec.cover_kg ?? '');
  const [bales, setBales] = useState(rec.bales_produced ?? '');
  const [applyCurrentRate, setApply] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = rec.role === 'Baler'
        ? { bales_produced: bales || 0, applyCurrentRate }
        : { pet_kg: pet || 0, cover_kg: cover || 0, applyCurrentRate };
      const r = await api.updateRecord(rec.id, body);
      notify(`Updated — payout ${naira(r.payout)}`);
      onSaved();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit record — {rec.full_name}</h3>
        <p className="muted" style={{ marginTop: -10, fontSize: 13 }}>{String(rec.date).slice(0, 10)} · {rec.role}</p>
        {rec.role === 'Baler' ? (
          <label className="field"><span>Number of bales</span>
            <input type="number" min="0" step="1" value={bales} onChange={(e) => setBales(e.target.value)} /></label>
        ) : (
          <div className="row">
            <label className="field"><span>PET (kg)</span>
              <input type="number" min="0" step="0.01" value={pet} onChange={(e) => setPet(e.target.value)} /></label>
            <label className="field"><span>Cover (kg)</span>
              <input type="number" min="0" step="0.01" value={cover} onChange={(e) => setCover(e.target.value)} /></label>
          </div>
        )}
        <div className="checkrow">
          <input id="acr" type="checkbox" checked={applyCurrentRate} onChange={(e) => setApply(e.target.checked)} />
          <label htmlFor="acr">Re-price at today's rates (default keeps the rate locked at original entry)</label>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
