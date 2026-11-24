// Walks through every screen in demo mode and saves screenshots for the manuals.
// Usage: node scripts/screenshots.cjs [baseUrl] (start `npm run preview` in web/ first)
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173/';
const out = __dirname + '/../docs/screens/';
const errors = [];

async function shot(page, name, full = true) { await page.waitForTimeout(400); await page.screenshot({ path: out + name + '.png', fullPage: full }); }
async function login(page, kind, value) {
  await page.goto(base + '?demo=1#/login');
  await page.evaluate(() => { localStorage.setItem('coho-poc-mode', 'demo'); });
  await page.goto(base + '#/login');
  if (kind === 'email') await page.click('text=Email');
  await page.fill('#login-target', value);
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch();
  // ---------- driver on a phone ----------
  const phone = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  p.on('pageerror', e => errors.push('driver: ' + e.message));
  await p.goto(base + '?demo=1#/login');
  await p.evaluate(() => localStorage.clear());
  await p.goto(base + '?demo=1#/login');
  await shot(p, '01-sign-in', false);
  await p.fill('#login-target', '0400 000 001'); await p.click('text=Send code');
  await shot(p, '02-sign-in-code', false);
  await p.fill('#login-code', '123456'); await p.click('button:has-text("Sign in")');
  await p.waitForSelector('text=Who is driving?');
  await shot(p, '03-who-is-driving', false);
  await p.click('button:has-text("Alex Driver")');
  await shot(p, '04-confirm-name', false);
  await p.click('text=Yes, that\'s me');
  await p.waitForSelector('text=Start a shift');
  await shot(p, '05-home-driver');
  await p.click('text=Start a shift');
  await p.fill('input[placeholder="COHO-TRUCK-04"]', 'COHO-TRUCK-04'); await p.click('button:has-text("Find")');
  await shot(p, '06-start-shift');
  await p.click('text=Next: prestart');
  await p.waitForSelector('text=Prestarts for this truck');
  await shot(p, '07-prestart');
  await p.click('text=Prestart passed');
  await p.waitForSelector('text=Today\'s jobs');
  await shot(p, '08-shift');
  await p.click('button.big >> nth=0');
  await p.waitForSelector('text=Loads and tasks');
  await shot(p, '09-docket-top', false);
  await p.click('text=Add a load');
  await p.fill('#f-task', 'Water cartage'); await p.fill('#f-material', 'Produced water'); await p.fill('#f-volume_out_l', '28000');
  await p.fill('#f-docket_no', 'D-4401');
  await shot(p, '10-docket-load');
  await p.click('text=Save load');
  await p.fill('#f-client_name', 'R. Client (Origin WSR)');
  const c = await p.$('canvas.sig'); const b = await c.boundingBox();
  await p.mouse.move(b.x + 30, b.y + 120); await p.mouse.down();
  for (let i = 0; i < 12; i++) await p.mouse.move(b.x + 30 + i * 22, b.y + 120 - Math.sin(i) * 40);
  await p.mouse.up();
  await shot(p, '11-docket-full');
  await p.click('text=Save and exit');
  await p.waitForTimeout(500);
  await p.click('text=My drafts'); await p.waitForSelector('text=Resume');
  await shot(p, '12-my-drafts');
  await p.click('button:has-text("Resume") >> nth=0');
  await p.waitForTimeout(600);
  await p.goto(p.url().replace(/#.*/, '#/drafts'));
  await p.click('tr:has-text("Docket") button:has-text("Resume")');
  await p.waitForSelector('text=Loads and tasks');
  await p.click('text=Close docket');
  await p.waitForSelector('text=Dockets this shift');
  await p.click('text=Report a fault');
  await p.fill('#f-description', 'Left mirror cracked');
  await shot(p, '13-fault');
  await p.click('text=Save fault'); await p.waitForTimeout(1200);
  await p.click('text=End shift and timesheet');
  await p.waitForSelector('text=Submit and sign out');
  await p.fill('#f-work_diary_page', '215');
  await shot(p, '14-end-shift');
  await p.click('text=Submit and sign out'); await p.waitForTimeout(1200);
  await phone.close();

  // ---------- office / admin / supervisor on a desktop ----------
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const d = await desk.newPage();
  d.on('pageerror', e => errors.push('desk: ' + e.message));
  await d.goto(base + '?demo=1#/login');
  await d.click('text=Email'); await d.fill('#login-target', 'admin@demo.local'); await d.click('text=Send code');
  await d.fill('#login-code', '123456'); await d.click('button:has-text("Sign in")');
  await d.waitForSelector('text=Open shifts');
  await shot(d, '20-home-admin');
  await d.click('nav >> text=Admin'); await d.click('text=How to use this screen');
  await shot(d, '21-admin');
  for (const [t, n] of [['app_logins', '22-logins'], ['work_phones', '23-work-phones'], ['phone_assignments', '24-phone-assignments'], ['people', '25-people'], ['trucks', '26-trucks'], ['jobs', '27-jobs'], ['allocations', '28-allocations']]) {
    await d.goto(d.url().replace(/#.*/, '#/admin/' + t)); await d.waitForTimeout(500); await shot(d, n);
  }
  await d.goto(d.url().replace(/#.*/, '#/admin/app_logins')); await d.click('text=New');
  await d.fill('#f-label', 'Crew phone 2'); await d.fill('#f-phone', '0400 000 002'); await d.selectOption('#f-role', 'driver');
  await shot(d, '29-new-login');
  await d.click('.subform >> text=Save');
  await d.goto(d.url().replace(/#.*/, '#/data')); await d.waitForTimeout(500); await shot(d, '30-data-integrations');
  await d.click('text=Upload spreadsheet');
  require('fs').writeFileSync('/tmp/gps.csv', 'Truck,Trip start,Trip end,KM,Source system\n87,24/11/2026 06:05,24/11/2026 06:40,31,Fleet Complete\n87,24/11/2026 06:40,24/11/2026 11:10,58,Fleet Complete\n');
  await d.setInputFiles('input[type=file]', '/tmp/gps.csv'); await d.waitForTimeout(600);
  const sel = d.locator('label:has-text("File column: Truck") select'); await sel.selectOption('truck_ref');
  await shot(d, '31-data-upload');
  await d.click('button:has-text("Import")'); await d.waitForTimeout(800);
  await d.click('text=Download'); await shot(d, '32-data-download', false);
  await d.click('text=Browse tables'); await d.waitForTimeout(500); await shot(d, '33-data-browse');
  await d.click('text=Query (SQL)'); await d.fill('textarea.sql', 'select * from dockets limit 5'); await d.click('text=Run query'); await d.waitForTimeout(500);
  await shot(d, '34-data-query');
  await d.click('text=Km matching'); await d.click('text=Run km matching now'); await d.waitForTimeout(1500);
  await shot(d, '35-data-km', false);
  await d.goto(d.url().replace(/#.*/, '#/reports')); await d.waitForTimeout(600); await shot(d, '36-report-customer');
  await d.click('text=Travel (no customer)'); await shot(d, '37-report-travel');
  await d.click('text=Per truck'); await shot(d, '38-report-truck');
  await d.goto(d.url().replace(/#.*/, '#/approvals')); await d.waitForTimeout(600); await shot(d, '39-approvals');
  await d.goto(d.url().replace(/#.*/, '#/help')); await d.waitForTimeout(400); await shot(d, '40-help');
  await desk.close();
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'No page errors');
})().catch(e => { console.error(e); process.exit(1); });
