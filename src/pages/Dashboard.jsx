import React, { useEffect, useState } from 'react';
import { api, naira, kg, intf } from '../api.js';
import { useToast } from '../App.jsx';

export default function Dashboard() {
  const notify = useToast();
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState('week'); // week | month

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => notify(e.message, 'err'));
  }, [notify]);

  if (!d) return <div className="empty">Loading dashboard…</div>;
  const p = d[period];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Dashboard</h1>
        </div>
        <div className="row" style={{ flex: '0 0 auto' }}>
          <button className={`btn sm ${period === 'week' ? '' : 'ghost'}`} onClick={() => setPeriod('week')}>Last 7 days</button>
          <button className={`btn sm ${period === 'month' ? '' : 'ghost'}`} onClick={() => setPeriod('month')}>Last 30 days</button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: -14, marginBottom: 18, fontSize: 13 }}>As of {d.asOf} (Africa/Lagos)</p>

      <div className="section-title">Today's output</div>
      <div className="grid cols-3">
        <Stat label="PET sorted" value={kg(d.today.pet_kg)} cls="accent-pet" />
        <Stat label="Covers sorted" value={kg(d.today.cover_kg)} cls="accent-leaf" />
        <Stat label="Bales produced" value={intf(d.today.bales)} cls="accent-brass" />
      </div>

      <div className="section-title">{period === 'week' ? 'Last 7 days' : 'Last 30 days'}</div>
      <div className="grid cols-3">
        <Stat label="PET sorted" value={kg(p.pet_kg)} cls="accent-pet" />
        <Stat label="Covers sorted" value={kg(p.cover_kg)} cls="accent-leaf" />
        <Stat label="Bales produced" value={intf(p.bales)} cls="accent-brass" />
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="card stat" style={{ gridColumn: 'span 1' }}>
          <div className="label">Expected payout — {period === 'week' ? '7 days' : '30 days'}</div>
          <div className="value" style={{ color: 'var(--brass-dim)' }}>{naira(p.payout)}</div>
          <div className="sub">Sum of locked payouts in period</div>
        </div>
        <Leaderboard title="Top sorters (30d)" rows={d.topSorters} fmt={(r) => kg(r.kg)} />
        <Leaderboard title="Top balers (30d)" rows={d.topBalers} fmt={(r) => intf(r.bales) + ' bales'} />
      </div>
    </>
  );
}

function Stat({ label, value, cls }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${cls || ''}`}>{value}</div>
    </div>
  );
}

function Leaderboard({ title, rows, fmt }) {
  return (
    <div className="card">
      <div className="label" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>{title}</div>
      {(!rows || rows.length === 0) && <div className="muted" style={{ fontSize: 13 }}>No data yet</div>}
      {rows && rows.map((r, i) => (
        <div className="leader" key={i}>
          <span className="rank">{i + 1}</span>
          <span className="who">{r.full_name}</span>
          <span className="qty">{fmt(r)}</span>
        </div>
      ))}
    </div>
  );
}
