import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isValidDate } from './_lib/dates.js';

const TYPES = ['advance', 'deduction', 'bonus'];

export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  // ── List with filters ────────────────────────────────────────
  if (req.method === 'GET') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const workerId = url.searchParams.get('worker_id');

    const rows = await sql`
      SELECT a.id, a.date, a.worker_id, w.full_name, w.role,
             a.type, a.amount, a.note, a.created_at
        FROM worker_adjustments a
        JOIN workers w ON w.id = a.worker_id
       WHERE a.deleted_at IS NULL
         AND (${from}::date IS NULL OR a.date >= ${from})
         AND (${to}::date IS NULL OR a.date <= ${to})
         AND (${workerId}::uuid IS NULL OR a.worker_id = ${workerId})
       ORDER BY a.date DESC, w.full_name`;
    return json(rows);
  }

  // ── Create ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!isValidDate(b.date)) throw new HttpError(400, 'Valid date is required');
    if (!TYPES.includes(b.type)) throw new HttpError(400, 'Type must be advance, deduction or bonus');
    const amount = positive(b.amount, 'Amount');

    const [worker] = await sql`SELECT id FROM workers WHERE id = ${b.worker_id}`;
    if (!worker) throw new HttpError(400, 'Unknown worker');

    const note = (b.note ?? '').toString().trim() || null;
    const [row] = await sql`
      INSERT INTO worker_adjustments (worker_id, date, type, amount, note)
      VALUES (${worker.id}, ${b.date}, ${b.type}, ${amount}, ${note})
      RETURNING id`;
    return json({ id: row.id }, 201);
  }

  // ── Soft delete ──────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) throw new HttpError(400, 'Missing adjustment id');
    const [row] = await sql`
      UPDATE worker_adjustments SET deleted_at = now()
       WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
    if (!row) throw new HttpError(404, 'Adjustment not found');
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
});

function positive(v, label) {
  const n = v == null || v === '' ? 0 : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label} must be greater than zero`);
  return n;
}
