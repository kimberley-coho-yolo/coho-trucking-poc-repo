-- Send SMS hook support: only registered work mobiles get a sign-in text, with a per-phone and daily cap,
-- and every send is logged so the office can see what was sent and what failed.
create table public.sms_log (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                 -- normalised, e.g. 61400000001
  status text not null default 'pending' check (status in ('pending','sent','failed','blocked')),
  reason text,                         -- why it was blocked or failed
  provider text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index sms_log_phone_time on public.sms_log (phone, created_at desc);
create index sms_log_time on public.sms_log (created_at desc);
alter table public.sms_log enable row level security;
-- Admins can read the log in the app's Data screen; nobody can write to it except the hook (service role).
create policy sms_log_admin_read on public.sms_log for select to authenticated using (public.is_admin());

-- Called by the send-sms Edge Function (service role only). Decides whether a code may be texted and logs it.
create or replace function public.sms_hook_check(p_phone text, p_provider text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ph text := public.norm_phone(p_phone);
  per_hour int := 5;      -- max codes per phone per hour
  per_day int := 1000;    -- max codes per day across all phones (cost circuit breaker)
  v_id uuid;
begin
  if ph is null or ph !~ '^614\d{8}$' then
    insert into public.sms_log(phone, status, reason, provider) values (coalesce(ph, ''), 'blocked', 'not an Australian mobile', p_provider) returning id into v_id;
    return jsonb_build_object('allowed', false, 'log_id', v_id, 'message', 'Use an Australian mobile number, for example 0400 000 000.');
  end if;
  if not exists (select 1 from public.app_logins where active is not false and public.norm_phone(phone) = ph)
     and not exists (select 1 from public.work_phones where active is not false and public.norm_phone(phone) = ph) then
    insert into public.sms_log(phone, status, reason, provider) values (ph, 'blocked', 'number not registered', p_provider) returning id into v_id;
    return jsonb_build_object('allowed', false, 'log_id', v_id, 'message', 'This number is not set up for Coho Drive. Ask the office to add it.');
  end if;
  if (select count(*) from public.sms_log where phone = ph and status in ('pending','sent') and created_at > now() - interval '1 hour') >= per_hour then
    insert into public.sms_log(phone, status, reason, provider) values (ph, 'blocked', 'hourly limit', p_provider) returning id into v_id;
    return jsonb_build_object('allowed', false, 'log_id', v_id, 'message', 'Too many codes for this number. Wait an hour or use email sign-in.');
  end if;
  if (select count(*) from public.sms_log where status in ('pending','sent') and created_at > now() - interval '1 day') >= per_day then
    insert into public.sms_log(phone, status, reason, provider) values (ph, 'blocked', 'daily limit', p_provider) returning id into v_id;
    return jsonb_build_object('allowed', false, 'log_id', v_id, 'message', 'Text sign-in is paused for today. Use email sign-in or call the office.');
  end if;
  insert into public.sms_log(phone, status, provider) values (ph, 'pending', p_provider) returning id into v_id;
  return jsonb_build_object('allowed', true, 'log_id', v_id, 'phone', ph);
end $$;

create or replace function public.sms_hook_result(p_log_id uuid, p_status text, p_provider_message_id text default null, p_reason text default null)
returns void language sql security definer set search_path = public as $$
  update public.sms_log set status = p_status, provider_message_id = p_provider_message_id, reason = p_reason where id = p_log_id;
$$;

revoke execute on function public.sms_hook_check(text, text) from public, anon, authenticated;
revoke execute on function public.sms_hook_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sms_hook_check(text, text) to service_role;
grant execute on function public.sms_hook_result(uuid, text, text, text) to service_role;
revoke all on public.sms_log from anon;
