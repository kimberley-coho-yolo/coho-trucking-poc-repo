// Forms that are not dockets, from the Landspray Supervisor's examples (19 Nov 2026):
//  - 2024 Landspray Driver Timesheet Template (fortnightly)      -> driver_timesheet (screen: TimesheetFortnight)
//  - Expense Reimbursement (4 companies, receipts pages)          -> expense_reimbursement
//  - RDM Land Pre Inspection and Fire Risk Assessment Form        -> land_fire_risk
// Fields are stored in form_submissions.data (JSON), photos and receipts in form_files.
import type { Field } from './schema';
import type { Row } from './backend';

export const COMPANIES = [
  'Coho Resources Pty Ltd (ABN 67 159 604 529)',
  'Mantl Australia Pty Ltd (ABN 50 611 383 503)',
  'Coho Pipe Inspection Pty Ltd (ABN 56 602 723 884)',
  'Sockeye Transport Pty Ltd (ABN 32 169 352 738)',
];

export interface FilesDef { kind: string; title: string; help: string; max: number }
export interface SimpleFormDef {
  code: string;
  label: string;
  ref: string;
  summary: string;
  sections: { title: string; help?: string; fields: Field[]; files?: FilesDef }[];
  lines?: { title: string; addLabel: string; fields: Field[]; totalField?: string; max: number };
  signoff: { title: string; nameLabel: string };
  approval: { title: string; verb: string; nameLabel: string };
}

const t = (name: string, label: string, help?: string): Field => ({ name, label, type: 'text', help });
const area = (name: string, label: string, help?: string): Field => ({ name, label, type: 'textarea', help });

export const SIMPLE_FORMS: SimpleFormDef[] = [
  {
    code: 'expense_reimbursement', label: 'Expense reimbursement', ref: 'Expense Reimbursement',
    summary: 'Claim back money you spent for work. Add each item and a photo of each receipt.',
    sections: [
      {
        title: 'Claim', fields: [
          { name: 'company', label: 'Company', type: 'select', options: COMPANIES },
          t('claimant_name', 'Name'),
        ],
      },
      {
        title: 'Bank details (only if different)', help: 'Payment goes into the same account as your wages unless you give a different account here.',
        fields: [t('bsb', 'BSB'), t('account_no', 'Account number')],
      },
    ],
    lines: {
      title: 'Items', addLabel: 'Add an item', max: 30, totalField: 'amount',
      fields: [{ name: 'date', label: 'Date', type: 'date' }, t('item', 'Item (supplier name)'),
        { name: 'amount', label: '$ amount', type: 'number' }, t('comments', 'Comments')],
    },
    signoff: { title: 'Completed by', nameLabel: 'Name' },
    approval: { title: 'Authorised by', verb: 'Authorise', nameLabel: 'Name' },
  },
  {
    code: 'land_fire_risk', label: 'Land pre-inspection and fire risk assessment', ref: 'RDM Land Pre Inspection and Fire Risk Assessment Form',
    summary: 'Compliance checklist before land preparation and spraying: approvals, desktop review, ground truth, vegetation and fire risk.',
    sections: [
      {
        title: 'Property', fields: [
          t('property_name', 'Property name'), t('idp_number', 'IDP number'),
          t('gps_location', 'GPS location', 'e.g. 25°11\'1.68"S 148°50\'26.47"E'), t('total_hectares', 'Total hectares'),
          t('land_access_contact', 'Field land access contact'),
          { name: 'approvals_received', label: 'Approval documentation received from client', type: 'multi', options: [
            'Environmental Approval', 'CH Approval', 'LH Maps', 'GIS data including CH Exclusions, Environmental Exclusions, Mitigation Zones',
            'Site Permit Request', 'Terms of Access'] },
          area('general_comments', 'General comments', 'Note any specific terms of access, CH or Environmental exclusions associated with this approval.'),
        ],
      },
      {
        title: 'Desktop review', help: 'Identify potential concerns: slope, hazards, drainage, proximity to waterways or infrastructure, factors affecting use of the area.',
        fields: [area('desktop_review', 'Desktop review')],
        files: { kind: 'evidence', title: 'Evidence of desktop review', help: 'e.g. a screenshot of the map', max: 6 },
      },
      {
        title: 'Ground truth', help: 'Review slope, hazards, drainage, proximity to waterways or infrastructure, factors affecting use of the area. Identify any concerns.',
        fields: [
          area('ground_truth', 'Ground truth'),
          { name: 'vegetation', label: 'Vegetation type checklist', type: 'multi', options: ['Pasture', 'Deadfall', 'Brigalow', 'Scrub / regrowth', 'Cropping / stubble', 'Bare / scalded', 'Other'],
            help: 'Pasture and Deadfall are from the example form; the other choices are a first guess to confirm with the Landspray Supervisor' },
          { name: 'fire_risk', label: 'Fire risk factors assessment', type: 'select', options: ['1 / 4', '2 / 4', '3 / 4', '4 / 4'] },
          area('fire_risk_factors', 'Fire risk factors documented'),
          area('controls', 'Controls to be implemented to mitigate risks'),
        ],
        files: { kind: 'photo', title: 'Photos for visual documentation', help: 'Take photos of the site', max: 12 },
      },
    ],
    signoff: { title: 'Completed by', nameLabel: 'Full name' },
    approval: { title: 'Reviewed by', verb: 'Approve', nameLabel: 'Name' },
  },
];

export const FORM_LABELS: Record<string, string> = {
  driver_timesheet: 'Driver timesheet (fortnight)',
  ...Object.fromEntries(SIMPLE_FORMS.map(f => [f.code, f.label])),
};
export const simpleForm = (code?: string | null) => SIMPLE_FORMS.find(f => f.code === code);

export function linesTotal(lines: Row[] | undefined, field: string): number {
  return Math.round((lines ?? []).reduce((s, l) => s + (Number(l[field]) || 0), 0) * 100) / 100;
}

// ---------- timesheet periods ----------
// Weeks start on a day set by admin in Settings (default Wednesday). Timesheets show a fortnight by default,
// or one week (some supervisors approve a week at a time before handover). Fortnights repeat every 14 days
// from the cycle anchor, moved to the start day.
export type PeriodView = 'fortnight' | 'week';
export interface PeriodSettings { weekStart: number; view: PeriodView; anchor: string }
export const DEFAULT_PERIOD: PeriodSettings = { weekStart: 3, view: 'fortnight', anchor: '2026-11-11' };
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dow = (dateIso: string) => new Date(utc(dateIso)).getUTCDay();

export const addDays = (dateIso: string, n: number) => iso(utc(dateIso) + n * DAY);
export const weekday = (dateIso: string) => DAY_NAMES[dow(dateIso)];
export const periodLength = (view: PeriodView) => (view === 'week' ? 7 : 14);
/** The cycle anchor moved forward to the start day (so Thursday starts work as well as Wednesday). */
export const anchorFor = (s: PeriodSettings) => addDays(s.anchor, (s.weekStart - dow(s.anchor) + 7) % 7);
/** First day of the week or fortnight that contains this date. */
export function periodStart(dateIso: string, s: PeriodSettings = DEFAULT_PERIOD, view: PeriodView = s.view): string {
  if (view === 'week') return addDays(dateIso, -((dow(dateIso) - s.weekStart + 7) % 7));
  const a = anchorFor(s);
  const diff = Math.round((utc(dateIso) - utc(a)) / DAY);
  return addDays(a, Math.floor(diff / 14) * 14);
}
export const periodDays = (start: string, view: PeriodView = 'fortnight') => Array.from({ length: periodLength(view) }, (_, i) => addDays(start, i));
export const periodEnd = (start: string, view: PeriodView = 'fortnight') => addDays(start, periodLength(view) - 1);
/** Due by 09:00 on the first day of the next period, to be paid in this cycle. */
export const submitBy = (start: string, view: PeriodView = 'fortnight') => addDays(start, periodLength(view)) + ' 09:00';
// kept for older links
export const fortnightStart = (dateIso: string) => periodStart(dateIso, DEFAULT_PERIOD, 'fortnight');
export const fortnightDays = (start: string) => periodDays(start, 'fortnight');

export const SHIFT_BANDS = ['00:00 to 12:00', '12:00 to 24:00', '06:00 to 18:00', '18:00 to 06:00'];
export const WET = ['8 hr wet (yard)', '6 hr wet (home)'];

export interface FortnightTotals { truckHours: number; truckAndDogHours: number; infieldDays: number; totalHours: number }
/** The totals at the bottom of the paper timesheet. */
export function fortnightTotals(lines: Row[]): FortnightTotals {
  let truckHours = 0, truckAndDogHours = 0, infieldDays = 0;
  for (const l of lines) {
    const h = Number(l.total_hours) || 0;
    if (l.with_dog) truckAndDogHours += h; else truckHours += h;
    if (l.on_shift && !l.rr) infieldDays += 1;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { truckHours: r(truckHours), truckAndDogHours: r(truckAndDogHours), infieldDays, totalHours: r(truckHours + truckAndDogHours) };
}

// ---------- photos and receipts: shrink before saving so forms stay quick on a phone signal ----------
export async function shrinkImage(file: File, maxSide = 1280, quality = 0.72): Promise<string> {
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  if (typeof document === 'undefined') return url;
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// ---------- reminders: timesheet days not sent ----------
export interface Reminder { kind: 'returned' | 'overdue' | 'due_soon'; start: string; end: string; due: string; days: number }
/**
 * What to remind a driver about, most urgent first: days sent back by the supervisor,
 * periods that have ended and were not sent (overdue), and the current period when it is due within a day.
 */
export function timesheetReminders(lines: { work_date?: string | null; status?: string | null }[], today: string, s: PeriodSettings, view: PeriodView = s.view): Reminder[] {
  const out: Reminder[] = [];
  const byStart = new Map<string, { returned: number; draft: number }>();
  for (const l of lines) {
    if (!l.work_date || l.work_date > today) continue;
    if (l.status !== 'draft' && l.status !== 'queried') continue;
    const st = periodStart(l.work_date, s, view);
    const g = byStart.get(st) ?? { returned: 0, draft: 0 };
    if (l.status === 'queried') g.returned += 1; else g.draft += 1;
    byStart.set(st, g);
  }
  for (const [start, g] of [...byStart.entries()].sort()) {
    const end = periodEnd(start, view); const due = submitBy(start, view);
    if (g.returned) out.push({ kind: 'returned', start, end, due, days: g.returned });
    if (g.draft && end < today) out.push({ kind: 'overdue', start, end, due, days: g.draft });
    else if (g.draft && due.slice(0, 10) <= addDays(today, 1)) out.push({ kind: 'due_soon', start, end, due, days: g.draft });
  }
  const rank = { returned: 0, overdue: 1, due_soon: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.start.localeCompare(b.start));
}
