import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../App.jsx';

function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7);
}

async function downloadFrom(resPromise, fallbackName) {
  const res = await resPromise;
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = (cd.match(/filename="(.+?)"/) || [])[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const notify = useToast();
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(thisMonth());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [format, setFormat] = useState('xlsx');     // xlsx | csv
  const [csvKind, setCsvKind] = useState('records'); // records | summary
  const [busy, setBusy] = useState(false);

  const rangeQ = () => (mode === 'month' ? { month } : { from, to });

  const download = async () => {
    setBusy(true);
    try {
      const q = rangeQ();
      if (format === 'csv') { q.format = 'csv'; q.csv = csvKind; }
      await downloadFrom(api.exportBlob(q), `Zilcycler_Payroll.${format}`);
      notify(format === 'csv' ? 'CSV generated' : 'Workbook generated');
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

        <div className="row" style={{ marginBottom: 4, flex: '0 0 auto' }}>
          <label className="field" style={{ maxWidth: 220 }}><span>Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="xlsx">Excel workbook (.xlsx)</option>
              <option value="csv">CSV (raw data)</option>
            </select>
          </label>
          {format === 'csv' && (
            <label className="field" style={{ maxWidth: 240 }}><span>CSV contents</span>
              <select value={csvKind} onChange={(e) => setCsvKind(e.target.value)}>
                <option value="records">Raw records (one row each)</option>
                <option value="summary">Payment summary (net pay)</option>
              </select>
            </label>
          )}
        </div>

        <button className="btn brass" onClick={download} disabled={busy || (mode === 'range' && (!from || !to))}>
          {busy ? <span className="spinner" /> : `↧ Download .${format}`}
        </button>

        <div className="card" style={{ background: 'var(--cream)', borderStyle: 'dashed', marginTop: 18 }}>
          <strong>The workbook has four sheets:</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.6 }}>
            <b>Sorters · PET</b> and <b>Sorters · Covers</b> — daily kg per worker with that material's payout.
            <b> Balers</b> — daily bale counts and payout. <b>Payment Summary</b> — one line per worker showing
            gross, advances, deductions, bonus and <b>net pay</b> with bank details, ready for the transfer.
            CSV gives the same data without formatting — raw records for pivoting, or the netted summary.
          </p>
        </div>
      </div>

      <PayslipCard mode={mode} month={month} from={from} to={to} />
    </>
  );
}

function PayslipCard({ mode, month, from, to }) {
  const notify = useToast();
  const [workers, setWorkers] = useState([]);
  const [workerId, setWorkerId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listWorkers(false).then(setWorkers).catch(() => {}); }, []);

  const download = async () => {
    if (!workerId) return notify('Select a worker', 'err');
    if (mode === 'range' && (!from || !to)) return notify('Set a from/to range above', 'err');
    setBusy(true);
    try {
      const q = mode === 'month' ? { worker_id: workerId, month } : { worker_id: workerId, from, to };
      await downloadFrom(api.payslipBlob(q), 'Payslip.pdf');
      notify('Payslip generated');
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 560, marginTop: 22 }}>
      <div className="label" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12, letterSpacing: '0.06em' }}>
        Per-worker payslip (PDF)
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14, fontSize: 13.5 }}>
        A printable record for one worker over the period selected above — output breakdown,
        advances/deductions, and net pay, with bank details.
      </p>
      <label className="field"><span>Worker</span>
        <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">Select worker…</option>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name} · {w.role}</option>)}
        </select>
      </label>
      <button className="btn" onClick={download} disabled={busy}>
        {busy ? <span className="spinner" /> : '↧ Download payslip'}
      </button>
    </div>
  );
}
