-- Coho Drive: roster, docket assignment to crew phones, texts, and review of completed dockets (25 Nov 2026)
--  * A docket is assigned to a crew phone (work_phones) and, optionally, to drivers on that phone.
--  * Assigning, reassigning and cancelling an assignment queues a text to the phone(s) concerned (sms_outbox).
--    Edits do not send texts (Kimberley's choice). The texts are sent by the docket-sms Edge Function.
--  * Only roles with "Assign dockets" can assign, reassign or cancel (supervisor, office, admin by default; Settings).
--  * When a driver completes (closes) a docket it goes to "Dockets to review" for supervisors of that department
--    ("Review dockets" function; a login's departments are set in Admin > Logins; none set = all departments).

-- ---------- columns ----------
alter table public.dockets
  add column if not exists assigned_phone_id uuid references public.work_phones(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid,
  add column if not exists completed_at timestamptz,
  add column if not exists review_status text check (review_status in ('to_review', 'reviewed', 'returned')),
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_comment text;
create index if not exists dockets_assigned_phone_idx on public.dockets(assigned_phone_id);
create index if not exists dockets_review_idx on public.dockets(review_status) where review_status = 'to_review';

alter table public.app_logins add column if not exists departments text[] not null default '{}';

-- ---------- functions on the Settings screen ----------
insert into public.features(code, label, grp, description, max_level, admin_only_edit, sort) values
  ('docket_assign', 'Assign dockets and roster', 'Supervision',
   'Read only: see the roster and who has which docket. Edit: assign dockets to crew phones, reassign them or cancel the assignment (texts the phone).', 'edit', false, 52),
  ('docket_review', 'Review completed dockets', 'Supervision',
   'Read only: see completed dockets waiting for review. Edit: mark them reviewed or return them to the driver. Only for the departments set on the login (none set = all).', 'edit', false, 54)
on conflict (code) do nothing;
insert into public.role_permissions(role, feature, access)
select r.code, f.code, case when r.code in ('admin', 'office', 'supervisor') then 'edit' else 'hidden' end
from public.roles r cross join (values ('docket_assign'), ('docket_review')) as f(code)
on conflict (role, feature) do nothing;

-- ---------- who am I ----------
create or replace function public.my_phone_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(w.id), '{}'::uuid[]) from public.work_phones w
  where w.active is not false and public.norm_phone(w.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))
$$;
-- departments this login reviews; empty = all
create or replace function public.my_review_departments() returns text[]
language sql stable security definer set search_path = public as $$
  select case when bool_or(coalesce(array_length(l.departments, 1), 0) = 0) then '{}'::text[]
              else coalesce(array_agg(distinct d), '{}') end
  from public.app_logins l left join lateral unnest(l.departments) d on true
  where l.active is not false and (
    (l.email is not null and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or (l.phone is not null and public.norm_phone(l.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))))
$$;
create or replace function public.docket_assigned_to_me(p_docket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dockets d where d.id = p_docket
    and (d.assigned_person_ids && public.my_person_ids() or d.assigned_phone_id = any(public.my_phone_ids())))
$$;
revoke execute on function public.my_phone_ids() from public, anon;
revoke execute on function public.my_review_departments() from public, anon;
grant execute on function public.my_phone_ids() to authenticated;
grant execute on function public.my_review_departments() to authenticated;

-- ---------- row level security: the crew phone sees dockets assigned to it ----------
drop policy if exists dockets_read on public.dockets;
drop policy if exists dockets_update on public.dockets;
create policy dockets_read on public.dockets for select to authenticated using (
  (select public.can_read('all_work')) or (select public.can_read('docket_assign')) or (select public.can_read('docket_review'))
  or ((created_by = (select auth.uid()) or assigned_person_ids && (select public.my_person_ids()) or assigned_phone_id = any(public.my_phone_ids()))
      and (select public.can_read('dockets'))));
create policy dockets_update on public.dockets for update to authenticated using (
  (select public.can_edit('all_work')) or (select public.can_edit('docket_assign')) or (select public.can_edit('docket_review'))
  or ((created_by = (select auth.uid()) or assigned_person_ids && (select public.my_person_ids()) or assigned_phone_id = any(public.my_phone_ids()))
      and (select public.can_edit('dockets'))))
  with check ((select public.has_access()));

-- ---------- rules: who may assign, completing sends it for review, reviewing ----------
create or replace function public.docket_workflow() returns trigger
language plpgsql security definer set search_path = public as $$
declare assign_changed boolean; is_admin boolean := public.app_role() = 'admin'; deps text[];
begin
  if auth.uid() is null then  -- the database itself (migrations, tests as owner): keep the stamps, skip the checks
    if tg_op = 'UPDATE' and new.status = 'closed' and old.status is distinct from 'closed' then
      new.completed_at := coalesce(new.completed_at, now()); new.review_status := coalesce(new.review_status, 'to_review');
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- creating a docket for yourself (e.g. from your shift) is fine; for anyone else you need "Assign dockets"
    if ((new.assigned_phone_id is not null and not new.assigned_phone_id = any(public.my_phone_ids()))
        or not (coalesce(new.assigned_person_ids, '{}') <@ public.my_person_ids()))
       and not public.can_edit('docket_assign') then
      raise exception 'Only supervisor, office or admin can assign dockets to someone else (Settings: Assign dockets and roster).' using errcode = '42501';
    end if;
    if new.assigned_phone_id is not null or coalesce(array_length(new.assigned_person_ids, 1), 0) > 0 then
      new.assigned_at := now(); new.assigned_by := auth.uid();
    end if;
    if new.status = 'closed' then new.completed_at := coalesce(new.completed_at, now()); new.review_status := coalesce(new.review_status, 'to_review'); end if;
    return new;
  end if;

  -- assignment
  assign_changed := new.assigned_phone_id is distinct from old.assigned_phone_id
                 or coalesce(new.assigned_person_ids, '{}') is distinct from coalesce(old.assigned_person_ids, '{}');
  if assign_changed then
    if not public.can_edit('docket_assign') then
      raise exception 'Only supervisor, office or admin can reassign or cancel a docket assignment (Settings: Assign dockets and roster).' using errcode = '42501';
    end if;
    new.assigned_at := now(); new.assigned_by := auth.uid();
  end if;

  -- a reviewed docket is locked, except for reviewers
  if old.review_status = 'reviewed' and not (is_admin or public.can_edit('docket_review')) then
    raise exception 'This docket has been reviewed and is locked. Ask a supervisor to reopen it.' using errcode = '42501';
  end if;

  -- completing sends it to the department's supervisors
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.completed_at := now();
    if new.review_status is not distinct from old.review_status then new.review_status := 'to_review'; end if;
  elsif new.status is distinct from 'closed' and old.status = 'closed' and new.review_status is not distinct from old.review_status
        and old.review_status = 'to_review' then
    new.review_status := null;   -- reopened before review
  end if;

  -- reviewing
  if new.review_status is distinct from old.review_status and new.review_status in ('reviewed', 'returned') then
    if not public.can_edit('docket_review') then
      raise exception 'Only someone with Review completed dockets can review a docket.' using errcode = '42501';
    end if;
    deps := public.my_review_departments();
    if not is_admin and coalesce(array_length(deps, 1), 0) > 0 and not (coalesce(new.department, '') = any(deps)) then
      raise exception 'This docket is for %, which is not one of your departments.', coalesce(new.department, 'no department') using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    if new.review_status = 'returned' then new.status := 'open'; new.completed_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists t_dockets_workflow on public.dockets;
create trigger t_dockets_workflow before insert or update on public.dockets for each row execute function public.docket_workflow();
revoke execute on function public.docket_workflow() from public, anon, authenticated;

-- ---------- texts ----------
create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                 -- docket_assigned / docket_moved / docket_cancelled
  docket_id uuid references public.dockets(id) on delete set null,
  work_phone_id uuid references public.work_phones(id) on delete set null,
  phone text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  provider_message_id text, error text, attempts int not null default 0,
  created_at timestamptz default now(), sent_at timestamptz, created_by uuid default auth.uid()
);
create index if not exists sms_outbox_pending_idx on public.sms_outbox(created_at) where status = 'pending';
create index if not exists sms_outbox_docket_idx on public.sms_outbox(docket_id);
alter table public.sms_outbox enable row level security;
drop policy if exists sms_outbox_read on public.sms_outbox;
create policy sms_outbox_read on public.sms_outbox for select to authenticated using (
  (select public.can_read('docket_assign')) or (select public.can_read('audit')));
-- written only by the database (trigger) and the docket-sms function (service role)
grant select on public.sms_outbox to authenticated;

create or replace function public.docket_label(d public.dockets) returns text
language sql stable security definer set search_path = public as $$
  select 'docket ' || coalesce(d.docket_no::text, '?')
    || coalesce(' (' || case d.form_type
         when 'landspray_runsheet' then 'Landspray runsheet' when 'daily_report_workover' then 'Workover daily report'
         when 'daily_report_drilling' then 'Drilling/CCC daily report' when 'frac_support' then 'Frac support report'
         when 'potable_water' then 'Potable water' when 'septic' then 'Septic' when 'rig_support_ticket' then 'Rig support ticket'
         else 'docket' end || ')', '')
    || coalesce(' for ' || to_char(coalesce(d.work_date, (d.start_at at time zone 'Australia/Brisbane')::date), 'DD/MM'), '')
    || coalesce(' at ' || (select name from public.locations where id = d.location_id), '')
$$;
revoke execute on function public.docket_label(public.dockets) from public, anon, authenticated;

create or replace function public.docket_assignment_texts() returns trigger
language plpgsql security definer set search_path = public as $$
declare new_phone text; old_phone text; label text;
begin
  if tg_op = 'UPDATE' and new.assigned_phone_id is not distinct from old.assigned_phone_id then return null; end if;
  label := public.docket_label(new);
  select phone into new_phone from public.work_phones where id = new.assigned_phone_id;
  if tg_op = 'UPDATE' then select phone into old_phone from public.work_phones where id = old.assigned_phone_id; end if;
  if new_phone is not null then
    insert into public.sms_outbox(kind, docket_id, work_phone_id, phone, body)
    values ('docket_assigned', new.id, new.assigned_phone_id, new_phone,
            left('Coho Drive: ' || label || ' is assigned to your phone. Open Coho Drive to view it.', 300));
  end if;
  if old_phone is not null then
    insert into public.sms_outbox(kind, docket_id, work_phone_id, phone, body)
    values (case when new_phone is null then 'docket_cancelled' else 'docket_moved' end, new.id, old.assigned_phone_id, old_phone,
            left('Coho Drive: ' || label || case when new_phone is null then ' has been cancelled for your phone.' else ' has been moved to another crew.' end
                 || ' No action needed.', 300));
  end if;
  return null;
end $$;
drop trigger if exists t_dockets_assignment_texts on public.dockets;
create trigger t_dockets_assignment_texts after insert or update of assigned_phone_id on public.dockets
  for each row execute function public.docket_assignment_texts();
revoke execute on function public.docket_assignment_texts() from public, anon, authenticated;

-- the docket-sms function claims texts to send (service role only), so two calls never send the same text
create or replace function public.claim_sms(p_limit int default 20) returns setof public.sms_outbox
language sql security definer set search_path = public as $$
  update public.sms_outbox o set status = 'sending', attempts = attempts + 1
  where o.id in (select id from public.sms_outbox where status = 'pending' and created_at > now() - interval '2 days'
                 order by created_at limit p_limit for update skip locked)
  returning o.*
$$;
revoke execute on function public.claim_sms(int) from public, anon, authenticated;
grant execute on function public.claim_sms(int) to service_role;
grant select, update on public.sms_outbox to service_role;

-- ---------- live updates ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sms_outbox') then
    alter publication supabase_realtime add table public.sms_outbox;
  end if;
end $$;
