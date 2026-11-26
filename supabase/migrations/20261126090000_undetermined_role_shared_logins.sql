-- New users waiting for a role, and logins shared by more than one person.
--
-- 1. Role "undetermined": every new contact is added with this role. It sees nothing (not even the
--    reference lists) until an admin changes the login to a real role under Admin > Logins and roles.
-- 2. Shared logins: some contacts share one mobile and email (e.g. "Max Stephenson/Tom Orpin" on the
--    field superintendent phone). Each person gets their own login row linked to their own person record,
--    all with the same email and mobile. After signing in they pick which of those people they are,
--    the same way drivers pick their name on a crew phone.

-- ---------- 1. the role ----------
insert into public.roles(code, label, description, rank, is_system, active)
select 'undetermined', 'Undetermined',
       'New user waiting for an admin to choose their role. Sees nothing until the role is changed.', 95, true, true
where not exists (select 1 from public.roles where code = 'undetermined');
-- no role_permissions rows on purpose: every function is hidden

-- "has access" now means a real role. An undetermined login can sign in, sees the "waiting for a role"
-- page, and nothing else: no reference lists, no settings, no inserts.
create or replace function public.has_access() returns boolean
language sql stable set search_path = public as $$
  select coalesce(public.app_role() not in ('undetermined'), false)
$$;

-- ---------- 2. who can I be? ----------
-- The people linked to the signed-in login: people sharing the crew phone (as before) plus the people
-- linked to login rows with the same email or mobile.
create or replace function public.people_for_my_phone() returns setof public.people
language sql stable security definer set search_path = public as $$
  select p.* from public.people p
  where p.active is not false and p.id in (
    select a.person_id
    from public.phone_assignments a join public.work_phones w on w.id = a.work_phone_id
    where w.active is not false
      and public.norm_phone(w.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))
    union
    select l.person_id
    from public.app_logins l
    where l.person_id is not null and l.active is not false and (
      (l.email is not null and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
      or (l.phone is not null and public.norm_phone(l.phone) = public.norm_phone(coalesce(auth.jwt() ->> 'phone', ''))))
  )
  order by p.full_name
$$;
revoke execute on function public.people_for_my_phone() from public, anon;
grant execute on function public.people_for_my_phone() to authenticated;
