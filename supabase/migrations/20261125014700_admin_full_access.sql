-- Admin can do everything: admin now gets "edit" on every function, including ones that
-- other roles can only ever read (reports, query console, audit log, drafts, help).
create or replace function public.access_for(p_role text, p_feature text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_role is null or f.code is null then 'hidden'
    when p_role = 'admin' then 'edit'
    else coalesce((select case when rp.access = 'edit' and (f.admin_only_edit or f.max_level = 'read') then 'read' else rp.access end
                   from public.role_permissions rp where rp.role = p_role and rp.feature = f.code), 'hidden')
  end
  from (select 1) one left join public.features f on f.code = p_feature
$$;
update public.role_permissions set access = 'edit' where role = 'admin';
