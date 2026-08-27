import { setCookie, json } from './_shared.mjs';

export default async () => json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });

export const config = { path: '/api/logout' };
