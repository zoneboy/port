import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isValidDate } from './_lib/dates.js';

export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  // ── List with filters ────────────────────────────────────────
  if (req.method === 'GET') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const workerId = url.searchParams.get('worker_id');
    const material = url.searchParams.get('material'); // PET | Cover | Bale

    const rows = await sql`
      SELECT r.id, r.date, r.worker_id, w.full_name, w.role,
             r.pet_kg, r.cover_kg, r.bales_produced,
             r.pet_rate, r.cover_rate, r.bale_rate, r.payout
        FROM daily_records r
        JOIN workers w ON w.id = r.worker_id
       WHERE r.deleted_at IS NULL
         AND (${from}::date IS NULL OR r.date >= ${from})
         AND (${to}::date IS NULL OR r.date <= ${to})
         AND (${workerId}::uuid IS NULL OR r.worker_id = ${workerId})
         AND (
           ${material}::text IS NULL
           OR (${material} = 'PET'   AND r.pet_kg IS NOT NULL AND r.pet_kg > 0)
           OR (${material} = 'Cover' AND r.cover_kg IS NOT NULL AND r.cover_kg > 0)
           OR (${material} = 'Bale'  AND r.bales_produced IS NOT NULL)
         )
       ORDER BY r.date DESC, w.full_name`;
    return json(rows);
  }

  // ── Create ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!isValidDate(b.date)) throw new HttpError(400, 'Valid date is required');

    const [worker] = await sql`SELECT id, role, is_active FROM workers WHERE id = ${b.worker_id}`;
    if (!worker) throw new HttpError(400, 'Unknown worker');

    const [rates] = await sql`SELECT pet_price_per_kg, cover_price_per_kg, bale_price FROM settings WHERE id = 1`;

    let fields;
    if (worker.role === 'Sorter') {
      const pet = nonNeg(b.pet_kg, 'PET weight');
      const cover = nonNeg(b.cover_kg, 'Cover weight');
      if (pet === 0 && cover === 0) throw new HttpError(400, 'Enter at least one of PET or Cover weight');
      fields = {
        pet_kg: pet, cover_kg: cover, bales: null,
        pet_rate: rates.pet_price_per_kg, cover_rate: rates.cover_price_per_kg, bale_rate: null,
      };
    } else {
      const bales = nonNegInt(b.bales_produced, 'Number of bales');
      if (bales === 0) throw new HttpError(400, 'Enter the number of bales');
      fields = {
        pet_kg: null, cover_kg: null, bales,
        pet_rate: null, cover_rate: null, bale_rate: rates.bale_price,
      };
    }

    let row;
    try {
      [row] = await sql`
        INSERT INTO daily_records
          (date, worker_id, pet_kg, cover_kg, bales_produced, pet_rate, cover_rate, bale_rate)
        VALUES (${b.date}, ${worker.id}, ${fields.pet_kg}, ${fields.cover_kg}, ${fields.bales},
                ${fields.pet_rate}, ${fields.cover_rate}, ${fields.bale_rate})
        RETURNING id, payout`;
    } catch (e) {
      if (String(e.message).includes('uniq_worker_day_live')) {
        throw new HttpError(409, 'This worker already has a record for that date. Edit it instead.');
      }
      throw e;
    }
    await audit(row.id, 'create', { ...fields, date: b.date, worker_id: worker.id });
    return json({ id: row.id, payout: row.payout }, 201);
  }

  // ── Update ───────────────────────────────────────────────────
  if (req.method === 'PUT') {
    if (!id) throw new HttpError(400, 'Missing record id');
    const b = await req.json().catch(() => ({}));

    const [rec] = await sql`
      SELECT r.*, w.role FROM daily_records r JOIN workers w ON w.id = r.worker_id
       WHERE r.id = ${id} AND r.deleted_at IS NULL`;
    if (!rec) throw new HttpError(404, 'Record not found');

    // Default: keep the snapshotted rate. applyCurrentRate re-snapshots to today's rate.
    let rates = { pet: rec.pet_rate, cover: rec.cover_rate, bale: rec.bale_rate };
    if (b.applyCurrentRate) {
      const [cur] = await sql`SELECT pet_price_per_kg, cover_price_per_kg, bale_price FROM settings WHERE id = 1`;
      rates = { pet: cur.pet_price_per_kg, cover: cur.cover_price_per_kg, bale: cur.bale_price };
    }

    let next;
    if (rec.role === 'Sorter') {
      const pet = nonNeg(b.pet_kg, 'PET weight');
      const cover = nonNeg(b.cover_kg, 'Cover weight');
      if (pet === 0 && cover === 0) throw new HttpError(400, 'Enter at least one of PET or Cover weight');
      next = { pet_kg: pet, cover_kg: cover, bales: null,
               pet_rate: rates.pet, cover_rate: rates.cover, bale_rate: null };
    } else {
      const bales = nonNegInt(b.bales_produced, 'Number of bales');
      if (bales === 0) throw new HttpError(400, 'Enter the number of bales');
      next = { pet_kg: null, cover_kg: null, bales,
               pet_rate: null, cover_rate: null, bale_rate: rates.bale };
    }

    const [row] = await sql`
      UPDATE daily_records
         SET pet_kg = ${next.pet_kg}, cover_kg = ${next.cover_kg}, bales_produced = ${next.bales},
             pet_rate = ${next.pet_rate}, cover_rate = ${next.cover_rate}, bale_rate = ${next.bale_rate},
             updated_at = now()
       WHERE id = ${id}
       RETURNING id, payout`;
    await audit(id, 'update', {
      before: { pet_kg: rec.pet_kg, cover_kg: rec.cover_kg, bales_produced: rec.bales_produced },
      after: next,
      applyCurrentRate: !!b.applyCurrentRate,
    });
    return json({ id: row.id, payout: row.payout });
  }

  // ── Soft delete ──────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) throw new HttpError(400, 'Missing record id');
    const [row] = await sql`
      UPDATE daily_records SET deleted_at = now(), updated_at = now()
       WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
    if (!row) throw new HttpError(404, 'Record not found');
    await audit(id, 'delete', {});
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
});

function nonNeg(v, label) {
  const n = v == null || v === '' ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number`);
  return n;
}
function nonNegInt(v, label) {
  const n = v == null || v === '' ? 0 : Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative whole number`);
  return n;
}
async function audit(recordId, action, changes) {
  await sql`INSERT INTO record_audit (record_id, action, changes)
            VALUES (${recordId}, ${action}, ${JSON.stringify(changes)})`;
}
