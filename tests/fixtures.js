/**
 * Shared test fixtures and helpers for the Community Online Event site.
 */
const base = require('@playwright/test');
const { expect } = base;

/**
 * Mock API responses so tests don't depend on a live backend.
 */
const mockData = {
  schedule: [
    {
      partitionKey: 'day1',
      rowKey: '1',
      title: 'Opening Keynote',
      description: 'Welcome to the community event!',
      startTime: '2026-03-15T09:00:00Z',
      endTime: '2026-03-15T10:00:00Z',
      speakers: 'Jane Doe',
      youtubeUrl: 'https://www.youtube.com/watch?v=test123',
      day: 'Day 1',
      order: 1,
    },
    {
      partitionKey: 'day1',
      rowKey: '2',
      title: 'Azure Functions Deep Dive',
      description: 'Learn about serverless computing.',
      startTime: '2026-03-15T10:30:00Z',
      endTime: '2026-03-15T11:30:00Z',
      speakers: 'John Smith',
      youtubeUrl: '',
      day: 'Day 1',
      order: 2,
    },
  ],

  speakers: [
    {
      partitionKey: 'speakers',
      rowKey: '1',
      name: 'Jane Doe',
      title: 'Principal Engineer',
      company: 'Microsoft',
      bio: 'Expert in cloud computing and distributed systems.',
      photoUrl: '',
      twitter: 'janedoe',
      linkedin: 'janedoe',
      sessionIds: '1',
    },
    {
      partitionKey: 'speakers',
      rowKey: '2',
      name: 'John Smith',
      title: 'Senior Developer',
      company: 'Contoso',
      bio: 'Passionate about serverless and event-driven architectures.',
      photoUrl: '',
      twitter: '',
      linkedin: 'johnsmith',
      sessionIds: '2',
    },
  ],

  sponsors: [
    {
      partitionKey: 'sponsors',
      rowKey: '1',
      name: 'Contoso Ltd',
      tier: 'gold',
      logoUrl: '',
      websiteUrl: 'https://contoso.com',
      description: 'Leading technology company.',
      order: 1,
    },
  ],

  content: {
    about: { content: '# About\nThis is a community event.' },
    codeOfConduct: { content: '# Code of Conduct\nBe nice.' },
  },

  siteConfig: {
    title: 'Community Online Event',
    tagline: 'A community-driven online event.',
    sponsorsEnabled: true,
  },
};

/**
 * Extended test fixture that can optionally mock all API routes.
 */
const test = base.test.extend({
  /**
   * Intercept API calls and return mock data.
   * Use: test('my test', async ({ mockAPIs }) => { ... })
   */
  mockAPIs: async ({ page }, use) => {
    // Mock schedule
    await page.route('**/api/schedule*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.schedule),
      });
    });

    // Mock speakers
    await page.route('**/api/speakers*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.speakers),
      });
    });

    // Mock sponsors
    await page.route('**/api/sponsors*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.sponsors),
      });
    });

    // Mock content (about, code-of-conduct)
    await page.route('**/api/content/about*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.content.about),
      });
    });

    await page.route('**/api/content/code-of-conduct*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.content.codeOfConduct),
      });
    });

    // Mock site config
    await page.route('**/api/content/site-config*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData.siteConfig),
      });
    });

    await use(mockData);
  },
});

module.exports = { test, expect, mockData };
