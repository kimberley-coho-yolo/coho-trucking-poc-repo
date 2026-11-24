-- Coho Trucking PoC: core schema
-- Principle for the PoC: every business column is optional (nullable). Only ids and audit columns are filled automatically.
-- Every table has created_at / created_by so drafts can be resumed by whoever started them.

create extension if not exists pgcrypto;

-- ---------- helper: normalise Australian mobile numbers to digits with country code (61...) ----------
create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select case
    when p is null or regexp_replace(p, '\D', '', 'g') = '' then null
    when regexp_replace(p, '\D', '', 'g') ~ '^0\d{9}$' then '61' || substr(regexp_replace(p, '\D', '', 'g'), 2)
    else regexp_replace(p, '\D', '', 'g')
  end
$$;

-- ---------- access: who may sign in, and with which role ----------
create table public.app_logins (
  id uuid primary key default gen_random_uuid(),
  label text,                       -- e.g. "Truck crew phone 1" or a person's name
  email text,
  phone text,                       -- work mobile, any format; matched with norm_phone()
  role text check (role in ('driver','supervisor','office','admin')),
  person_id uuid,                   -- optional: links an email/mobile login to one person
  active boolean default true,
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);

-- ---------- people and work phones ----------
create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  crew text,                        -- e.g. Shift 1 Day
  department text,
  licences text,
  is_driver boolean default true,
  active boolean default true,
  notes text,
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);
alter table public.app_logins add constraint app_logins_person_fk foreign key (person_id) references public.people(id) on delete set null;

create table public.work_phones (
  id uuid primary key default gen_random_uuid(),
  phone text,
  label text,
  active boolean default true,
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);

create table public.phone_assignments (
  id uuid primary key default gen_random_uuid(),
  work_phone_id uuid references public.work_phones(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);

-- ---------- reference data ----------
create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  unit_no text, rego text, truck_type text, ownership text,
  qr_value text, gearbox_id text, tracker_id text, tracker_system text,
  status text, active boolean default true, notes text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  rego text, equipment_type text, capacity text, ownership text, active boolean default true, notes text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text, short_name text, billing_company text, myob_card_id text, active boolean default true,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text,
  kind text,                        -- rig, well, source, disposal, sprayfield, yard, other
  customer_id uuid references public.customers(id) on delete set null,
  well_ref text, gps text, active boolean default true,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

-- ---------- planning ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_date date,
  customer_id uuid references public.customers(id) on delete set null,
  billing_company text, contract text,
  location_id uuid references public.locations(id) on delete set null,
  well text, project_no text, task_no text, po text, department text, notes text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  truck_id uuid references public.trucks(id) on delete set null,
  equipment_id uuid references public.equipment(id) on delete set null,
  shift_date date, day_night text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

-- ---------- the driver's day ----------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  status text default 'draft' check (status in ('draft','open','submitted','approved')),
  shift_date date, day_night text,
  truck_id uuid references public.trucks(id) on delete set null,
  equipment_id uuid references public.equipment(id) on delete set null,
  driver_id uuid references public.people(id) on delete set null,
  work_phone_id uuid references public.work_phones(id) on delete set null,
  is_cover boolean default false,
  sign_in_at timestamptz, sign_out_at timestamptz,
  prestart_status text,             -- not done, passed, failed
  prestart_ref text,
  last_step text,                   -- where the driver left off (save and exit)
  notes text,
  created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid default auth.uid()
);

-- Docket = one customer job inside a shift. Core record of the design.
create table public.dockets (
  id uuid primary key default gen_random_uuid(),
  status text default 'draft' check (status in ('draft','open','closed')),
  shift_id uuid references public.shifts(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  department text, project_no text, task_no text, po text, contract text,
  start_at timestamptz, end_at timestamptz,
  standby_minutes numeric, standby_reason text,
  fuel_l numeric, odo_start numeric, odo_end numeric,
  km numeric,                       -- filled by km matching
  equipment_on_site text, notes text,
  extras jsonb default '{}'::jsonb, -- department-specific fields
  last_step text,
  created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.loads (
  id uuid primary key default gen_random_uuid(),
  docket_id uuid references public.dockets(id) on delete cascade,
  depart_at timestamptz, return_at timestamptz,
  task text, material text, volume_in_l numeric, volume_out_l numeric,
  source text, destination text, docket_no text, waste_tracking_no text,
  extras jsonb default '{}'::jsonb,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.signoffs (
  id uuid primary key default gen_random_uuid(),
  docket_id uuid references public.dockets(id) on delete cascade,
  client_name text, signed_at timestamptz, po text,
  signature_png text,               -- data URL of the drawn signature (PoC)
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.faults (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references public.shifts(id) on delete set null,
  truck_id uuid references public.trucks(id) on delete set null,
  description text, safe_to_run boolean, status text default 'open',
  reported_at timestamptz default now(), gearbox_ref text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.timesheet_lines (
  id uuid primary key default gen_random_uuid(),
  status text default 'draft' check (status in ('draft','submitted','approved','queried')),
  person_id uuid references public.people(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  work_date date,
  on_shift boolean default true, rr boolean default false,
  docket_hours numeric, travel_hours numeric, standby_hours numeric, total_hours numeric,
  wet_hours numeric, wet_type text, work_diary_page text, location text,
  driver_comment text, supervisor_comment text,
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid default auth.uid()
);

-- ---------- integration stand-ins (filled by spreadsheet upload until APIs are connected) ----------
create table public.gps_trips (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid references public.trucks(id) on delete set null,
  truck_ref text,                   -- unit, rego or tracker id as it appears in the export
  start_at timestamptz, end_at timestamptz, km numeric,
  odo_start numeric, odo_end numeric, source_system text,   -- MyGeotab, Fleet Complete, manual
  import_batch_id uuid,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.prestart_records (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid references public.trucks(id) on delete set null,
  truck_ref text, done_at timestamptz, result text, driver_name text, gearbox_ref text, faults text,
  import_batch_id uuid,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.km_segments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references public.shifts(id) on delete cascade,
  truck_id uuid references public.trucks(id) on delete set null,
  trip_id uuid references public.gps_trips(id) on delete set null,
  docket_id uuid references public.dockets(id) on delete set null,  -- empty for travel
  segment_type text check (segment_type in ('docket','travel')),
  start_at timestamptz, end_at timestamptz, km numeric, flag text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  target_table text, file_name text, row_count int, notes text,
  created_at timestamptz default now(), created_by uuid default auth.uid()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  system text, purpose text, direction text, api_status text, stand_in text, sort_order int
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text, record_id uuid, action text, actor uuid default auth.uid(),
  before_data jsonb, after_data jsonb, at timestamptz default now()
);

-- ---------- reporting views (respect row level security of the caller) ----------
create view public.v_daily_customer with (security_invoker = true) as
select (d.start_at at time zone 'Australia/Brisbane')::date as work_date,
       c.name as customer, l.name as location, d.project_no, d.task_no, d.po,
       count(distinct d.id) as dockets,
       round(sum(extract(epoch from (d.end_at - d.start_at)) / 3600.0)::numeric, 2) as hours,
       round(sum(coalesce(d.km, 0))::numeric, 1) as km,
       sum(coalesce(d.fuel_l, 0)) as fuel_l
from public.dockets d
left join public.customers c on c.id = d.customer_id
left join public.locations l on l.id = d.location_id
group by 1, 2, 3, 4, 5, 6;

create view public.v_daily_travel with (security_invoker = true) as
select (k.start_at at time zone 'Australia/Brisbane')::date as work_date,
       t.unit_no, t.rego, p.full_name as driver,
       round(sum(extract(epoch from (k.end_at - k.start_at)) / 3600.0)::numeric, 2) as travel_hours,
       round(sum(coalesce(k.km, 0))::numeric, 1) as travel_km
from public.km_segments k
left join public.shifts s on s.id = k.shift_id
left join public.trucks t on t.id = k.truck_id
left join public.people p on p.id = s.driver_id
where k.segment_type = 'travel'
group by 1, 2, 3, 4;

create view public.v_daily_truck with (security_invoker = true) as
select s.shift_date, s.day_night, t.unit_no, t.rego, p.full_name as driver,
       c.name as customer, l.name as location, d.department,
       d.start_at, d.end_at,
       round((extract(epoch from (d.end_at - d.start_at)) / 3600.0)::numeric, 2) as hours,
       d.km, d.standby_minutes, d.fuel_l,
       (select count(*) from public.loads x where x.docket_id = d.id) as loads,
       d.status
from public.dockets d
join public.shifts s on s.id = d.shift_id
left join public.trucks t on t.id = s.truck_id
left join public.people p on p.id = s.driver_id
left join public.customers c on c.id = d.customer_id
left join public.locations l on l.id = d.location_id;
