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

5. Route the Worker to the same domain as the app so these endpoints work:

```text
/api/data
/api/reminders/sync
```

When you open the app, enter the same `FINANCE_DATA_TOKEN`. The token is stored only in `sessionStorage` for the current browser session; finance data itself is not stored locally.

## Email Reminders

The app can prepare due-date reminders for subscriptions and loans, then sync them to a Cloudflare Worker. The Worker runs daily at 8:00 AM Manila time and sends an email through Resend when an item is due within your reminder window.

The default reminder email is:

```text
cherife1198@gmail.com
```

### Worker Setup

Email reminders use the same Worker and KV namespace as cloud data.

Set Worker secrets:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put REMINDER_SYNC_TOKEN
```

Set Worker variables in Cloudflare or `wrangler.toml`:

```text
REMINDER_FROM_EMAIL=Cheri Finance <reminders@yourdomain.com>
REMINDER_TIMEZONE=Asia/Manila
ALLOWED_ORIGIN=https://your-domain.com
```

Deploy the Worker after setting secrets:

```bash
npm run worker:deploy
```

In the app Settings, enter the same private sync token, save, then click `Sync reminders`.

If the Worker is on a separate `workers.dev` URL, paste its sync endpoint into Settings, for example:

```text
https://cheri-finance-reminders.your-subdomain.workers.dev/api/reminders/sync
```

The default Content Security Policy allows same-origin sync endpoints and `workers.dev` endpoints. If you use a different external Worker domain, add it to `connect-src` in `_headers`.

If you route the Worker on the same domain as the app, keep the default:

```text
/api/reminders/sync
```

## Privacy Note

Finance data is stored in Cloudflare KV after you unlock the app with your private cloud token. The token is required on each new browser session and is not saved as part of the finance file.

Email reminder sync uploads only the reminder email, reminder settings, and due items needed for notifications. Finance data sync is handled separately by `/api/data`.

The deployment includes `robots.txt` and `X-Robots-Tag` headers to discourage search indexing.
