import { authOf, resolveBrand, store, dataKey, LEGACY_KEY, brandList, json }
  from './_shared.mjs';

/**
 * A brand is sent a dataset with the landed costs removed — not hidden,
 * removed. Margin and break-even are worked out in the browser from those
 * costs, so without them the columns simply have nothing to show, and there
 * is nothing in the response to dig out.
 */
function forViewer(ds) {
  const out = Object.assign({}, ds);
  delete out.cogs;
  delete out.fbmShipping;
  delete out.log;
  /* the cost file also carries the product names and grouping, which are not
     sensitive — keep those so the table still reads properly */
  out.names = {};
  Object.keys((ds && ds.cogs) || {}).forEach(function (a) {
    out.names[a] = { name: ds.cogs[a].name, group: ds.cogs[a].group };
  });
  return out;
}

export default async (req) => {
  const auth = await authOf(req);
  if (!auth) return json({ error: 'not signed in' }, 401);

  const asked = new URL(req.url).searchParams.get('brand');
  const slug = resolveBrand(auth, asked);
  if (!slug) return json({ error: 'no such brand for this sign-in' }, 403);

  const role = auth.role === 'team' ? 'admin' : 'viewer';
  const s = await store('report');
  let ds = null;
  try { ds = await s.get(dataKey(slug), { type: 'json' }); } catch (e) { ds = null; }
  /* Before this site held more than one brand the dataset sat under a bare
     key. Read it once more here so upgrading does not look like data loss;
     the next save writes it to the branded key and this stops mattering. */
  if (!ds && brandList()[0] && brandList()[0].slug === slug) {
    try { ds = await s.get(LEGACY_KEY, { type: 'json' }); } catch (e) { ds = null; }
  }
  if (!ds) return json({ role: role, brand: slug, dataset: null });

  return json({ role: role, brand: slug,
                dataset: role === 'admin' ? ds : forViewer(ds) });
};

export const config = { path: '/api/data' };
