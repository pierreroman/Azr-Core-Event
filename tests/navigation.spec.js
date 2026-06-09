/**
 * Navigation & interaction tests — covers the new side-rail navigation,
 * cross-page transitions, and modal dialogs that now live on the
 * per-section pages (schedule.html, speakers.html, sponsors.html).
 */
const { test, expect } = require('./fixtures');

test.describe('Side Rail — Public', () => {

  test('rail renders on the home page with all 7 nav items', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const rail = page.locator('aside.side-rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('aria-label', 'Primary navigation');
    await expect(rail.locator('.rail-item[data-rail-id]')).toHaveCount(7);
  });

  test('rail marks the current page with aria-current="page"', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const active = page.locator('aside.side-rail .rail-item.is-active');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(active).toHaveAttribute('data-rail-id', 'home');
  });

  test('rail active state updates per page', async ({ page, mockAPIs }) => {
    const pages = [
      { url: '/watch.html', id: 'watch' },
      { url: '/about.html', id: 'about' },
      { url: '/schedule.html', id: 'schedule' },
      { url: '/speakers.html', id: 'speakers' },
      { url: '/code-of-conduct.html', id: 'code-of-conduct' },
      { url: '/sponsors.html', id: 'sponsors' },
    ];
    for (const p of pages) {
      await page.goto(p.url);
      const active = page.locator('aside.side-rail .rail-item.is-active');
      await expect(active, `active item on ${p.url}`).toHaveAttribute('data-rail-id', p.id);
    }
  });

  test('rail link navigates between pages', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await page.locator('aside.side-rail .rail-item[data-rail-id="schedule"]').click();
    await expect(page).toHaveURL(/\/schedule\.html$/);
    await expect(page.locator('aside.side-rail .rail-item.is-active'))
      .toHaveAttribute('data-rail-id', 'schedule');
  });

  test('rail footer contains the theme toggle button', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const toggle = page.locator('aside.side-rail .rail-theme-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', /true|false/);
  });

  test('rail collapse state persists across navigations', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await page.locator('.rail-collapse').click();
    await expect(page.locator('body')).toHaveClass(/rail-collapsed/);
    await page.goto('/about.html');
    await expect(page.locator('body')).toHaveClass(/rail-collapsed/);
    // Cleanup so we don't leak state into other tests
    await page.evaluate(() => localStorage.removeItem('rail.collapsed'));
  });
});

test.describe('Side Rail — Mobile drawer', () => {
  test.use({ viewport: { width: 480, height: 800 } });

  test('hamburger toggles the off-canvas drawer below 900px', async ({ page, mockAPIs }) => {
    await page.goto('/');
    const hamburger = page.locator('.rail-toggle-mobile');
    await expect(hamburger).toBeVisible();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    await hamburger.click();
    await expect(page.locator('body')).toHaveClass(/rail-open/);
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    // Escape closes the drawer
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/rail-open/);
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Code of Conduct page', () => {

  test('side-rail item navigates to /code-of-conduct.html', async ({ page, mockAPIs }) => {
    await page.goto('/');
    await page.locator('.side-rail .rail-item[data-rail-id="code-of-conduct"]').click();
    await expect(page).toHaveURL(/\/code-of-conduct\.html$/);
    await expect(page.locator('aside.side-rail .rail-item.is-active'))
      .toHaveAttribute('data-rail-id', 'code-of-conduct');
  });

  test('renders the Markdown content from the API', async ({ page, mockAPIs }) => {
    await page.goto('/code-of-conduct.html');
    const content = page.locator('#coc-content');
    await expect(content).toBeVisible();
    // Mocked fixture returns '# Code of Conduct\nBe nice.' which parses to <h1>
    await expect(content.locator('h1')).toContainText('Code of Conduct', { timeout: 5_000 });
  });
});

test.describe('Session modal (schedule page)', () => {

  test('clicking a schedule item opens the session modal', async ({ page, mockAPIs }) => {
    await page.goto('/schedule.html');
    await expect(page.locator('#schedule-container .loading')).toBeHidden({ timeout: 10_000 });

    const firstSession = page.locator('.schedule-card, .session-card').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      const sessionModal = page.locator('#session-modal');
      await expect(sessionModal).toBeVisible();
      await sessionModal.locator('.modal-close').click();
      await expect(sessionModal).toBeHidden();
    }
  });
});

test.describe('Speaker modal (speakers page)', () => {

  test('clicking a speaker opens the speaker modal', async ({ page, mockAPIs }) => {
    await page.goto('/speakers.html');
    await expect(page.locator('#speakers-grid .loading')).toBeHidden({ timeout: 10_000 });

    const firstSpeaker = page.locator('.speaker-card').first();
    if (await firstSpeaker.isVisible()) {
      await firstSpeaker.click();
      const speakerModal = page.locator('#speaker-modal');
      await expect(speakerModal).toBeVisible();
      await expect(speakerModal.locator('#speaker-modal-name')).not.toBeEmpty();
      await speakerModal.locator('.modal-close').click();
      await expect(speakerModal).toBeHidden();
    }
  });
});

test.describe('Sponsor modal (sponsors page)', () => {

  test('clicking a sponsor opens the sponsor modal', async ({ page, mockAPIs }) => {
    await page.goto('/sponsors.html');
    await expect(page.locator('#sponsors-grid .loading')).toBeHidden({ timeout: 10_000 });

    const firstSponsor = page.locator('.sponsor-card, .sponsor-item').first();
    if (await firstSponsor.isVisible()) {
      await firstSponsor.click();
      const sponsorModal = page.locator('#sponsor-modal');
      await expect(sponsorModal).toBeVisible();
      await sponsorModal.locator('.modal-close').click();
      await expect(sponsorModal).toBeHidden();
    }
  });
});

test.describe('Footer admin link', () => {

  test('every public page links to /admin.html', async ({ page, mockAPIs }) => {
    for (const url of ['/', '/watch.html', '/about.html', '/schedule.html', '/speakers.html', '/sponsors.html']) {
      await page.goto(url);
      const adminLink = page.locator('footer a[href="/admin.html"]');
      await expect(adminLink, `admin link on ${url}`).toBeVisible();
    }
  });
});
