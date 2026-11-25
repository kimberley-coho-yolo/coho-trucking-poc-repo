-- Tests: roles and access settings (hidden / read only / edit), enforced by the database.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;

-- set-up as the database owner: a custom HSE role and an office login
insert into public.roles(code, label, rank) values ('hse', 'HSE', 40);
insert into public.role_permissions(role, feature, access) select 'hse', code, 'hidden' from public.features;
update public.role_permissions set access = 'read' where role = 'hse' and feature in ('all_work', 'faults', 'help');
update public.role_permissions set access = 'edit' where role = 'hse' and feature = 'integrations';  -- not allowed: admin only
insert into public.app_logins(label, email, role) values ('HSE', 'hse@example.com', 'hse'), ('Office', 'office@example.com', 'office');
insert into public.faults(description, created_by) values ('seed fault', 'aaaaaaaa-0000-0000-0000-000000000001');

-- defaults
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001', '{"phone":"61400000001"}');
select pg_temp.check(public.my_permissions() ->> 'dockets' = 'edit', 'driver can edit dockets by default');
select pg_temp.check(public.my_permissions() ->> 'reports' = 'hidden', 'reports hidden for drivers by default');
select pg_temp.check(public.my_permissions() ->> 'integrations' = 'hidden', 'integrations hidden for drivers');

-- custom role
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000005', '{"email":"hse@example.com"}');
select pg_temp.check(public.app_role() = 'hse', 'custom role resolves from the login');
select pg_temp.check(public.access('integrations') = 'read', 'edit on integrations is capped to read for non-admin');
select pg_temp.check(public.access('reports') = 'hidden', 'custom role: hidden function');
set role authenticated;
select pg_temp.check((select count(*) from public.faults) = 1, 'read only on all crews: sees everyone''s faults');
do $$ begin
  begin insert into public.faults(description) values ('x'); raise exception 'FAIL: read-only role added a fault';
  exception when insufficient_privilege then raise notice 'ok - read only role cannot add a fault'; end;
end $$;
select pg_temp.check((select count(*) from public.integrations) > 0, 'read only can view integrations');
do $$ begin
  begin update public.integrations set purpose = 'x'; if found then raise exception 'FAIL: non-admin edited integrations'; end if;
    raise notice 'ok - non-admin cannot edit integrations';
  exception when insufficient_privilege then raise notice 'ok - non-admin cannot edit integrations'; end;
end $$;
do $$ begin
  begin update public.role_permissions set access = 'edit' where role = 'hse'; if found then raise exception 'FAIL: non-admin changed settings'; end if;
    raise notice 'ok - non-admin cannot change access settings';
  exception when insufficient_privilege then raise notice 'ok - non-admin cannot change access settings'; end;
end $$;
reset role;

-- office: integrations read only even though office edits other lists
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006', '{"email":"office@example.com"}');
select pg_temp.check(public.access('integrations') = 'read' and public.access('fleet') = 'edit', 'office edits lists but not integrations');

-- turning a driver function to read only takes effect straight away
update public.role_permissions set access = 'read' where role = 'driver' and feature = 'dockets';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001', '{"phone":"61400000001"}');
set role authenticated;
do $$ begin
  begin insert into public.dockets(status) values ('open'); raise exception 'FAIL: driver added a docket while read only';
  exception when insufficient_privilege then raise notice 'ok - driver cannot add dockets when set to read only'; end;
end $$;
reset role;
update public.role_permissions set access = 'edit' where role = 'driver' and feature = 'dockets';

-- admin is never restricted, and only admin changes settings
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000009', '{"email":"boss@example.com"}');
select pg_temp.check(public.access('settings') = 'edit' and public.access('integrations') = 'edit', 'admin edits settings and integrations');
set role authenticated;
update public.role_permissions set access = 'read' where role = 'hse' and feature = 'reports';
select pg_temp.check((select access from public.role_permissions where role = 'hse' and feature = 'reports') = 'read', 'admin can change a role''s access');
reset role;

-- roles housekeeping
do $$ begin
  begin delete from public.roles where code = 'driver'; raise exception 'FAIL: built-in role deleted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok - built-in roles cannot be deleted'; end;
end $$;
do $$ begin
  begin delete from public.roles where code = 'hse'; raise exception 'FAIL: role in use deleted';
  exception when foreign_key_violation or restrict_violation then raise notice 'ok - a role still used by a login cannot be deleted'; end;
end $$;
update public.roles set active = false where code = 'hse';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000005', '{"email":"hse@example.com"}');
select pg_temp.check(public.app_role() is null, 'retiring a role removes access for its logins');
