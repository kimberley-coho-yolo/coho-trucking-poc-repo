import { buildMessage, toLocalMobile } from '../../../supabase/functions/send-sms/sms';

describe('send-sms hook helpers', () => {
  it('turns a normalised Australian mobile into local format', () => {
    expect(toLocalMobile('61412345678')).toBe('0412345678');
  });
  it('keeps the sign-in text to one SMS part with plain characters', () => {
    const m = buildMessage('123456');
    expect(m.length).toBeLessThanOrEqual(160);
    expect(m).toMatch(/^123456 /);
    expect(/^[\x20-\x7E]*$/.test(m)).toBe(true);
  });
});
