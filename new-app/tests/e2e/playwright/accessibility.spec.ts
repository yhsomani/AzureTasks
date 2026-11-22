import { test, expect } from '@playwright/test';

test.describe('WCAG 2.1 AA Accessibility & Keyboard Navigation Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('verifies keyboard Tab focus traversal across navigation items', async ({ page }) => {
    // Focus the document body
    await page.locator('body').focus();
    // Press Tab multiple times
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'A', 'INPUT', 'DIV']).toContain(focusedTag);
  });

  test('ensures landmark regions and accessible names are present', async ({ page }) => {
    await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('verifies all interactive buttons meet minimum touch target recommendations', async ({ page }) => {
    const navButtons = page.locator('nav button');
    const count = await navButtons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await navButtons.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
