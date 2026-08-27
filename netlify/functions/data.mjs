import { roleOf, store, DATA_KEY, json } from './_shared.mjs';

/**
 * A viewer is sent a dataset with the landed costs removed — not hidden,
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
  const role = await roleOf(req);
  if (!role) return json({ error: 'not signed in' }, 401);

  const s = await store('report');
  let ds = null;
  try { ds = await s.get(DATA_KEY, { type: 'json' }); } catch (e) { ds = null; }
  if (!ds) return json({ role: role, dataset: null });

  return json({ role: role, dataset: role === 'admin' ? ds : forViewer(ds) });
};

export const config = { path: '/api/data' };
