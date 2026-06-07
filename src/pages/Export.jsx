import React, { useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../App.jsx';

function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7);
}

export default function ExportPage() {
  const notify = useToast();
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(thisMonth());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const q = mode === 'month' ? { month } : { from, to };
      const res = await api.exportBlob(q);
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const name = (cd.match(/filename="(.+?)"/) || [])[1] || 'Zilcycler_Payroll.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      notify('Workbook generated');
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><p className="eyebrow">Reporting</p><h1>Export payroll</h1></div></div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="row" style={{ marginBottom: 16, flex: '0 0 auto' }}>
          <button className={`btn sm ${mode === 'month' ? '' : 'ghost'}`} onClick={() => setMode('month')}>By month</button>
          <button className={`btn sm ${mode === 'range' ? '' : 'ghost'}`} onClick={() => setMode('range')}>Custom range</button>
        </div>

        {mode === 'month' ? (
          <label className="field" style={{ maxWidth: 240 }}><span>Month</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        ) : (
          <div className="row">
            <label className="field"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}

        <button className="btn brass" onClick={download} disabled={busy || (mode === 'range' && (!from || !to))}>
          {busy ? <span className="spinner" /> : '↧ Download .xlsx'}
        </button>

        <div className="card" style={{ background: 'var(--cream)', borderStyle: 'dashed', marginTop: 18 }}>
          <strong>Four sheets:</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.6 }}>
            <b>Sorters · PET</b> and <b>Sorters · Covers</b> — daily kg per worker with that material's payout.
            <b> Balers</b> — daily bale counts and payout. <b>Payment Summary</b> — one grand-total line
            per worker with bank details, ready to upload for the transfer. Date columns cover only the
            days that had records in the range.
          </p>
        </div>
      </div>
    </>
  );
}
