# Report on Netlify + GitHub — setup

The data no longer lives inside the page. It lives in a Netlify blob, and the
only way to it is through a function that checks a signed cookie first. An
unauthenticated visitor receives an empty shell and a password box — there is
nothing in the HTML to dig out.

    public/index.html          the app. Carries no data.
    netlify/functions/
      login.mjs    /api/login  password in, signed cookie out
      logout.mjs   /api/logout
      data.mjs     /api/data   the dataset — 401 without a session
      save.mjs     /api/save   writes the dataset — admin only
      _shared.mjs             signing, session reading, throttle, blob store
    netlify.toml               publish folder, function folder, headers
    package.json               @netlify/blobs

---

## 1. Put these files in the repo

Commit the whole tree as it is. Netlify installs the dependency itself.

## 2. Set three environment variables

Netlify → your project → **Project configuration → Environment variables**.

| Variable | What it is |
|---|---|
| `SESSION_SECRET` | Signs the session cookie. Long and random. Never shared. |
| `ADMIN_PASSWORD` | You. Can upload files and save. Sees landed cost and margin. |
| `VIEWER_PASSWORD` | The brand. Read-only, and the costs are never sent to them. |

Generate the secret rather than inventing one — in a terminal:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Or on a Mac without Node:

    openssl rand -hex 32

If `VIEWER_PASSWORD` is left unset, there is simply no viewer role — only you
can get in. That is a fine way to start.

**Set them for all deploy contexts**, otherwise the production site will have
no passwords and refuse everybody.

## 3. Deploy

Push to GitHub. Netlify builds and deploys on its own from here on.

## 4. First run

Open the site, sign in with the admin password, open **Update data**, drop the
cost file and the Fee Preview in, then this week's exports. Press
**Save to the site**.

---

## What changed in the weekly routine

Before: drop files in → download a new index.html → drag it onto Netlify.

Now: open the site → sign in → drop files in → **Save**. That is it. The save
writes straight to the blob and the site is current immediately. No download,
no deploy, no Netlify credits spent.

The **Download updated page** button is still there. It now produces a
self-contained backup copy — the whole dataset inside one file, which opens
from your desktop with no site and no password. Keep one somewhere safe.

## What the brand sees

Signed in with the viewer password: every chart, every KPI, the product table,
the periods. What they do not get is `cogs` — it is deleted from the response
before it is sent, so Margin, Margin/unit and B/E TACOS have nothing to compute
from and show as blank. Product names and groupings still come through, because
those are not sensitive.

Check it yourself: sign in as the viewer, open DevTools → Network → `/api/data`
and read the response. The costs are not in it.

## Undoing a bad upload

The dataset is one blob. Saving replaces it. If you save something wrong, drop
your last backup copy (the downloaded index.html) onto the page — it takes its
data across — and press Save again.

## Later: SP-API

The shape is already right for it. A scheduled function fetches the reports
from Amazon, folds them into the same dataset with the same merge code, and
writes the same blob. Nothing else changes: `/api/data` keeps serving, the page
keeps rendering, the manual upload keeps working alongside it as a fallback.

## Notes

- Sessions last 12 hours, then ask again.
- Ten wrong passwords from one address in fifteen minutes and it stops
  answering for a while.
- The cookie is HttpOnly, Secure, SameSite=Lax, and signed — editing it to say
  `admin` does not work, the signature will not match.
- Writes need a header a cross-site form cannot set, on top of SameSite.
- If a save ever fails, the merged data is still sitting in the open page.
  Try again, or download a copy — nothing is lost by the failure itself.
