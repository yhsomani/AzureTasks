import { test, expect } from '../harness/fixtures.js';
import {
  assertKeyboardDialogBehavior,
  assertLandmarks,
  assertLiveAnnouncement,
  assertNoHorizontalOverflow,
} from '../harness/a11y.js';

interface RouteGroup {
  name: string;
  tags: string;
  routes: string[];
}

const ALL_CANONICAL_ROUTES: string[] = [
  '/mywork',
  '/dashboard',
  '/logs',
  '/planner',
  '/explorer',
  '/burndown',
  '/lifecycle',
  '/people',
  '/calendar',
  '/journal',
  '/scheduler',
  '/settings',
  '/azure-overview',
  '/azure-builds',
  '/azure-teams',
  '/unassigned',
  '/sprint-progress',
];

const ROUTE_GROUPS: RouteGroup[] = [
  {
    name: 'Core Operations',
    tags: '[F13][F14]',
    routes: ['/mywork', '/dashboard', '/logs'],
  },
  {
    name: 'Planning, Explorer, Burndown & Lifecycle',
    tags: '[F13]',
    routes: ['/planner', '/explorer', '/burndown', '/lifecycle'],
  },
  {
    name: 'Team, Calendar, Governance & Settings',
    tags: '[F13]',
    routes: ['/people', '/calendar', '/journal', '/scheduler', '/settings'],
  },
  {
    name: 'Azure ALM Intelligence & Sprint Progress',
    tags: '[F13]',
    routes: ['/azure-overview', '/azure-builds', '/azure-teams', '/unassigned', '/sprint-progress'],
  },
];

async function assertTabletAndDesktopNavLayout(page: import('@playwright/test').Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const main = page.locator('main#main');
  const mainBox = await main.boundingBox();
  expect(mainBox, 'main#main must have a visible bounding box').not.toBeNull();
  if (!mainBox) return;

  const navVisible = await nav.isVisible().catch(() => false);
  if (!navVisible) {
    // When sidebar navigation is collapsed into a drawer (e.g. Tablet 768px or Mobile 375px),
    // main content must start near the left edge without a hidden 256px sidebar gap.
    expect(
      mainBox.x,
      `Hidden navigation gap detected at ${viewport.width}px: main#main starts at x=${mainBox.x}`
    ).toBeLessThanOrEqual(48);
  } else {
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    if (navBox && viewport.width >= 768) {
      const gap = mainBox.x - (navBox.x + navBox.width);
      expect(
        gap,
        `Unexpected layout gap (${gap}px) between visible sidebar nav and main#main`
      ).toBeLessThanOrEqual(64);
    }
  }
}

test.describe('[Tier 2][@responsive] Responsive Layout & WCAG Accessibility', () => {
  for (const group of ROUTE_GROUPS) {
    test(`${group.tags}[Tier 2][@responsive] Landmarks, non-empty ariaSnapshot, and zero horizontal overflow — ${group.name}`, async ({
      page,
      gotoRoute,
    }) => {
      for (const route of group.routes) {
        await gotoRoute(route);
        await assertLandmarks(page);
        await assertNoHorizontalOverflow(page);
        await assertTabletAndDesktopNavLayout(page);

        const mainSnapshot = await page.locator('main#main').ariaSnapshot();
        expect(
          mainSnapshot.trim().length,
          `main#main ariaSnapshot should be non-empty on ${route}`
        ).toBeGreaterThan(15);

        const nav = page.getByRole('navigation', { name: 'Main navigation' });
        if (await nav.isVisible().catch(() => false)) {
          const navSnapshot = await nav.ariaSnapshot();
          expect(
            navSnapshot.trim().length,
            `Main navigation ariaSnapshot should be non-empty on ${route}`
          ).toBeGreaterThan(15);
        }
      }
    });
  }

  test('[F13][Tier 2][@responsive] Root path and hash fallback resolve cleanly with landmarks and zero overflow', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveURL(/\/(mywork)?(\?.*)?(#.*)?$/);

    await gotoRoute('/#/dashboard');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/dashboard/i);
  });

  test('[F13][F14][Tier 2][@responsive] Navigation drawer / sidebar keyboard traversal, skip link, live announcement, and Escape close', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/mywork');
    const viewport = page.viewportSize();
    const skipLink = page.locator('a[href="#main"]');
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');

    const mainFocusedOrTargeted = await page.evaluate(() => {
      const main = document.getElementById('main');
      const active = document.activeElement;
      return Boolean(
        window.location.hash === '#main' ||
          (main && active && (main === active || main.contains(active)))
      );
    });
    expect(mainFocusedOrTargeted, 'Skip link should target or focus #main').toBe(true);

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const toggle = page.locator('button[aria-expanded][aria-controls]').first();

    if (viewport && viewport.width < 1024) {
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const controlsId = await toggle.getAttribute('aria-controls');
      expect(controlsId, 'Drawer toggle must declare aria-controls').toBeTruthy();

      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(nav).toBeVisible();

      if (controlsId) {
        const controlledEl = page.locator(`#${controlsId}`);
        await expect(controlledEl).toBeVisible();
      }

      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toBeFocused();

      // Re-open via keyboard and traverse to Explorer
      await page.keyboard.press('Enter');
      await expect(nav).toBeVisible();
      const explorerLink = nav.getByRole('link', { name: /explorer/i }).first();
      await explorerLink.click();
      await expect(page).toHaveURL(/\/explorer/);
      await assertLiveAnnouncement(page, /explorer/i);
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);
    } else {
      await expect(nav).toBeVisible();
      const explorerLink = nav.getByRole('link', { name: /explorer/i }).first();
      await explorerLink.focus();
      await expect(explorerLink).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/explorer/);
      await assertLiveAnnouncement(page, /explorer/i);
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);
    }
  });

  test('[F13][F14][Tier 2][@responsive] Modal dialog and global SSE Logs drawer keyboard focus management and Escape close', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/people');
    await assertLandmarks(page);

    const addMemberTrigger = page
      .getByRole('button', { name: /add\s+(member|person)|new\s+member/i })
      .first();
    await expect(addMemberTrigger).toBeVisible();

    const dialog = page.getByRole('dialog').first();
    await assertKeyboardDialogBehavior(page, addMemberTrigger, dialog);

    // Re-open and verify Tab navigates interactive elements inside dialog and Escape dismisses
    await addMemberTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    const stillInsideDialog = await dialog.evaluate((el) => {
      const active = document.activeElement;
      return Boolean(active && (el === active || el.contains(active)));
    });
    expect(stillInsideDialog, 'Tabbing inside an open dialog must stay inside dialog').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(addMemberTrigger).toBeFocused();

    // Verify Global SSE Logs Drawer in header: keyboard open, aria-expanded, Escape close, focus restoration
    const banner = page.getByRole('banner');
    const logsToggle = banner.locator('button[aria-expanded]').filter({
      hasText: /logs/i,
    }).or(banner.getByRole('button', { name: /logs/i })).first();
    await expect(logsToggle).toBeVisible();
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'false');

    const logsControlsId = await logsToggle.getAttribute('aria-controls');
    await logsToggle.focus();
    await expect(logsToggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'true');

    const logsDrawer = logsControlsId
      ? page.locator(`#${logsControlsId}`)
      : page
          .getByRole('dialog', { name: /log/i })
          .or(page.getByRole('complementary', { name: /log/i }))
          .or(page.getByRole('region', { name: /log/i }))
          .first();
    await expect(logsDrawer).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.keyboard.press('Escape');
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(logsDrawer).toBeHidden();
    await expect(logsToggle).toBeFocused();
  });

  test('[F13][F14][Tier 2][@responsive] Interactive controls accessible names and form label associations across all 17 canonical views', async ({
    page,
    gotoRoute,
  }) => {
    for (const route of ALL_CANONICAL_ROUTES) {
      await gotoRoute(route);
      await expect(page.locator('main#main')).toBeVisible();

      const audit = await page.evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const unlabeledInputs: string[] = [];
        const inputs = Array.from(document.querySelectorAll('main input, main select, main textarea'));
        for (const input of inputs) {
          if (!isVisible(input)) continue;
          const htmlInput = input as HTMLInputElement;
          if (htmlInput.type === 'hidden') continue;

          const hasLabelsList = 'labels' in htmlInput && htmlInput.labels && htmlInput.labels.length > 0;
          const hasAriaLabel = Boolean(input.getAttribute('aria-label')?.trim());
          const hasAriaLabelledBy = Boolean(input.getAttribute('aria-labelledby')?.trim());
          const hasWrappingLabel = Boolean(input.closest('label')?.textContent?.trim());

          if (!hasLabelsList && !hasAriaLabel && !hasAriaLabelledBy && !hasWrappingLabel) {
            const nameAttr = input.getAttribute('name') || input.getAttribute('placeholder') || input.tagName;
            unlabeledInputs.push(nameAttr);
          }
        }

        const unnamedControls: string[] = [];
        const controls = Array.from(document.querySelectorAll('header button, header a[href], main button, main a[href]'));
        for (const ctrl of controls) {
          if (!isVisible(ctrl)) continue;
          const text = (ctrl.textContent || '').trim();
          const ariaLabel = (ctrl.getAttribute('aria-label') || '').trim();
          const ariaLabelledBy = (ctrl.getAttribute('aria-labelledby') || '').trim();
          const title = (ctrl.getAttribute('title') || '').trim();
          const imgAlt = ctrl.querySelector('img[alt]')?.getAttribute('alt')?.trim() || '';
          if (!text && !ariaLabel && !ariaLabelledBy && !title && !imgAlt) {
            unnamedControls.push(`${ctrl.tagName.toLowerCase()}.${String(ctrl.className).slice(0, 32)}`);
          }
        }

        return { unlabeledInputs, unnamedControls };
      });

      expect(
        audit.unlabeledInputs,
        `Unlabeled form fields on ${route}: ${audit.unlabeledInputs.join(', ')}`
      ).toEqual([]);
      expect(
        audit.unnamedControls,
        `Interactive controls missing accessible name on ${route}: ${audit.unnamedControls.join(', ')}`
      ).toEqual([]);
    }
  });

  test('[F13][F14][Tier 2][@responsive] Theme switcher (light/dark/system) persists preference and visual contrast across routes and reload', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/mywork');
    const banner = page.getByRole('banner');
    await expect(banner).toBeVisible();

    const getThemeSnapshot = async () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const bodyStyle = window.getComputedStyle(document.body);
        const rootStyle = window.getComputedStyle(root);
        const storageEntries = Object.entries(window.localStorage)
          .filter(([k]) => /theme/i.test(k))
          .map(([, v]) => v);
        return {
          dataTheme: root.getAttribute('data-theme'),
          dataThemePref: root.getAttribute('data-theme-preference'),
          className: root.className,
          colorScheme: rootStyle.colorScheme,
          bodyBg: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          storageValues: storageEntries,
        };
      });

    const themeSelect = banner.getByRole('combobox', { name: /theme/i });
    const themeToggleBtn = banner.getByRole('button', { name: /theme|dark|light|system/i }).first();

    const selectThemeMode = async (mode: 'dark' | 'light' | 'system') => {
      if ((await themeSelect.count()) > 0) {
        await themeSelect.selectOption(mode);
        return;
      }

      const explicitOption = banner
        .getByRole('button', { name: new RegExp(`^${mode}$`, 'i') })
        .or(banner.getByRole('radio', { name: new RegExp(mode, 'i') }));
      if ((await explicitOption.count()) > 0) {
        await explicitOption.first().click();
        return;
      }

      await expect(themeToggleBtn).toBeVisible();
      for (let i = 0; i < 6; i++) {
        const snap = await getThemeSnapshot();
        const label = ((await themeToggleBtn.getAttribute('aria-label')) || (await themeToggleBtn.textContent()) || '').toLowerCase();
        const matchesMode =
          snap.storageValues.some((v) => v.toLowerCase() === mode) ||
          snap.dataThemePref === mode ||
          (mode === 'system' ? snap.dataTheme === 'system' || /\bsystem\b/.test(label) : snap.dataTheme === mode || new RegExp(`\\b${mode}\\b`).test(snap.className));
        if (matchesMode) break;
        await themeToggleBtn.click();
      }
    };

    // 1. Dark mode + navigation + reload persistence
    await selectThemeMode('dark');
    const darkSnap = await getThemeSnapshot();
    expect(
      darkSnap.dataTheme === 'dark' || /\bdark\b/.test(darkSnap.className) || darkSnap.colorScheme.includes('dark'),
      `Expected dark theme attribute or class after switching, got ${JSON.stringify(darkSnap)}`
    ).toBe(true);
    expect(darkSnap.bodyBg).not.toBe(darkSnap.bodyColor);

    await gotoRoute('/dashboard');
    await assertNoHorizontalOverflow(page);
    const afterNavDark = await getThemeSnapshot();
    expect(
      afterNavDark.dataTheme === 'dark' || /\bdark\b/.test(afterNavDark.className)
    ).toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    const afterReloadDark = await getThemeSnapshot();
    expect(
      afterReloadDark.dataTheme === 'dark' || /\bdark\b/.test(afterReloadDark.className)
    ).toBe(true);

    // 2. Light mode + reload persistence
    await selectThemeMode('light');
    const lightSnap = await getThemeSnapshot();
    expect(lightSnap.bodyBg).not.toBe(lightSnap.bodyColor);
    expect(
      lightSnap.dataTheme !== 'dark' && !/\bdark\b/.test(lightSnap.className)
    ).toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    const afterReloadLight = await getThemeSnapshot();
    expect(
      afterReloadLight.dataTheme !== 'dark' && !/\bdark\b/.test(afterReloadLight.className)
    ).toBe(true);

    // 3. System mode + prefers-color-scheme media adaptation + reload persistence
    await page.emulateMedia({ colorScheme: 'dark' });
    await selectThemeMode('system');
    const sysDarkSnap = await getThemeSnapshot();
    expect(
      sysDarkSnap.dataTheme === 'dark' ||
        sysDarkSnap.dataTheme === 'system' ||
        /\bdark\b/.test(sysDarkSnap.className) ||
        sysDarkSnap.storageValues.some((v) => /system/i.test(v)),
      `Expected system theme to reflect dark preference or system state, got ${JSON.stringify(sysDarkSnap)}`
    ).toBe(true);
    expect(sysDarkSnap.bodyBg).not.toBe(sysDarkSnap.bodyColor);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    const afterReloadSysDark = await getThemeSnapshot();
    expect(
      afterReloadSysDark.dataTheme === 'dark' ||
        afterReloadSysDark.dataTheme === 'system' ||
        /\bdark\b/.test(afterReloadSysDark.className) ||
        afterReloadSysDark.storageValues.some((v) => /system/i.test(v))
    ).toBe(true);

    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    const sysLightSnap = await getThemeSnapshot();
    expect(sysLightSnap.bodyBg).not.toBe(sysLightSnap.bodyColor);
    expect(
      sysLightSnap.dataTheme !== 'dark' && !/\bdark\b/.test(sysLightSnap.className)
    ).toBe(true);
  });
});
