import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api, naira, kg } from '../api.js';
import { useToast } from '../App.jsx';
import { PET_TYPES } from '../petTypes.js';

const MATERIALS = PET_TYPES.map((t) => t.label);

function monthOf(date) { return String(date).slice(0, 7); }
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

// Washing days: tick the existing workers who came; each gets the same fixed
// pay (Settings → washing pay per worker), snapshotted when the day is saved.
export default function WashingEntry({ workers, rates, date, setDate, go }) {
  const notify = useToast();
  const blank = () => ({ id: null, material: 'Oily PET', kg_washed: '', note: '', ids: new Set() });
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [applyCurrentRate, setApply] = useState(false);
  const [month, setMonth] = useState(monthOf(date));
  const [days, setDays] = useState([]);

  const load = useCallback(() => {
    api.listWashing(monthRange(month)).then(setDays).catch((e) => notify(e.message, 'err'));
  }, [month, notify]);
  useEffect(() => { load(); }, [load]);

  const editing = days.find((d) => d.id === form.id);
  // Editing keeps the day's own rate unless re-priced; a new day uses today's setting.
  const rate = editing && !applyCurrentRate ? Number(editing.pay_rate) : Number(rates.washing_pay_per_worker) || 0;
  const count = form.ids.size;

  // Active workers, plus anyone already on the day being edited (even if since deactivated).
  const pool = useMemo(() => {
    const list = workers.filter((w) => w.is_active !== false);
    for (const w of editing?.workers || []) if (!list.some((x) => x.id === w.id)) list.push(w);
    return list.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [workers, editing]);

  const toggle = (id) => setForm((f) => {
    const ids = new Set(f.ids);
    ids.has(id) ? ids.delete(id) : ids.add(id);
    return { ...f, ids };
  });
  const setAll = (on) => setForm((f) => ({ ...f, ids: new Set(on ? pool.map((w) => w.id) : []) }));
  const reset = () => { setForm(blank()); setApply(false); };

  const startEdit = (d) => {
    setDate(d.date);
    setForm({ id: d.id, material: d.material, kg_washed: String(Number(d.kg_washed) || ''), note: d.note || '',
              ids: new Set(d.workers.map((w) => w.id)) });
    setApply(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (count === 0) return notify('Tick at least one worker who washed', 'err');
    setBusy(true);
    try {
      const body = { date, material: form.material, kg_washed: form.kg_washed || 0, note: form.note,
                     worker_ids: [...form.ids], applyCurrentRate };
      const r = form.id ? await api.updateWashing(form.id, body) : await api.addWashing(body);
      notify(`Saved — ${r.workers} worker${r.workers === 1 ? '' : 's'} × ${naira(r.pay_rate)} = ${naira(r.total)}`);
      reset();
      if (monthOf(date) !== month) setMonth(monthOf(date)); else load();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this washing day? Its pay will be removed from exports and payslips.')) return;
    try { await api.deleteWashing(id); notify('Washing day deleted'); if (form.id === id) reset(); load(); }
    catch (e) { notify(e.message, 'err'); }
  };

  const monthTotal = days.reduce((s, d) => s + Number(d.total), 0);

  return (
    <>
      <div className="card" style={{ maxWidth: 760 }}>
        {form.id && <p className="eyebrow" style={{ marginTop: 0 }}>Editing washing day</p>}
        <div className="row">
          <label className="field"><span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Material washed</span>
            <select value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })}>
              {[...new Set([...MATERIALS, form.material])].map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
          <label className="field"><span>Kg washed</span>
            <input type="number" min="0" step="0.01" value={form.kg_washed} placeholder="0.00"
              onChange={(e) => setForm({ ...form, kg_washed: e.target.value })} /></label>
        </div>

        <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--forest-2)', flex: '0 0 auto' }}>
            Workers who washed ({count})
          </span>
          <span style={{ flex: '0 0 auto' }}>
            <button className="btn sm ghost" onClick={() => setAll(true)}>Select all</button>{' '}
            <button className="btn sm ghost" onClick={() => setAll(false)}>Clear</button>
          </span>
        </div>
        {pool.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No active workers yet. <button className="btn sm ghost" onClick={() => go('workers')}>Add one</button>
          </p>
        ) : (
          <div className="wash-grid">
            {pool.map((w) => (
              <label key={w.id} className={`wash-worker ${form.ids.has(w.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={form.ids.has(w.id)} onChange={() => toggle(w.id)} />
                <span>{w.full_name}</span>
                <span className={`pill ${String(w.role).toLowerCase()}`}>{w.role}</span>
              </label>
            ))}
          </div>
        )}

        <label className="field" style={{ marginTop: 16 }}><span>Note (optional)</span>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. washed at the back yard" /></label>

        {form.id && (
          <div className="checkrow">
            <input id="wacr" type="checkbox" checked={applyCurrentRate} onChange={(e) => setApply(e.target.checked)} />
            <label htmlFor="wacr">Re-price at today's washing pay (default keeps {naira(editing?.pay_rate)} from when it was entered)</label>
          </div>
        )}

        <div className="preview">
          <span className="lbl">{count} worker{count === 1 ? '' : 's'} × {naira(rate)}</span>
          <span className="amt">{naira(count * rate)}</span>
        </div>

        <div className="row" style={{ marginTop: 18, flex: '0 0 auto' }}>
          <button className="btn" onClick={save} disabled={busy || pool.length === 0}>
            {busy ? <span className="spinner" /> : form.id ? 'Save changes' : 'Save washing day'}
          </button>
          <button className="btn ghost" onClick={reset}>{form.id ? 'Cancel edit' : 'Clear'}</button>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between', margin: '26px 0 12px' }}>
        <h2 style={{ margin: 0, flex: '0 0 auto' }}>Washing days</h2>
        <label className="field" style={{ marginBottom: 0, maxWidth: 200 }}><span>Month</span>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Date</th><th>Material</th><th className="r">Kg washed</th><th>Workers</th>
            <th className="r">Pay each</th><th className="r">Total</th><th className="r">Actions</th>
          </tr></thead>
          <tbody>
            {days.length === 0 && <tr><td colSpan={7}><div className="empty">No washing days this month.</div></td></tr>}
            {days.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.date}</td>
                <td>{d.material}{d.note ? <div className="muted" style={{ fontSize: 12 }}>{d.note}</div> : null}</td>
                <td className="r mono">{kg(d.kg_washed)}</td>
                <td>{d.workers.length}: {d.workers.map((w) => w.full_name).join(', ')}</td>
                <td className="r mono">{naira(d.pay_rate)}</td>
                <td className="r mono">{naira(d.total)}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => startEdit(d)}>Edit</button>{' '}
                  <button className="btn sm danger" onClick={() => del(d.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {days.length > 0 && (
              <tr><td colSpan={5} className="r"><strong>Month total</strong></td>
                <td className="r mono"><strong>{naira(monthTotal)}</strong></td><td /></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
