// Roles and access settings: for each role, every function is hidden, read only or edit.
// The database (supabase/migrations/*_role_permissions.sql) holds the real settings and enforces them;
// this file mirrors the list of functions and the starting defaults for the demo backend and the screens.
import type { TableName } from './schema';

export type Access = 'hidden' | 'read' | 'edit';
export type Perms = Record<string, Access>;

export interface Feature {
  code: string;
  label: string;
  grp: string;
  description: string;
  max_level: 'read' | 'edit';     // 'read' = there is nothing to edit
  admin_only_edit: boolean;       // only admin can ever edit
  sort: number;
}

export const FEATURES: Feature[] = [
  { code: 'shifts', label: 'Shifts, prestart and end of shift', grp: 'Driver', description: 'Start a shift, prestart check and the end-of-shift timesheet (own records).', max_level: 'edit', admin_only_edit: false, sort: 10 },
  { code: 'dockets', label: 'Dockets, loads and sign-offs', grp: 'Driver', description: 'Customer dockets, loads and client sign-off (own records and dockets assigned to them).', max_level: 'edit', admin_only_edit: false, sort: 20 },
  { code: 'faults', label: 'Fault reports', grp: 'Driver', description: 'Report a truck or equipment fault (own records).', max_level: 'edit', admin_only_edit: false, sort: 30 },
  { code: 'forms', label: 'Timesheets, expense claims and checklists', grp: 'Driver', description: 'Fortnightly timesheet, expense reimbursement and land pre-inspection checklist (own forms). Approving them needs Timesheet approvals.', max_level: 'edit', admin_only_edit: false, sort: 35 },
  { code: 'drafts', label: 'My drafts', grp: 'Driver', description: 'List of unfinished work to carry on.', max_level: 'read', admin_only_edit: false, sort: 40 },
  { code: 'all_work', label: "All crews' shifts and dockets", grp: 'Supervision', description: "Read only: see everyone's shifts, dockets and faults. Edit: change them, and create, clone and edit dockets for any crew.", max_level: 'edit', admin_only_edit: false, sort: 50 },
  { code: 'approvals', label: 'Timesheet approvals', grp: 'Supervision', description: 'Read only: see timesheets, expense claims and checklists waiting. Edit: approve, authorise or return them.', max_level: 'edit', admin_only_edit: false, sort: 60 },
  { code: 'reports', label: 'Reports', grp: 'Supervision', description: 'Hours and km per customer, rig, truck and travel.', max_level: 'read', admin_only_edit: false, sort: 70 },
  { code: 'people', label: 'People, work phones and phone sharing', grp: 'Admin lists', description: 'Who can be picked as a driver, crew phones and who uses which phone.', max_level: 'edit', admin_only_edit: false, sort: 80 },
  { code: 'fleet', label: 'Trucks, trailers and equipment', grp: 'Admin lists', description: 'Truck and trailer lists, QR codes, tracker and Gearbox IDs.', max_level: 'edit', admin_only_edit: false, sort: 90 },
  { code: 'customers', label: 'Customers, rigs and locations', grp: 'Admin lists', description: 'Customer and location lists.', max_level: 'edit', admin_only_edit: false, sort: 100 },
  { code: 'planning', label: 'Jobs and allocations', grp: 'Admin lists', description: 'Customer jobs and which truck does which job each day.', max_level: 'edit', admin_only_edit: false, sort: 110 },
  { code: 'data_transfer', label: 'Upload and download spreadsheets', grp: 'Data', description: 'Read only: download and browse tables. Edit: upload spreadsheets too.', max_level: 'edit', admin_only_edit: false, sort: 120 },
  { code: 'integration_data', label: 'GPS trips, prestart records and km matching', grp: 'Data', description: 'Integration stand-in data. Edit: upload and run km matching.', max_level: 'edit', admin_only_edit: false, sort: 130 },
  { code: 'query', label: 'Query console (SQL)', grp: 'Data', description: 'Read-only SQL queries. Results still respect these access settings.', max_level: 'read', admin_only_edit: false, sort: 140 },
  { code: 'integrations', label: 'Integrations', grp: 'Admin only', description: 'The list of systems to connect and their settings. Only admin can add or edit.', max_level: 'edit', admin_only_edit: true, sort: 150 },
  { code: 'logins', label: 'Logins and roles', grp: 'Admin only', description: 'Who can sign in (email or mobile) and which role they have. Only admin can edit.', max_level: 'edit', admin_only_edit: true, sort: 160 },
  { code: 'settings', label: 'Settings: roles and access', grp: 'Admin only', description: 'This screen. Only admin can change it.', max_level: 'edit', admin_only_edit: true, sort: 170 },
  { code: 'audit', label: 'Audit log and text message log', grp: 'Admin only', description: 'History of changes and sign-in texts.', max_level: 'read', admin_only_edit: false, sort: 180 },
  { code: 'help', label: 'Help', grp: 'General', description: 'How-to pages.', max_level: 'read', admin_only_edit: false, sort: 190 },
];

export const SYSTEM_ROLES = [
  { code: 'admin', label: 'Admin', description: 'Full access, including settings, logins and integrations. Cannot be restricted.', rank: 1 },
  { code: 'office', label: 'Office', description: 'Sets up people, trucks, customers and jobs; uploads and downloads data.', rank: 20 },
  { code: 'supervisor', label: 'Supervisor', description: "Sees all crews' work, approves timesheets, views reports.", rank: 30 },
  { code: 'driver', label: 'Driver', description: 'The basics: shifts, prestart, dockets, faults and their own drafts.', rank: 90 },
];

/** Starting access for the built-in roles (same rules as the database migration). */
export function defaultAccess(role: string, f: Feature): Access {
  if (role === 'admin') return 'edit';
  if (['shifts', 'dockets', 'faults'].includes(f.code)) return 'edit';
  if (f.code === 'forms') return ['driver', 'supervisor', 'office'].includes(role) ? 'edit' : 'hidden';
  if (['drafts', 'help'].includes(f.code)) return 'read';
  if (role === 'driver') return 'hidden';
  if (role !== 'office' && role !== 'supervisor') return 'hidden';
  if (['all_work', 'approvals'].includes(f.code)) return 'edit';
  if (f.code === 'reports') return 'read';
  if (f.code === 'integration_data') return role === 'office' ? 'edit' : 'read';
  if (role === 'office' && ['people', 'fleet', 'customers', 'planning', 'data_transfer'].includes(f.code)) return 'edit';
  if (role === 'office' && ['query', 'integrations'].includes(f.code)) return 'read';
  return 'hidden';
}

/** What a role really gets: admin can do everything; for other roles admin-only and read-only functions are capped. */
export function effectiveAccess(role: string | null, f: Feature | undefined, stored: Access | undefined): Access {
  if (!role || !f) return 'hidden';
  if (role === 'admin') return 'edit';
  const a = stored ?? 'hidden';
  if (a === 'edit' && (f.admin_only_edit || f.max_level === 'read')) return 'read';
  return a;
}

/** Which choices the Settings screen offers for a role and function. */
export function allowedLevels(role: string, f: Feature): Access[] {
  if (role === 'admin') return ['edit'];
  return f.max_level === 'read' || f.admin_only_edit ? ['hidden', 'read'] : ['hidden', 'read', 'edit'];
}

export const canRead = (p: Perms, f: string) => p[f] === 'read' || p[f] === 'edit';
export const canEdit = (p: Perms, f: string) => p[f] === 'edit';
const rankOf: Record<Access, number> = { hidden: 0, read: 1, edit: 2 };
/** The higher of several settings, e.g. a docket page is open to "Dockets" or "All crews' work". */
export function best(p: Perms, ...features: string[]): Access {
  return features.map(f => p[f] ?? 'hidden').reduce((a, b) => (rankOf[b] > rankOf[a] ? b : a), 'hidden' as Access);
}

/** Which function controls each table (used by the demo backend and the Admin lists). */
export const TABLE_FEATURE: Partial<Record<TableName, string>> = {
  people: 'people', work_phones: 'people', phone_assignments: 'people',
  trucks: 'fleet', equipment: 'fleet', customers: 'customers', locations: 'customers',
  jobs: 'planning', allocations: 'planning', integrations: 'integrations', app_logins: 'logins', audit_log: 'audit',
  gps_trips: 'integration_data', prestart_records: 'integration_data', km_segments: 'integration_data',
  shifts: 'shifts', timesheet_lines: 'shifts', dockets: 'dockets', loads: 'dockets', signoffs: 'dockets', faults: 'faults',
  roles: 'settings', role_permissions: 'settings', features: 'settings',
  form_submissions: 'forms', form_files: 'forms', app_settings: 'settings',
};

export const DATA_FEATURES = ['data_transfer', 'integration_data', 'query', 'integrations'];
export const ADMIN_FEATURES = ['people', 'fleet', 'customers', 'planning', 'logins'];
