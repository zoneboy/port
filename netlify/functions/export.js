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

  // Adjustments dated within the period — these net against gross on the
  // Payment Summary. Joined to workers so adjustment-only workers (advance but
  // no recorded output) still surface, with a negative/zero net as a red flag.
  const adjRows = await sql`
    SELECT a.worker_id, w.full_name, w.role, w.bank_name, w.account_number,
           a.type, COALESCE(SUM(a.amount),0)::numeric AS total
      FROM worker_adjustments a JOIN workers w ON w.id = a.worker_id
     WHERE a.deleted_at IS NULL AND a.date >= ${from} AND a.date <= ${to}
     GROUP BY a.worker_id, w.full_name, w.role, w.bank_name, w.account_number, a.type`;

  // Decrypt bank fields once per worker (from records and adjustments alike).
  const bank = new Map();
  const meta = new Map(); // worker_id -> { name, role }
  const remember = (r) => {
    if (!bank.has(r.worker_id)) bank.set(r.worker_id, { name: decrypt(r.bank_name), acct: decrypt(r.account_number) });
    if (!meta.has(r.worker_id)) meta.set(r.worker_id, { name: r.full_name, role: r.role });
  };
  rows.forEach(remember);
  adjRows.forEach(remember);

  // worker_id -> { advance, deduction, bonus }
  const adj = new Map();
  for (const a of adjRows) {
    if (!adj.has(a.worker_id)) adj.set(a.worker_id, { advance: 0, deduction: 0, bonus: 0 });
    adj.get(a.worker_id)[a.type] += Number(a.total) || 0;
  }

  const d = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10));
  const workedDates = [...new Set(rows.map((r) => d(r.date)))].sort();

  // ── CSV branch: raw records or the payment summary, unformatted ──
  const format = url.searchParams.get('format');
  if (format === 'csv') {
    const kind = url.searchParams.get('csv') === 'summary' ? 'summary' : 'records';
    const csv = kind === 'summary'
      ? summaryCsv(summaryRows(rows, adj, meta, bank))
      : recordsCsv(rows, bank, d);
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="Zilcycler_${kind}_${label}.csv"`,
      },
    });
  }

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
  buildSummarySheet(wb, summaryRows(rows, adj, meta, bank));

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

// One netted row per worker who has either records or adjustments in range.
// net = gross − advances − deductions + bonuses. Sorted by name.
function summaryRows(rows, adj, meta, bank) {
  const gross = new Map();
  for (const r of rows) gross.set(r.worker_id, (gross.get(r.worker_id) || 0) + (Number(r.payout) || 0));

  const ids = new Set([...meta.keys()]);
  const out = [];
  for (const id of ids) {
    const m = meta.get(id) || { name: '', role: '' };
    const b = bank.get(id) || { name: '', acct: '' };
    const a = adj.get(id) || { advance: 0, deduction: 0, bonus: 0 };
    const g = gross.get(id) || 0;
    const net = g - a.advance - a.deduction + a.bonus;
    out.push({
      name: m.name, role: m.role, bankName: b.name, acct: b.acct,
      gross: round2(g), advances: round2(a.advance), deductions: round2(a.deduction),
      bonus: round2(a.bonus), net: round2(net),
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

function buildSummarySheet(wb, summary) {
  const header = ['Name', 'Role', 'Bank Name', 'Account No.',
    'Gross Payout', 'Advances', 'Deductions', 'Bonus', 'Net Payout'];
  const data = [header];
  const totals = { gross: 0, advances: 0, deductions: 0, bonus: 0, net: 0 };
  for (const s of summary) {
    data.push([s.name, s.role, s.bankName, s.acct, s.gross, s.advances, s.deductions, s.bonus, s.net]);
    totals.gross += s.gross; totals.advances += s.advances; totals.deductions += s.deductions;
    totals.bonus += s.bonus; totals.net += s.net;
  }
  data.push(['', '', '', 'GRAND TOTAL',
    round2(totals.gross), round2(totals.advances), round2(totals.deductions), round2(totals.bonus), round2(totals.net)]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  // currency format on the four money columns (indices 4..8)
  for (let r = 1; r < data.length; r++) {
    for (let c = 4; c <= 8; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = NAIRA;
    }
  }
  ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 22 }, { wch: 16 },
    { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Payment Summary');
}

// ── CSV builders ──────────────────────────────────────────────
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvLine(arr) { return arr.map(csvCell).join(','); }

// Account numbers are kept as a leading-zero-safe text formula so Sheets/Excel
// don't strip a leading 0 from a NUBAN.
function acctText(acct) { return acct ? `="${acct}"` : ''; }

function recordsCsv(rows, bank, d) {
  const header = ['Date', 'Worker', 'Role', 'Bank Name', 'Account No.',
    'PET kg', 'Cover kg', 'Bales', 'PET rate', 'Cover rate', 'Bale rate', 'Payout'];
  const lines = [csvLine(header)];
  const sorted = [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name) || d(a.date).localeCompare(d(b.date)));
  for (const r of sorted) {
    const b = bank.get(r.worker_id) || { name: '', acct: '' };
    lines.push(csvLine([
      d(r.date), r.full_name, r.role, b.name, acctText(b.acct),
      num(r.pet_kg), num(r.cover_kg), num(r.bales_produced),
      num(r.pet_rate), num(r.cover_rate), num(r.bale_rate), round2(r.payout),
    ]));
  }
  return lines.join('\r\n');
}

function summaryCsv(summary) {
  const header = ['Name', 'Role', 'Bank Name', 'Account No.',
    'Gross Payout', 'Advances', 'Deductions', 'Bonus', 'Net Payout'];
  const lines = [csvLine(header)];
  for (const s of summary) {
    lines.push(csvLine([s.name, s.role, s.bankName, acctText(s.acct),
      s.gross, s.advances, s.deductions, s.bonus, s.net]));
  }
  return lines.join('\r\n');
}

function num(v) { return v == null ? '' : Number(v); }

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
