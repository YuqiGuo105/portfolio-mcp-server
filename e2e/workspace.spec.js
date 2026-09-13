import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/host/control', { data: {} }); });
test('visitor filters, bounded pagination, timeline, and identifiers', async ({ page }) => {
  await page.goto('/');
  const ui = page.frameLocator('#app');
  await expect(ui.getByText('18', { exact: true })).toBeVisible();
  await expect(ui.locator('.record')).toHaveCount(15);
  await ui.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(ui.locator('.record')).toHaveCount(3);
  await expect(ui.getByText('Page 2', { exact: true })).toBeVisible();
  await ui.locator('.record').first().click();
  await expect(ui.getByRole('heading', { name: 'Session timeline' })).toBeVisible();
  await expect(ui.getByText('192.0.2.10', { exact: true })).not.toBeVisible();
  await ui.getByText('Visitor identifiers', { exact: true }).click();
  await expect(ui.getByText('192.0.2.10', { exact: true })).toBeVisible();
  await ui.getByRole('button', { name: 'Close details' }).click();
  await ui.getByLabel('Search', { exact: true }).fill('empty');
  await ui.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(ui.getByText('No matching records')).toBeVisible();
});
test('knowledge text is escaped and detail is readable', async ({ page }) => {
  await page.goto('/?view=knowledge');
  const ui = page.frameLocator('#app');
  await expect(ui.getByText('Platform architecture', { exact: true })).toBeVisible();
  await expect(ui.locator('.record img')).toHaveCount(0);
  await ui.locator('.record').first().click();
  await expect(ui.getByText('Owner-approved source content.', { exact: false })).toBeVisible();
  await expect(ui.getByText('v7', { exact: true })).toBeVisible();
});
test('operation details show durable transitions and retry guidance', async ({ page }) => {
  await page.goto('/?view=operations');
  const ui = page.frameLocator('#app');
  await ui.locator('.record').first().click();
  await expect(ui.locator('.timeline li')).toHaveCount(2);
  await expect(ui.locator('.timeline')).toContainText('Running');
  await expect(ui.locator('.timeline')).not.toContainText('Time unavailable');
  await expect(ui.getByText('VERIFY_OUTCOME', { exact: true })).toBeVisible();
  await expect(ui.getByText('No', { exact: true })).toBeVisible();
});
test('review, cancel and explicit confirmation issue exactly one write', async ({ page, request }) => {
  await page.goto('/?view=operations');
  const ui = page.frameLocator('#app');
  await ui.getByRole('button', { name: 'Review retry', exact: true }).click();
  await expect(ui.getByRole('button', { name: 'Confirm retry' })).toBeVisible();
  expect((await (await request.get('/host/state')).json()).writes).toBe(0);
  await ui.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await request.get('/host/state')).json()).writes).toBe(0);
  await ui.getByRole('button', { name: 'Review retry', exact: true }).click();
  await ui.getByRole('button', { name: 'Confirm retry', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Retry accepted' })).toBeVisible();
  expect((await (await request.get('/host/state')).json()).writes).toBe(1);
  await ui.getByRole('button', { name: 'Close details' }).click();
  await expect(ui.getByRole('button', { name: 'Verify outcome', exact: true })).toBeVisible();
});
test('uncertain writes never show success or automatically retry', async ({ page, request }) => {
  await request.post('/host/control', { data: { mode: 'unknown' } });
  await page.goto('/?view=operations');
  const ui = page.frameLocator('#app');
  await ui.getByRole('button', { name: 'Review retry', exact: true }).click();
  await ui.getByRole('button', { name: 'Confirm retry', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Verification required' })).toBeVisible();
  expect((await (await request.get('/host/state')).json()).writes).toBe(1);
});
test('partial service failure is not an empty success', async ({ page, request }) => {
  await request.post('/host/control', { data: { mode: 'partial' } });
  await page.goto('/?view=operations');
  await expect(page.frameLocator('#app').getByRole('alert')).toContainText('Some services are unavailable');
});
test('mobile, dark theme and scrolling remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const ui = page.frameLocator('#app');
  await expect(ui.locator('.record')).toHaveCount(15);
  expect(await ui.locator('html').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await ui.locator('main').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await ui.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(ui.getByText('Page 1', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(ui.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => ui.locator('.record').first().evaluate(el => getComputedStyle(el).backgroundColor))
    .toBe('rgb(23, 28, 29)');
  await page.screenshot({ path: 'test-results/workspace-mobile-dark.png', fullPage: true, animations: 'disabled' });
});
test('desktop screenshot and clean browser execution', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto('/?view=operations');
  await expect(page.frameLocator('#app').getByRole('button', { name: 'Review retry', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
