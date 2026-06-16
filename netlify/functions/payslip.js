import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { handle, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { decrypt } from './_lib/crypto.js';
import { isValidDate, monthBounds } from './_lib/dates.js';

// Brand colours (mirror the app theme).
const FOREST = rgb(0.07, 0.165, 0.125);
const BRASS = rgb(0.66, 0.525, 0.227);
const MUTED = rgb(0.435, 0.482, 0.443);
const LINE = rgb(0.85, 0.815, 0.74);
const INK = rgb(0.08, 0.125, 0.102);

export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);

  const workerId = url.searchParams.get('worker_id');
  if (!workerId) throw new HttpError(400, 'worker_id is required');

  // Resolve range: ?month=YYYY-MM  OR  ?from&to (mirrors export.js).
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

  const [worker] = await sql`SELECT id, full_name, role, bank_name, account_number FROM workers WHERE id = ${workerId}`;
  if (!worker) throw new HttpError(404, 'Worker not found');

  const records = await sql`
    SELECT date, pet_kg, cover_kg, bales_produced, pet_rate, cover_rate, bale_rate, payout
      FROM daily_records
     WHERE deleted_at IS NULL AND worker_id = ${workerId} AND date >= ${from} AND date <= ${to}
     ORDER BY date`;

  const adjustments = await sql`
    SELECT date, type, amount, note
      FROM worker_adjustments
     WHERE deleted_at IS NULL AND worker_id = ${workerId} AND date >= ${from} AND date <= ${to}
     ORDER BY date`;

  const bankName = decrypt(worker.bank_name);
  const acct = decrypt(worker.account_number);

  const pdf = await buildPdf({
    worker, bankName, acct, from, to, label, records, adjustments,
  });
  const bytes = await pdf.save();

  const safeName = worker.full_name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="Payslip_${safeName}_${label}.pdf"`,
    },
  });
});

async function buildPdf({ worker, bankName, acct, from, to, records, adjustments }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595, H = 842, M = 50;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s, x, yy, { size = 10, f = font, color = INK } = {}) =>
    page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (s, xRight, yy, opts = {}) => {
    const f = opts.f || font, size = opts.size || 10;
    const str = safe(s);
    const w = f.widthOfTextAtSize(str, size);
    text(str, xRight - w, yy, opts);
  };
  const hr = (yy, color = LINE) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 1, color });
  const ensure = (need) => {
    if (y - need < M) { page = doc.addPage([W, H]); y = H - M; }
  };

  // Header
  text('Zilcycler', M, y, { size: 24, f: bold, color: FOREST });
  right('PAYSLIP', W - M, y + 4, { size: 13, f: bold, color: BRASS });
  y -= 26;
  text('Record Management System', M, y, { size: 9, color: MUTED });
  y -= 26;
  hr(y); y -= 22;

  // Worker / period block
  text(worker.full_name, M, y, { size: 15, f: bold });
  right(`Period: ${from} to ${to}`, W - M, y, { size: 9.5, color: MUTED });
  y -= 16;
  text(worker.role, M, y, { size: 10, color: MUTED });
  y -= 28;

  // Earnings table
  const cAmt = W - M;            // right edge for amounts
  const cRate = W - M - 130;     // right edge for rate column
  text('EARNINGS', M, y, { size: 10, f: bold, color: FOREST });
  y -= 6; hr(y); y -= 16;
  text('Date', M, y, { size: 9, f: bold, color: MUTED });
  text('Detail', M + 80, y, { size: 9, f: bold, color: MUTED });
  right('Rate', cRate, y, { size: 9, f: bold, color: MUTED });
  right('Amount', cAmt, y, { size: 9, f: bold, color: MUTED });
  y -= 14;

  let gross = 0;
  const lineItems = [];
  for (const r of records) {
    const d = String(r.date).slice(0, 10);
    if (Number(r.pet_kg) > 0)
      lineItems.push([d, `${fmtKg(r.pet_kg)} kg PET`, `${money(r.pet_rate)}/kg`, Number(r.pet_kg) * Number(r.pet_rate)]);
    if (Number(r.cover_kg) > 0)
      lineItems.push([d, `${fmtKg(r.cover_kg)} kg Cover`, `${money(r.cover_rate)}/kg`, Number(r.cover_kg) * Number(r.cover_rate)]);
    if (Number(r.bales_produced) > 0)
      lineItems.push([d, `${r.bales_produced} bales`, `${money(r.bale_rate)}/bale`, Number(r.bales_produced) * Number(r.bale_rate)]);
  }

  if (lineItems.length === 0) {
    text('No recorded output in this period.', M, y, { size: 10, color: MUTED });
    y -= 16;
  }
  for (const [d, detail, rate, amt] of lineItems) {
    ensure(16);
    text(d, M, y, { size: 9.5 });
    text(detail, M + 80, y, { size: 9.5 });
    right(rate, cRate, y, { size: 9.5, color: MUTED });
    right(money(amt), cAmt, y, { size: 9.5 });
    gross += amt;
    y -= 15;
  }
  y -= 2; hr(y); y -= 16;
  text('Gross payout', M, y, { size: 10, f: bold });
  right(money(gross), cAmt, y, { size: 10, f: bold });
  y -= 26;

  // Adjustments
  const sum = { advance: 0, deduction: 0, bonus: 0 };
  for (const a of adjustments) sum[a.type] += Number(a.amount) || 0;

  if (adjustments.length > 0) {
    ensure(40);
    text('ADVANCES & ADJUSTMENTS', M, y, { size: 10, f: bold, color: FOREST });
    y -= 6; hr(y); y -= 16;
    for (const a of adjustments) {
      ensure(15);
      const d = String(a.date).slice(0, 10);
      const sign = a.type === 'bonus' ? '+' : '-';
      const labelTxt = cap(a.type) + (a.note ? ` — ${a.note}` : '');
      text(d, M, y, { size: 9.5 });
      text(labelTxt, M + 80, y, { size: 9.5 });
      right(`${sign} ${money(a.amount)}`, cAmt, y, { size: 9.5, color: a.type === 'bonus' ? FOREST : INK });
      y -= 15;
    }
    y -= 6;
  }

  // Net block
  ensure(70);
  hr(y); y -= 18;
  const netRow = (lbl, val, opts = {}) => {
    text(lbl, M + 80, y, { size: opts.size || 10, f: opts.f || font, color: opts.color || INK });
    right(val, cAmt, y, { size: opts.size || 10, f: opts.f || font, color: opts.color || INK });
    y -= opts.gap || 16;
  };
  netRow('Gross payout', money(gross));
  netRow('Less advances', `- ${money(sum.advance)}`);
  netRow('Less deductions', `- ${money(sum.deduction)}`);
  netRow('Plus bonus', `+ ${money(sum.bonus)}`);
  hr(y + 4); y -= 8;
  const net = gross - sum.advance - sum.deduction + sum.bonus;
  netRow('NET PAY', money(net), { size: 13, f: bold, color: FOREST, gap: 24 });

  // Bank footer
  ensure(60);
  hr(y); y -= 18;
  text('Payment to', M, y, { size: 9, f: bold, color: MUTED }); y -= 15;
  text(`${bankName}  ·  ${acct}`, M, y, { size: 10.5, f: bold }); y -= 24;
  text('Generated by Zilcycler RMS. Net pay reflects advances and adjustments dated within the period.',
    M, M - 14, { size: 8, color: MUTED });

  return doc;
}

function money(n) {
  return 'NGN ' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtKg(n) {
  return (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// pdf-lib standard fonts use WinAnsi encoding and throw on glyphs outside it.
// Map the common typographic characters and drop anything else unencodable
// (e.g. emoji in a note) so a stray character can never break the payslip.
const CHAR_MAP = {
  '‒': '-', '–': '-', '—': '-', '−': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '…': '...', '₦': 'NGN',
};
function safe(s) {
  return String(s == null ? '' : s).replace(/[^\x20-\x7E -ÿ]/g, (c) => CHAR_MAP[c] || '?');
}
