import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api, naira } from '../api.js';
import { useToast } from '../App.jsx';

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

const TYPE_LABEL = { advance: 'Advance', deduction: 'Deduction', bonus: 'Bonus' };

export default function Adjustments() {
  const notify = useToast();
  const [workers, setWorkers] = useState([]);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', worker_id: '' });

  // new-entry form
  const [workerId, setWorkerId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState('advance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listAdjustments(filters).then(setRows).catch((e) => notify(e.message, 'err'));
  }, [filters, notify]);

  useEffect(() => { api.listWorkers(false).then(setWorkers).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const t = { advance: 0, deduction: 0, bonus: 0 };
    for (const r of rows) t[r.type] += Number(r.amount) || 0;
    t.net = t.bonus - t.advance - t.deduction;
    return t;
  }, [rows]);

  const add = async () => {
    if (!workerId) return notify('Select a worker', 'err');
    if (!(Number(amount) > 0)) return notify('Enter an amount greater than zero', 'err');
    setBusy(true);
    try {
      await api.addAdjustment({ worker_id: workerId, date, type, amount: Number(amount), note });
      notify(`${TYPE_LABEL[type]} recorded`);
      setAmount(''); setNote('');
      load();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this adjustment?')) return;
    try { await api.deleteAdjustment(id); notify('Adjustment deleted'); load(); }
    catch (e) { notify(e.message, 'err'); }
  };

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Payroll</p><h1>Advances &amp; Deductions</h1></div>
      </div>

      <p className="muted" style={{ marginTop: -16, marginBottom: 18, fontSize: 13.5 }}>
        Advances and deductions reduce a worker's net pay; bonuses add to it. The Payment Summary
        export nets these against gross for adjustments dated within the chosen period.
      </p>

      <div className="card" style={{ maxWidth: 760, marginBottom: 22 }}>
        <div className="row">
          <label className="field"><span>Worker</span>
            <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">Select worker…</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name} · {w.role}</option>)}
            </select>
          </label>
          <label className="field"><span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field"><span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="advance">Advance</option>
              <option value="deduction">Deduction</option>
              <option value="bonus">Bonus</option>
            </select>
          </label>
          <label className="field"><span>Amount (₦)</span>
            <input type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
        </div>
        <label className="field" style={{ marginBottom: 0 }}><span>Note (optional)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. cash advance, late penalty" maxLength={200} />
        </label>
        <div className="row" style={{ marginTop: 16, flex: '0 0 auto' }}>
          <button className="btn" onClick={add} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Record adjustment'}
          </button>
        </div>
      </div>

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
        <button className="btn ghost" onClick={() => setFilters({ from: '', to: '', worker_id: '' })}>Reset</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Date</th><th>Worker</th><th>Type</th><th>Note</th>
            <th className="r">Amount</th><th className="r">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><div className="empty">No adjustments match these filters.</div></td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{String(r.date).slice(0, 10)}</td>
                <td>{r.full_name}</td>
                <td><span className={`pill ${r.type === 'bonus' ? 'sorter' : 'baler'}`}>{TYPE_LABEL[r.type]}</span></td>
                <td className="muted">{r.note || '—'}</td>
                <td className="r mono">{r.type === 'bonus' ? '+' : '−'} {naira(r.amount)}</td>
                <td className="r"><button className="btn sm danger" onClick={() => del(r.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)' }}>
                <td colSpan={4} className="r" style={{ fontWeight: 600 }}>
                  Advances {naira(totals.advance)} · Deductions {naira(totals.deduction)} · Bonus {naira(totals.bonus)}
                </td>
                <td className="r mono" style={{ fontWeight: 700 }}>{naira(totals.net)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
