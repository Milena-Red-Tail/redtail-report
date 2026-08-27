/* ============================================================================
 *  Shared auth for the report functions.
 *
 *  One site, several brands. Two kinds of sign-in:
 *
 *    TEAM   — a named person on the Red-Tail side. Sees every brand, and is
 *             the only one allowed to upload. Set as
 *                 TEAM = milena|password1, jan|password2
 *
 *    BRAND  — the brand itself. Sees one report, read-only, with the landed
 *             costs stripped out of the payload. Set as
 *                 BRANDS = heale|Heale|password, gozney|Gozney|password
 *
 *  The dataset lives in a Netlify blob, one per brand, and the only way to it
 *  is through /api/data, which checks a signed cookie first. Nothing sensitive
 *  is ever in the HTML.
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

/* ---------- reading the people and brand lists ----------
 * Rows are separated by commas or newlines, fields inside a row by a pipe.
 * A password therefore may not contain a comma, a pipe or a line break —
 * everything else is fair game, and the error for a bad row is silence
 * rather than a half-parsed login. */
function rows(raw) {
  return String(raw || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.split('|').map(f => f.trim()));
}

/** [{ user, pw }] — the people who may see everything and upload. */
export function teamList() {
  const out = rows(env('TEAM'))
    .filter(r => r.length >= 2 && r[0] && r[1])
    .map(r => ({ user: r[0], pw: r[1] }));
  /* The first version of this site had a single ADMIN_PASSWORD. Anyone who
     set that up keeps working without touching Netlify again. */
  const legacy = env('ADMIN_PASSWORD');
  if (!out.length && legacy) out.push({ user: 'admin', pw: legacy });
  return out;
}

/** [{ slug, name, pw }] — the brands, in the order they were written down. */
export function brandList() {
  const out = rows(env('BRANDS'))
    .filter(r => r.length >= 2 && /^[a-z0-9][a-z0-9-]*$/.test(r[0]))
    .map(r => ({ slug: r[0], name: r[1] || r[0], pw: r[2] || '' }));
  if (out.length) return out;
  /* Same courtesy for the single-brand site: BRAND_NAME labels it, the old
     VIEWER_PASSWORD still opens it. */
  return [{ slug: 'report', name: env('BRAND_NAME') || 'Report',
            pw: env('VIEWER_PASSWORD') }];
}

export function brandBySlug(slug) {
  return brandList().find(b => b.slug === slug) || null;
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

/**
 * who = { user, role: 'team'|'brand', brand: slug|null }
 * The brand is baked into the cookie, not read from the request, so a brand
 * login cannot ask for another brand's data by changing a query string.
 */
export async function makeToken(who, secret) {
  const body = b64url(enc.encode(JSON.stringify({
    u: who.user, r: who.role, b: who.brand || null,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  })));
  return body + '.' + await hmac(body, secret);
}

/** Returns { user, role, brand } or null. Never throws on malformed input. */
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
    if (o.r !== 'team' && o.r !== 'brand') return null;
    if (o.r === 'brand' && !o.b) return null;
    return { user: String(o.u || ''), role: o.r, brand: o.b || null };
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

/** The session this request carries, or null when it carries none. */
export async function authOf(req) {
  const secret = env('SESSION_SECRET');
  if (!secret) return null;
  return readToken(cookieFrom(req), secret);
}

/** The brands this session may open, newest list order, with passwords out. */
export function brandsFor(auth) {
  if (!auth) return [];
  if (auth.role === 'team') return brandList().map(b => ({ slug: b.slug, name: b.name }));
  const b = brandBySlug(auth.brand);
  return b ? [{ slug: b.slug, name: b.name }] : [];
}

/** The brand asked for, or the only one this session has — null if not allowed. */
export function resolveBrand(auth, asked) {
  const mine = brandsFor(auth);
  if (!mine.length) return null;
  if (!asked) return auth.role === 'brand' ? mine[0].slug
    : (mine.length === 1 ? mine[0].slug : null);
  return mine.some(b => b.slug === asked) ? asked : null;
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

export const dataKey = slug => 'dataset:' + slug;
export const metaKey = slug => 'meta:' + slug;
/* What the single-brand version wrote before brands existed. Read as a
   fallback so an upgrade does not lose the data already up there. */
export const LEGACY_KEY = 'dataset';

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
