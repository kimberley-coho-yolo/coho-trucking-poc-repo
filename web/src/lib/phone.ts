// Australian mobile numbers: accept "0400 000 001", "+61 400 000 001", "61400000001".
export function normPhone(p?: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  if (!d) return null;
  if (/^0\d{9}$/.test(d)) return '61' + d.slice(1);
  return d;
}

export function toE164(p: string): string {
  const n = normPhone(p);
  return n ? '+' + n : p;
}

export function samePhone(a?: string | null, b?: string | null): boolean {
  const x = normPhone(a), y = normPhone(b);
  return !!x && x === y;
}
