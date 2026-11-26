import { expect, type Locator, type Page } from '@playwright/test';

export async function assertLandmarks(page: Page): Promise<void> {
  const skipLink = page.locator('a[href="#main"]');
  await expect(skipLink).toHaveCount(1);
  await expect(skipLink).toHaveAccessibleName(/\S+/);

  const main = page.locator('main#main');
  await expect(main).toBeVisible();

  const banner = page.getByRole('banner');
  await expect(banner).toBeVisible();

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading.first()).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toHaveCount(1);

  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 1024) {
    await expect(nav).toBeVisible();
  } else {
    const isNavVisible = await nav.isVisible().catch(() => false);
    if (!isNavVisible) {
      const toggle = page.locator('button[aria-expanded][aria-controls]').first();
      await expect(toggle).toBeVisible();
    }
  }

  const liveRegion = page.locator('[aria-live="polite"]');
  await expect(liveRegion.first()).toBeAttached();
}

export async function assertNoHorizontalOverflow(page: Page, tolerancePx = 2): Promise<void> {
  const result = await page.evaluate((tolerance) => {
    const doc = document.documentElement;
    const scrollWidth = doc.scrollWidth;
    const clientWidth = doc.clientWidth;
    const overflowing: string[] = [];

    if (scrollWidth > clientWidth + tolerance) {
      const all = Array.from(document.querySelectorAll('*'));
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.right > clientWidth + tolerance) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const cls = typeof el.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
          overflowing.push(`${tag}${id}${cls} (right=${Math.round(rect.right)} > ${clientWidth})`);
          if (overflowing.length >= 5) break;
        }
      }
    }

    return { scrollWidth, clientWidth, overflowing };
  }, tolerancePx);

  expect(
    result.scrollWidth,
    `Horizontal overflow detected: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}, offenders=${result.overflowing.join(', ')}`
  ).toBeLessThanOrEqual(result.clientWidth + tolerancePx);
}

export async function assertKeyboardDialogBehavior(
  page: Page,
  trigger: Locator,
  dialog: Locator
): Promise<void> {
  await trigger.focus();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();

  const focusInsideDialog = await dialog.evaluate((dialogEl) => {
    const active = document.activeElement;
    return Boolean(active && (dialogEl === active || dialogEl.contains(active)));
  });
  expect(focusInsideDialog, 'Focus must move inside the dialog when opened via keyboard').toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await expect(trigger).toBeFocused();
}

export async function assertLiveAnnouncement(
  page: Page,
  expectedPattern: string | RegExp,
  timeoutMs = 5000
): Promise<void> {
  const regex = typeof expectedPattern === 'string'
    ? new RegExp(expectedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : expectedPattern;

  const liveRegions = page.locator('[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"]');
  await expect
    .poll(
      async () => {
        const texts = await liveRegions.allTextContents();
        return texts.some((text) => regex.test(text));
      },
      { timeout: timeoutMs, message: `Expected a live region announcement matching ${String(expectedPattern)}` }
    )
    .toBe(true);
}
