import { handle, json } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { todayLagos, daysAgoLagos } from './_lib/dates.js';

export default handle(async (req) => {
  requireAuth(req);

  const today = todayLagos();
  const last7 = daysAgoLagos(6);   // inclusive 7-day window
  const last30 = daysAgoLagos(29); // inclusive 30-day window

  const totals = async (from, to) => {
    const [t] = await sql`
      SELECT COALESCE(SUM(pet_kg),0)::numeric        AS pet_kg,
             COALESCE(SUM(cover_kg),0)::numeric      AS cover_kg,
             COALESCE(SUM(bales_produced),0)::int    AS bales,
             COALESCE(SUM(payout),0)::numeric        AS payout
        FROM daily_records
       WHERE deleted_at IS NULL AND date >= ${from} AND date <= ${to}`;
    return t;
  };

  const topSorters = async (from, to) => sql`
    SELECT w.full_name, COALESCE(SUM(r.pet_kg),0) + COALESCE(SUM(r.cover_kg),0) AS kg
      FROM daily_records r JOIN workers w ON w.id = r.worker_id
     WHERE r.deleted_at IS NULL AND w.role = 'Sorter' AND r.date >= ${from} AND r.date <= ${to}
     GROUP BY w.full_name HAVING (COALESCE(SUM(r.pet_kg),0)+COALESCE(SUM(r.cover_kg),0)) > 0
     ORDER BY kg DESC LIMIT 3`;

  const topBalers = async (from, to) => sql`
    SELECT w.full_name, COALESCE(SUM(r.bales_produced),0) AS bales
      FROM daily_records r JOIN workers w ON w.id = r.worker_id
     WHERE r.deleted_at IS NULL AND w.role = 'Baler' AND r.date >= ${from} AND r.date <= ${to}
     GROUP BY w.full_name HAVING COALESCE(SUM(r.bales_produced),0) > 0
     ORDER BY bales DESC LIMIT 3`;

  const [todayT, week, month, sorters, balers] = await Promise.all([
    totals(today, today),
    totals(last7, today),
    totals(last30, today),
    topSorters(last30, today),
    topBalers(last30, today),
  ]);

  return json({
    today: todayT,
    week,
    month,
    topSorters: sorters,
    topBalers: balers,
    asOf: today,
  });
});
