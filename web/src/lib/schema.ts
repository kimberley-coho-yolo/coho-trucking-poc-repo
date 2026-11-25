// Field definitions for every table the app shows. Forms, tables, imports, exports
// and the field lists in the manuals are all generated from this one file.
// PoC rule: no field is required.

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'time' | 'bool' | 'multi' | 'select' | 'ref' | 'phone' | 'email';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  ref?: TableName;          // for type 'ref'
  options?: string[];       // for type 'select'
  optionsFrom?: { table: TableName; value: string; label: string };  // for type 'select' with options from a table
  help?: string;
  hideInTable?: boolean;
}

export type TableName =
  | 'app_logins' | 'people' | 'work_phones' | 'phone_assignments' | 'trucks' | 'equipment'
  | 'customers' | 'locations' | 'jobs' | 'allocations' | 'shifts' | 'dockets' | 'loads'
  | 'signoffs' | 'faults' | 'timesheet_lines' | 'gps_trips' | 'prestart_records'
  | 'km_segments' | 'import_batches' | 'integrations' | 'audit_log' | 'roles' | 'features' | 'role_permissions'
  | 'form_submissions' | 'form_files' | 'app_settings';

export interface TableDef {
  name: TableName;
  label: string;
  group: 'Access' | 'Reference' | 'Planning' | 'Driver work' | 'Integration stand-ins' | 'System' | 'Settings';
  display: (r: Record<string, any>) => string;   // how a row shows in drop-downs
  fields: Field[];
  importable?: boolean;
}

const DEPARTMENTS = ['Completions', 'Workover', 'Drilling', 'Flowback', 'Frac support', 'Rig support', 'Potable and septic', 'Civil', 'Landspray'];
const DAY_NIGHT = ['Day', 'Night'];
const ROLES = ['driver', 'supervisor', 'office', 'admin'];

export const TABLES: Record<TableName, TableDef> = {
  app_logins: {
    name: 'app_logins', label: 'Logins and roles', group: 'Access', importable: true,
    display: r => r.label || r.email || r.phone || '',
    fields: [
      { name: 'label', label: 'Label', type: 'text', help: 'A name for this login, e.g. "Crew phone 1" or a person' },
      { name: 'email', label: 'Email', type: 'email', help: 'Sign in with a code sent to this email' },
      { name: 'phone', label: 'Mobile', type: 'phone', help: 'Sign in with a code texted to this mobile. Any format, e.g. 0400 000 001' },
      { name: 'role', label: 'Role', type: 'select', options: ROLES, optionsFrom: { table: 'roles', value: 'code', label: 'label' }, help: 'Roles and what each can see are set in Settings (admin only)' },
      { name: 'person_id', label: 'Person (optional)', type: 'ref', ref: 'people' },
      { name: 'active', label: 'Active', type: 'bool' },
    ],
  },
  people: {
    name: 'people', label: 'People', group: 'Access', importable: true,
    display: r => r.full_name || '',
    fields: [
      { name: 'full_name', label: 'Full name', type: 'text' },
      { name: 'crew', label: 'Crew', type: 'text', help: 'e.g. Shift 1 Day' },
      { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
      { name: 'licences', label: 'Licences', type: 'text' },
      { name: 'is_driver', label: 'Driver', type: 'bool' },
      { name: 'active', label: 'Active', type: 'bool' },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInTable: true },
    ],
  },
  work_phones: {
    name: 'work_phones', label: 'Work phones', group: 'Access', importable: true,
    display: r => [r.label, r.phone].filter(Boolean).join(' - '),
    fields: [
      { name: 'phone', label: 'Mobile number', type: 'phone' },
      { name: 'label', label: 'Label', type: 'text' },
      { name: 'active', label: 'Active', type: 'bool' },
    ],
  },
  phone_assignments: {
    name: 'phone_assignments', label: 'Who uses which phone', group: 'Access', importable: true,
    display: r => r.id,
    fields: [
      { name: 'work_phone_id', label: 'Work phone', type: 'ref', ref: 'work_phones' },
      { name: 'person_id', label: 'Person', type: 'ref', ref: 'people' },
    ],
  },
  trucks: {
    name: 'trucks', label: 'Trucks', group: 'Reference', importable: true,
    display: r => [r.unit_no && `Unit ${r.unit_no}`, r.rego].filter(Boolean).join(' '),
    fields: [
      { name: 'unit_no', label: 'Unit no.', type: 'text' },
      { name: 'rego', label: 'Rego', type: 'text' },
      { name: 'truck_type', label: 'Type', type: 'text' },
      { name: 'ownership', label: 'Ownership', type: 'select', options: ['Owned', 'Hired', 'Other'] },
      { name: 'qr_value', label: 'QR code value', type: 'text', help: 'The text inside the QR code on the truck' },
      { name: 'gearbox_id', label: 'Gearbox ID', type: 'text' },
      { name: 'tracker_id', label: 'Tracker ID', type: 'text' },
      { name: 'tracker_system', label: 'Tracker system', type: 'select', options: ['MyGeotab', 'Fleet Complete', 'None'] },
      { name: 'status', label: 'Status', type: 'select', options: ['Available', 'Allocated to job', 'In use', 'Defect logged', 'Tagged out', 'Scheduled service', 'In workshop', 'Awaiting parts', 'At external repairer', 'Awaiting sign-off', 'Off hired / Sold'] },
      { name: 'active', label: 'Active', type: 'bool' },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInTable: true },
    ],
  },
  equipment: {
    name: 'equipment', label: 'Trailers and equipment', group: 'Reference', importable: true,
    display: r => [r.rego, r.equipment_type].filter(Boolean).join(' '),
    fields: [
      { name: 'rego', label: 'Rego', type: 'text' },
      { name: 'equipment_type', label: 'Type', type: 'text' },
      { name: 'capacity', label: 'Capacity', type: 'text' },
      { name: 'ownership', label: 'Ownership', type: 'select', options: ['Owned', 'Hired', 'Other'] },
      { name: 'active', label: 'Active', type: 'bool' },
    ],
  },
  customers: {
    name: 'customers', label: 'Customers', group: 'Reference', importable: true,
    display: r => r.short_name || r.name || '',
    fields: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'short_name', label: 'Short name', type: 'text' },
      { name: 'billing_company', label: 'Billing company', type: 'select', options: ['Coho Resources', 'Mantl Australia', 'Coho Pipe Inspection', 'Sockeye Transport'] },
      { name: 'myob_card_id', label: 'MYOB card ID', type: 'text' },
      { name: 'active', label: 'Active', type: 'bool' },
    ],
  },
  locations: {
    name: 'locations', label: 'Rigs and locations', group: 'Reference', importable: true,
    display: r => r.name || '',
    fields: [
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'kind', label: 'Kind', type: 'select', options: ['rig', 'well', 'source', 'disposal', 'sprayfield', 'yard', 'other'] },
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { name: 'well_ref', label: 'Well ref (PL / EPPG)', type: 'text' },
      { name: 'gps', label: 'GPS', type: 'text' },
      { name: 'active', label: 'Active', type: 'bool' },
    ],
  },
  jobs: {
    name: 'jobs', label: 'Jobs', group: 'Planning', importable: true,
    display: r => [r.job_date, r.project_no, r.po].filter(Boolean).join(' '),
    fields: [
      { name: 'job_date', label: 'Date', type: 'date' },
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { name: 'billing_company', label: 'Billing company', type: 'select', options: ['Coho Resources', 'Mantl Australia', 'Coho Pipe Inspection', 'Sockeye Transport'] },
      { name: 'contract', label: 'Contract', type: 'text' },
      { name: 'location_id', label: 'Rig / location', type: 'ref', ref: 'locations' },
      { name: 'well', label: 'Well', type: 'text' },
      { name: 'project_no', label: 'Project no.', type: 'text' },
      { name: 'task_no', label: 'Task no.', type: 'text' },
      { name: 'po', label: 'PO', type: 'text' },
      { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInTable: true },
    ],
  },
  allocations: {
    name: 'allocations', label: 'Allocations (truck to job)', group: 'Planning', importable: true,
    display: r => r.id,
    fields: [
      { name: 'shift_date', label: 'Date', type: 'date' },
      { name: 'day_night', label: 'Day / Night', type: 'select', options: DAY_NIGHT },
      { name: 'job_id', label: 'Job', type: 'ref', ref: 'jobs' },
      { name: 'truck_id', label: 'Truck', type: 'ref', ref: 'trucks' },
      { name: 'equipment_id', label: 'Trailer', type: 'ref', ref: 'equipment' },
    ],
  },
  shifts: {
    name: 'shifts', label: 'Shifts', group: 'Driver work', importable: true,
    display: r => [r.shift_date, r.day_night].filter(Boolean).join(' '),
    fields: [
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'open', 'submitted', 'approved'] },
      { name: 'shift_date', label: 'Date', type: 'date' },
      { name: 'day_night', label: 'Day / Night', type: 'select', options: DAY_NIGHT },
      { name: 'driver_id', label: 'Driver', type: 'ref', ref: 'people' },
      { name: 'is_cover', label: 'Cover driver', type: 'bool' },
      { name: 'over_24h', label: 'Shift over 24 hours', type: 'bool', help: 'Hours are split across each day on the timesheet', hideInTable: true },
      { name: 'truck_id', label: 'Truck', type: 'ref', ref: 'trucks' },
      { name: 'equipment_id', label: 'Trailer', type: 'ref', ref: 'equipment' },
      { name: 'sign_in_at', label: 'Signed in', type: 'datetime' },
      { name: 'sign_out_at', label: 'Signed out', type: 'datetime' },
      { name: 'prestart_status', label: 'Prestart', type: 'select', options: ['not done', 'passed', 'failed'] },
      { name: 'prestart_ref', label: 'Prestart reference', type: 'text' },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInTable: true },
    ],
  },
  dockets: {
    name: 'dockets', label: 'Dockets', group: 'Driver work', importable: true,
    display: r => [r.docket_no ? 'No. ' + r.docket_no : '', r.project_no, r.po, r.department].filter(Boolean).join(' '),
    fields: [
      { name: 'docket_no', label: 'Docket no.', type: 'number', help: 'Given by the system when the docket is created' },
      { name: 'form_type', label: 'Form', type: 'select', options: ['landspray_runsheet', 'daily_report_workover', 'daily_report_drilling', 'frac_support', 'potable_water', 'septic', 'rig_support_ticket', 'general'] },
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'open', 'closed'] },
      { name: 'work_date', label: 'Date', type: 'date' },
      { name: 'truck_id', label: 'Truck', type: 'ref', ref: 'trucks' },
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' },
      { name: 'location_id', label: 'Rig / location', type: 'ref', ref: 'locations' },
      { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
      { name: 'contract', label: 'Contract', type: 'text' },
      { name: 'project_no', label: 'Project no.', type: 'text' },
      { name: 'task_no', label: 'Task no.', type: 'text' },
      { name: 'po', label: 'PO', type: 'text' },
      { name: 'start_at', label: 'Start', type: 'datetime' },
      { name: 'end_at', label: 'End', type: 'datetime' },
      { name: 'standby_minutes', label: 'Standby (minutes)', type: 'number' },
      { name: 'over_24h', label: 'Shift over 24 hours', type: 'bool', help: 'Tick when the shift runs past 24 hours. Hours are split across each day on the timesheet', hideInTable: true },
      { name: 'standby_reason', label: 'Standby reason', type: 'text' },
      { name: 'fuel_l', label: 'Fuel used (L)', type: 'number' },
      { name: 'odo_start', label: 'Odometer start', type: 'number', help: 'Only needed if the truck has no tracker' },
      { name: 'odo_end', label: 'Odometer end', type: 'number' },
      { name: 'km', label: 'Km (from GPS matching)', type: 'number' },
      { name: 'equipment_on_site', label: 'Equipment on site', type: 'textarea', hideInTable: true },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInTable: true },
    ],
  },
  loads: {
    name: 'loads', label: 'Loads and tasks', group: 'Driver work', importable: true,
    display: r => [r.task, r.material].filter(Boolean).join(' '),
    fields: [
      { name: 'depart_at', label: 'Departed', type: 'datetime' },
      { name: 'return_at', label: 'Returned', type: 'datetime' },
      { name: 'task', label: 'Task', type: 'text' },
      { name: 'material', label: 'Material / fluid', type: 'text' },
      { name: 'volume_in_l', label: 'Volume in (L)', type: 'number' },
      { name: 'volume_out_l', label: 'Volume out (L)', type: 'number' },
      { name: 'source', label: 'Source', type: 'text' },
      { name: 'destination', label: 'Destination / disposal', type: 'text' },
      { name: 'docket_no', label: 'Docket no.', type: 'text' },
      { name: 'waste_tracking_no', label: 'Waste tracking no.', type: 'text' },
    ],
  },
  signoffs: {
    name: 'signoffs', label: 'Client sign-offs', group: 'Driver work',
    display: r => r.client_name || '',
    fields: [
      { name: 'client_name', label: 'Client representative', type: 'text' },
      { name: 'po', label: 'PO confirmed', type: 'text' },
      { name: 'signed_at', label: 'Signed at', type: 'datetime' },
    ],
  },
  faults: {
    name: 'faults', label: 'Faults', group: 'Driver work', importable: true,
    display: r => r.description || '',
    fields: [
      { name: 'truck_id', label: 'Truck', type: 'ref', ref: 'trucks' },
      { name: 'description', label: 'Fault', type: 'textarea' },
      { name: 'safe_to_run', label: 'Safe to run', type: 'bool' },
      { name: 'status', label: 'Status', type: 'select', options: ['open', 'sent to Gearbox', 'closed'] },
      { name: 'reported_at', label: 'Reported', type: 'datetime' },
      { name: 'gearbox_ref', label: 'Gearbox ref', type: 'text' },
    ],
  },
  timesheet_lines: {
    name: 'timesheet_lines', label: 'Timesheet lines', group: 'Driver work', importable: true,
    display: r => [r.work_date].filter(Boolean).join(' '),
    fields: [
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'submitted', 'approved', 'queried'] },
      { name: 'person_id', label: 'Driver', type: 'ref', ref: 'people' },
      { name: 'work_date', label: 'Date', type: 'date' },
      { name: 'on_shift', label: 'On shift', type: 'bool' },
      { name: 'rr', label: 'R&R', type: 'bool' },
      { name: 'docket_hours', label: 'Docket time (hours)', type: 'number', help: 'Time inside customer dockets. Decimal hours: 0.5 = 30 minutes' },
      { name: 'travel_hours', label: 'Travel time (hours, no customer)', type: 'number', help: 'Time driving outside any docket, e.g. yard to first job. This is time, not distance' },
      { name: 'standby_hours', label: 'Standby time (hours)', type: 'number' },
      { name: 'total_hours', label: 'Total time (hours)', type: 'number' },
      { name: 'wet_hours', label: 'Wet time (hours)', type: 'number' },
      { name: 'wet_type', label: 'Wet type', type: 'select', options: ['8 hr wet (yard)', '6 hr wet (home)'] },
      { name: 'work_diary_page', label: 'Work diary page', type: 'text' },
      { name: 'shift_band', label: 'Shift times', type: 'select', options: ['00:00 to 12:00', '12:00 to 24:00', '06:00 to 18:00', '18:00 to 06:00'] },
      { name: 'truck_id', label: 'Unit', type: 'ref', ref: 'trucks' },
      { name: 'with_dog', label: 'Truck and dog', type: 'bool', help: 'Tick when the hours were worked with a dog trailer' },
      { name: 'over_24h', label: 'Part of a shift over 24 hours', type: 'bool' },
      { name: 'split_note', label: 'Long shift', type: 'text', hideInTable: true },
      { name: 'location', label: 'Rig / location', type: 'text' },
      { name: 'driver_comment', label: 'Driver comment', type: 'textarea', hideInTable: true },
      { name: 'supervisor_comment', label: 'Supervisor comment', type: 'textarea' },
    ],
  },
  gps_trips: {
    name: 'gps_trips', label: 'GPS trips (MyGeotab / Fleet Complete)', group: 'Integration stand-ins', importable: true,
    display: r => [r.truck_ref, r.start_at].filter(Boolean).join(' '),
    fields: [
      { name: 'truck_ref', label: 'Truck (unit, rego or tracker id)', type: 'text' },
      { name: 'truck_id', label: 'Truck (matched)', type: 'ref', ref: 'trucks' },
      { name: 'start_at', label: 'Trip start', type: 'datetime' },
      { name: 'end_at', label: 'Trip end', type: 'datetime' },
      { name: 'km', label: 'Km', type: 'number' },
      { name: 'odo_start', label: 'Odometer start', type: 'number' },
      { name: 'odo_end', label: 'Odometer end', type: 'number' },
      { name: 'source_system', label: 'Source system', type: 'select', options: ['MyGeotab', 'Fleet Complete', 'Manual'] },
    ],
  },
  prestart_records: {
    name: 'prestart_records', label: 'Prestart records (Gearbox)', group: 'Integration stand-ins', importable: true,
    display: r => [r.truck_ref, r.done_at, r.result].filter(Boolean).join(' '),
    fields: [
      { name: 'truck_ref', label: 'Truck (unit or rego)', type: 'text' },
      { name: 'truck_id', label: 'Truck (matched)', type: 'ref', ref: 'trucks' },
      { name: 'done_at', label: 'Done at', type: 'datetime' },
      { name: 'result', label: 'Result', type: 'select', options: ['passed', 'failed'] },
      { name: 'driver_name', label: 'Driver', type: 'text' },
      { name: 'gearbox_ref', label: 'Gearbox ref', type: 'text' },
      { name: 'faults', label: 'Faults', type: 'textarea' },
    ],
  },
  km_segments: {
    name: 'km_segments', label: 'Km segments (matching result)', group: 'Integration stand-ins',
    display: r => r.id,
    fields: [
      { name: 'shift_id', label: 'Shift', type: 'ref', ref: 'shifts' },
      { name: 'docket_id', label: 'Docket (empty = travel)', type: 'ref', ref: 'dockets' },
      { name: 'segment_type', label: 'Type', type: 'select', options: ['docket', 'travel'] },
      { name: 'start_at', label: 'Start', type: 'datetime' },
      { name: 'end_at', label: 'End', type: 'datetime' },
      { name: 'km', label: 'Km', type: 'number' },
      { name: 'flag', label: 'Flag', type: 'text' },
    ],
  },
  import_batches: {
    name: 'import_batches', label: 'Import history', group: 'System',
    display: r => r.file_name || '',
    fields: [
      { name: 'target_table', label: 'Table', type: 'text' },
      { name: 'file_name', label: 'File', type: 'text' },
      { name: 'row_count', label: 'Rows', type: 'number' },
      { name: 'created_at', label: 'When', type: 'datetime' },
    ],
  },
  integrations: {
    name: 'integrations', label: 'Integrations to build', group: 'System',
    display: r => r.system || '',
    fields: [
      { name: 'system', label: 'System', type: 'text' },
      { name: 'purpose', label: 'Purpose', type: 'text' },
      { name: 'direction', label: 'Direction', type: 'text' },
      { name: 'api_status', label: 'API status', type: 'text' },
      { name: 'status', label: 'Progress', type: 'select', options: ['Not started', 'Access requested', 'In progress', 'Connected', 'Paused'] },
      { name: 'owner', label: 'Owner', type: 'text', help: 'Who is looking after this integration' },
      { name: 'stand_in', label: 'Until integrated', type: 'text' },
      { name: 'sort_order', label: 'Order', type: 'number', hideInTable: true },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInTable: true, help: 'Never put API keys or passwords here. They go in Supabase secrets.' },
    ],
  },
  roles: {
    name: 'roles', label: 'Roles', group: 'Settings',
    display: r => r.label || r.code || '',
    fields: [
      { name: 'label', label: 'Name', type: 'text' },
      { name: 'code', label: 'Code', type: 'text', help: 'Short lower-case id, e.g. hse. Set once.' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'rank', label: 'Priority', type: 'number', help: 'If someone has several logins, the lowest number wins' },
      { name: 'active', label: 'Active', type: 'bool' },
    ],
  },
  features: {
    name: 'features', label: 'Functions', group: 'Settings',
    display: r => r.label || r.code || '',
    fields: [
      { name: 'label', label: 'Function', type: 'text' },
      { name: 'grp', label: 'Group', type: 'text' },
      { name: 'description', label: 'What it covers', type: 'text' },
    ],
  },
  role_permissions: {
    name: 'role_permissions', label: 'Role access', group: 'Settings',
    display: r => `${r.role} ${r.feature}`,
    fields: [
      { name: 'role', label: 'Role', type: 'text' },
      { name: 'feature', label: 'Function', type: 'text' },
      { name: 'access', label: 'Access', type: 'select', options: ['hidden', 'read', 'edit'] },
    ],
  },
  form_submissions: {
    name: 'form_submissions', label: 'Forms (timesheets, expenses, checklists)', group: 'Driver work',
    display: r => [r.form_type, r.period_start].filter(Boolean).join(' '),
    fields: [
      { name: 'form_type', label: 'Form', type: 'select', options: ['driver_timesheet', 'expense_reimbursement', 'land_fire_risk'] },
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'submitted', 'approved', 'returned'] },
      { name: 'person_id', label: 'Person', type: 'ref', ref: 'people' },
      { name: 'period_start', label: 'Date / fortnight beginning', type: 'date' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'signed_at', label: 'Signed at', type: 'datetime' },
      { name: 'approver_name', label: 'Approved / authorised by', type: 'text' },
      { name: 'approver_comment', label: 'Approver comment', type: 'textarea', hideInTable: true },
      { name: 'approved_at', label: 'Approved at', type: 'datetime' },
    ],
  },
  app_settings: {
    name: 'app_settings', label: 'App settings', group: 'Settings',
    display: r => r.id,
    fields: [{ name: 'id', label: 'Setting', type: 'text' }, { name: 'description', label: 'What it does', type: 'text' }],
  },
  form_files: {
    name: 'form_files', label: 'Form photos and receipts', group: 'Driver work',
    display: r => r.file_name || r.kind || '',
    fields: [
      { name: 'kind', label: 'Kind', type: 'text' },
      { name: 'file_name', label: 'File name', type: 'text' },
      { name: 'caption', label: 'Caption', type: 'text' },
    ],
  },
  audit_log: {
    name: 'audit_log', label: 'Audit log', group: 'System',
    display: r => String(r.id),
    fields: [
      { name: 'table_name', label: 'Table', type: 'text' },
      { name: 'action', label: 'Action', type: 'text' },
      { name: 'record_id', label: 'Record', type: 'text' },
      { name: 'at', label: 'When', type: 'datetime' },
    ],
  },
};

export const TABLE_LIST = Object.values(TABLES);
