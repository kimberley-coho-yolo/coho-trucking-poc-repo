import { beforeEach, describe, expect, it } from 'vitest';
import { jobsFor, stageOf, toReview } from './assignment';
import { normTime } from '../components/ui';
import { DemoBackend } from './demoBackend';

describe('24-hour times', () => {
  it('tidies what people type into HH:MM and refuses impossible times', () => {
    expect(normTime('630')).toBe('06:30');
    expect(normTime('1830')).toBe('18:30');
    expect(normTime('7')).toBe('07:00');
    expect(normTime('18.45')).toBe('18:45');
    expect(normTime('23:59')).toBe('23:59');
    expect(normTime('24:00')).toBeNull();
    expect(normTime('6pm')).toBeNull();
  });
});

describe('where a docket is up to', () => {
  it('works out the stage', () => {
    expect(stageOf({})).toBe('unassigned');
    expect(stageOf({ assigned_phone_id: 'w1' })).toBe('assigned');
    expect(stageOf({ assigned_phone_id: 'w1', status: 'open' })).toBe('in_progress');
    expect(stageOf({ status: 'closed', review_status: 'to_review' })).toBe('to_review');
    expect(stageOf({ status: 'open', review_status: 'returned' })).toBe('returned');
    expect(stageOf({ status: 'closed', review_status: 'reviewed' })).toBe('reviewed');
  });
  it('lists a driver\'s jobs: today, late and coming up, not other drivers\' named dockets', () => {
    const ds = [
      { id: 'a', assigned_phone_id: 'w1', work_date: '2026-11-25', docket_no: 2 },
      { id: 'b', assigned_phone_id: 'w1', assigned_person_ids: ['sam'], work_date: '2026-11-25' },
      { id: 'c', assigned_phone_id: 'w1', work_date: '2026-11-24', status: 'open' },
      { id: 'd', assigned_phone_id: 'w1', work_date: '2026-11-27' },
      { id: 'e', assigned_phone_id: 'w1', work_date: '2026-11-25', status: 'closed', review_status: 'to_review' },
      { id: 'f', work_date: '2026-11-25' },
    ];
    const j = jobsFor(ds, 'alex', '2026-11-25');
    expect(j.today.map(d => d.id)).toEqual(['a']);
    expect(j.late.map(d => d.id)).toEqual(['c']);
    expect(j.upcoming.map(d => d.id)).toEqual(['d']);
    expect(jobsFor(ds, 'sam', '2026-11-25').today.map(d => d.id).sort()).toEqual(['a', 'b']);
  });
  it('sends completed dockets to the reviewers of that department', () => {
    const ds = [{ id: '1', review_status: 'to_review', department: 'Drilling' }, { id: '2', review_status: 'to_review', department: 'Landspray' }];
    expect(toReview(ds, ['Drilling']).map(d => d.id)).toEqual(['1']);
    expect(toReview(ds, []).map(d => d.id)).toEqual(['1', '2']);
  });
});

describe('demo: assigning, texts and review (same rules as the database)', () => {
  beforeEach(() => localStorage.clear());
  it('office assigns to a crew phone, the phone is texted and sees it; the driver cannot reassign; completing sends it for review', async () => {
    const office = new DemoBackend();
    await office.verifyCode({ email: 'office@demo.local' }, '123456');
    const phones = await office.list('work_phones');
    const w2 = phones.find(w => w.phone === '0400 000 002')!;
    const w1 = phones.find(w => w.phone === '0400 000 001')!;
    const d = await office.save('dockets', { form_type: 'daily_report_drilling', status: 'draft', department: 'Drilling', work_date: '2026-11-25', assigned_phone_id: w2.id });
    expect((await office.list('sms_outbox')).map(m => [m.kind, m.phone])).toEqual([['docket_assigned', '0400 000 002']]);

    const night = new DemoBackend();
    await night.verifyCode({ phone: '0400 000 002' }, '123456');
    expect(await night.get('dockets', d.id)).toBeTruthy();
    await expect(night.save('dockets', { id: d.id, assigned_phone_id: null })).rejects.toThrow(/reassign or cancel/);

    const office2 = new DemoBackend();
    await office2.verifyCode({ email: 'office@demo.local' }, '123456');
    const moved = await office2.save('dockets', { id: d.id, assigned_phone_id: w1.id });
    expect((await office2.list('sms_outbox')).map(m => m.kind).sort()).toEqual(['docket_assigned', 'docket_assigned', 'docket_moved']);
    await office2.kickTexts();
    expect((await office2.list('sms_outbox')).every(m => m.status === 'sent')).toBe(true);

    const day = new DemoBackend();
    await day.verifyCode({ phone: '0400 000 001' }, '123456');
    const done = await day.save('dockets', { ...moved, status: 'closed' });
    expect(done.review_status).toBe('to_review');

    const landsup = new DemoBackend();
    await landsup.verifyCode({ email: 'supervisor@demo.local' }, '123456');
    const ok = await landsup.save('dockets', { ...done, review_status: 'returned', review_comment: 'Fix fuel' });
    expect(ok.status).toBe('open');
  });
  it('a supervisor limited to Drilling cannot review a Landspray docket', async () => {
    const office = new DemoBackend();
    await office.verifyCode({ email: 'office@demo.local' }, '123456');
    const d = await office.save('dockets', { form_type: 'landspray_runsheet', status: 'closed', department: 'Landspray' });
    expect(d.review_status).toBe('to_review');
    const drill = new DemoBackend();
    await drill.verifyCode({ email: 'drilling.sup@demo.local' }, '123456');
    await expect(drill.save('dockets', { ...d, review_status: 'reviewed' })).rejects.toThrow(/not one of your departments/);
  });
});
