import { describe, expect, it } from 'vitest';
import { normPhone, samePhone, toE164 } from './phone';
describe('phone numbers', () => {
  it('normalises Australian mobiles', () => {
    expect(normPhone('0400 000 001')).toBe('61400000001');
    expect(normPhone('+61 400 000 001')).toBe('61400000001');
    expect(toE164('0400000001')).toBe('+61400000001');
    expect(samePhone('0400 000 001', '61400000001')).toBe(true);
    expect(normPhone('')).toBeNull();
  });
});
