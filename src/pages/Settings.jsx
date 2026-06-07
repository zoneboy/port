import React, { useEffect, useState } from 'react';
import { api, naira } from '../api.js';
import { useToast } from '../App.jsx';

export default function Settings() {
  const notify = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getSettings().then(setS).catch((e) => notify(e.message, 'err')); }, [notify]);
  if (!s) return <div className="empty">Loading…</div>;

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.saveSettings({
        pet_price_per_kg: Number(s.pet_price_per_kg) || 0,
        cover_price_per_kg: Number(s.cover_price_per_kg) || 0,
        bale_price: Number(s.bale_price) || 0,
      });
      setS(saved);
      notify('Pricing updated');
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><p className="eyebrow">Configuration</p><h1>Pricing</h1></div></div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="row">
          <label className="field"><span>PET — price per kg</span>
            <input type="number" min="0" step="0.01" value={s.pet_price_per_kg} onChange={set('pet_price_per_kg')} /></label>
          <label className="field"><span>Covers — price per kg</span>
            <input type="number" min="0" step="0.01" value={s.cover_price_per_kg} onChange={set('cover_price_per_kg')} /></label>
        </div>
        <label className="field" style={{ maxWidth: 260 }}><span>Bale — price each</span>
          <input type="number" min="0" step="0.01" value={s.bale_price} onChange={set('bale_price')} /></label>

        <div className="card" style={{ background: 'var(--cream)', borderStyle: 'dashed', marginTop: 6, marginBottom: 18 }}>
          <strong>How pricing works.</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.5 }}>
            These rates are copied onto each record at the moment it is saved. Changing them
            here affects <em>future</em> entries only — every payout already recorded stays exactly
            as it was. Current rates: PET {naira(s.pet_price_per_kg)}/kg · Covers {naira(s.cover_price_per_kg)}/kg · Bale {naira(s.bale_price)}.
          </p>
        </div>

        <button className="btn" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'Save pricing'}</button>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Last updated: {s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}</p>
      </div>
    </>
  );
}
