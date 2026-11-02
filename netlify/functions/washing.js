import { randomUUID } from 'node:crypto';
import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isValidDate } from './_lib/dates.js';

// Washing days: a group of existing workers washes a material and each is paid
// the same fixed amount (settings.washing_pay_per_worker, snapshotted per day).
export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  // ── List with filters ────────────────────────────────────────
  if (req.method === 'GET') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const rows = await sql`
      SELECT s.id, s.date::text AS date, s.material, s.kg_washed, s.pay_rate, s.note,
             COALESCE(json_agg(json_build_object('id', w.id, 'full_name', w.full_name, 'role', w.role)
                               ORDER BY w.full_name) FILTER (WHERE w.id IS NOT NULL), '[]') AS workers
        FROM washing_sessions s
        LEFT JOIN washing_workers ww ON ww.session_id = s.id
        LEFT JOIN workers w ON w.id = ww.worker_id
       WHERE s.deleted_at IS NULL
         AND (${from}::date IS NULL OR s.date >= ${from})
         AND (${to}::date IS NULL OR s.date <= ${to})
       GROUP BY s.id
       ORDER BY s.date DESC, s.created_at DESC`;
    return json(rows.map((r) => ({ ...r, total: round2(Number(r.pay_rate) * r.workers.length) })));
  }

  // ── Create ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const f = await readBody(b);
    const [rates] = await sql`SELECT washing_pay_per_worker FROM settings WHERE id = 1`;
    const sessionId = randomUUID();

    await sql.transaction([
      sql`INSERT INTO washing_sessions (id, date, material, kg_washed, pay_rate, note)
          VALUES (${sessionId}, ${f.date}, ${f.material}, ${f.kg}, ${rates.washing_pay_per_worker}, ${f.note})`,
      sql`INSERT INTO washing_workers (session_id, worker_id)
          SELECT ${sessionId}, unnest(${f.workerIds}::uuid[])`,
    ]);
    const total = round2(Number(rates.washing_pay_per_worker) * f.workerIds.length);
    return json({ id: sessionId, workers: f.workerIds.length, pay_rate: rates.washing_pay_per_worker, total }, 201);
  }

  // ── Update (keeps the original rate unless applyCurrentRate) ─
  if (req.method === 'PUT') {
    if (!id) throw new HttpError(400, 'Missing washing id');
    const b = await req.json().catch(() => ({}));
    const f = await readBody(b);

    const [cur] = await sql`SELECT pay_rate FROM washing_sessions WHERE id = ${id} AND deleted_at IS NULL`;
    if (!cur) throw new HttpError(404, 'Washing day not found');
    let rate = cur.pay_rate;
    if (b.applyCurrentRate) {
      [{ washing_pay_per_worker: rate }] = await sql`SELECT washing_pay_per_worker FROM settings WHERE id = 1`;
    }

    await sql.transaction([
      sql`UPDATE washing_sessions
             SET date = ${f.date}, material = ${f.material}, kg_washed = ${f.kg},
                 pay_rate = ${rate}, note = ${f.note}, updated_at = now()
           WHERE id = ${id}`,
      sql`DELETE FROM washing_workers WHERE session_id = ${id}`,
      sql`INSERT INTO washing_workers (session_id, worker_id)
          SELECT ${id}, unnest(${f.workerIds}::uuid[])`,
    ]);
    return json({ id, workers: f.workerIds.length, pay_rate: rate, total: round2(Number(rate) * f.workerIds.length) });
  }

  // ── Soft delete ──────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) throw new HttpError(400, 'Missing washing id');
    const [row] = await sql`
      UPDATE washing_sessions SET deleted_at = now(), updated_at = now()
       WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
    if (!row) throw new HttpError(404, 'Washing day not found');
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
});

async function readBody(b) {
  if (!isValidDate(b.date)) throw new HttpError(400, 'Valid date is required');
  const material = (b.material ?? '').toString().trim() || 'Oily PET';
  const kg = b.kg_washed == null || b.kg_washed === '' ? 0 : Number(b.kg_washed);
  if (!Number.isFinite(kg) || kg < 0) throw new HttpError(400, 'Kg washed must be a non-negative number');
  const note = (b.note ?? '').toString().trim() || null;

  const workerIds = [...new Set(Array.isArray(b.worker_ids) ? b.worker_ids : [])];
  if (workerIds.length === 0) throw new HttpError(400, 'Tick at least one worker who washed');
  const found = await sql`SELECT id FROM workers WHERE id = ANY(${workerIds}::uuid[])`;
  if (found.length !== workerIds.length) throw new HttpError(400, 'Unknown worker in the list');

  return { date: b.date, material, kg, note, workerIds };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
