import { test, expect, type Page } from '@playwright/test';
import { ADMIN } from './instance';

async function fits(page: Page) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - width,
      controls: [...document.querySelectorAll('button, input, select, textarea, a')]
        .filter((element) => {
          const r = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return r.width > 0 && style.visibility !== 'hidden' &&
            (r.left < -1 || r.right > width + 1);
        }).map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim()),
    };
  });
  expect(result).toEqual({ overflow: 0, controls: [] });
}

test('Insulam themes preserve user choice and mobile actions fit at narrow widths', async ({ page }, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name !== 'desktop', 'Explicit viewport matrix runs once.');
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const before = (await (await page.request.get(`/api/users/${user.id}/preferences`)).json()).preferences;
  try {
    for (const [themeId, bg] of [['insulam-night', '16 14 20'], ['insulam-day', '243 234 218']]) {
      expect((await page.request.put(`/api/users/${user.id}/preferences`, {
        data: { themeId, fontId: 'insulam' },
      })).ok()).toBe(true);
      for (const width of [320, 360, 390, 412]) {
        await page.setViewportSize({ width, height: 844 });
        for (const path of ['/dashboard', '/characters']) {
          await page.goto(path);
          await expect(page.locator('h1')).toBeVisible();
          await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--rgb-bg-base'))).toBe(bg);
          await page.evaluate(() => document.fonts.ready);
          await fits(page);
          const label = path === '/dashboard' ? 'Create Campaign' : 'Create Character';
          await page.getByRole('button', { name: label, exact: true }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await fits(page);
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          await expect(page.getByRole('dialog')).toBeHidden();
        }
      }
      await page.reload();
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--rgb-bg-base'))).toBe(bg);
    }
  } finally {
    // This test only runs in the disposable CI instance.
    await page.request.put(`/api/users/${user.id}/preferences`, {
      data: { themeId: before.themeId ?? 'cozy-default', fontId: before.fontId ?? 'default' },
    });
  }
});
