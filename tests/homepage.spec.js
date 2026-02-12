/**
 * Homepage test protocol — verifies the public landing page renders
 * correctly, loads data from APIs, and displays all major sections.
 */
const { test, expect } = require('./fixtures');

test.describe('Homepage', () => {

  // ── Page Load & SEO ───────────────────────────────────────────

  test('should load successfully and have correct title', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Community Online Event/i);
  });

  test('should have meta viewport for responsive design', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });

  // ── Hero Section ──────────────────────────────────────────────

  test('should display hero section with title and tagline', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await expect(page.locator('#site-title')).toBeVisible();
    await expect(page.locator('#site-tagline')).toBeVisible();
  });

  test('hero should have CTA navigation buttons', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const ctas = page.locator('.hero .cta');
    await expect(ctas).toHaveCount(4); // About, Schedule, Speakers, Sponsors
  });

  // ── Schedule Section ──────────────────────────────────────────

  test('should render schedule section with session data', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const scheduleSection = page.locator('#schedule');
    await expect(scheduleSection).toBeVisible();
    await expect(scheduleSection.locator('h2')).toContainText('Event Schedule');

    // Wait for schedule content to load (loading placeholder should disappear)
    await expect(page.locator('#schedule-container .loading')).toBeHidden({ timeout: 10_000 });
  });

  // ── Speakers Section ──────────────────────────────────────────

  test('should render speakers section', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const speakersSection = page.locator('#speakers');
    await expect(speakersSection).toBeVisible();
    await expect(speakersSection.locator('h2')).toContainText('Featured Speakers');

    // Wait for speakers to load
    await expect(page.locator('#speakers-grid .loading')).toBeHidden({ timeout: 10_000 });
  });

  // ── Sponsors Section ──────────────────────────────────────────

  test('should have sponsors section in DOM', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const sponsorsSection = page.locator('#sponsors');
    // Sponsors section may be hidden if no sponsors are configured
    await expect(sponsorsSection).toBeAttached();
  });

  // ── Footer ────────────────────────────────────────────────────

  test('should display footer with links', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-links a')).toHaveCount(4);
    await expect(footer.locator('.copyright')).toContainText('2026');
  });

  // ── External Scripts ──────────────────────────────────────────

  test('should load required external scripts', async ({ page, mockAPIs }) => {
    await page.goto('/');
    // marked.js and DOMPurify should be loaded
    const hasMarked = await page.evaluate(() => typeof window.marked !== 'undefined');
    const hasDOMPurify = await page.evaluate(() => typeof window.DOMPurify !== 'undefined');
    expect(hasMarked).toBe(true);
    expect(hasDOMPurify).toBe(true);
  });
});
