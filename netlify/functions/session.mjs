import { authOf, brandsFor, store, metaKey, json } from './_shared.mjs';

/**
 * Who is signed in and what they may open. The cards page is drawn from this,
 * so it carries the last-saved stamp for each brand — read from a small meta
 * record rather than the dataset itself, which is megabytes.
 */
export default async (req) => {
  const auth = await authOf(req);
  if (!auth) return json({ error: 'not signed in' }, 401);

  const brands = brandsFor(auth);
  const s = await store('report');
  for (const b of brands) {
    let m = null;
    try { m = await s.get(metaKey(b.slug), { type: 'json' }); } catch (e) { m = null; }
    if (m) { b.savedAt = m.savedAt || null; b.savedBy = m.savedBy || null;
             b.days = m.days || 0; b.to = m.to || null; }
  }
  return json({ user: auth.user, role: auth.role, brand: auth.brand, brands: brands });
};

export const config = { path: '/api/session' };
