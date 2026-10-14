import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isValidDate } from './_lib/dates.js';
import { readPet, NO_PET } from './_lib/pet.js';

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
             r.pet_clear_kg, r.pet_oily_kg, r.pet_brown_kg, r.pet_green_kg,
             r.pet_viju_kg, r.pet_freshyo_kg, r.pet_blue_kg,
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

    // Bulk single-date entry: { date, entries: [{ worker_id, pet_*_kg..., cover_kg | bales_produced }] }
    if (Array.isArray(b.entries)) return bulkUpsert(b.date, b.entries);

    const [worker] = await sql`SELECT id, role, is_active FROM workers WHERE id = ${b.worker_id}`;
    if (!worker) throw new HttpError(400, 'Unknown worker');

    const [rates] = await sql`SELECT pet_price_per_kg, cover_price_per_kg, bale_price FROM settings WHERE id = 1`;

    let fields;
    if (worker.role === 'Sorter') {
      const pet = readPet(b);
      const cover = nonNeg(b.cover_kg, 'Cover weight');
      if (pet.total === 0 && cover === 0) throw new HttpError(400, 'Enter at least one of PET or Cover weight');
      fields = {
        pet_kg: pet.total, ...pet.breakdown, cover_kg: cover, bales: null,
        pet_rate: rates.pet_price_per_kg, cover_rate: rates.cover_price_per_kg, bale_rate: null,
      };
    } else {
      const bales = nonNegInt(b.bales_produced, 'Number of bales');
      if (bales === 0) throw new HttpError(400, 'Enter the number of bales');
      fields = {
        pet_kg: null, ...NO_PET, cover_kg: null, bales,
        pet_rate: null, cover_rate: null, bale_rate: rates.bale_price,
      };
    }

    let row;
    try {
      [row] = await sql`
        INSERT INTO daily_records
          (date, worker_id, pet_kg, cover_kg, bales_produced, pet_rate, cover_rate, bale_rate,
           pet_clear_kg, pet_oily_kg, pet_brown_kg, pet_green_kg, pet_viju_kg, pet_freshyo_kg, pet_blue_kg)
        VALUES (${b.date}, ${worker.id}, ${fields.pet_kg}, ${fields.cover_kg}, ${fields.bales},
                ${fields.pet_rate}, ${fields.cover_rate}, ${fields.bale_rate},
                ${fields.pet_clear_kg}, ${fields.pet_oily_kg}, ${fields.pet_brown_kg}, ${fields.pet_green_kg},
                ${fields.pet_viju_kg}, ${fields.pet_freshyo_kg}, ${fields.pet_blue_kg})
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
      const pet = readPet(b);
      const cover = nonNeg(b.cover_kg, 'Cover weight');
      if (pet.total === 0 && cover === 0) throw new HttpError(400, 'Enter at least one of PET or Cover weight');
      next = { pet_kg: pet.total, ...pet.breakdown, cover_kg: cover, bales: null,
               pet_rate: rates.pet, cover_rate: rates.cover, bale_rate: null };
    } else {
      const bales = nonNegInt(b.bales_produced, 'Number of bales');
      if (bales === 0) throw new HttpError(400, 'Enter the number of bales');
      next = { pet_kg: null, ...NO_PET, cover_kg: null, bales,
               pet_rate: null, cover_rate: null, bale_rate: rates.bale };
    }

    const [row] = await sql`
      UPDATE daily_records
         SET pet_kg = ${next.pet_kg}, cover_kg = ${next.cover_kg}, bales_produced = ${next.bales},
             pet_rate = ${next.pet_rate}, cover_rate = ${next.cover_rate}, bale_rate = ${next.bale_rate},
             pet_clear_kg = ${next.pet_clear_kg}, pet_oily_kg = ${next.pet_oily_kg},
             pet_brown_kg = ${next.pet_brown_kg}, pet_green_kg = ${next.pet_green_kg},
             pet_viju_kg = ${next.pet_viju_kg}, pet_freshyo_kg = ${next.pet_freshyo_kg},
             pet_blue_kg = ${next.pet_blue_kg},
             updated_at = now()
       WHERE id = ${id}
       RETURNING id, payout`;
    await audit(id, 'update', {
      before: {
        pet_kg: rec.pet_kg, cover_kg: rec.cover_kg, bales_produced: rec.bales_produced,
        pet_clear_kg: rec.pet_clear_kg, pet_oily_kg: rec.pet_oily_kg, pet_brown_kg: rec.pet_brown_kg,
        pet_green_kg: rec.pet_green_kg, pet_viju_kg: rec.pet_viju_kg, pet_freshyo_kg: rec.pet_freshyo_kg,
        pet_blue_kg: rec.pet_blue_kg,
      },
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

// Upsert one record per worker for a single date. Empty rows are skipped (not
// zeroed), so an unfilled grid row leaves any existing record untouched. Rates
// are snapshotted from current settings (same-day entry => today's rate).
async function bulkUpsert(date, entries) {
  const [rates] = await sql`SELECT pet_price_per_kg, cover_price_per_kg, bale_price FROM settings WHERE id = 1`;

  // Roles for every referenced worker, in one query.
  const ids = [...new Set(entries.map((e) => e.worker_id).filter(Boolean))];
  if (ids.length === 0) return json({ saved: 0, skipped: 0, results: [] });
  const workers = await sql`SELECT id, role FROM workers WHERE id = ANY(${ids})`;
  const roleOf = new Map(workers.map((w) => [w.id, w.role]));

  const results = [];
  let saved = 0, skipped = 0;
  for (const e of entries) {
    const role = roleOf.get(e.worker_id);
    if (!role) { skipped++; continue; }

    let fields;
    if (role === 'Sorter') {
      const pet = readPet(e);
      const cover = nonNeg(e.cover_kg, 'Cover weight');
      if (pet.total === 0 && cover === 0) { skipped++; continue; }
      fields = { pet_kg: pet.total, ...pet.breakdown, cover_kg: cover, bales: null,
                 pet_rate: rates.pet_price_per_kg, cover_rate: rates.cover_price_per_kg, bale_rate: null };
    } else {
      const bales = nonNegInt(e.bales_produced, 'Number of bales');
      if (bales === 0) { skipped++; continue; }
      fields = { pet_kg: null, ...NO_PET, cover_kg: null, bales,
                 pet_rate: null, cover_rate: null, bale_rate: rates.bale_price };
    }

    const [row] = await sql`
      INSERT INTO daily_records
        (date, worker_id, pet_kg, cover_kg, bales_produced, pet_rate, cover_rate, bale_rate,
         pet_clear_kg, pet_oily_kg, pet_brown_kg, pet_green_kg, pet_viju_kg, pet_freshyo_kg, pet_blue_kg)
      VALUES (${date}, ${e.worker_id}, ${fields.pet_kg}, ${fields.cover_kg}, ${fields.bales},
              ${fields.pet_rate}, ${fields.cover_rate}, ${fields.bale_rate},
              ${fields.pet_clear_kg}, ${fields.pet_oily_kg}, ${fields.pet_brown_kg}, ${fields.pet_green_kg},
              ${fields.pet_viju_kg}, ${fields.pet_freshyo_kg}, ${fields.pet_blue_kg})
      ON CONFLICT (worker_id, date) WHERE deleted_at IS NULL
      DO UPDATE SET pet_kg = EXCLUDED.pet_kg, cover_kg = EXCLUDED.cover_kg,
                    bales_produced = EXCLUDED.bales_produced,
                    pet_rate = EXCLUDED.pet_rate, cover_rate = EXCLUDED.cover_rate,
                    bale_rate = EXCLUDED.bale_rate,
                    pet_clear_kg = EXCLUDED.pet_clear_kg, pet_oily_kg = EXCLUDED.pet_oily_kg,
                    pet_brown_kg = EXCLUDED.pet_brown_kg, pet_green_kg = EXCLUDED.pet_green_kg,
                    pet_viju_kg = EXCLUDED.pet_viju_kg, pet_freshyo_kg = EXCLUDED.pet_freshyo_kg,
                    pet_blue_kg = EXCLUDED.pet_blue_kg, updated_at = now()
      RETURNING id, payout, (xmax = 0) AS inserted`;
    await audit(row.id, row.inserted ? 'create' : 'update', { ...fields, date, worker_id: e.worker_id, bulk: true });
    results.push({ worker_id: e.worker_id, id: row.id, payout: row.payout });
    saved++;
  }
  return json({ saved, skipped, results });
}

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
