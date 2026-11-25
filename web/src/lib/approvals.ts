// Groups timesheet lines by driver for the Approvals screen, and picks which lines a
// per-driver "approve all" may touch. Bulk approval never mixes drivers.
import type { Row } from './backend';
import { round2 } from './kmMatch';

export interface DriverGroup {
  personId: string | null;   // null = no driver recorded on the line
  name: string;
  lines: Row[];
  totalHours: number;
  waiting: number;           // lines with status "submitted"
  firstDate: string | null;
  lastDate: string | null;
}

export function groupByDriver(lines: Row[], nameOf: (personId: string | null) => string): DriverGroup[] {
  const map = new Map<string, Row[]>();
  for (const l of lines) {
    const k = l.person_id ?? '';
    map.set(k, [...(map.get(k) ?? []), l]);
  }
  const groups = [...map.entries()].map(([k, ls]) => {
    const sorted = [...ls].sort((a, b) => String(a.work_date ?? '').localeCompare(String(b.work_date ?? '')));
    const dates = sorted.map(l => l.work_date).filter(Boolean) as string[];
    return {
      personId: k || null,
      name: k ? (nameOf(k) || 'Unknown driver') : 'No driver recorded',
      lines: sorted,
      totalHours: round2(sorted.reduce((s, l) => s + (Number(l.total_hours) || 0), 0)),
      waiting: sorted.filter(l => l.status === 'submitted').length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
    };
  });
  return groups.sort((a, b) => (a.personId ? 0 : 1) - (b.personId ? 0 : 1) || a.name.localeCompare(b.name));
}

/** Lines that "Approve all" may approve for one driver: only that driver's lines waiting for approval. */
export function bulkApprovable(group: DriverGroup): Row[] {
  return group.lines.filter(l => l.status === 'submitted' && (l.person_id ?? null) === group.personId);
}
