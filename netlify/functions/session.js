import { handle, json } from './_lib/respond.js';
import { requireAuth, clearCookie, signSession, sessionCookie } from './_lib/auth.js';

// GET  /api/session  -> { email } if authenticated (used on app load + as a
//                       keepalive: it re-issues a fresh cookie so an active
//                       admin's session slides instead of hard-expiring).
// POST /api/session  -> logout (clears cookie)
export default handle(async (req) => {
  if (req.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }
  const me = requireAuth(req);
  return json({ email: me.sub }, 200, { 'set-cookie': sessionCookie(signSession(me.sub)) });
});
