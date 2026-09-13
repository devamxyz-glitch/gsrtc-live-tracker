/**
 * The owner's dashboard: how the app is being used, so it can be made better.
 *
 * **What this deliberately cannot do.** The app tells every rider, on its own Settings screen,
 * "no accounts, no ads, no tracking", and it means it — commutes and saved buses live in the
 * browser and are never sent anywhere. So there is no user table here, and none is added: every
 * number below is an aggregate keyed on the thing that was asked for, never on who asked. There
 * is no identifier to join on, which is what makes the promise structurally true rather than a
 * policy someone has to remember. "How popular is this bus today" is answerable; "what is this
 * person doing" is not, and adding it would mean editing the privacy text on the way past.
 *
 * Auth is a password in `.env` and a signed cookie. Unset means the whole surface 404s, so a
 * deployment that forgets to configure it is closed rather than open.
 */

import crypto from 'node:crypto';

const env = process.env;

export const password = env.ADMIN_PASSWORD || '';
export const enabled = Boolean(password);

const COOKIE = 'st_admin';
const SESSION_MS = 8 * 3600 * 1000;

/**
 * A secret for signing sessions. Derived from the password when none is set, so sessions are
 * still unforgeable without adding another thing to configure — and rotating the password
 * invalidates every existing session, which is the behaviour you want from a password change.
 */
const SECRET = env.ADMIN_SECRET || (enabled
  ? crypto.createHash('sha256').update(`st-admin:${password}`).digest()
  : crypto.randomBytes(32));

/* ------------------------------------------------------------------ sessions */

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function issueSession() {
  const expires = Date.now() + SESSION_MS;
  return `${expires}.${sign(String(expires))}`;
}

export function validSession(token) {
  if (!enabled || !token) return false;
  const [expires, mac] = String(token).split('.');
  if (!expires || !mac) return false;
  if (Number(expires) < Date.now()) return false;

  // Compare the MACs, not the tokens: a plain === on secrets leaks their contents through how
  // long it takes to fail.
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(mac);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function checkPassword(candidate) {
  if (!enabled) return false;
  // Hash both sides first so timingSafeEqual never sees mismatched lengths, which would throw
  // and turn "wrong length" into a different, faster answer than "wrong password".
  const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

export function sessionCookie(token, { secure }) {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',                 // a stolen XSS payload still cannot read it
    'SameSite=Strict',          // and cannot be ridden from another origin
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export function readCookie(header) {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

/* ------------------------------------------------------------------ brute force */

/**
 * Login attempts, per address.
 *
 * The password is short and guessable by design right now — it is an email address — so the
 * only thing standing between it and a dictionary is this. Failures back off; a success clears
 * the record entirely.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 6;
const LOCKOUT_MS = 15 * 60 * 1000;

export function loginBlocked(ip) {
  const record = attempts.get(ip);
  if (!record) return 0;
  if (Date.now() > record.until) { attempts.delete(ip); return 0; }
  return record.n >= MAX_ATTEMPTS ? Math.ceil((record.until - Date.now()) / 1000) : 0;
}

export function noteFailure(ip) {
  const record = attempts.get(ip) || { n: 0, until: 0 };
  record.n += 1;
  record.until = Date.now() + LOCKOUT_MS;
  attempts.set(ip, record);
  if (attempts.size > 5000) attempts.clear();   // bounded; losing it only forgives lockouts
}

export const noteSuccess = (ip) => attempts.delete(ip);
