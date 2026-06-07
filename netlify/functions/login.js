import bcrypt from 'bcryptjs';
import { handle, json, HttpError } from './_lib/respond.js';
import { signSession, sessionCookie } from './_lib/auth.js';
import { allowLogin } from './_lib/ratelimit.js';

export default handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const ip = req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (!(await allowLogin(ip))) {
    throw new HttpError(429, 'Too many attempts. Try again later.');
  }

  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) throw new HttpError(400, 'Email and password are required');

  const okEmail = email.trim().toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase();
  const okPass = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || '');

  // Generic message either way — don't reveal which field was wrong.
  if (!okEmail || !okPass) throw new HttpError(401, 'Invalid email or password');

  const token = signSession(email.trim().toLowerCase());
  return json({ ok: true, email: email.trim().toLowerCase() }, 200, {
    'set-cookie': sessionCookie(token),
  });
});
