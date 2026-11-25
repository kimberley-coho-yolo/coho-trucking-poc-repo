import { beforeEach, describe, expect, it } from 'vitest';
import { applyRowRules, cloneDocket, defaultFormFor, formFor, FORMS, fromView, shiftFields, toView, total } from './docketForms';
import { DemoBackend } from './demoBackend';

describe('docket forms', () => {
  it('every form has rows, columns that exist and a unique code', () => {
    expect(new Set(FORMS.map(f => f.code)).size).toBe(FORMS.length);
    for (const f of FORMS) for (const c of f.rows.columns) expect(f.rows.fields.some(x => x.name === c), `${f.code}.${c}`).toBe(true);
  });
  it('picks the usual form for a department, and General otherwise', () => {
    expect(defaultFormFor('Landspray')).toBe('landspray_runsheet');
    expect(defaultFormFor('Workover')).toBe('daily_report_workover');
    expect(defaultFormFor('Drilling')).toBe('daily_report_drilling');
    expect(defaultFormFor('Flowback')).toBe('frac_support');
    expect(defaultFormFor('Civil')).toBe('general');
    expect(formFor(null).code).toBe('general');
  });
  it('keeps table columns as columns and puts everything else in extras', () => {
    const row = fromView({ id: 'd1', notes: 'n', po: 'PO1', well: 'SAV72', s1_operator_id: 'p1', version: 3 }, 'dockets');
    expect(row).toMatchObject({ id: 'd1', notes: 'n', po: 'PO1', version: 3, extras: { well: 'SAV72', s1_operator_id: 'p1' } });
    expect(toView(row)).toMatchObject({ well: 'SAV72', s1_operator_id: 'p1', po: 'PO1' });
    const load = fromView({ material: 'Dirty mud', volume_in_l: 8000, sprayfield: 'MMP4', shift: 2 }, 'loads');
    expect(load).toMatchObject({ material: 'Dirty mud', volume_in_l: 8000, extras: { sprayfield: 'MMP4', shift: 2 } });
  });
  it('two-shift forms prefix the shift fields', () => {
    const names = shiftFields(formFor('daily_report_workover'), 2).map(f => f.name);
    expect(names).toContain('s2_operator_id');
    expect(names).toContain('s2_fuel_used_l');
  });
  it('landspray works out m3 from litres', () => {
    const f = formFor('landspray_runsheet');
    expect(applyRowRules(f, {}, { volume_in_l: 8000 }).volume_m3).toBe(8);
  });
  it('adds up row totals from columns and extras', () => {
    const rows = [{ volume_in_l: 8000, extras: { actual_weight_t: 10 } }, { volume_in_l: 8000, extras: { actual_weight_t: 9.5 } }];
    expect(total(rows, 'volume_in_l')).toBe(16000);
    expect(total(rows, 'actual_weight_t')).toBe(19.5);
  });
  it('clone keeps the job details but not the day, times, signatures or fuel', () => {
    const src = {
      id: 'd1', docket_no: 100005, version: 4, status: 'closed', form_type: 'daily_report_workover', shift_id: 's1', work_date: '2026-11-17',
      customer_id: 'c1', location_id: 'l1', truck_id: 't1', project_no: 'E.00.007480', task_no: 'MAJ17', po: 'PO1', start_at: 'x', end_at: 'y', km: 40,
      assigned_person_ids: ['p1', 'p2'],
      extras: { well: 'SAV72', trailer_rego: 'YB25FC', s1_operator_id: 'p1', s1_operator_signed_at: 'z', s1_fuel_used_l: 413, s1_notes: 'rain', eq_frac_tank: 1 },
    };
    const { docket, rows } = cloneDocket(src, [{ id: 'r1', docket_id: 'd1', material: 'Produced', extras: { shift: 1 } }], { workDate: '2026-11-18', includeRows: true, keepDrivers: true });
    expect(docket).toMatchObject({ status: 'draft', work_date: '2026-11-18', cloned_from: 'd1', customer_id: 'c1', truck_id: 't1', project_no: 'E.00.007480', assigned_person_ids: ['p1', 'p2'] });
    for (const k of ['id', 'docket_no', 'version', 'shift_id', 'start_at', 'end_at', 'km']) expect(docket[k], k).toBeUndefined();
    expect(docket.extras).toMatchObject({ well: 'SAV72', trailer_rego: 'YB25FC', s1_operator_id: 'p1', eq_frac_tank: 1 });
    expect(docket.extras.s1_operator_signed_at).toBeUndefined();
    expect(docket.extras.s1_fuel_used_l).toBeUndefined();
    expect(docket.extras.s1_notes).toBeUndefined();
    expect(rows).toEqual([{ material: 'Produced', extras: { shift: 1 }, sort: 0 }]);
    const noRows = cloneDocket(src, [{ id: 'r1' }], { workDate: null, includeRows: false, keepDrivers: false });
    expect(noRows.rows).toEqual([]);
    expect(noRows.docket.assigned_person_ids).toEqual([]);
  });
});

describe('dockets shared between office and drivers (demo backend, same rules as the database)', () => {
  beforeEach(() => localStorage.clear());
  it('office docket assigned to a driver shows on the crew phone, and a stale save is refused', async () => {
    const office = new DemoBackend();
    await office.verifyCode({ email: 'office@demo.local' }, '123456');
    const people = await office.list('people');
    const alex = people.find(p => p.full_name === 'Alex Driver')!;
    const jo = people.find(p => p.full_name === 'Jo Cover')!;
    const mine = await office.save('dockets', { form_type: 'landspray_runsheet', status: 'draft', assigned_person_ids: [alex.id], notes: 'from office' });
    const notMine = await office.save('dockets', { form_type: 'potable_water', status: 'draft', assigned_person_ids: [jo.id] });
    expect(mine.docket_no).toBeGreaterThan(100000);
    expect(mine.version).toBe(1);
    await office.save('loads', { docket_id: mine.id, material: 'Dirty mud', volume_in_l: 8000 });

    const driver = new DemoBackend();          // the crew phone (same demo data)
    await driver.verifyCode({ phone: '0400 000 001' }, '123456');
    expect(await driver.get('dockets', mine.id)).toBeTruthy();
    expect(await driver.get('dockets', notMine.id)).toBeNull();
    expect(await driver.list('loads', { docket_id: mine.id })).toHaveLength(1);
    const after = await driver.save('dockets', { ...mine, notes: 'driver added', version: 1 });
    expect(after.version).toBe(2);

    const office2 = new DemoBackend();          // the office screen still holds version 1
    await office2.verifyCode({ email: 'office@demo.local' }, '123456');
    await expect(office2.save('dockets', { ...mine, notes: 'stale', version: 1 })).rejects.toThrow(/another device/);
    expect((await office2.get('dockets', mine.id))!.notes).toBe('driver added');
  });
  it('tells open screens when a watched docket changes', async () => {
    const b = new DemoBackend();
    await b.verifyCode({ email: 'office@demo.local' }, '123456');
    const d = await b.save('dockets', { form_type: 'general', status: 'draft' });
    const seen: string[] = [];
    const stop = b.watch([{ table: 'dockets', column: 'id', value: d.id }], (t, r) => seen.push(`${t}:${r?.notes ?? ''}`));
    await b.save('dockets', { ...d, notes: 'changed' });
    stop();
    await b.save('dockets', { id: d.id, notes: 'after stop' });
    expect(seen).toEqual(['dockets:changed']);
  });
});
