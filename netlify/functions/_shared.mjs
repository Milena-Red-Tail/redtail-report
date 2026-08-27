/* ============================================================================
 *  Shared auth for the report functions.
 *
 *  The whole point of moving to functions is that the data never reaches a
 *  browser that has not proved who it is. So the dataset lives in a Netlify
 *  blob, and the only way to it is through /api/data, which checks a signed
 *  cookie first. Nothing sensitive is ever in the HTML.
 * ========================================================================= */

const enc = new TextEncoder();

/* ---------- environment ---------- */
export function env(name) {
  const v = process.env[name];
  return v == null ? '' : String(v);
}
export const SESSION_HOURS = 12;

/* ---------- constant-time compare ----------
 * Comparing with === leaks how many characters matched through timing. */
export function sameSecret(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/* ---------- signed session cookie ---------- */
const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export async function makeToken(role, secret) {
  const body = b64url(enc.encode(JSON.stringify({
    role: role, exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  })));
  return body + '.' + await hmac(body, secret);
}

/** Returns the role, or null. Never throws on malformed input. */
export async function readToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const want = await hmac(body, secret);
  if (!sameSecret(sig, want)) return null;
  try {
    const o = JSON.parse(unb64url(body).toString('utf8'));
    if (!o || typeof o.exp !== 'number' || Date.now() > o.exp) return null;
    if (o.role !== 'admin' && o.role !== 'viewer') return null;
    return o.role;
  } catch (e) {
    return null;
  }
}

const COOKIE = 'rt_session';

export function cookieFrom(req) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

export function setCookie(token, maxAgeSeconds) {
  return COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' +
    maxAgeSeconds;
}

/** The role this request carries, or null when it carries none. */
export async function roleOf(req) {
  const secret = env('SESSION_SECRET');
  if (!secret) return null;
  return readToken(cookieFrom(req), secret);
}

/* ---------- responses ---------- */
export const json = (data, status = 200, headers = {}) => new Response(
  JSON.stringify(data),
  { status: status, headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    }, headers) });

/* ---------- blob store ----------
 * The in-memory fallback exists so the functions can be run and tested off
 * Netlify. It is behind an explicit flag: silently keeping a brand's data in
 * memory in production would lose it on every cold start. */
const MEM = new Map();
export async function store(name) {
  if (env('LOCAL_DEV') === '1') {
    return {
      get: async (k, o) => {
        const v = MEM.get(name + '/' + k);
        if (v === undefined) return null;
        return o && o.type === 'json' ? JSON.parse(v) : v;
      },
      setJSON: async (k, v) => { MEM.set(name + '/' + k, JSON.stringify(v)); },
      set: async (k, v) => { MEM.set(name + '/' + k, v); },
      delete: async (k) => { MEM.delete(name + '/' + k); },
    };
  }
  const { getStore } = await import('@netlify/blobs');
  return getStore(name);
}

export const DATA_KEY = 'dataset';

/* ---------- login throttle ----------
 * A password endpoint open to the internet is worth guessing at. This is not
 * a fortress, but it turns thousands of attempts a minute into a handful. */
export async function throttle(ip) {
  const s = await store('auth');
  const key = 'rl:' + (ip || 'unknown');
  const now = Date.now();
  let rec = null;
  try { rec = await s.get(key, { type: 'json' }); } catch (e) { rec = null; }
  if (!rec || now > rec.until) rec = { n: 0, until: now + 15 * 60 * 1000 };
  rec.n += 1;
  await s.setJSON(key, rec);
  return { blocked: rec.n > 10, retryInSeconds: Math.ceil((rec.until - now) / 1000) };
}
export async function clearThrottle(ip) {
  const s = await store('auth');
  try { await s.delete('rl:' + (ip || 'unknown')); } catch (e) { /* nothing to clear */ }
}
