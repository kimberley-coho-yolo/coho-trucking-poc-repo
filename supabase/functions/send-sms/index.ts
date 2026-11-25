// Supabase Auth "Send SMS" hook: texts the sign-in code through an Australian SMS provider.
// Flow: verify the hook signature -> ask the database whether this number may get a code (registered work
// mobile, under the limits) -> send through the provider -> record the result in public.sms_log.
// Secrets (set in Supabase > Edge Functions > Secrets, never in code):
//   SEND_SMS_HOOK_SECRET   from Authentication > Hooks (format v1,whsec_...)
//   SMS_PROVIDER           mobilemessage (default) | test (logs only, sends nothing)
//   SMS_SENDER             approved sender ID, e.g. CohoDrive
//   MOBILEMESSAGE_USERNAME / MOBILEMESSAGE_PASSWORD   API credentials from the provider
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildMessage, toLocalMobile } from './sms.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

function hookError(httpCode: number, message: string) {
  // Supabase shows `message` to the person signing in.
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: httpCode, headers: { 'Content-Type': 'application/json' },
  });
}

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
    const data = JSON.parse(text);
    const r = data?.results?.[0];
    if (r?.status === 'success') return { ok: true, id: String(r.message_id ?? data.send_id ?? '') };
    return { ok: false, reason: `Provider said: ${text.slice(0, 200)}` };
  } catch { return { ok: false, reason: `Unreadable reply: ${text.slice(0, 200)}` }; }
}

async function send(provider: string, to: string, body: string): Promise<SendResult> {
  if (provider === 'test') { console.log(`[test provider] would text ${to}`); return { ok: true, id: 'test' }; }
  const key = crypto.randomUUID(); // same key on retry, so the provider never sends twice
  let r = await sendMobileMessage(to, body, key);
  if (!r.ok && r.retry) { await new Promise((ok) => setTimeout(ok, 800)); r = await sendMobileMessage(to, body, key); }
  return r;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return hookError(405, 'Method not allowed');
  const payload = await req.text();
  let user: { phone?: string }, sms: { otp?: string };
  try {
    const wh = new Webhook(env('SEND_SMS_HOOK_SECRET').replace('v1,whsec_', ''));
    ({ user, sms } = wh.verify(payload, Object.fromEntries(req.headers)) as { user: { phone?: string }; sms: { otp?: string } });
  } catch {
    return hookError(401, 'Invalid hook signature');
  }

  const provider = env('SMS_PROVIDER') || 'mobilemessage';
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: gate, error } = await db.rpc('sms_hook_check', { p_phone: user?.phone ?? '', p_provider: provider });
  if (error) { console.error('sms_hook_check failed', error.message); return hookError(500, 'Text sign-in is unavailable right now. Use email sign-in.'); }
  if (!gate?.allowed) return hookError(400, gate?.message ?? 'This number cannot get a code.');

  const to = toLocalMobile(gate.phone);
  const r = await send(provider, to, buildMessage(sms?.otp ?? ''));
  await db.rpc('sms_hook_result', { p_log_id: gate.log_id, p_status: r.ok ? 'sent' : 'failed', p_provider_message_id: r.id ?? null, p_reason: r.reason ?? null });
  if (!r.ok) { console.error('SMS send failed', r.reason); return hookError(502, 'The text could not be sent. Try again in a minute or use email sign-in.'); }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
