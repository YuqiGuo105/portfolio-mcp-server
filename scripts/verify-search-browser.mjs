import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.SEARCH_PREVIEW_URL || 'http://127.0.0.1:3092';
const browser = await chromium.launch({ headless: true, channel: process.env.CHROMIUM_CHANNEL || undefined });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Search', exact: true });
    const rows = page.getByTestId('search-result');
    await input.fill('k8s');
    await page.getByRole('heading', { name: 'Kubernetes vs Docker: Containers, Runtimes, and Orchestration' }).waitFor();
    for (const query of ['盐湖城', 'SLC', 'did he go to chiago']) {
      const response = page.waitForResponse(r => r.url().includes('/api/search?') && new URL(r.url()).searchParams.get('q') === query);
      await input.fill(query);
      assert.equal((await response).status(), 200);
      await rows.first().waitFor();
      assert.match(await rows.first().innerText(), /From New York Island to California/);
      assert.match(await rows.first().innerText(), /Sign in to read/);
    }
    await page.getByRole('tab', { name: 'Projects', exact: true }).click();
    await page.getByRole('heading', { name: 'No matches in Projects' }).waitFor();
    await page.getByRole('button', { name: 'Search all content' }).click();
    await input.fill('版本控制');
    await page.getByRole('heading', { name: /GitHub Operations/ }).waitFor();
    await input.fill('zzzz-no-such-document-93478');
    await page.getByRole('heading', { name: 'No matches', exact: true }).waitFor();
    await page.route('**/api/search?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Search temporarily unavailable' }) }), { times: 1 });
    await input.fill('failure-test');
    await page.getByText('Search temporarily unavailable', { exact: true }).waitFor();
    await input.fill('盐湖城');
    await page.getByRole('heading', { name: 'From New York Island to California' }).waitFor();
    const bounds = await page.getByTestId('search-panel').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
    assert.equal(await page.getByTestId('search-panel').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: `/private/tmp/search-mle-${viewport.width}.png` });
    await input.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await rows.last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: 'Search portfolio' }).count(), 0);
    console.log(`PASS ${viewport.width}px: bilingual/typo, category, empty/error recovery, layout, keyboard`);
    await context.close();
  }
  const page = await browser.newPage();
  await page.goto('https://www.yuqi.site/life-blog/2', { waitUntil: 'domcontentloaded' });
  await page.getByText(/sign in|log in/i).first().waitFor();
  console.log('PASS anonymous restricted original still requests sign-in');
} finally { await browser.close(); }
