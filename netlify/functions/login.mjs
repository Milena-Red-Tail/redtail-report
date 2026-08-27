import { env, sameSecret, makeToken, setCookie, json, throttle, clearThrottle,
         SESSION_HOURS } from './_shared.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = env('SESSION_SECRET');
  const admin = env('ADMIN_PASSWORD');
  const viewer = env('VIEWER_PASSWORD');
  if (!secret || !admin) {
    return json({ error: 'The site is not configured yet — SESSION_SECRET and ' +
      'ADMIN_PASSWORD have to be set in Netlify.' }, 500);
  }

  const ip = req.headers.get('x-nf-client-connection-ip') ||
             (context && context.ip) || '';
  const gate = await throttle(ip);
  if (gate.blocked) {
    return json({ error: 'Too many attempts. Try again in ' +
      Math.ceil(gate.retryInSeconds / 60) + ' minutes.' }, 429);
  }

  let body = {};
  try { body = await req.json(); } catch (e) { body = {}; }
  const pw = String(body.password || '');

  /* Both are checked either way so the answer takes the same time whichever
     password was wrong — and an empty viewer password can never match. */
  const isAdmin = sameSecret(pw, admin);
  const isViewer = viewer ? sameSecret(pw, viewer) : false;
  const role = isAdmin ? 'admin' : (isViewer ? 'viewer' : null);
  if (!role) return json({ error: 'That password does not match.' }, 401);

  await clearThrottle(ip);
  return json({ role: role }, 200,
    { 'set-cookie': setCookie(await makeToken(role, secret), SESSION_HOURS * 3600) });
};

export const config = { path: '/api/login' };
