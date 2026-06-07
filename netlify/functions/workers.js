import { handle, json, HttpError } from './_lib/respond.js';
import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { encrypt, decrypt } from './_lib/crypto.js';

const ROLES = ['Sorter', 'Baler'];

export default handle(async (req) => {
  requireAuth(req);
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (req.method === 'GET') {
    const activeOnly = url.searchParams.get('active') === '1';
    const rows = activeOnly
      ? await sql`SELECT * FROM workers WHERE is_active = true ORDER BY full_name`
      : await sql`SELECT * FROM workers ORDER BY is_active DESC, full_name`;
    return json(rows.map(view));
  }

  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    validate(b);
    const [row] = await sql`
      INSERT INTO workers (full_name, role, bank_name, account_number)
      VALUES (${b.full_name.trim()}, ${b.role}, ${encrypt(b.bank_name.trim())},
              ${encrypt(b.account_number.trim())})
      RETURNING *`;
    return json(view(row), 201);
  }

  if (req.method === 'PUT') {
    if (!id) throw new HttpError(400, 'Missing worker id');
    const b = await req.json().catch(() => ({}));
    validate(b);
    // Role may only change while the worker has no records (PRD §3.3).
    const [{ count }] = await sql`SELECT count(*)::int AS count
                                  FROM daily_records WHERE worker_id = ${id} AND deleted_at IS NULL`;
    const [current] = await sql`SELECT role FROM workers WHERE id = ${id}`;
    if (!current) throw new HttpError(404, 'Worker not found');
    if (count > 0 && current.role !== b.role) {
      throw new HttpError(409, 'Cannot change role: worker already has records');
    }
    const [row] = await sql`
      UPDATE workers
         SET full_name = ${b.full_name.trim()}, role = ${b.role},
             bank_name = ${encrypt(b.bank_name.trim())},
             account_number = ${encrypt(b.account_number.trim())},
             updated_at = now()
       WHERE id = ${id}
       RETURNING *`;
    return json(view(row));
  }

  // Soft deactivate / reactivate (never hard-delete).
  if (req.method === 'PATCH') {
    if (!id) throw new HttpError(400, 'Missing worker id');
    const b = await req.json().catch(() => ({}));
    const [row] = await sql`
      UPDATE workers SET is_active = ${!!b.is_active}, updated_at = now()
       WHERE id = ${id} RETURNING *`;
    if (!row) throw new HttpError(404, 'Worker not found');
    return json(view(row));
  }

  throw new HttpError(405, 'Method not allowed');
});

function validate(b) {
  if (!b.full_name || !b.full_name.trim()) throw new HttpError(400, 'Full name is required');
  if (!ROLES.includes(b.role)) throw new HttpError(400, 'Role must be Sorter or Baler');
  if (!b.bank_name || !b.bank_name.trim()) throw new HttpError(400, 'Bank name is required');
  const acct = (b.account_number || '').trim();
  if (!/^\d{10}$/.test(acct)) throw new HttpError(400, 'Account number must be a 10-digit NUBAN');
}

// Decrypt bank fields for the authenticated admin.
function view(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    bank_name: decrypt(row.bank_name),
    account_number: decrypt(row.account_number),
    is_active: row.is_active,
    created_at: row.created_at,
  };
}
