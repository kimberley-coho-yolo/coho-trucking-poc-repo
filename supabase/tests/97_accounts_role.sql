-- Tests: the Accounts role has Office's access plus the Accounts reports.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;

insert into public.app_logins(label, email, role) values ('Accounts', 'accounts@example.com', 'accounts');

select pg_temp.check((select is_system and rank = 25 from public.roles where code = 'accounts'), 'the Accounts role exists');
select pg_temp.check(not exists (
  select 1 from public.role_permissions o
  join public.role_permissions a on a.feature = o.feature and a.role = 'accounts'
  where o.role = 'office' and o.feature <> 'accounts_reports' and a.access <> o.access), 'Accounts has the same access as Office');
select pg_temp.check((select array_agg(role order by role) from public.role_permissions where feature = 'accounts_reports' and access = 'read')
  = array['accounts', 'admin', 'office', 'supervisor'], 'Accounts reports go to Accounts, Office and Supervisor');
select pg_temp.check(public.access_for('driver', 'accounts_reports') = 'hidden', 'drivers do not see the Accounts reports');

select set_config('t.dockets', (select count(*) from public.dockets)::text, false), set_config('t.lines', (select count(*) from public.timesheet_lines)::text, false);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000030', '{"email":"accounts@example.com"}');
set role authenticated;
select pg_temp.check(public.app_role() = 'accounts' and public.can_read('accounts_reports'), 'an Accounts login can open the Accounts reports');
select pg_temp.check(public.can_read('all_work') and public.can_read('approvals') and public.can_read('reports'), 'Accounts sees all crews, approvals and reports like Office');
select pg_temp.check((select count(*) from public.dockets) = current_setting('t.dockets')::bigint
  and (select count(*) from public.timesheet_lines) = current_setting('t.lines')::bigint, 'Accounts can read every docket and timesheet line');
select pg_temp.check(not public.can_edit('accounts_reports'), 'the Accounts reports are read only');
reset role;
delete from public.app_logins where email = 'accounts@example.com';
