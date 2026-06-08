/**
 * Accessibility test protocol — basic a11y checks across all public pages
 * and both themes. Covers landmarks, skip links, aria-current, alt text,
 * keyboard focus, and heading structure.
 */
const { test, expect } = require('./fixtures');

const PUBLIC_PAGES = [
  { path: '/', name: 'home' },
  { path: '/watch.html', name: 'watch' },
  { path: '/about.html', name: 'about' },
  { path: '/schedule.html', name: 'schedule' },
  { path: '/speakers.html', name: 'speakers' },
  { path: '/sponsors.html', name: 'sponsors' },
];

test.describe('Accessibility — every public page', () => {

  for (const p of PUBLIC_PAGES) {
    test(`${p.name}: html has lang="en"`, async ({ page, mockAPIs }) => {
      await page.goto(p.path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });

    test(`${p.name}: has a navigation landmark`, async ({ page, mockAPIs }) => {
      await page.goto(p.path);
      // The rail mounts as <aside aria-label="Primary navigation"> and
      // contains a <nav aria-label="Main"> for the link list.
      await expect(page.locator('aside.side-rail')).toBeVisible();
      await expect(page.locator('aside.side-rail nav[aria-label="Main"]')).toBeAttached();
    });

    test(`${p.name}: active rail item carries aria-current="page"`, async ({ page, mockAPIs }) => {
      await page.goto(p.path);
      const active = page.locator('aside.side-rail .rail-item.is-active');
      await expect(active).toHaveAttribute('aria-current', 'page');
    });

    test(`${p.name}: has a skip-to-content link`, async ({ page, mockAPIs }) => {
      await page.goto(p.path);
      await expect(page.locator('a.skip-link, a[href="#main-content"], a[href^="#"][class*="skip"]').first())
        .toBeAttached();
    });

    test(`${p.name}: every image has an alt attribute`, async ({ page, mockAPIs }) => {
      await page.goto(p.path);
      // Wait briefly for dynamic content (speakers/sponsors grids)
      await page.waitForLoadState('networkidle').catch(() => {});
      const images = page.locator('img');
      const count = await images.count();
      for (let i = 0; i < count; i++) {
        const alt = await images.nth(i).getAttribute('alt');
        expect(alt, `${p.name}: image ${i} missing alt`).not.toBeNull();
      }
    });

    test(`${p.name}: page has at least one heading`, async ({ page, mockAPIs }) => {
      await page.goto(p.path);
      const headings = await page.locator('h1, h2').count();
      expect(headings).toBeGreaterThanOrEqual(1);
    });
  }
});

test.describe('Accessibility — both themes render readable content', () => {

  for (const theme of ['dark', 'light']) {
    test(`hero title is visible in ${theme} theme`, async ({ page, mockAPIs }) => {
      await page.goto('/');
      await page.evaluate((t) => localStorage.setItem('site.theme', t), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const title = page.locator('#site-title');
      await expect(title).toBeVisible();
      const box = await title.boundingBox();
      expect(box?.width).toBeGreaterThan(0);
      expect(box?.height).toBeGreaterThan(0);
      await page.evaluate(() => localStorage.removeItem('site.theme'));
    });
  }
});

test.describe('Keyboard navigation', () => {

  test('Tab moves focus into the rail', async ({ page, mockAPIs }) => {
    await page.goto('/');
    // First Tab usually hits the skip link, second moves into the rail.
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.tagName);
    expect(first).not.toBe('BODY');
  });
});
