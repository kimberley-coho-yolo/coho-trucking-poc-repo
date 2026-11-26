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
  await page.fill('#f-label', 'Crew phone 9');
  await page.fill('#f-phone', '0400 000 009');
  await page.selectOption('#f-role', 'driver');
  await page.click('.subform >> text=Save');
  await expect(page.locator('td:has-text("Crew phone 9")')).toBeVisible();
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
  await page.click('.form-option:has-text("Drilling / CCC daily report")');
  await page.selectOption('.subform #f-truck_id', { label: 'Unit 87 XB28PZ' });
  await page.selectOption('#assign-phone', '55555555-0000-0000-0000-000000000001');
  await page.click('.chip-toggle:has-text("Sam Driver")');
  await page.click('button:has-text("Create docket")');
  await expect(page.locator('h1')).toHaveText('Drilling / CCC daily report');
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

test('driver fills in a fortnight timesheet and an expense claim; supervisor approves both', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.fill('#login-target', '0400 000 001');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Alex Driver")');
  await page.click("text=Yes, that's me");
  await page.click('nav >> text=Forms');

  // timesheet: two days on shift, truck and dog
  await page.click('button.card:has-text("Driver timesheet")');
  await page.waitForSelector('table.fortnight');
  const day1 = page.locator('table.fortnight tbody tr').nth(0);
  const day2 = page.locator('table.fortnight tbody tr').nth(1);
  for (const [row, page_no] of [[day1, '508117'], [day2, '508118']] as const) {
    await row.locator('select').nth(0).selectOption('On shift');
    await row.locator('input').nth(0).fill(page_no);
    await row.locator('select').nth(1).selectOption('18:00 to 06:00');
    await row.locator('input[type=number]').fill('12');
    await row.locator('input[type=checkbox]').check();
  }
  await expect(page.locator('.summary.totals')).toContainText('Total truck and dog hours 24');
  await expect(page.locator('.summary.totals')).toContainText('Total infield days 2');
  const pad = page.locator('canvas.sig');
  await pad.evaluate(e => e.scrollIntoView({ block: 'center' }));
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 60); await page.mouse.up();
  await page.click('button:has-text("Send to supervisor")');
  await expect(page.locator('.toast')).toContainText('sent to your supervisor');

  // expense claim with a receipt photo
  await page.click('button:has-text("Back to forms")');
  await page.click('button.card:has-text("Expense reimbursement")');
  await page.selectOption('#f-company', { index: 1 });
  await page.click('button:has-text("Add an item")');
  await page.fill('#f-item-0', 'Fuel - Roma BP');
  await page.fill('#f-amount-0', '55.50');
  await expect(page.locator('.lines-total')).toContainText('$55.50');
  await page.locator('.image-files input[type=file]').last().setInputFiles('e2e/receipt.png');
  await expect(page.locator('.thumb img')).toHaveCount(1);
  const pad2 = page.locator('canvas.sig').first();
  await pad2.evaluate(e => e.scrollIntoView({ block: 'center' }));
  const b2 = (await pad2.boundingBox())!;
  await page.mouse.move(b2.x + 20, b2.y + 40); await page.mouse.down(); await page.mouse.move(b2.x + 120, b2.y + 60); await page.mouse.up();
  await page.click('button:has-text("Send for approval")');
  await expect(page.locator('.pill.submitted')).toBeVisible();

  // supervisor
  await page.click('nav >> text=Sign out');
  await page.click('text=Email');
  await page.fill('#login-target', 'supervisor@demo.local');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('nav >> text=Forms');
  await expect(page.locator('button[role=tab]:has-text("Waiting for approval (2)")')).toBeVisible();
  await page.click('tr:has-text("Expense reimbursement") button:has-text("Open")');
  await page.fill('#f-approver_name', 'Lindsay Harris');
  await page.click('.savebar >> text=Authorise');
  await expect(page.locator('.pill.approved')).toBeVisible();
  await page.click('button:has-text("Back to forms")');
  await page.click('tr:has-text("Driver timesheet") button:has-text("Open")');
  await page.click('button:has-text("Approve fortnight")');
  await expect(page.locator('.toast')).toContainText('approved and locked');
  await expect(page.locator('table.fortnight .pill.approved')).toHaveCount(2);
});

test('closing a docket fills in the driver timesheet for that day', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.fill('#login-target', '0400 000 001');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Alex Driver")');
  await page.click("text=Yes, that's me");
  // the office-prepared landspray runsheet (6am - 6pm day shift) waiting for Alex
  await page.click('button.big:has-text("Landspray 12 hour runsheet")');
  await page.click('.savebar >> text=Close docket');
  await expect(page.locator('.toast')).toContainText('timesheet for this day is updated');
  await page.click('.docket-meta >> text=My timesheet');
  await page.waitForSelector('table.fortnight');
  const today = await page.evaluate(() => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); });
  const row = page.locator(`table.fortnight tbody tr:has-text("${today}")`);
  await expect(row.locator('input[type=number]')).toHaveValue('12');
  await expect(row.locator('select').nth(0)).toHaveValue('On shift');
  await expect(row.locator('select').nth(1)).toHaveValue('06:00 to 18:00');
  await expect(row).toContainText('Dockets 12 h');
});

test('with no signal a driver can still fill in and close a docket; it sends by itself when signal is back', async ({ page, context }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.fill('#login-target', '0400 000 001');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Alex Driver")');
  await page.click("text=Yes, that's me");
  await page.click('button.big:has-text("Landspray 12 hour runsheet")');
  await expect(page.locator('h1')).toHaveText('Landspray 12 hour runsheet');

  await context.setOffline(true);
  await expect(page.locator('.outbox-bar.offline')).toBeVisible();
  await page.fill('#f-po', 'PO-NO-SIGNAL');
  await page.click('.savebar >> text=Save');
  await expect(page.locator('.toast')).toContainText('Saved on this device');
  await expect(page.locator('.docket-meta')).toContainText('Not sent yet');
  await page.click('.savebar >> text=Close docket');
  await expect(page.locator('.outbox-bar.offline')).toContainText('1 waiting');

  await context.setOffline(false);
  await expect(page.locator('.outbox-bar')).toHaveCount(0, { timeout: 10_000 });   // sent: nothing waiting
  const sent = await page.evaluate(() => JSON.parse(localStorage.getItem('coho-poc-demo-db-v1')!).dockets.find((d: any) => d.id === 'd3'));
  expect(sent).toMatchObject({ po: 'PO-NO-SIGNAL', status: 'closed' });
  await page.goto('?demo=1#/outbox');
  await expect(page.locator('.note')).toContainText('Everything is sent');
});

test('a timesheet not sent is flagged to the driver; supervisors pick week, fortnight, last 7/14 days or the month', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('?demo=1#/login');
  await page.fill('#login-target', '0400 000 001');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Sam Driver")');
  await page.click("text=Yes, that's me");
  // Sam works a day in the previous fortnight but never sends it
  await page.click('nav >> text=Forms');
  await page.click('button.card:has-text("Driver timesheet")');
  await expect(page.locator('.period-label')).toContainText('Wed');                 // weeks start on Wednesday
  await page.click('button[aria-label="Previous fortnight"]');
  const row = page.locator('table.fortnight tbody tr').nth(0);
  await row.locator('select').nth(0).selectOption('On shift');
  await row.locator('input[type=number]').fill('10');
  await page.click('.savebar >> text=Save');
  await expect(page.locator('.toast')).toContainText('Saved');
  await page.reload();                                                              // the reminder works out what is unsent on load
  // the demo already has a day the supervisor sent back to Sam, so that shows first, then the unsent fortnight
  await expect(page.locator('.ts-reminder')).toContainText('sent back');
  await expect(page.locator('.ts-reminder')).toContainText('+1 more', { timeout: 10_000 });
  await page.click('.ts-reminder >> text=Fix and send');
  await expect(page.locator('table.fortnight')).toBeVisible();
  // week view
  await page.click('.seg >> text=Week');
  await expect(page.locator('table.fortnight tbody tr')).toHaveCount(7);

  // supervisor: date ranges
  await page.click('nav >> text=Sign out');
  await page.click('text=Email');
  await page.fill('#login-target', 'supervisor@demo.local');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.goto('?demo=1#/approvals');
  await page.click('.approval-range >> text=This month to today');
  await expect(page.locator('p.muted').first()).toContainText('-01 to ');
  await page.click('.approval-range >> text=Last 7 days');
  await page.click('.approval-range .seg >> text=Week');
  await expect(page.locator('.approval-range')).toContainText('This week');
});

test('roster: office assigns a docket to a crew phone, reassigns and cancels; the driver completes it; the supervisor reviews it', async ({ page }) => {
  await page.goto('?demo=1#/login');
  await page.evaluate(() => localStorage.clear());
  await signInEmail(page, 'office@demo.local');
  await page.click('nav >> text=Roster');
  // + in today's cell for Crew phone 2
  await page.locator('table.roster tbody tr:has-text("Crew phone 2") td.today button.roster-add').click();
  await expect(page.locator('#assign-phone')).toHaveValue('55555555-0000-0000-0000-000000000002');
  await page.click('.form-option:has-text("Drilling / CCC daily report")');
  await page.selectOption('.subform #f-department', 'Drilling');
  await page.click('button:has-text("Create docket")');
  await expect(page.locator('.assign-now')).toContainText('Crew phone 2');
  const texts = () => page.evaluate(() => JSON.parse(localStorage.getItem('coho-poc-demo-db-v1')!).sms_outbox.map((m: any) => `${m.kind} ${m.phone}`));
  expect(await texts()).toEqual(['docket_assigned 0400 000 002']);

  // reassign to crew phone 1, then cancel
  await page.click('button:has-text("Docket reassignment")');
  await page.selectOption('#assign-phone', '55555555-0000-0000-0000-000000000001');
  await page.click('button:has-text("Reassign and text the crew")');
  await expect(page.locator('.assign-now')).toContainText('Crew phone 1');
  expect(await texts()).toContain('docket_moved 0400 000 002');
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Cancel docket assignment")');
  await expect(page.locator('.assign-now')).toContainText('Not assigned');
  expect(await texts()).toContain('docket_cancelled 0400 000 001');
  // assign it back to crew phone 2 for Jo
  await page.click('button:has-text("Assign docket")');
  await page.selectOption('#assign-phone', '55555555-0000-0000-0000-000000000002');
  await page.click('.chip-toggle:has-text("Jo Cover")');
  await page.click('button:has-text("Assign and text the crew")');
  await expect(page.locator('.assign-now')).toContainText('Jo Cover');
  // times are 24-hour
  await expect(page.locator('#f-start_at-time')).toHaveAttribute('placeholder', 'HH:MM');
  const docketNo = (await page.locator('.docket-meta').innerText()).match(/Docket No\.\s*(\d+)/)![1];

  // Jo on crew phone 2: jobs for today, completes it
  await page.click('nav >> text=Sign out');
  await page.fill('#login-target', '0400 000 002');
  await page.click('text=Send code');
  await page.fill('#login-code', '123456');
  await page.click('button:has-text("Sign in")');
  await page.click('button:has-text("Jo Cover")');
  await page.click("text=Yes, that's me");
  await expect(page.locator('.jobs-today')).toContainText(`No. ${docketNo}`);
  await page.click(`.jobs-today button:has-text("No. ${docketNo}")`);
  await expect(page.locator('button:has-text("Docket reassignment")')).toHaveCount(0);   // drivers cannot reassign
  await page.fill('#f-start_at', new Date().toISOString().slice(0, 10));
  await page.fill('#f-start_at-time', '0600');
  await page.locator('#f-start_at-time').blur();
  await expect(page.locator('#f-start_at-time')).toHaveValue('06:00');
  await page.click('.savebar >> text=Close docket');
  await expect(page.locator('.toast')).toContainText('Docket closed');

  // supervisor: dockets to review, returns it with a comment
  await page.click('nav >> text=Sign out');
  await signInEmail(page, 'supervisor@demo.local');
  await expect(page.locator('.assigned-status')).toContainText('Dockets to review');
  await page.click(`.assigned-status button:has-text("No. ${docketNo}")`);
  await page.fill('.review-box textarea', 'Add the load volumes');
  await page.click('button:has-text("Return to driver")');
  await expect(page.locator('.note[role=alert]')).toContainText('Add the load volumes');
});
