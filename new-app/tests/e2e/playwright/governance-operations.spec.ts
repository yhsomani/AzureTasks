import { test, expect } from '@playwright/test';

test.describe('Governance & Operations Workspace Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('navigates to Audit Log view and displays entries container', async ({ page }) => {
    const journalBtn = page.locator('#view-journal');
    await expect(journalBtn).toBeVisible();
    await journalBtn.click();
    await expect(journalBtn).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main')).toBeVisible();
  });

  test('navigates to Scheduler Daemon view', async ({ page }) => {
    const schedulerBtn = page.locator('#view-scheduler');
    await expect(schedulerBtn).toBeVisible();
    await schedulerBtn.click();
    await expect(schedulerBtn).toHaveAttribute('aria-current', 'page');
  });

  test('navigates to RBAC & Identity settings view', async ({ page }) => {
    const settingsBtn = page.locator('#view-settings');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(settingsBtn).toHaveAttribute('aria-current', 'page');
  });
});
