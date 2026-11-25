-- Tests: timesheets, expense claims and checklists (form_submissions, form_files).
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;
insert into public.app_logins(label, email, role) values ('Supervisor', 'sup@example.com', 'supervisor');

-- driver (crew phone 1) starts an expense claim for Alex and a fortnight timesheet
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
select pg_temp.check(public.my_permissions() ->> 'forms' = 'edit', 'drivers can fill in their own forms by default');
insert into public.form_submissions(id, form_type, person_id, period_start, data)
values ('88888888-0000-0000-0000-000000000001', 'expense_reimbursement', '44444444-0000-0000-0000-000000000001', current_date,
        '{"company":"Coho Resources Pty Ltd","lines":[{"date":"2026-11-18","item":"Fuel","amount":55.5}]}'),
       ('88888888-0000-0000-0000-000000000002', 'driver_timesheet', '44444444-0000-0000-0000-000000000001', current_date, '{}');
insert into public.form_files(submission_id, kind, data_url) values ('88888888-0000-0000-0000-000000000001', 'receipt', 'data:image/jpeg;base64,AAAA');
select pg_temp.check((select count(*) from public.form_files) = 1, 'driver can attach a receipt');
do $$ begin
  begin update public.form_submissions set status = 'approved' where id = '88888888-0000-0000-0000-000000000001';
    raise exception 'FAIL: driver approved their own claim';
  exception when insufficient_privilege then raise notice 'ok - driver cannot approve their own claim'; end;
end $$;
update public.form_submissions set status = 'submitted', signed_at = now() where id = '88888888-0000-0000-0000-000000000001';
select pg_temp.check((select version from public.form_submissions where id = '88888888-0000-0000-0000-000000000001') = 2, 'submitting bumps the version');
do $$ begin
  update public.form_submissions set title = 'changed after submit' where id = '88888888-0000-0000-0000-000000000001';
  if found then raise exception 'FAIL: driver changed a submitted claim'; end if;
  raise notice 'ok - submitted forms are not changed by the driver';
end $$;
reset role;

-- another crew cannot see Alex's forms
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007', '{"phone":"61400000002"}');
set role authenticated;
select pg_temp.check((select count(*) from public.form_submissions) = 0, 'another crew does not see these forms');
select pg_temp.check((select count(*) from public.form_files) = 0, 'or their receipts');
reset role;

-- a viewer role (read only on all crews, no approvals) sees the timesheet but not the expense claim with bank details
insert into public.roles(code, label, rank) values ('viewer', 'Viewer', 45);
insert into public.role_permissions(role, feature, access) select 'viewer', code, case when code = 'all_work' then 'read' else 'hidden' end from public.features;
insert into public.app_logins(label, email, role) values ('Viewer', 'viewer@example.com', 'viewer');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000005', '{"email":"viewer@example.com"}');
set role authenticated;
select pg_temp.check((select count(*) from public.form_submissions where form_type = 'driver_timesheet') = 1, 'all-crews readers see timesheets');
select pg_temp.check((select count(*) from public.form_submissions where form_type = 'expense_reimbursement') = 0, 'but not expense claims (bank details)');
reset role;

-- supervisor approves; the form is then locked except for admin
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000008', '{"email":"sup@example.com"}');
set role authenticated;
select pg_temp.check((select count(*) from public.form_submissions where form_type = 'expense_reimbursement') = 1, 'approvers see expense claims');
do $$ begin
  begin update public.form_submissions set approver_name = 'x', version = 1 where id = '88888888-0000-0000-0000-000000000001';
    raise exception 'FAIL: stale save went through';
  exception when serialization_failure then raise notice 'ok - a save from an out-of-date copy is refused'; end;
end $$;
update public.form_submissions set status = 'approved', approver_name = 'Lindsay Harris', approver_comment = 'Approved', version = 2
  where id = '88888888-0000-0000-0000-000000000001';
select pg_temp.check((select approved_at is not null and approved_by = 'aaaaaaaa-0000-0000-0000-000000000008' from public.form_submissions where id = '88888888-0000-0000-0000-000000000001'), 'approval records who and when');
do $$ begin
  begin update public.form_submissions set approver_comment = 'changed' where id = '88888888-0000-0000-0000-000000000001';
    raise exception 'FAIL: approved form changed by non-admin';
  exception when insufficient_privilege then raise notice 'ok - approved forms are locked'; end;
end $$;
reset role;

-- admin can still change an approved form
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000009', '{"email":"boss@example.com"}');
set role authenticated;
update public.form_submissions set approver_comment = 'fixed by admin' where id = '88888888-0000-0000-0000-000000000001';
select pg_temp.check((select approver_comment from public.form_submissions where id = '88888888-0000-0000-0000-000000000001') = 'fixed by admin', 'admin can change an approved form');
reset role;

-- new timesheet columns
select pg_temp.check((select count(*) from information_schema.columns where table_name = 'timesheet_lines' and column_name in ('shift_band','truck_id','with_dog')) = 3, 'timesheet lines have shift time, unit and truck-and-dog');
