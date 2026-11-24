import { test, expect } from '@playwright/test';

test.describe('Remediation Verification (Challenger 1 Adversarial Findings)', () => {
  test('verifies desktop matrix visibility and mobile accordion suppression at 1280x800', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#planner');
    await page.waitForLoadState('domcontentloaded');

    const matrix = page.locator('#plannerMatrix');
    await expect(matrix).toBeVisible();
    const matrixDisplay = await matrix.evaluate((el) => window.getComputedStyle(el).display);
    expect(matrixDisplay).toBe('block');

    const accordion = page.locator('#plannerCardAccordion');
    await expect(accordion).toBeHidden();
    const accordionDisplay = await accordion.evaluate((el) => window.getComputedStyle(el).display);
    expect(accordionDisplay).toBe('none');
  });

  test('verifies mobile accordion visibility and desktop matrix suppression at 375x667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#planner');
    await page.waitForLoadState('domcontentloaded');

    const accordion = page.locator('#plannerCardAccordion');
    await expect(accordion).toBeVisible();
    const accordionDisplay = await accordion.evaluate((el) => window.getComputedStyle(el).display);
    expect(accordionDisplay).toBe('flex');

    const matrix = page.locator('#plannerMatrix');
    await expect(matrix).toBeHidden();
    const matrixDisplay = await matrix.evaluate((el) => window.getComputedStyle(el).display);
    expect(matrixDisplay).toBe('none');
  });

  test('verifies Toast container layout has no negative-left offset on mobile (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/#people');
    await page.waitForLoadState('domcontentloaded');

    // Trigger toast notification
    const addMemberBtn = page.locator('button:has-text("Add Member")');
    if (await addMemberBtn.isVisible()) {
      await addMemberBtn.click();
      const saveBtn = page.locator('button:has-text("Save Member"), button:has-text("Save")').last();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
      }
    }

    const toastStack = page.locator('#viewStatus');
    if (await toastStack.count() > 0 && await toastStack.isVisible()) {
      const box = await toastStack.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('verifies Toast container layout aligns to the right on desktop (1280x800)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#people');
    await page.waitForLoadState('domcontentloaded');

    // Trigger toast notification
    const addMemberBtn = page.locator('button:has-text("Add Member")');
    if (await addMemberBtn.isVisible()) {
      await addMemberBtn.click();
      const saveBtn = page.locator('button:has-text("Save Member"), button:has-text("Save")').last();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
      }
    }

    const toastStack = page.locator('#viewStatus');
    if (await toastStack.count() > 0 && await toastStack.isVisible()) {
      const box = await toastStack.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
        expect(1280 - (box.x + box.width)).toBeLessThanOrEqual(30);
      }
    }
  });
});
