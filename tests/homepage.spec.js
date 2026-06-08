/**
 * Homepage tests — index.html (`/`) is now the Home page: logo, title,
 * tagline, and CTA buttons. The video player lives on /watch.html.
 */
const { test, expect } = require('./fixtures');

test.describe('Home page (/)', () => {

  test('should load with the correct document title', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Community Online Event/i);
  });

  test('should have meta viewport for responsive design', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });

  test('should set body[data-rail="public"] and mark "home" as active', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveAttribute('data-rail', 'public');
    await expect(page.locator('body')).toHaveAttribute('data-rail-active', 'home');
  });

  test('should display hero with logo, title, and tagline', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await expect(page.locator('#site-logo')).toBeVisible();
    await expect(page.locator('#site-title')).toBeVisible();
    await expect(page.locator('#site-tagline')).toBeVisible();
  });

  test('should display Watch and Schedule CTA buttons', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const watchCta = page.locator('.hero-actions a[href="/watch.html"]');
    const scheduleCta = page.locator('.hero-actions a[href="/schedule.html"]');
    await expect(watchCta).toBeVisible();
    await expect(scheduleCta).toBeVisible();
  });

  test('should NOT render the video player on the Home page', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await expect(page.locator('#video')).toHaveCount(0);
    await expect(page.locator('#video-container')).toHaveCount(0);
  });

  test('should display footer with links', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-links a')).toHaveCount(4);
    await expect(footer.locator('.copyright')).toContainText('2026');
  });
});

test.describe('Watch page (/watch.html)', () => {

  test('should load with the correct document title', async ({ page, mockAPIs }) => {
    await page.goto('/watch.html');
    await expect(page).toHaveTitle(/Watch/i);
  });

  test('should set body[data-rail="public"] and mark "watch" as active', async ({ page, mockAPIs }) => {
    await page.goto('/watch.html');
    await expect(page.locator('body')).toHaveAttribute('data-rail', 'public');
    await expect(page.locator('body')).toHaveAttribute('data-rail-active', 'watch');
  });

  test('should display the video section and container', async ({ page, mockAPIs }) => {
    await page.goto('/watch.html');
    await expect(page.locator('#video')).toBeVisible();
    await expect(page.locator('#video-container')).toBeVisible();
  });

  test('should NOT render the hero on the Watch page', async ({ page, mockAPIs }) => {
    await page.goto('/watch.html');
    await expect(page.locator('.hero')).toHaveCount(0);
    await expect(page.locator('#site-title')).toHaveCount(0);
  });

  test('should load required external scripts', async ({ page, mockAPIs }) => {
    await page.goto('/watch.html');
    const hasMarked = await page.evaluate(() => typeof window.marked !== 'undefined');
    const hasDOMPurify = await page.evaluate(() => typeof window.DOMPurify !== 'undefined');
    expect(hasMarked).toBe(true);
    expect(hasDOMPurify).toBe(true);
  });
});
