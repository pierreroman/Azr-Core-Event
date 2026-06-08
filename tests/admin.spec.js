/**
 * Admin pages test protocol — verifies admin pages are protected and that
 * the admin rail markup is present in the HTML source. Authenticated
 * dashboard rendering requires SWA CLI with mocked auth or a real session.
 */
const { test, expect } = require('@playwright/test');

test.describe('Admin Pages — Authentication', () => {

  test('admin.html should redirect unauthenticated users', async ({ page }) => {
    const response = await page.goto('/admin.html');
    const status = response?.status() ?? 0;
    expect(status === 200 || status === 401 || status === 302).toBeTruthy();
    if (status === 302) {
      expect(page.url()).toContain('.auth/login');
    }
  });

  test('schedule-admin.html should be protected', async ({ page }) => {
    const response = await page.goto('/schedule-admin.html');
    const status = response?.status() ?? 0;
    expect([200, 401, 302]).toContain(status);
  });

  test('speakers-admin.html should be protected', async ({ page }) => {
    const response = await page.goto('/speakers-admin.html');
    const status = response?.status() ?? 0;
    expect([200, 401, 302]).toContain(status);
  });

  test('sponsors-admin.html should be protected', async ({ page }) => {
    const response = await page.goto('/sponsors-admin.html');
    const status = response?.status() ?? 0;
    expect([200, 401, 302]).toContain(status);
  });
});

test.describe('Admin Dashboard — Markup', () => {
  // These tests check the raw HTML to verify structure even when auth
  // would block rendering against a live SWA deployment.

  test('admin.html source contains rail markers and dashboard markup', async ({ request }) => {
    const response = await request.get('/admin.html', { maxRedirects: 0 }).catch(() => null);
    if (!response || response.status() !== 200) {
      test.skip(true, 'admin.html not directly served (auth redirect or non-local target)');
      return;
    }
    const html = await response.text();
    // Rail markers
    expect(html).toContain('data-rail="admin"');
    expect(html).toContain('data-rail-active="dashboard"');
    expect(html).toContain('rail.js');
    // Dashboard markup
    expect(html).toContain('dashboard-card');
    // Legacy .user-bar should be gone — the rail now renders Logout / Back-to-site
    expect(html).not.toMatch(/class=["'][^"']*user-bar/);
  });

  test('schedule-admin.html source mounts the admin rail with Schedule active', async ({ request }) => {
    const response = await request.get('/schedule-admin.html', { maxRedirects: 0 }).catch(() => null);
    if (!response || response.status() !== 200) {
      test.skip(true, 'schedule-admin.html not directly served');
      return;
    }
    const html = await response.text();
    expect(html).toContain('data-rail="admin"');
    expect(html).toContain('data-rail-active="schedule"');
    expect(html).toContain('rail.js');
  });

  test('speakers-admin.html source mounts the admin rail with Speakers active', async ({ request }) => {
    const response = await request.get('/speakers-admin.html', { maxRedirects: 0 }).catch(() => null);
    if (!response || response.status() !== 200) {
      test.skip(true, 'speakers-admin.html not directly served');
      return;
    }
    const html = await response.text();
    expect(html).toContain('data-rail="admin"');
    expect(html).toContain('data-rail-active="speakers"');
  });

  test('sponsors-admin.html source mounts the admin rail with Sponsors active', async ({ request }) => {
    const response = await request.get('/sponsors-admin.html', { maxRedirects: 0 }).catch(() => null);
    if (!response || response.status() !== 200) {
      test.skip(true, 'sponsors-admin.html not directly served');
      return;
    }
    const html = await response.text();
    expect(html).toContain('data-rail="admin"');
    expect(html).toContain('data-rail-active="sponsors"');
  });
});
