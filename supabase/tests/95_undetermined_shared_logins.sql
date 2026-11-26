-- Tests: the "undetermined" role sees nothing; logins shared by two people let each pick their name.
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.as_user(sub text, claims text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', claims, false); end $$;

insert into public.people(id, full_name, is_driver, department) values
 ('77777777-0000-0000-0000-000000000001', 'Max Example', false, 'Drilling'),
 ('77777777-0000-0000-0000-000000000002', 'Tom Example', false, 'Drilling');
insert into public.app_logins(label, email, phone, role, person_id) values
 ('Max Example', 'fieldsup@example.com', '0491 570 006', 'undetermined', '77777777-0000-0000-0000-000000000001'),
 ('Tom Example', 'fieldsup@example.com', '0491 570 006', 'undetermined', '77777777-0000-0000-0000-000000000002');

select pg_temp.check((select is_system from public.roles where code = 'undetermined'), 'the undetermined role exists and cannot be deleted');
select pg_temp.check((select count(*) from public.role_permissions where role = 'undetermined') = 0, 'the undetermined role has no access settings');

-- signed in by email: the role is undetermined, nothing is visible
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000020', '{"email":"fieldsup@example.com"}');
set role authenticated;
select pg_temp.check(public.app_role() = 'undetermined', 'a new contact signs in as undetermined');
select pg_temp.check(not public.has_access(), 'undetermined has no access');
select pg_temp.check((select count(*) from public.trucks) = 0 and (select count(*) from public.people) = 0
  and (select count(*) from public.customers) = 0 and (select count(*) from public.role_permissions) = 0, 'undetermined sees no lists');
select pg_temp.check((select count(*) from public.dockets) = 0 and (select count(*) from public.shifts) = 0, 'undetermined sees no shifts or dockets');
do $$ begin
  begin insert into public.trucks(unit_no) values ('X');
    raise exception 'FAIL: undetermined added a truck';
  exception when insufficient_privilege then raise notice 'ok - undetermined cannot add anything'; end;
end $$;
-- both names are offered
select pg_temp.check((select array_agg(full_name order by full_name) from public.people_for_my_phone()) = array['Max Example', 'Tom Example'],
  'a shared email login offers both names');
reset role;

-- the same by mobile
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000021', '{"phone":"61491570006"}');
set role authenticated;
select pg_temp.check((select count(*) from public.people_for_my_phone()) = 2, 'a shared mobile login offers both names');
reset role;

-- the admin gives Tom a real role: the shared login now gets the higher of the two
update public.app_logins set role = 'supervisor' where person_id = '77777777-0000-0000-0000-000000000002';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000020', '{"email":"fieldsup@example.com"}');
set role authenticated;
select pg_temp.check(public.app_role() = 'supervisor' and public.has_access(), 'once a role is assigned the login has access');
reset role;

-- crew phones still list their drivers as before
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003', '{"phone":"61400000001"}');
set role authenticated;
select pg_temp.check((select count(*) from public.people_for_my_phone()) >= 2, 'crew phones still list the people sharing the phone');
reset role;

delete from public.app_logins where person_id in ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002');
delete from public.people where id in ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002');
