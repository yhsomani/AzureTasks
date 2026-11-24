import { test, expect } from '@playwright/test';
import { openNavigationIfNeeded } from './helpers.js';

test.describe('Team & Planning Workspace Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await openNavigationIfNeeded(page);
  });

  test('navigates to Plan & Review subview', async ({ page }) => {
    const plannerBtn = page.locator('#view-planner');
    await expect(plannerBtn).toBeVisible();
    await plannerBtn.click();
    await expect(plannerBtn).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main')).toBeVisible();

    const isDesktop = (page.viewportSize()?.width ?? 1024) >= 768;
    if (isDesktop) {
      await expect(page.locator('#plannerMatrix')).toBeVisible();
      await expect(page.locator('#plannerCardAccordion')).toBeHidden();
    } else {
      await expect(page.locator('#plannerCardAccordion')).toBeVisible();
      await expect(page.locator('#plannerMatrix')).toBeHidden();
    }
  });

  test('navigates to Coverage Matrix view', async ({ page }) => {
    const explorerBtn = page.locator('#view-explorer');
    await expect(explorerBtn).toBeVisible();
    await explorerBtn.click();
    await expect(explorerBtn).toHaveAttribute('aria-current', 'page');
  });

  test('navigates to Team Roster and Work Calendar', async ({ page }) => {
    const peopleBtn = page.locator('#view-people');
    await expect(peopleBtn).toBeVisible();
    await peopleBtn.click();
    await expect(peopleBtn).toHaveAttribute('aria-current', 'page');

    await openNavigationIfNeeded(page);
    const calendarBtn = page.locator('#view-calendar');
    await expect(calendarBtn).toBeVisible();
    await calendarBtn.click();
    await expect(calendarBtn).toHaveAttribute('aria-current', 'page');
  });
});
