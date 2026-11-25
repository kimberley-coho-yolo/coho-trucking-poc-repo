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
  await page.click('tr:has-text("Docket") button:has-text("Resume")');
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
