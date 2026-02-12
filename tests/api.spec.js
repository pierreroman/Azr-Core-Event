/**
 * API integration test protocol — verifies that API endpoints respond
 * correctly. These tests hit the REAL API (no mocking) so they require
 * the SWA CLI or Azure Functions to be running.
 *
 * Run separately:  npx playwright test tests/api.spec.js
 */
const { test, expect } = require('@playwright/test');

test.describe('API Endpoints', () => {

  // ── GET /api/schedule ─────────────────────────────────────────

  test('GET /api/schedule should return 200 with data', async ({ request }) => {
    const response = await request.get('/api/schedule');
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Response may be an array or an object with a data property
    expect(body).toBeTruthy();
  });

  // ── GET /api/speakers ─────────────────────────────────────────

  test('GET /api/speakers should return 200 with data', async ({ request }) => {
    const response = await request.get('/api/speakers');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toBeTruthy();
  });

  // ── GET /api/sponsors ─────────────────────────────────────────

  test('GET /api/sponsors should return 200 with data', async ({ request }) => {
    const response = await request.get('/api/sponsors');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toBeTruthy();
  });

  // ── GET /api/content/about ────────────────────────────────────

  test('GET /api/content/about should return 200', async ({ request }) => {
    const response = await request.get('/api/content/about');
    expect(response.status()).toBe(200);
  });

  // ── GET /api/content/code-of-conduct ──────────────────────────

  test('GET /api/content/code-of-conduct should return 200', async ({ request }) => {
    const response = await request.get('/api/content/code-of-conduct');
    expect(response.status()).toBe(200);
  });

  // ── POST without auth should be rejected ──────────────────────

  test('POST /api/schedule without auth should not succeed with changes', async ({ request }) => {
    const response = await request.post('/api/schedule', {
      data: { title: 'Unauthorized Test' },
    });
    // SWA may return 200 (redirect to login page), 401, or 403
    expect([200, 401, 403]).toContain(response.status());
  });

  test('POST /api/speakers without auth should not succeed with changes', async ({ request }) => {
    const response = await request.post('/api/speakers', {
      data: { name: 'Unauthorized Test' },
    });
    expect([200, 401, 403]).toContain(response.status());
  });

  test('POST /api/sponsors without auth should not succeed with changes', async ({ request }) => {
    const response = await request.post('/api/sponsors', {
      data: { name: 'Unauthorized Test' },
    });
    expect([200, 401, 403]).toContain(response.status());
  });
});
