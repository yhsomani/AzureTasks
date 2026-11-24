import { test, expect } from '@playwright/test';

test.describe('Mobile Viewport & Responsive Card Journeys', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('toggles mobile sidebar drawer via hamburger menu', async ({ page }) => {
    const hamburgerBtn = page.getByRole('button', { name: 'Open primary navigation', exact: true });
    await expect(hamburgerBtn).toBeVisible();
    await hamburgerBtn.click();
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('renders without horizontal document overflow on mobile width', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});
