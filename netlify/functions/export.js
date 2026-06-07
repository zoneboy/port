import * as XLSX from 'xlsx';
import { handle, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { decrypt } from './_lib/crypto.js';
import { isValidDate, monthBounds } from './_lib/dates.js';

const NAIRA = '"₦"#,##0.00';
const KG = '#,##0.00';

export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);

  // Resolve the date range: ?month=YYYY-MM  OR  ?from=YYYY-MM-DD&to=YYYY-MM-DD
  let from, to, label;
  const month = url.searchParams.get('month');
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    ({ start: from, end: to } = monthBounds(y, m));
    label = month;
  } else {
    from = url.searchParams.get('from');
    to = url.searchParams.get('to');
    if (!isValidDate(from) || !isValidDate(to)) throw new HttpError(400, 'Provide month or a valid from/to range');
    label = `${from}_to_${to}`;
  }

  const rows = await sql`
    SELECT r.date, r.pet_kg, r.cover_kg, r.bales_produced, r.payout,
           r.pet_rate, r.cover_rate, r.bale_rate,
           w.id AS worker_id, w.full_name, w.role, w.bank_name, w.account_number
      FROM daily_records r JOIN workers w ON w.id = r.worker_id
     WHERE r.deleted_at IS NULL AND r.date >= ${from} AND r.date <= ${to}
     ORDER BY w.full_name, r.date`;

  // Decrypt bank fields once per worker.
  const bank = new Map();
  for (const r of rows) {
    if (!bank.has(r.worker_id)) {
      bank.set(r.worker_id, { name: decrypt(r.bank_name), acct: decrypt(r.account_number) });
    }
  }
  const d = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10));
  const workedDates = [...new Set(rows.map((r) => d(r.date)))].sort();

  const wb = XLSX.utils.book_new();

  // Sheet 1 — Sorters · PET
  buildMaterialSheet(wb, 'Sorters · PET', rows, workedDates, bank, {
    pick: (r) => Number(r.pet_kg) || 0,
    pay: (r) => (Number(r.pet_kg) || 0) * (Number(r.pet_rate) || 0),
    role: 'Sorter', qtyHeader: 'Total kg', qtyFmt: KG, payHeader: 'Total PET Payout',
  });

  // Sheet 2 — Sorters · Covers
  buildMaterialSheet(wb, 'Sorters · Covers', rows, workedDates, bank, {
    pick: (r) => Number(r.cover_kg) || 0,
    pay: (r) => (Number(r.cover_kg) || 0) * (Number(r.cover_rate) || 0),
    role: 'Sorter', qtyHeader: 'Total kg', qtyFmt: KG, payHeader: 'Total Cover Payout',
  });

  // Sheet 3 — Balers
  buildMaterialSheet(wb, 'Balers', rows, workedDates, bank, {
    pick: (r) => Number(r.bales_produced) || 0,
    pay: (r) => (Number(r.bales_produced) || 0) * (Number(r.bale_rate) || 0),
    role: 'Baler', qtyHeader: 'Total Bales', qtyFmt: '#,##0', payHeader: 'Total Payout',
  });

  // Sheet 4 — Payment Summary (one row per worker, used for the bank transfer)
  buildSummarySheet(wb, rows, bank);

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="Zilcycler_Payroll_${label}.xlsx"`,
    },
  });
});

function buildMaterialSheet(wb, name, rows, dates, bank, cfg) {
  // Workers of this role who have any quantity for this material in range.
  const byWorker = new Map();
  for (const r of rows) {
    if (r.role !== cfg.role) continue;
    if (cfg.pick(r) <= 0) continue;
    if (!byWorker.has(r.worker_id)) byWorker.set(r.worker_id, { name: r.full_name, cells: {}, total: 0, pay: 0 });
    const w = byWorker.get(r.worker_id);
    const key = (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10));
    w.cells[key] = (w.cells[key] || 0) + cfg.pick(r);
    w.total += cfg.pick(r);
    w.pay += cfg.pay(r);
  }

  const header = ['Name', 'Bank Name', 'Account No.', ...dates, cfg.qtyHeader, cfg.payHeader];
  const data = [header];
  for (const [id, w] of [...byWorker].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const b = bank.get(id) || { name: '', acct: '' };
    const row = [w.name, b.name, b.acct, ...dates.map((dt) => w.cells[dt] ?? ''), w.total, round2(w.pay)];
    data.push(row);
  }
  if (byWorker.size === 0) data.push(['No records in range']);

  const ws = XLSX.utils.aoa_to_sheet(data);
  formatSheet(ws, data.length, dates.length, cfg.qtyFmt);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function buildSummarySheet(wb, rows, bank) {
  const byWorker = new Map();
  for (const r of rows) {
    if (!byWorker.has(r.worker_id)) byWorker.set(r.worker_id, { name: r.full_name, role: r.role, pay: 0 });
    byWorker.get(r.worker_id).pay += Number(r.payout) || 0;
  }
  const header = ['Name', 'Role', 'Bank Name', 'Account No.', 'Total Payout'];
  const data = [header];
  let grand = 0;
  for (const [id, w] of [...byWorker].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const b = bank.get(id) || { name: '', acct: '' };
    data.push([w.name, w.role, b.name, b.acct, round2(w.pay)]);
    grand += w.pay;
  }
  data.push(['', '', '', 'GRAND TOTAL', round2(grand)]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  // currency format on the Total Payout column (col index 4)
  for (let r = 1; r < data.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 4 });
    if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = NAIRA;
  }
  ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 22 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Payment Summary');
}

// Apply column widths + number formats. Layout: 3 text cols, then `dateCount`
// quantity cols, then a quantity-total col, then a currency payout col.
function formatSheet(ws, rowCount, dateCount, qtyFmt) {
  const payCol = 3 + dateCount + 1;
  const totalCol = 3 + dateCount;
  for (let r = 1; r < rowCount; r++) {
    for (let c = 3; c <= totalCol; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = qtyFmt;
    }
    const payAddr = XLSX.utils.encode_cell({ r, c: payCol });
    if (ws[payAddr] && typeof ws[payAddr].v === 'number') ws[payAddr].z = NAIRA;
  }
  ws['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 16 },
    ...Array.from({ length: dateCount }, () => ({ wch: 11 })),
    { wch: 12 }, { wch: 16 }];
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
