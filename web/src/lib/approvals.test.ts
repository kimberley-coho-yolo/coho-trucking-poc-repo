import { describe, expect, it } from 'vitest';
import { bulkApprovable, groupByDriver } from './approvals';

const names: Record<string, string> = { p1: 'Alex Driver', p2: 'Sam Driver' };
const lines = [
  { id: 'a', person_id: 'p2', work_date: '2026-11-24', total_hours: 10, status: 'submitted' },
  { id: 'b', person_id: 'p1', work_date: '2026-11-24', total_hours: 12, status: 'submitted' },
  { id: 'c', person_id: 'p1', work_date: '2026-11-23', total_hours: 11.5, status: 'submitted' },
  { id: 'd', person_id: 'p1', work_date: '2026-11-22', total_hours: 9, status: 'queried' },
  { id: 'e', person_id: null, work_date: '2026-11-24', total_hours: 8, status: 'submitted' },
];

describe('timesheet approvals by driver', () => {
  const groups = groupByDriver(lines, id => (id ? names[id] : ''));
  it('groups lines per driver, sorted by name, with totals and date range', () => {
    expect(groups.map(g => g.name)).toEqual(['Alex Driver', 'Sam Driver', 'No driver recorded']);
    const alex = groups[0];
    expect(alex.lines.map(l => l.id)).toEqual(['d', 'c', 'b']);
    expect(alex.totalHours).toBe(32.5);
    expect(alex.waiting).toBe(2);
    expect([alex.firstDate, alex.lastDate]).toEqual(['2026-11-22', '2026-11-24']);
  });
  it('bulk approve only takes that driver\'s lines waiting for approval', () => {
    expect(bulkApprovable(groups[0]).map(l => l.id)).toEqual(['c', 'b']);
    expect(bulkApprovable(groups[1]).map(l => l.id)).toEqual(['a']);
    for (const g of groups) expect(bulkApprovable(g).every(l => (l.person_id ?? null) === g.personId)).toBe(true);
  });
});
