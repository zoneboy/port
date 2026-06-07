import React, { useEffect, useMemo, useState } from 'react';
import { api, naira } from '../api.js';
import { useToast } from '../App.jsx';

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

export default function Entry({ go }) {
  const notify = useToast();
  const [tab, setTab] = useState('Sorter');
  const [workers, setWorkers] = useState([]);
  const [rates, setRates] = useState({ pet_price_per_kg: 0, cover_price_per_kg: 0, bale_price: 0 });

  const [date, setDate] = useState(todayStr());
  const [workerId, setWorkerId] = useState('');
  const [pet, setPet] = useState('');
  const [cover, setCover] = useState('');
  const [bales, setBales] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listWorkers(true).then(setWorkers).catch((e) => notify(e.message, 'err'));
    api.getSettings().then(setRates).catch(() => {});
  }, [notify]);

  const pool = workers.filter((w) => w.role === tab);

  const preview = useMemo(() => {
    if (tab === 'Sorter') {
      return (Number(pet) || 0) * Number(rates.pet_price_per_kg) +
             (Number(cover) || 0) * Number(rates.cover_price_per_kg);
    }
    return (Number(bales) || 0) * Number(rates.bale_price);
  }, [tab, pet, cover, bales, rates]);

  const reset = () => { setWorkerId(''); setPet(''); setCover(''); setBales(''); };

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

  const ratesUnset = Number(rates.pet_price_per_kg) === 0 && Number(rates.bale_price) === 0 && Number(rates.cover_price_per_kg) === 0;

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Data entry</p><h1>Daily Entry</h1></div>
        <div className="row" style={{ flex: '0 0 auto' }}>
          <button className={`btn sm ${tab === 'Sorter' ? '' : 'ghost'}`} onClick={() => { setTab('Sorter'); reset(); }}>Sorter</button>
          <button className={`btn sm ${tab === 'Baler' ? '' : 'ghost'}`} onClick={() => { setTab('Baler'); reset(); }}>Baler</button>
        </div>
      </div>

      {ratesUnset && (
        <div className="card" style={{ marginBottom: 18, borderColor: '#e6d6a8', background: '#fbf3da' }}>
          Pricing is not set — payouts will compute as ₦0. <button className="btn sm brass" style={{ marginLeft: 8 }} onClick={() => go('settings')}>Set pricing</button>
        </div>
      )}

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
    </>
  );
}
