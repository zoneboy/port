import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default handle(async (req) => {
  requireAuth(req);

  if (req.method === 'GET') {
    const [s] = await sql`SELECT pet_price_per_kg, cover_price_per_kg, bale_price, washing_pay_per_worker, updated_at
                          FROM settings WHERE id = 1`;
    return json(s);
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    const pet = num(body.pet_price_per_kg);
    const cover = num(body.cover_price_per_kg);
    const bale = num(body.bale_price);
    const washing = num(body.washing_pay_per_worker);

    const [s] = await sql`
      UPDATE settings
         SET pet_price_per_kg = ${pet},
             cover_price_per_kg = ${cover},
             bale_price = ${bale},
             washing_pay_per_worker = ${washing},
             updated_at = now()
       WHERE id = 1
       RETURNING pet_price_per_kg, cover_price_per_kg, bale_price, washing_pay_per_worker, updated_at`;

    // keep an audit trail of pricing changes
    await sql`INSERT INTO settings_history (pet_price_per_kg, cover_price_per_kg, bale_price, washing_pay_per_worker)
              VALUES (${pet}, ${cover}, ${bale}, ${washing})`;

    return json(s);
  }

  throw new HttpError(405, 'Method not allowed');
});

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Rates must be non-negative numbers');
  return n;
}
