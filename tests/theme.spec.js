/**
 * Theme system tests — verify dark/light toggle, localStorage persistence,
 * prefers-color-scheme honored on first visit, and CSS variables flip.
 */
const { test, expect } = require('./fixtures');

test.describe('Theme toggle', () => {

  test('honors prefers-color-scheme: light on first visit', async ({ browser, mockAPIs: _ }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await ctx.close();
  });

  test('defaults to dark when prefers-color-scheme is dark', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await ctx.close();
  });

  test('toggle button switches theme and persists to localStorage', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const initial = await page.locator('html').getAttribute('data-theme');
    const expectedNext = initial === 'dark' ? 'light' : 'dark';

    await page.locator('.rail-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedNext);

    const stored = await page.evaluate(() => localStorage.getItem('site.theme'));
    expect(stored).toBe(expectedNext);

    // Survive a reload
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedNext);

    // Cleanup
    await page.evaluate(() => localStorage.removeItem('site.theme'));
  });

  test('toggle aria-pressed reflects current theme', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const toggle = page.locator('.rail-theme-toggle');
    const theme = await page.locator('html').getAttribute('data-theme');
    await expect(toggle).toHaveAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
  });

  test('light theme changes the body background', async ({ page, mockAPIs }) => {
    await page.goto('/');
    // Force light
    await page.evaluate(() => {
      localStorage.setItem('site.theme', 'light');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const bg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    // Light bg is rgb(245, 247, 251); dark bg is rgb(10, 15, 31)
    // Light mode should have a high luminance (R+G+B > 600)
    const match = bg.match(/(\d+),\s*(\d+),\s*(\d+)/);
    expect(match).not.toBeNull();
    const sum = match ? Number(match[1]) + Number(match[2]) + Number(match[3]) : 0;
    expect(sum).toBeGreaterThan(600);

    await page.evaluate(() => localStorage.removeItem('site.theme'));
  });

  test('theme preference applies across pages', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('site.theme', 'light'));

    for (const url of ['/about.html', '/schedule.html', '/speakers.html', '/sponsors.html']) {
      await page.goto(url);
      await expect(page.locator('html'), `theme on ${url}`).toHaveAttribute('data-theme', 'light');
    }

    await page.evaluate(() => localStorage.removeItem('site.theme'));
  });
});
