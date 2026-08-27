import { env, sameSecret, makeToken, setCookie, json, throttle, clearThrottle,
         teamList, brandList, SESSION_HOURS } from './_shared.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = env('SESSION_SECRET');
  const team = teamList();
  if (!secret || !team.length) {
    return json({ error: 'The site is not configured yet — SESSION_SECRET and ' +
      'TEAM have to be set in Netlify.' }, 500);
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

  /* Every row is compared even after a match, so the answer takes the same
     time whichever password was given — the number of people on the team is
     not something a stopwatch should be able to count. A blank password in
     the list can never match, whatever is typed. */
  let who = null;
  for (const p of team) {
    if (p.pw && sameSecret(pw, p.pw) && !who) who = { user: p.user, role: 'team', brand: null };
  }
  for (const b of brandList()) {
    if (b.pw && sameSecret(pw, b.pw) && !who) who = { user: b.name, role: 'brand', brand: b.slug };
  }
  if (!who) return json({ error: 'That password does not match.' }, 401);

  await clearThrottle(ip);
  return json({ user: who.user, role: who.role, brand: who.brand }, 200,
    { 'set-cookie': setCookie(await makeToken(who, secret), SESSION_HOURS * 3600) });
};

export const config = { path: '/api/login' };
