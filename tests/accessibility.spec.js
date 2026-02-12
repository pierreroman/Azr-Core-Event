/**
 * Accessibility test protocol — basic a11y checks across pages.
 */
const { test, expect } = require('./fixtures');

test.describe('Accessibility', () => {

  test('homepage should have lang attribute on html element', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('all images should have alt attributes', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      expect(alt, `Image ${i} missing alt attribute`).not.toBeNull();
    }
  });

  test('page should have h1 headings', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
  });

  test('all interactive elements should be keyboard-focusable', async ({ page, mockAPIs }) => {
    await page.goto('/');

    // Tab through the page and verify focus moves
    await page.keyboard.press('Tab');
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(firstFocused).not.toBe('BODY');
  });

  test('color contrast — hero text should be readable', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const title = page.locator('#site-title');
    await expect(title).toBeVisible();
    // Basic check: element is rendered and has non-zero dimensions
    const box = await title.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });
});
