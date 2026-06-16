import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api, naira } from '../api.js';
import { useToast } from '../App.jsx';

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

export default function Entry({ go }) {
  const notify = useToast();
  const [mode, setMode] = useState('single'); // single | bulk
  const [tab, setTab] = useState('Sorter');
  const [workers, setWorkers] = useState([]);
  const [rates, setRates] = useState({ pet_price_per_kg: 0, cover_price_per_kg: 0, bale_price: 0 });
  const [date, setDate] = useState(todayStr());

  useEffect(() => {
    api.listWorkers(true).then(setWorkers).catch((e) => notify(e.message, 'err'));
    api.getSettings().then(setRates).catch(() => {});
  }, [notify]);

  const pool = useMemo(() => workers.filter((w) => w.role === tab), [workers, tab]);
  const ratesUnset = Number(rates.pet_price_per_kg) === 0 && Number(rates.bale_price) === 0 && Number(rates.cover_price_per_kg) === 0;

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Data entry</p><h1>Daily Entry</h1></div>
        <div className="row" style={{ flex: '0 0 auto', gap: 18 }}>
          <div className="row" style={{ flex: '0 0 auto', gap: 6 }}>
            <button className={`btn sm ${mode === 'single' ? '' : 'ghost'}`} onClick={() => setMode('single')}>Single</button>
            <button className={`btn sm ${mode === 'bulk' ? '' : 'ghost'}`} onClick={() => setMode('bulk')}>Bulk grid</button>
          </div>
          <div className="row" style={{ flex: '0 0 auto', gap: 6 }}>
            <button className={`btn sm ${tab === 'Sorter' ? '' : 'ghost'}`} onClick={() => setTab('Sorter')}>Sorter</button>
            <button className={`btn sm ${tab === 'Baler' ? '' : 'ghost'}`} onClick={() => setTab('Baler')}>Baler</button>
          </div>
        </div>
      </div>

      {ratesUnset && (
        <div className="card" style={{ marginBottom: 18, borderColor: '#e6d6a8', background: '#fbf3da' }}>
          Pricing is not set — payouts will compute as ₦0. <button className="btn sm brass" style={{ marginLeft: 8 }} onClick={() => go('settings')}>Set pricing</button>
        </div>
      )}

      {mode === 'single'
        ? <SingleForm tab={tab} pool={pool} rates={rates} date={date} setDate={setDate} go={go} />
        : <BulkGrid tab={tab} pool={pool} rates={rates} date={date} setDate={setDate} go={go} />}
    </>
  );
}

function SingleForm({ tab, pool, rates, date, setDate, go }) {
  const notify = useToast();
  const [workerId, setWorkerId] = useState('');
  const [pet, setPet] = useState('');
  const [cover, setCover] = useState('');
  const [bales, setBales] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setWorkerId(''); setPet(''); setCover(''); setBales(''); };
  useEffect(reset, [tab]);

  const preview = useMemo(() => {
    if (tab === 'Sorter') {
      return (Number(pet) || 0) * Number(rates.pet_price_per_kg) +
             (Number(cover) || 0) * Number(rates.cover_price_per_kg);
    }
    return (Number(bales) || 0) * Number(rates.bale_price);
  }, [tab, pet, cover, bales, rates]);

  const save = async () => {
    if (!workerId) return notify('Select a worker', 'err');
    setBusy(true);
    try {
      const body = tab === 'Sorter'
        ? { date, worker_id: workerId, pet_kg: pet || 0, cover_kg: cover || 0 }
        : { date, worker_id: workerId, bales_produced: bales || 0 };
      const r = await api.addRecord(body);
      notify(`Saved — payout ${naira(r.payout)}`);
      reset();
    } catch (e) {
      notify(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <div className="row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>{tab} name</span>
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Select {tab.toLowerCase()}…</option>
            {pool.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
          </select>
        </label>
      </div>

      {tab === 'Sorter' ? (
        <div className="row">
          <label className="field">
            <span>PET weight (kg)</span>
            <input type="number" min="0" step="0.01" value={pet} onChange={(e) => setPet(e.target.value)} placeholder="0.00" />
          </label>
          <label className="field">
            <span>Cover weight (kg)</span>
            <input type="number" min="0" step="0.01" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="0.00" />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>Number of bales produced</span>
          <input type="number" min="0" step="1" value={bales} onChange={(e) => setBales(e.target.value)} placeholder="0" />
        </label>
      )}

      <div className="preview">
        <span className="lbl">Payout preview</span>
        <span className="amt">{naira(preview)}</span>
      </div>

      <div className="row" style={{ marginTop: 18, flex: '0 0 auto' }}>
        <button className="btn" onClick={save} disabled={busy || pool.length === 0}>
          {busy ? <span className="spinner" /> : 'Save record'}
        </button>
        <button className="btn ghost" onClick={reset}>Clear</button>
      </div>
      {pool.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          No active {tab.toLowerCase()}s yet. <button className="btn sm ghost" onClick={() => go('workers')}>Add one</button>
        </p>
      )}
    </div>
  );
}

// One screen, one date: enter output for every active worker of the role and
// save in a single batch. Prefilled from existing records so it also edits.
function BulkGrid({ tab, pool, rates, date, setDate, go }) {
  const notify = useToast();
  const [grid, setGrid] = useState({}); // worker_id -> { pet, cover, bales }
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!date) return;
    setLoading(true);
    api.listRecords({ from: date, to: date })
      .then((rows) => {
        const m = {};
        for (const r of rows) {
          m[r.worker_id] = {
            pet: r.pet_kg != null ? String(r.pet_kg) : '',
            cover: r.cover_kg != null ? String(r.cover_kg) : '',
            bales: r.bales_produced != null ? String(r.bales_produced) : '',
          };
        }
        setGrid(m);
      })
      .catch((e) => notify(e.message, 'err'))
      .finally(() => setLoading(false));
  }, [date, notify]);

  useEffect(() => { load(); }, [load]);

  const setCell = (id, field, value) =>
    setGrid((g) => ({ ...g, [id]: { ...(g[id] || {}), [field]: value } }));

  const rowPay = (id) => {
    const c = grid[id] || {};
    if (tab === 'Sorter') {
      return (Number(c.pet) || 0) * Number(rates.pet_price_per_kg) +
             (Number(c.cover) || 0) * Number(rates.cover_price_per_kg);
    }
    return (Number(c.bales) || 0) * Number(rates.bale_price);
  };

  const total = useMemo(() => pool.reduce((sum, w) => sum + rowPay(w.id), 0), [pool, grid, rates, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const entries = [];
    for (const w of pool) {
      const c = grid[w.id] || {};
      if (tab === 'Sorter') {
        if (Number(c.pet) > 0 || Number(c.cover) > 0) entries.push({ worker_id: w.id, pet_kg: c.pet || 0, cover_kg: c.cover || 0 });
      } else if (Number(c.bales) > 0) {
        entries.push({ worker_id: w.id, bales_produced: c.bales || 0 });
      }
    }
    if (entries.length === 0) return notify('Enter at least one value', 'err');
    setBusy(true);
    try {
      const r = await api.bulkRecords(date, entries);
      notify(`Saved ${r.saved} record${r.saved === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
      load();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
        <label className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="preview" style={{ flex: '0 0 auto', minWidth: 260, marginTop: 0 }}>
          <span className="lbl">Total payout</span>
          <span className="amt">{naira(total)}</span>
        </div>
      </div>

      {pool.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          No active {tab.toLowerCase()}s yet. <button className="btn sm ghost" onClick={() => go('workers')}>Add one</button>
        </p>
      ) : (
        <>
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table>
              <thead><tr>
                <th>{tab}</th>
                {tab === 'Sorter'
                  ? <><th style={{ width: 160 }}>PET (kg)</th><th style={{ width: 160 }}>Cover (kg)</th></>
                  : <th style={{ width: 180 }}>Bales</th>}
                <th className="r">Payout</th>
              </tr></thead>
              <tbody>
                {pool.map((w) => {
                  const c = grid[w.id] || {};
                  return (
                    <tr key={w.id}>
                      <td>{w.full_name}</td>
                      {tab === 'Sorter' ? (
                        <>
                          <td><input type="number" min="0" step="0.01" value={c.pet || ''} placeholder="0.00"
                            onChange={(e) => setCell(w.id, 'pet', e.target.value)} /></td>
                          <td><input type="number" min="0" step="0.01" value={c.cover || ''} placeholder="0.00"
                            onChange={(e) => setCell(w.id, 'cover', e.target.value)} /></td>
                        </>
                      ) : (
                        <td><input type="number" min="0" step="1" value={c.bales || ''} placeholder="0"
                          onChange={(e) => setCell(w.id, 'bales', e.target.value)} /></td>
                      )}
                      <td className="r mono">{naira(rowPay(w.id))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 16, flex: '0 0 auto' }}>
            <button className="btn" onClick={save} disabled={busy || loading}>
              {busy ? <span className="spinner" /> : `Save all (${tab.toLowerCase()}s)`}
            </button>
            <button className="btn ghost" onClick={load} disabled={busy || loading}>Reset to saved</button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Blank rows are skipped. Rows with existing records for this date are updated in place.
          </p>
        </>
      )}
    </div>
  );
}
