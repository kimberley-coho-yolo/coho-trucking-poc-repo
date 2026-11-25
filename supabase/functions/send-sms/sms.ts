// Small pure helpers, kept separate so they can be unit tested.
/** 61412345678 -> 0412345678 (Australian providers want local format). */
export function toLocalMobile(normalised: string): string {
  const d = normalised.replace(/\D/g, '');
  return d.startsWith('61') && d.length === 11 ? '0' + d.slice(2) : d;
}
/** The sign-in text. Plain characters only, so it stays one SMS part (under 160 characters). */
export function buildMessage(otp: string): string {
  return `${otp} is your Coho Drive sign-in code. Do not share it. If you did not ask for it, tell the office.`;
}
