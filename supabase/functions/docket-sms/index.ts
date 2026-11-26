// Sends the queued docket texts (assigned / moved to another crew / cancelled) from public.sms_outbox.
// The database queues a text whenever a docket's crew phone changes. The app calls this function
// right after an assignment (and when it opens), so texts go out within seconds.
// Anyone signed in may call it: it only ever sends what the database queued, at most 20 at a time,
// with the same daily cap as sign-in texts.
// Secrets (already set for sign-in texts): SMS_PROVIDER, SMS_SENDER, MOBILEMESSAGE_USERNAME, MOBILEMESSAGE_PASSWORD.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { toLocalMobile } from './sms.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const DAILY_CAP = 1000;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type SendResult = { ok: boolean; id?: string; reason?: string; retry?: boolean };
async function sendMobileMessage(to: string, body: string, key: string): Promise<SendResult> {
  const auth = btoa(`${env('MOBILEMESSAGE_USERNAME')}:${env('MOBILEMESSAGE_PASSWORD')}`);
  const res = await fetch('https://api.mobilemessage.com.au/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}`, 'Idempotency-Key': key },
    body: JSON.stringify({ messages: [{ to, message: body, sender: env('SMS_SENDER') }] }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 200)}`, retry: res.status >= 500 || res.status === 429 };
  try {
    const r = JSON.parse(text)?.results?.[0];
    return r?.status === 'success' ? { ok: true, id: String(r.message_id ?? '') } : { ok: false, reason: `Provider said: ${text.slice(0, 200)}` };
  } catch { return { ok: false, reason: `Unreadable reply: ${text.slice(0, 200)}` }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // daily cost circuit breaker, shared with sign-in texts
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: a }, { count: b }] = await Promise.all([
    db.from('sms_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', since),
    db.from('sms_outbox').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', since),
  ]);
  if ((a ?? 0) + (b ?? 0) >= DAILY_CAP) return json({ sent: 0, reason: 'daily cap reached' });

  const { data: items, error } = await db.rpc('claim_sms', { p_limit: 20 });
  if (error) return json({ error: error.message }, 500);
  const provider = env('SMS_PROVIDER') || 'mobilemessage';
  let sent = 0, failed = 0;
  for (const it of items ?? []) {
    let r: SendResult;
    if (provider === 'test') { console.log(`[test provider] would text ${it.phone}: ${it.body}`); r = { ok: true, id: 'test' }; }
    else {
      r = await sendMobileMessage(toLocalMobile(String(it.phone)), it.body, it.id);
      if (!r.ok && r.retry) { await new Promise(ok => setTimeout(ok, 800)); r = await sendMobileMessage(toLocalMobile(String(it.phone)), it.body, it.id); }
    }
    await db.from('sms_outbox').update(r.ok
      ? { status: 'sent', sent_at: new Date().toISOString(), provider_message_id: r.id ?? null, error: null }
      : { status: r.retry && it.attempts < 3 ? 'pending' : 'failed', error: r.reason ?? 'unknown' }).eq('id', it.id);
    if (r.ok) sent++; else failed++;
  }
  return json({ sent, failed });
});
