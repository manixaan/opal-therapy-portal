# Turn on Google Maps API for the scheduler mockup

Beginner-friendly walkthrough. Takes ~20–30 minutes.

## What you're doing & what it'll cost

1. Create a free Google Cloud account
2. Turn on the Routes API
3. Get an API "key" that lets your mockup talk to Google Maps
4. Paste the key into `mockup_v2.html`
5. Reload the mockup — travel times become real traffic-aware estimates

**Cost:** Google gives $200/month free credit. For a single-therapist practice, expect to use ~50¢/month of that credit. You will not be charged.

**Security note:** For a local mockup you open only on your own computer, we'll pin the key so it only works from your machine. Even if someone saw the key, they couldn't use it.

---

## Part 1 — Create a Google Cloud account (5 min)

1. Go to https://console.cloud.google.com
2. Sign in with the Google account you want to use.
3. Agree to terms → **Start my free trial**.
4. Enter payment method (required, but you won't be charged unless you explicitly opt in after the trial).
5. Click **Start my free trial**.

You'll land on the Google Cloud Console dashboard.

---

## Part 2 — Create a project (2 min)

1. Top of page, click the project dropdown (says "My First Project" or "Select a project").
2. In the popup, click **NEW PROJECT**.
3. Name: `opal-scheduler`. Click **CREATE**. Wait ~10 seconds.
4. Click the top dropdown again and select `opal-scheduler`.

Confirm: top dropdown now reads `opal-scheduler`.

---

## Part 3 — Enable the Routes API (3 min)

1. Top search bar → type `Routes API` → Enter.
2. Click the **Routes API** result.
3. Click the big blue **ENABLE** button.
4. Wait ~10 seconds.

Repeat for:
- `Geocoding API` → Enable
- `Places API (New)` → Enable (optional — only if you want the smart-gap recommender to suggest nearby places)

---

## Part 4 — Create the API key (3 min)

1. Top search bar → `Credentials` → Enter.
2. Click **Credentials** (under APIs & Services).
3. Top of page → **+ CREATE CREDENTIALS** → **API key**.
4. A popup shows your key (starts with `AIza...`). Copy it and paste it somewhere safe temporarily.
5. Click **EDIT API KEY** at the bottom of the popup.

---

## Part 5 — Restrict the key (5 min) — IMPORTANT

On the Edit API key page:

1. **Name**: change to `opal-scheduler-local`.

2. **Application restrictions** → choose **Websites (HTTP referrers)**:

   **If you open the HTML file directly** (double-click in Finder):
   - Add: `file:///*`
   - Note: some browsers don't send referrers for `file://`, so if it fails, use a local server instead (see Part 7).

   **If you'll serve via a local web server** (recommended):
   - Add: `http://localhost/*`
   - Add: `http://127.0.0.1/*`

3. **API restrictions** → **Restrict key**:
   - Tick: Routes API, Geocoding API, (Places API (New) if enabled).
   - Click **OK**.

4. Scroll down → **SAVE**.

Restrictions can take up to 5 minutes to propagate.

---

## Part 6 — Paste the key into the mockup (2 min)

1. Open `mockup_v2.html` in a text editor.
2. Search for `GOOGLE_MAPS_API_KEY` (⌘F / Ctrl+F).
3. Find this line (~line 5059):
   ```js
   let GOOGLE_MAPS_API_KEY = '';
   ```
4. Paste your key between the quotes:
   ```js
   let GOOGLE_MAPS_API_KEY = 'AIzaSyA-your-actual-key-here';
   ```
5. Save.

---

## Part 7 — Open & verify (3 min)

**Option B (recommended — local web server):**

Open Terminal, run:

```
cd "/Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application"
python3 -m http.server 8000
```

Visit `http://localhost:8000/mockup_v2.html` in your browser.

**Option A (file://):** Double-click `mockup_v2.html` in Finder.

**Verify in DevTools:**

1. Right-click page → **Inspect** (F12).
2. **Network** tab → filter for `routes.googleapis.com`.
3. Reload page.
4. You should see requests with status **200**. Clicking one shows JSON like `{"routes":[{"duration":"2280s","distanceMeters":24310}]}`.

Travel overlays in the weekly view will now show real traffic-aware minutes instead of the suburb-table estimates.

---

## Part 8 — When you're ready to share

Today: key is in the HTML file. Fine for solo local use.

When you're ready to deploy publicly or share the mockup, we'll move the key to a backend proxy (Cloudflare Worker or Azure Function, ~40 lines of Node.js). The mockup changes one line — `fetch('/api/routes/compute')` instead of `fetch('https://routes.googleapis.com/...')`. Ask when you want to do this step.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Travel times unchanged | Key not pasted or empty | Re-check Part 6 |
| Console: `403 REQUEST_DENIED` | Referrer restriction mismatch | Part 5 — match how browser opens file |
| Console: `API not enabled` | Routes API off in *this* project | Part 3, confirm project dropdown |
| Console: `Billing account not found` | Free trial not set up | Part 1 step 4 |
| Works but no `routes.googleapis.com` in Network tab | Stale cache | Hard-reload: ⌘+Shift+R / Ctrl+Shift+R |

---

## Quick reference

- Console: https://console.cloud.google.com
- Project name: `opal-scheduler`
- APIs to enable: Routes API, Geocoding API, Places API (New)
- Key name: `opal-scheduler-local`
- File to edit: `mockup_v2.html` line ~5059
- Test URL: `http://localhost:8000/mockup_v2.html`
