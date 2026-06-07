import jwt from 'jsonwebtoken';
import { parse, serialize } from 'cookie';
import { HttpError } from './respond.js';

const COOKIE = 'zrms_session';
const MAX_AGE = 30 * 60; // 30 minutes

export function signSession(email) {
  return jwt.sign({ sub: email, role: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: MAX_AGE,
  });
}

export function sessionCookie(token) {
  return serialize(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearCookie() {
  return serialize(COOKIE, '', {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0,
  });
}

// Throws 401 if not authenticated. Returns the decoded payload otherwise.
export function requireAuth(req) {
  const header = req.headers.get('cookie') || '';
  const token = parse(header)[COOKIE];
  if (!token) throw new HttpError(401, 'Not authenticated');
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Session expired');
  }
}
