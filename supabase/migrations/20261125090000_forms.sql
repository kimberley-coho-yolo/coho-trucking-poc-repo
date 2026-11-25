-- Coho Drive: forms that are not dockets (25 Nov 2026)
-- From the Landspray Supervisor's examples: the fortnightly Driver Timesheet, the Expense Reimbursement
-- and the RDM Land Pre Inspection and Fire Risk Assessment (compliance checklist).
-- One table holds every submission (fields in "data" JSON), photos and receipts sit in their own table,
-- and timesheet lines gain the columns the paper timesheet has (shift times, unit, truck and dog).

-- ---------- timesheet lines: the extra columns on the paper timesheet ----------
alter table public.timesheet_lines
  add column if not exists shift_band text,          -- 00:00 to 12:00 / 12:00 to 24:00 / 06:00 to 18:00 / 18:00 to 06:00
  add column if not exists truck_id uuid references public.trucks(id) on delete set null,
  add column if not exists with_dog boolean default false;   -- hours count as "truck and dog"
create index if not exists timesheet_lines_truck_idx on public.timesheet_lines(truck_id);
create index if not exists timesheet_lines_person_date_idx on public.timesheet_lines(person_id, work_date);

-- ---------- new function on the Settings screen ----------
insert into public.features(code, label, grp, description, max_level, admin_only_edit, sort) values
  ('forms', 'Timesheets, expense claims and checklists', 'Driver',
   'Fortnightly timesheet, expense reimbursement and land pre-inspection checklist (own forms). Approving them needs Timesheet approvals.',
   'edit', false, 35)
on conflict (code) do nothing;
insert into public.role_permissions(role, feature, access)
select r.code, 'forms', case when r.code in ('admin','office','supervisor','driver') then 'edit' else 'hidden' end
from public.roles r
on conflict (role, feature) do nothing;
update public.features set description = 'Read only: see timesheets, expense claims and checklists waiting. Edit: approve, authorise or return them.'
  where code = 'approvals';

-- ---------- submissions ----------
create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_type text not null,                       -- driver_timesheet / expense_reimbursement / land_fire_risk (web/src/lib/forms.ts)
  status text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  person_id uuid references public.people(id) on delete set null,   -- whose form it is (driver, claimant, inspector)
  period_start date,                             -- fortnight beginning, or the form's date
  title text,
  data jsonb not null default '{}'::jsonb,       -- every field and line on the form
  signature_png text, signed_at timestamptz,     -- completed by
  approver_name text, approver_comment text, approver_signature_png text,
  approved_by uuid, approved_at timestamptz,
  assigned_person_ids uuid[] not null default '{}',
  version int not null default 1,
  created_at timestamptz default now(), created_by uuid default auth.uid(),
  updated_at timestamptz default now(), updated_by uuid
);
create index if not exists form_submissions_person_idx on public.form_submissions(person_id);
create index if not exists form_submissions_type_period_idx on public.form_submissions(form_type, period_start);
create index if not exists form_submissions_assigned_idx on public.form_submissions using gin(assigned_person_ids);

-- photos, receipts and desktop-review evidence (resized images, kept small)
create table if not exists public.form_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  kind text,                                     -- receipt / photo / evidence
  file_name text, mime_type text,
  data_url text,                                 -- PoC: resized image as a data URL; move to Supabase Storage before scale
  caption text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);
create index if not exists form_files_submission_idx on public.form_files(submission_id);

-- ---------- rules: versions, who can approve, approved forms are locked ----------
create or replace function public.form_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.version is distinct from old.version then
    raise exception 'This form was changed on another device after you opened it. Tap Reload to get the latest copy, then make your change again.'
      using errcode = '40001';
  end if;
  if old.status = 'approved' and public.app_role() is distinct from 'admin' then
    raise exception 'This form is approved and locked. Only an admin can change it.' using errcode = '42501';
  end if;
  if new.status in ('approved','returned') and new.status is distinct from old.status and not public.can_edit('approvals') then
    raise exception 'Only someone with Timesheet approvals can approve or return a form.' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists t_form_submissions_guard on public.form_submissions;
create trigger t_form_submissions_guard before update on public.form_submissions for each row execute function public.form_guard();
revoke execute on function public.form_guard() from public, anon, authenticated;

-- a new form can only start as a draft or submitted
create or replace function public.form_insert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('draft','submitted') and not public.can_edit('approvals') then
    raise exception 'A new form starts as a draft.' using errcode = '42501';
  end if;
  new.version := 1;
  return new;
end $$;
drop trigger if exists t_form_submissions_insert on public.form_submissions;
create trigger t_form_submissions_insert before insert on public.form_submissions for each row execute function public.form_insert_guard();
revoke execute on function public.form_insert_guard() from public, anon, authenticated;

-- audit, like the other work tables
drop trigger if exists t_form_submissions_audit on public.form_submissions;
create trigger t_form_submissions_audit after insert or update or delete on public.form_submissions for each row execute function public.audit();

-- ---------- row level security ----------
alter table public.form_submissions enable row level security;
alter table public.form_files enable row level security;

-- Is this my form? (created on my login, or for one of my people)
create or replace function public.form_is_mine(p_created_by uuid, p_person uuid, p_assigned uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select p_created_by = auth.uid() or p_person = any(public.my_person_ids()) or p_assigned && public.my_person_ids()
$$;
revoke execute on function public.form_is_mine(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.form_is_mine(uuid, uuid, uuid[]) to authenticated;

drop policy if exists form_submissions_read on public.form_submissions;
drop policy if exists form_submissions_insert on public.form_submissions;
drop policy if exists form_submissions_update on public.form_submissions;
drop policy if exists form_submissions_delete on public.form_submissions;
-- expense claims carry bank details: only the claimant and approvers see them (not everyone with "all crews")
create policy form_submissions_read on public.form_submissions for select to authenticated using (
  (select public.can_read('approvals'))
  or ((select public.can_read('all_work')) and form_type <> 'expense_reimbursement')
  or ((select public.can_read('forms')) and public.form_is_mine(created_by, person_id, assigned_person_ids)));
create policy form_submissions_insert on public.form_submissions for insert to authenticated
  with check ((select public.can_edit('forms')) or (select public.can_edit('all_work')) or (select public.can_edit('approvals')));
create policy form_submissions_update on public.form_submissions for update to authenticated using (
  (select public.can_edit('approvals'))
  or ((select public.can_edit('all_work')) and form_type <> 'expense_reimbursement')
  or ((select public.can_edit('forms')) and status in ('draft','returned') and public.form_is_mine(created_by, person_id, assigned_person_ids)))
  with check ((select public.has_access()));
create policy form_submissions_delete on public.form_submissions for delete to authenticated using (
  (select public.app_role()) = 'admin'
  or (status = 'draft' and created_by = (select auth.uid()) and (select public.can_edit('forms'))));

drop policy if exists form_files_read on public.form_files;
drop policy if exists form_files_insert on public.form_files;
drop policy if exists form_files_delete on public.form_files;
-- files follow their form (the inner select applies the form's own read rule)
create policy form_files_read on public.form_files for select to authenticated using (
  exists (select 1 from public.form_submissions s where s.id = submission_id));
create policy form_files_insert on public.form_files for insert to authenticated with check (
  exists (select 1 from public.form_submissions s where s.id = submission_id and (s.status <> 'approved' or (select public.app_role()) = 'admin'))
  and ((select public.can_edit('forms')) or (select public.can_edit('all_work')) or (select public.can_edit('approvals'))));
create policy form_files_delete on public.form_files for delete to authenticated using (
  exists (select 1 from public.form_submissions s where s.id = submission_id and (s.status <> 'approved' or (select public.app_role()) = 'admin'))
  and (created_by = (select auth.uid()) or (select public.can_edit('approvals'))));

grant select, insert, update, delete on public.form_submissions, public.form_files to authenticated;

-- ---------- live updates ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['form_submissions','timesheet_lines'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
