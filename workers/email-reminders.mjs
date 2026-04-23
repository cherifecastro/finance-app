const STORAGE_KEY = 'cheri-finance-reminders';
const DATA_KEY = 'cheri-finance-data';
const DAY_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/data' && request.method === 'GET') {
        if (!isFinanceAuthorized(request, env)) return json({ ok: false, error: 'Invalid finance cloud token.' }, 401, env);
        const raw = await kv(env).get(DATA_KEY);
        return json({ ok: true, data: raw ? JSON.parse(raw) : null }, 200, env);
      }

      if (url.pathname === '/api/data' && request.method === 'PUT') {
        if (!isFinanceAuthorized(request, env)) return json({ ok: false, error: 'Invalid finance cloud token.' }, 401, env);
        const text = await request.text();
        if (text.length > 900000) return json({ ok: false, error: 'Finance data is too large for this simple KV setup.' }, 413, env);
        await kv(env).put(DATA_KEY, JSON.stringify(JSON.parse(text)));
        return json({ ok: true, savedAt: new Date().toISOString() }, 200, env);
      }

      if (url.pathname === '/api/reminders/status' && request.method === 'GET') {
        const stored = await readReminderData(env);
        return json({ ok: true, configured: !!stored, email: stored?.email || null, itemCount: stored?.items?.length || 0 }, 200, env);
      }

      if (url.pathname === '/api/reminders/sync' && request.method === 'POST') {
        if (!isAuthorized(request, env)) return json({ ok: false, error: 'Invalid reminder sync token.' }, 401, env);
        const payload = normalizePayload(await request.json());
        await kv(env).put(STORAGE_KEY, JSON.stringify(payload));
        return json({ ok: true, synced: payload.items.length, email: payload.email }, 200, env);
      }

      if (url.pathname === '/api/reminders/test' && request.method === 'POST') {
        if (!isAuthorized(request, env)) return json({ ok: false, error: 'Invalid reminder sync token.' }, 401, env);
        const stored = await readReminderData(env);
        if (!stored) return json({ ok: false, error: 'Sync reminders before sending a test.' }, 400, env);
        const today = todayYmd(env);
        const items = stored.items.slice(0, 8).map(item => ({ ...item, daysUntil: daysUntil(today, item.dueDate) }));
        await sendReminderEmail(env, stored, items, today);
        return json({ ok: true, sent: true, email: stored.email }, 200, env);
      }

      return json({ ok: false, error: 'Not found.' }, 404, env);
    } catch (error) {
      return json({ ok: false, error: error.message || 'Reminder request failed.' }, 500, env);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runDailyReminders(env));
  }
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-reminder-token,x-finance-token',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status = 200, env = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function isAuthorized(request, env) {
  const expected = (env.REMINDER_SYNC_TOKEN || '').trim();
  if (!expected) return true;
  return request.headers.get('x-reminder-token') === expected;
}

function isFinanceAuthorized(request, env) {
  const expected = (env.FINANCE_DATA_TOKEN || env.REMINDER_SYNC_TOKEN || '').trim();
  if (!expected) return false;
  return request.headers.get('x-finance-token') === expected;
}

function kv(env) {
  return env.FINANCE_KV || env.REMINDERS_KV;
}

async function readReminderData(env) {
  const raw = await kv(env).get(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function normalizePayload(payload) {
  const email = String(payload?.email || '').trim();
  if (!email || !email.includes('@')) throw new Error('A valid reminder email is required.');

  const leadDays = Math.max(0, Math.min(30, Number(payload?.leadDays || 3)));
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 150).map(normalizeItem).filter(Boolean) : [];

  return {
    email,
    enabled: payload?.enabled !== false,
    leadDays,
    generatedAt: new Date().toISOString(),
    items
  };
}

function normalizeItem(item) {
  const dueDate = String(item?.dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  return {
    id: String(item?.id || `${item?.type || 'item'}:${item?.name || dueDate}`).slice(0, 120),
    type: String(item?.type || 'bill').slice(0, 40),
    name: String(item?.name || 'Bill').slice(0, 120),
    amount: Number(item?.amount || 0),
    dueDate,
    source: String(item?.source || '').slice(0, 120)
  };
}

async function runDailyReminders(env) {
  const stored = await readReminderData(env);
  if (!stored || stored.enabled === false || !stored.items?.length) return { sent: false, reason: 'nothing configured' };

  const today = todayYmd(env);
  const sentKey = `sent:${today}`;
  if (await kv(env).get(sentKey)) return { sent: false, reason: 'already sent today' };

  const dueSoon = stored.items
    .map(item => ({ ...item, daysUntil: daysUntil(today, item.dueDate) }))
    .filter(item => item.daysUntil >= 0 && item.daysUntil <= stored.leadDays)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));

  if (!dueSoon.length) return { sent: false, reason: 'no due items' };

  await sendReminderEmail(env, stored, dueSoon, today);
  await kv(env).put(sentKey, JSON.stringify({ sentAt: new Date().toISOString(), count: dueSoon.length }), { expirationTtl: 36 * 60 * 60 });
  return { sent: true, count: dueSoon.length };
}

function todayYmd(env) {
  const timeZone = env.REMINDER_TIMEZONE || 'Asia/Manila';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function daysUntil(today, dueDate) {
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

async function sendReminderEmail(env, stored, dueItems, today) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const subject = dueItems.some(item => item.daysUntil === 0)
    ? `Finance reminder: ${dueItems.length} item${dueItems.length === 1 ? '' : 's'} due today or soon`
    : `Finance reminder: ${dueItems.length} upcoming due item${dueItems.length === 1 ? '' : 's'}`;

  const htmlRows = dueItems.map(item => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5edf7;"><strong>${escapeHtml(item.name)}</strong><br><span style="color:#6f8098;">${escapeHtml(labelForItem(item))}</span></td>
      <td style="padding:10px;border-bottom:1px solid #e5edf7;">${escapeHtml(dueLabel(item))}</td>
      <td style="padding:10px;border-bottom:1px solid #e5edf7;text-align:right;">${formatPeso(item.amount)}</td>
    </tr>`).join('');

  const text = [
    `Cheri Finance reminders for ${today}`,
    '',
    ...dueItems.map(item => `- ${item.name}: ${dueLabel(item)} · ${formatPeso(item.amount)}${item.source ? ` · ${item.source}` : ''}`)
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.REMINDER_FROM_EMAIL || 'Cheri Finance <reminders@example.com>',
      to: [stored.email],
      subject,
      text,
      html: `
        <div style="font-family:Arial,sans-serif;color:#122033;line-height:1.5;">
          <h2 style="margin:0 0 8px;">Cheri Finance reminders</h2>
          <p style="margin:0 0 16px;color:#6f8098;">These items are due within ${stored.leadDays} day${stored.leadDays === 1 ? '' : 's'}.</p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e5edf7;border-radius:12px;overflow:hidden;">
            <thead><tr style="background:#f5f8fc;"><th align="left" style="padding:10px;">Item</th><th align="left" style="padding:10px;">Due</th><th align="right" style="padding:10px;">Amount</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </div>`
    })
  });

  if (!response.ok) throw new Error(`Resend failed: ${await response.text()}`);
}

function labelForItem(item) {
  return [item.type, item.source].filter(Boolean).join(' · ');
}

function dueLabel(item) {
  if (item.daysUntil === 0) return `Due today (${item.dueDate})`;
  if (item.daysUntil === 1) return `Due tomorrow (${item.dueDate})`;
  return `Due in ${item.daysUntil} days (${item.dueDate})`;
}

function formatPeso(value) {
  return `₱${Math.abs(Number(value || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
