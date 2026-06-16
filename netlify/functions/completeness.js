import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isValidDate, todayLagos } from './_lib/dates.js';

// Which active workers do / don't have a live record for a given date?
// One missed sorter quietly costs someone their wage — this surfaces it.
export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || todayLagos();
  if (!isValidDate(date)) throw new HttpError(400, 'Invalid date');

  const rows = await sql`
    SELECT w.id, w.full_name, w.role,
           (r.id IS NOT NULL) AS has_record
      FROM workers w
      LEFT JOIN daily_records r
        ON r.worker_id = w.id AND r.date = ${date} AND r.deleted_at IS NULL
     WHERE w.is_active = true
     ORDER BY w.role, w.full_name`;

  const missing = rows.filter((r) => !r.has_record).map(strip);
  const recorded = rows.filter((r) => r.has_record).map(strip);

  return json({
    date,
    missing,
    recorded,
    counts: { active: rows.length, missing: missing.length, recorded: recorded.length },
  });
});

function strip(r) {
  return { id: r.id, full_name: r.full_name, role: r.role };
}
