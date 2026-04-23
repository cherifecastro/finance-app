# Finance Tracker Website

Static personal finance tracker prepared for Cloudflare Pages.

## Project Structure

- `index.html` - main entry page
- `assets/css/styles.css` - all styles
- `assets/js/app.js` - app logic (Cloudflare sync + charts)
- `favicon.svg` - original Cheri Finance favicon

## Run Locally

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`

The production app now expects the Cloudflare Worker data API. For full local testing, run the Worker too:

```bash
npm run worker:dev
```

When unlocking locally, use the advanced Data API URL:

```text
http://localhost:8787/api/data
```

## Build For Cloudflare

```bash
npm run build
```

This creates `dist/`, which contains only the production files Cloudflare should publish.

To preview that production folder locally:

```bash
npm run preview
```

Then open `http://localhost:8788/`.

## Cloudflare Pages Settings

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: leave blank if this folder is the repo root; otherwise use `budgetdashboardhtmlzip`
- Environment variables for the static Pages app: none required, but the Worker below is required for cloud data sync

You can also use Cloudflare Pages Direct Upload by running `npm run build` and uploading the `dist/` folder.

## Cloud Data Sync

The app no longer stores finance data in browser `localStorage`. It keeps the active file in memory and saves the full finance JSON to Cloudflare KV through the Worker at `/api/data`.

### Required Worker Setup

1. Create one Cloudflare KV namespace.
2. Put the namespace id in `wrangler.toml` under `FINANCE_KV`.
3. Set a private data token:

```bash
npx wrangler secret put FINANCE_DATA_TOKEN
```

4. Deploy the Worker:

```bash
npm run worker:deploy
```

5. Route the Worker to the same domain as the app so this endpoint works:

```text
/api/data
```

When you open the app, enter the same `FINANCE_DATA_TOKEN`. The token is stored only in `sessionStorage` for the current browser session; finance data itself is not stored locally.

## Due Alerts

The app now shows due and overdue subscriptions or loans directly inside the UI:

- a status pill in the top bar
- a `Due Ping` card on the Overview page
- a one-time toast when you open the app and something urgent needs attention

For push notifications outside the app, use your phone's Reminders or Calendar app. The web app itself no longer sends email reminders.

## Privacy Note

Finance data is stored in Cloudflare KV after you unlock the app with your private cloud token. The token is required on each new browser session and is not saved as part of the finance file.

The deployment includes `robots.txt` and `X-Robots-Tag` headers to discourage search indexing.
