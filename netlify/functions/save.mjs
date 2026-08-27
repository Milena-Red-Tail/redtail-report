import { gunzipSync } from 'node:zlib';
import { authOf, resolveBrand, store, dataKey, metaKey, json } from './_shared.mjs';

const MAX_BYTES = 12 * 1024 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  /* SameSite=Lax already stops a cross-site form from carrying the cookie;
     requiring a header a plain form cannot set closes the rest. */
  if (req.headers.get('x-report-write') !== '1') {
    return json({ error: 'missing write header' }, 400);
  }
  const auth = await authOf(req);
  if (!auth || auth.role !== 'team') return json({ error: 'team only' }, 403);

  const asked = new URL(req.url).searchParams.get('brand');
  const slug = resolveBrand(auth, asked);
  if (!slug) return json({ error: 'which brand? none was named' }, 400);

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return json({ error: 'empty body' }, 400);
  if (buf.length > MAX_BYTES) return json({ error: 'too large' }, 413);

  let ds;
  try {
    /* the browser gzips before sending — a three-year dataset is megabytes
       raw and well under a hundred kilobytes compressed */
    const raw = req.headers.get('x-report-gzip') === '1'
      ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    ds = JSON.parse(raw);
  } catch (e) {
    return json({ error: 'could not read that payload' }, 400);
  }
  if (!ds || typeof ds !== 'object' || !ds.daily) {
    return json({ error: 'that does not look like a dataset' }, 400);
  }

  ds.savedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  ds.savedBy = auth.user;
  const days = Object.keys(ds.daily);
  days.sort();

  const s = await store('report');
  await s.setJSON(dataKey(slug), ds);
  /* A small companion record, so the cards page can say when each brand was
     last updated without pulling every dataset down to find out. */
  await s.setJSON(metaKey(slug), {
    savedAt: ds.savedAt, savedBy: auth.user, days: days.length,
    from: days[0] || null, to: days[days.length - 1] || null,
  });
  return json({ ok: true, savedAt: ds.savedAt, savedBy: auth.user,
                brand: slug, days: days.length });
};

export const config = { path: '/api/save' };
