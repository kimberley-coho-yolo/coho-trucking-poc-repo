-- 27/11/2026 (Kimberley): the Admin role is now called "System admin (SYS.ADM)". Same full access as before (everything, cannot be
-- restricted). The internal code stays 'admin' so every existing rule, policy and login keeps working unchanged; only the names and
-- messages people see change. The Admin screen/menu name is unchanged (it is a screen, not the role).

update public.roles set label = 'System admin (SYS.ADM)',
  description = 'System administrator: full access to everything, including settings, logins, roles and integrations. Cannot be restricted.'
where code = 'admin';
update public.roles set description = 'New user waiting for a system admin (SYS.ADM) to choose their role. Sees nothing until the role is changed.'
where code = 'undetermined';

update public.features set grp = 'System admin (SYS.ADM) only' where grp = 'Admin only';
update public.features set description = replace(description, 'Only admin can', 'Only system admin (SYS.ADM) can') where description like '%Only admin can%';

-- Messages inside database functions: swap only these exact sentences; nothing else in the functions changes.
do $$
declare
  f text; def text; new_def text;
  swaps text[][] := array[
    ['Ask an admin to reopen', 'Ask a system admin (SYS.ADM) to reopen'],
    ['An admin already exists. Ask them to add you.', 'A system admin (SYS.ADM) already exists. Ask them to add you.'],
    ['You are now the admin.', 'You are now the system admin (SYS.ADM).'],
    ['Only an admin can change it.', 'Only a system admin (SYS.ADM) can change it.'],
    ['Only supervisor, office or admin can', 'Only supervisor, office or system admin (SYS.ADM) can'],
    ['The admin role must stay active and first.', 'The system admin (SYS.ADM) role must stay active and first.'],
    ['''First admin''', '''First system admin''']
  ];
  i int;
begin
  foreach f in array array['protect_roles', 'pair_pending_driver', 'claim_first_admin', 'form_guard', 'docket_workflow', 'resolve_timesheet_clash'] loop
    for def in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f loop
      new_def := def;
      for i in 1 .. array_length(swaps, 1) loop
        new_def := replace(new_def, swaps[i][1], swaps[i][2]);
      end loop;
      if new_def <> def then execute new_def; end if;
    end loop;
  end loop;
end $$;
