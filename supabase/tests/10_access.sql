-- Tests: roles, row level security, run_select, timesheet lock. Run with scripts/test-db.sh
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(sub text, email text, phone text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', sub, false);
  perform set_config('request.jwt.claims', json_build_object('sub', sub, 'email', email, 'phone', phone)::text, false);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;

-- phone normalisation
select pg_temp.check(public.norm_phone('0400 000 001') = '61400000001', 'norm_phone local format');
select pg_temp.check(public.norm_phone('+61 400 000 001') = '61400000001', 'norm_phone international');

-- driver on the crew phone
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001', null, '61400000001');
select pg_temp.check(public.app_role() = 'driver', 'crew phone resolves to driver role');
select pg_temp.check((select count(*) from public.people_for_my_phone()) = 2, 'name list shows 2 people assigned to the phone');

-- first admin claim
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000009', 'boss@example.com', null);
select pg_temp.check(public.app_role() is null, 'unknown email has no role');
select pg_temp.check(public.claim_first_admin('Test admin') = 'You are now the system admin (SYS.ADM).', 'first admin claim works');
select pg_temp.check(public.app_role() = 'admin', 'claimed user is admin');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000008', 'other@example.com', null);
select pg_temp.check(public.claim_first_admin() like 'A system admin (SYS.ADM) already exists%', 'second claim refused');
