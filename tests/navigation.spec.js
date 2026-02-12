/**
 * Navigation & interaction test protocol — verifies anchor links,
 * modal dialogs, and cross-page navigation work correctly.
 */
const { test, expect } = require('./fixtures');

test.describe('Navigation & Interactions', () => {

  // ── Anchor Navigation ─────────────────────────────────────────

  test('CTA buttons should scroll to correct sections', async ({ page, mockAPIs }) => {
    await page.goto('/');

    // Click "Schedule" CTA and verify scroll position
    await page.locator('.hero .cta', { hasText: 'Schedule' }).click();
    await expect(page.locator('#schedule')).toBeInViewport();
  });

  test('About anchor link should navigate to about section', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await page.locator('.hero .cta', { hasText: 'About' }).click();
    await expect(page.locator('section#about').first()).toBeInViewport();
  });

  // ── Code of Conduct Modal ─────────────────────────────────────

  test('should open and close Code of Conduct modal', async ({ page, mockAPIs }) => {
    await page.goto('/');

    // Find and click the Code of Conduct link in the footer
    await page.locator('footer a', { hasText: 'Code of Conduct' }).click();

    // Modal should be visible
    const modal = page.locator('#coc-modal');
    await expect(modal).toBeVisible();

    // Close the modal
    await modal.locator('.modal-close').click();
    await expect(modal).toBeHidden();
  });

  // ── Session Modal ─────────────────────────────────────────────

  test('should open session detail modal when clicking a schedule item', async ({ page, mockAPIs }) => {
    await page.goto('/');

    // Wait for schedule to load
    await expect(page.locator('#schedule-container .loading')).toBeHidden({ timeout: 10_000 });

    // Click the first schedule card (if rendered)
    const firstSession = page.locator('.schedule-card, .session-card').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();

      const sessionModal = page.locator('#session-modal');
      await expect(sessionModal).toBeVisible();

      // Close modal
      await sessionModal.locator('.modal-close').click();
      await expect(sessionModal).toBeHidden();
    }
  });

  // ── Speaker Modal ─────────────────────────────────────────────

  test('should open speaker detail modal when clicking a speaker card', async ({ page, mockAPIs }) => {
    await page.goto('/');

    // Wait for speakers to load
    await expect(page.locator('#speakers-grid .loading')).toBeHidden({ timeout: 10_000 });

    // Click the first speaker card (if rendered)
    const firstSpeaker = page.locator('.speaker-card').first();
    if (await firstSpeaker.isVisible()) {
      await firstSpeaker.click();

      const speakerModal = page.locator('#speaker-modal');
      await expect(speakerModal).toBeVisible();

      // Verify speaker name is displayed
      await expect(speakerModal.locator('#speaker-modal-name')).not.toBeEmpty();

      // Close modal
      await speakerModal.locator('.modal-close').click();
      await expect(speakerModal).toBeHidden();
    }
  });

  // ── Sponsor Modal ─────────────────────────────────────────────

  test('should open sponsor detail modal when clicking a sponsor', async ({ page, mockAPIs }) => {
    await page.goto('/');

    // Wait for sponsors to load
    await expect(page.locator('#sponsors-grid .loading')).toBeHidden({ timeout: 10_000 });

    const firstSponsor = page.locator('.sponsor-card, .sponsor-item').first();
    if (await firstSponsor.isVisible()) {
      await firstSponsor.click();

      const sponsorModal = page.locator('#sponsor-modal');
      await expect(sponsorModal).toBeVisible();

      // Close modal
      await sponsorModal.locator('.modal-close').click();
      await expect(sponsorModal).toBeHidden();
    }
  });

  // ── Admin Link ────────────────────────────────────────────────

  test('footer should contain link to admin page', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const adminLink = page.locator('footer a[href="/admin.html"]');
    await expect(adminLink).toBeVisible();
    await expect(adminLink).toHaveText('Admin');
  });
});
