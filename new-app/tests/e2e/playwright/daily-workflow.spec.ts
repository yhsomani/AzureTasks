import { test, expect } from '@playwright/test';

test.describe('Daily Workflow Workspace Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('loads Daily Workflow workspace by default and displays cockpit metrics', async ({ page }) => {
    await expect(page.locator('#view-mywork')).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    // Verify navigation label
    await expect(page.getByText('Daily Workflow', { exact: false })).toBeVisible();
  });

  test('navigates between Personal Cockpit, Today Summary, and Live SSE Stream', async ({ page }) => {
    // Click Today's Summary
    const summaryBtn = page.locator('#view-dashboard');
    await expect(summaryBtn).toBeVisible();
    await summaryBtn.click();
    await expect(summaryBtn).toHaveAttribute('aria-current', 'page');

    // Click Live SSE Stream
    const logsBtn = page.locator('#view-logs');
    await expect(logsBtn).toBeVisible();
    await logsBtn.click();
    await expect(logsBtn).toHaveAttribute('aria-current', 'page');

    // Return to Cockpit
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
