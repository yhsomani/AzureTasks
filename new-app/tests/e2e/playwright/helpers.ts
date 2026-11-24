import type { Page } from '@playwright/test';

export async function openNavigationIfNeeded(page: Page): Promise<void> {
  const sidebar = page.locator('#sidebar');
  if (await sidebar.isVisible()) return;
  await page.getByRole('button', { name: 'Open primary navigation', exact: true }).click();
  await sidebar.waitFor({ state: 'visible' });
}
