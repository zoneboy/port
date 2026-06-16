import React, { useEffect, useState, useMemo } from 'react';
import { api, naira, kg, intf } from '../api.js';
import { useToast } from '../App.jsx';

export default function Dashboard({ go }) {
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

      <Completeness asOf={d.asOf} go={go} />

      <div className="section-title">Today's output</div>
      <div className="grid cols-3">
        <Stat label="PET sorted" value={kg(d.today.pet_kg)} cls="accent-pet" />
        <Stat label="Covers sorted" value={kg(d.today.cover_kg)} cls="accent-leaf" />
        <Stat label="Bales produced" value={intf(d.today.bales)} cls="accent-brass" />
      </div>

      <div className="section-title">30-day trend</div>
      <TrendChart data={d.trend} asOf={d.asOf} />

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

// Which active workers still have no record for the chosen date.
function Completeness({ asOf, go }) {
  const notify = useToast();
  const [date, setDate] = useState(asOf);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.completeness(date).then(setData).catch((e) => notify(e.message, 'err'));
  }, [date, notify]);

  const missing = data?.missing || [];
  const alert = missing.length > 0;

  return (
    <div className="card" style={{ marginBottom: 24, borderColor: alert ? '#e6c2a8' : 'var(--line)', background: alert ? '#fbf1e8' : 'var(--paper)' }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: data ? 14 : 0 }}>
        <div style={{ flex: 1 }}>
          <div className="label" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4, letterSpacing: '0.06em' }}>
            Daily completeness
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>
            {!data ? 'Checking…'
              : alert ? `${missing.length} active worker${missing.length > 1 ? 's' : ''} with no record`
              : 'All active workers have a record'}
          </div>
        </div>
        <label className="field" style={{ marginBottom: 0, flex: '0 0 auto', minWidth: 170 }}>
          <span>Date</span>
          <input type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {data && alert && (
        <>
          <div className="chips">
            {missing.map((w) => (
              <span key={w.id} className={`chip ${w.role.toLowerCase()}`}>{w.full_name}<small>{w.role}</small></span>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14, alignItems: 'center', flex: '0 0 auto' }}>
            <button className="btn sm" onClick={() => go && go('entry')}>Go to entry</button>
            <span className="muted" style={{ fontSize: 13 }}>{data.counts.recorded} of {data.counts.active} recorded</span>
          </div>
        </>
      )}
      {data && !alert && (
        <div className="muted" style={{ fontSize: 13 }}>{data.counts.active} active workers, all accounted for.</div>
      )}
    </div>
  );
}

// Lightweight inline-SVG trend. Each series is normalised to its own peak over
// the window so dips and missing-entry days (drops to zero) stand out, even
// though kg and bale counts live on very different scales.
function TrendChart({ data, asOf }) {
  const [show, setShow] = useState({ pet_kg: true, cover_kg: true, bales: true });
  const SERIES = [
    { key: 'pet_kg', label: 'PET kg', color: 'var(--pet)' },
    { key: 'cover_kg', label: 'Cover kg', color: 'var(--leaf)' },
    { key: 'bales', label: 'Bales', color: 'var(--brass)' },
  ];

  // Build a gap-free 30-day axis ending at asOf; fill absent days with 0.
  const days = useMemo(() => {
    const byDate = new Map((data || []).map((r) => [String(r.date).slice(0, 10), r]));
    const out = [];
    const end = new Date(asOf + 'T00:00:00Z');
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(end);
      dt.setUTCDate(dt.getUTCDate() - i);
      const key = dt.toISOString().slice(0, 10);
      const r = byDate.get(key);
      out.push({
        date: key,
        pet_kg: Number(r?.pet_kg) || 0,
        cover_kg: Number(r?.cover_kg) || 0,
        bales: Number(r?.bales) || 0,
      });
    }
    return out;
  }, [data, asOf]);

  const W = 720, H = 200, padX = 8, padTop = 12, padBottom = 22;
  const n = days.length;
  const xAt = (i) => padX + (i * (W - padX * 2)) / (n - 1);
  const peaks = Object.fromEntries(SERIES.map((s) => [s.key, Math.max(1, ...days.map((d) => d[s.key]))]));
  const yAt = (key, v) => padTop + (1 - v / peaks[key]) * (H - padTop - padBottom);

  const hasAny = days.some((d) => d.pet_kg || d.cover_kg || d.bales);

  return (
    <div className="card">
      <div className="row" style={{ flex: '0 0 auto', gap: 8, marginBottom: 12 }}>
        {SERIES.map((s) => (
          <button key={s.key} className={`legend-btn ${show[s.key] ? '' : 'off'}`}
            onClick={() => setShow((p) => ({ ...p, [s.key]: !p[s.key] }))}>
            <span className="swatch" style={{ background: s.color, opacity: show[s.key] ? 1 : 0.3 }} />
            {s.label}<small>peak {s.key === 'bales' ? intf(peaks[s.key]) : kg(peaks[s.key])}</small>
          </button>
        ))}
      </div>

      {!hasAny ? (
        <div className="empty" style={{ padding: 28 }}>No output recorded in the last 30 days.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }} preserveAspectRatio="none">
          <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke="var(--line)" strokeWidth="1" />
          {SERIES.filter((s) => show[s.key]).map((s) => {
            const pts = days.map((d, i) => `${xAt(i)},${yAt(s.key, d[s.key])}`).join(' ');
            return (
              <g key={s.key}>
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {days.map((d, i) => (d[s.key] > 0
                  ? <circle key={i} cx={xAt(i)} cy={yAt(s.key, d[s.key])} r="2" fill={s.color} />
                  : null))}
              </g>
            );
          })}
          {days.map((d, i) => (i % 5 === 0 || i === n - 1) && (
            <text key={i} x={xAt(i)} y={H - 6} fontSize="9" fill="var(--muted)" textAnchor="middle">{d.date.slice(5)}</text>
          ))}
        </svg>
      )}
    </div>
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
