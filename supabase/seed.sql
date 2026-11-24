-- Demo seed data for the PoC. All names and numbers are made up.
insert into public.integrations(system, purpose, direction, api_status, stand_in, sort_order) values
 ('MyGeotab (Securatrak / Geotrack?)','GPS trips and odometer for km matching','In','Published API, access to request','Upload GPS trips spreadsheet (Data > Import > gps_trips)',1),
 ('Fleet Complete (Powerfleet)','GPS trips and odometer','In','Published API, token to request','Upload GPS trips spreadsheet',2),
 ('Gearbox / Gearbox Prestart','Prestart results in, faults out','In and out','API on request; webhook','Upload prestart spreadsheet (Data > Import > prestart_records); driver confirms prestart',3),
 ('MYOB AccountRight','Approved hours to payroll; invoice lines','Out','Published API','Export approved timesheet lines and daily customer report (Data > Export)',4),
 ('SMS provider (e.g. Twilio)','Sign-in codes to work mobiles','Out','Published API','Email sign-in, or Supabase test phone numbers',5),
 ('Microsoft 365','07:30 and approval emails','Out','Published API','Reports screen, export',6),
 ('Fabric lakehouse / Power BI','Management reporting','Out','Published API','Export to CSV or Excel',7),
 ('Momentum IoT','Camera event links','In','API on request','Not in PoC',8),
 ('Jotform','Existing forms during transition','In','Published API','Replaced by dockets in the app',9);

insert into public.customers(id, name, short_name, billing_company) values
 ('11111111-0000-0000-0000-000000000001','Origin Energy','Origin','Coho Resources'),
 ('11111111-0000-0000-0000-000000000002','Santos','Santos','Coho Resources');
insert into public.locations(id, name, kind, customer_id) values
 ('22222222-0000-0000-0000-000000000001','SAV 168','rig','11111111-0000-0000-0000-000000000001'),
 ('22222222-0000-0000-0000-000000000002','NIT 1','rig','11111111-0000-0000-0000-000000000002'),
 ('22222222-0000-0000-0000-000000000003','Roma yard','yard',null);
insert into public.trucks(id, unit_no, rego, truck_type, ownership, qr_value, tracker_system) values
 ('33333333-0000-0000-0000-000000000004','04','XB80KB','Prime mover','Owned','COHO-TRUCK-04','MyGeotab'),
 ('33333333-0000-0000-0000-000000000087','87','XB28PZ','Water truck','Owned','COHO-TRUCK-87','Fleet Complete');
insert into public.equipment(rego, equipment_type, capacity) values ('TR12AB','Water tanker trailer','30000 L');
insert into public.people(id, full_name, crew, department) values
 ('44444444-0000-0000-0000-000000000001','Alex Driver','Shift 1 Day','Completions'),
 ('44444444-0000-0000-0000-000000000002','Sam Driver','Shift 2 Day','Completions'),
 ('44444444-0000-0000-0000-000000000003','Jo Cover','Shift 1 Night','Drilling');
insert into public.work_phones(id, phone, label) values ('55555555-0000-0000-0000-000000000001','0400 000 001','Crew phone 1 (Shift 1 / Shift 2 Day)');
insert into public.phone_assignments(work_phone_id, person_id) values
 ('55555555-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001'),
 ('55555555-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000002');
insert into public.app_logins(label, phone, role) values ('Crew phone 1','0400 000 001','driver');
insert into public.jobs(id, job_date, customer_id, billing_company, location_id, project_no, task_no, po, department) values
 ('66666666-0000-0000-0000-000000000001', current_date, '11111111-0000-0000-0000-000000000001','Coho Resources','22222222-0000-0000-0000-000000000001','P-1001','T-01','PO-5501','Completions'),
 ('66666666-0000-0000-0000-000000000002', current_date, '11111111-0000-0000-0000-000000000002','Coho Resources','22222222-0000-0000-0000-000000000002','P-2002','T-07','PO-7702','Completions');
insert into public.allocations(job_id, truck_id, shift_date, day_night) values
 ('66666666-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000004', current_date, 'Night'),
 ('66666666-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000004', current_date, 'Night');
