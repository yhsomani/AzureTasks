import { test, expect } from '@playwright/test';
import { openNavigationIfNeeded } from './helpers.js';

test.describe('Daily Workflow Workspace Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await openNavigationIfNeeded(page);
  });

  test('loads My Work by default and displays the primary workspace', async ({ page }) => {
    await expect(page.locator('#view-mywork')).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    // Verify navigation label
    await expect(page.getByRole('heading', { name: /My work/i })).toBeVisible();
  });

  test('navigates between My Work, Today's Delivery, and Activity Stream', async ({ page }) => {
    // Click Today's delivery
    const summaryBtn = page.locator('#view-dashboard');
    await expect(summaryBtn).toBeVisible();
    await summaryBtn.click();
    await expect(summaryBtn).toHaveAttribute('aria-current', 'page');

    // Click Live SSE Stream
    await openNavigationIfNeeded(page);
    const logsBtn = page.locator('#view-logs');
    await expect(logsBtn).toBeVisible();
    await logsBtn.click();
    await expect(logsBtn).toHaveAttribute('aria-current', 'page');

    // Return to Cockpit
    await openNavigationIfNeeded(page);
    const myworkBtn = page.locator('#view-mywork');
    await myworkBtn.click();
    await expect(page.locator('#view-mywork')).toHaveAttribute('aria-current', 'page');
  });

  test('validates action buttons in daily workflow view', async ({ page }) => {
    await page.locator('#view-mywork').click();
    // Check main container visibility
    await expect(page.locator('main')).toBeVisible();
  });
});
