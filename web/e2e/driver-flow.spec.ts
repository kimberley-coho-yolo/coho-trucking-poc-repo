import { expect, test } from '@playwright/test';

// A driver signs in on a work phone, picks a name, starts a shift, saves and exits, resumes from drafts, closes a docket.
test('driver can start, save and exit, resume and close a docket', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.fill('#login-target', '0400 000 001');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Alex Driver")');
  await page.click("text=Yes, that's me");
  await page.click('text=Start a shift');
  await page.fill('input[placeholder="COHO-TRUCK-04"]', 'COHO-TRUCK-04');
  await page.click('button:has-text("Find")');
  await page.click('text=Next: prestart');
  await page.click('text=Prestart passed');
  await page.click('button.big >> nth=0');
  await expect(page.locator('#f-project_no')).toHaveValue('P-1001');
  await page.click('text=Save and exit');
  await page.click('nav >> text=My drafts');
  await page.click('tr:has-text("P-1001") button:has-text("Resume")');
  await page.click('text=Close docket');
  await expect(page.getByText("Dockets this shift")).toBeVisible();
  await expect(page.locator('td:has-text("closed")')).toBeVisible();
});

test('admin can add a login with a mobile and a role', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.click('text=Email');
  await page.fill('#login-target', 'admin@demo.local');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.goto('?demo=1#/admin/app_logins');
  await page.click('button:has-text("New")');
  await page.fill('#f-label', 'Crew phone 2');
  await page.fill('#f-phone', '0400 000 002');
  await page.selectOption('#f-role', 'driver');
  await page.click('.subform >> text=Save');
  await expect(page.locator('td:has-text("Crew phone 2")')).toBeVisible();
});

test('supervisor sees timesheets grouped by driver and approves all for one driver only', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.click('text=Email');
  await page.fill('#login-target', 'supervisor@demo.local');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.goto('?demo=1#/approvals');
  await expect(page.locator('details.driver-group')).toHaveCount(2);
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Approve all for Alex Driver (2)")');
  await expect(page.locator('.toast')).toContainText('Approved 2 lines for Alex Driver');
  // Alex's lines are approved; Sam's line is still waiting.
  await expect(page.locator('details.driver-group')).toHaveCount(1);
  await expect(page.locator('details.driver-group summary')).toContainText('Sam Driver');
});

async function signInEmail(page: import('@playwright/test').Page, email: string) {
  await page.goto('?demo=1#/login');
  await page.click('text=Email');
  await page.fill('#login-target', email);
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await expect(page.locator('nav.top')).toBeVisible();
}

test('office creates a docket from a form, assigns a driver, and the driver sees it on the crew phone', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await signInEmail(page, 'office@demo.local');
  await page.goto('?demo=1#/dockets');
  await page.click('button:has-text("New docket")');
  await page.click('.form-option:has-text("Drilling daily report")');
  await page.selectOption('.subform #f-truck_id', { label: 'Unit 87 XB28PZ' });
  await page.click('.chip-toggle:has-text("Sam Driver")');
  await page.click('button:has-text("Create docket")');
  await expect(page.locator('h1')).toHaveText('Drilling daily report');
  await page.fill('#f-well', 'VEN27 Atlas 237');
  await page.locator('fieldset.shift-block').first().locator('button:has-text("Add a load")').click();
  await page.fill('.subform #f-material', 'Cuttings');
  await page.fill('.subform #f-volume_in_l', '14000');
  await page.click('button:has-text("Save row")');
  await expect(page.locator('.rows-block tfoot')).toContainText('14,000');
  await page.click('.savebar >> text=Save');
  await expect(page.locator('.toast')).toContainText('Saved');
  const docketNo = (await page.locator('.docket-meta').innerText()).match(/Docket No\.\s*(\d+)/)![1];

  // the crew phone: Sam picks his name and finds the docket waiting
  await page.click('nav >> text=Sign out');
  await page.fill('#login-target', '0400 000 001');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Sam Driver")');
  await page.click("text=Yes, that's me");
  await page.click(`button.big:has-text("No. ${docketNo}")`);
  await expect(page.locator('#f-well')).toHaveValue('VEN27 Atlas 237');
  await expect(page.locator('.rows-block').first()).toContainText('Cuttings');
});

test('a change on one device shows on another device that has the docket open', async ({ browser }) => {
  const ctx = await browser.newContext();                 // one browser profile = the demo's shared data
  const office = await ctx.newPage();
  await office.goto('?demo=1#/login');
  await office.evaluate(() => localStorage.clear());
  await signInEmail(office, 'office@demo.local');
  const other = await ctx.newPage();                      // second "device"
  await other.goto('?demo=1#/docket/d3');
  await office.goto('?demo=1#/docket/d3');
  await expect(other.locator('h1')).toHaveText('Landspray 12 hour runsheet');
  await office.fill('#f-po', 'PO-LIVE-1');
  await office.click('.savebar >> text=Save');
  await expect(other.locator('#f-po')).toHaveValue('PO-LIVE-1');   // no reload on the second device

  // the second device is mid-edit when the first saves again: it is warned instead of overwriting
  await other.fill('#f-task_no', 'MAJ17');
  await office.fill('#f-po', 'PO-LIVE-2');
  await office.click('.savebar >> text=Save');
  await expect(other.locator('.live-note')).toContainText('another device');
  await other.click('.savebar >> text=Save');
  await expect(other.locator('.live-note')).toContainText('Tap Reload');
  await other.click('.live-note >> text=Reload');
  await expect(other.locator('#f-po')).toHaveValue('PO-LIVE-2');
  await ctx.close();
});
