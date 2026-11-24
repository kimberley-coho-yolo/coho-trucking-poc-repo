import { describe, expect, it } from 'vitest';
import { autoMap, mapRows, parseCsv, parseDate } from './importExport';
import { TABLES } from './schema';
describe('spreadsheet import', () => {
  const fields = TABLES.gps_trips.fields;
  it('matches headers by name or label', () => {
    const m = autoMap(['Truck (unit, rego or tracker id)', 'start_at', 'Trip End', 'KM', 'Unknown'], fields);
    expect(m).toEqual({ 'Truck (unit, rego or tracker id)': 'truck_ref', start_at: 'start_at', 'Trip End': 'end_at', KM: 'km' });
  });
  it('converts numbers, Australian dates and blanks', () => {
    const sheet = parseCsv('truck_ref,start_at,km\n04,24/11/2026 18:10,"1,042"\n,,\n');
    const rows = mapRows(sheet, { truck_ref: 'truck_ref', start_at: 'start_at', km: 'km' }, fields);
    expect(rows).toHaveLength(1);
    expect(rows[0].km).toBe(1042);
    expect(new Date(rows[0].start_at).getHours()).toBe(18);
  });
  it('parses ISO dates', () => {
    expect(parseDate('2026-11-24T18:10:00Z')?.toISOString()).toBe('2026-11-24T18:10:00.000Z');
    expect(parseDate('not a date')).toBeNull();
  });
});
