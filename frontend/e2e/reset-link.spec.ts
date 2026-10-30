import { expect, test } from '@playwright/test';

test('a synthetic recovery fragment stays out of HTTP requests and browser history', async ({ page }) => {
  const token = 'd'.repeat(64);
  const requests: string[] = [];
  page.on('request', request => {
    requests.push(request.url(), request.headers()['referer'] || '');
  });
  await page.goto('/auth/login');
  await page.goto('/reset-password#token=' + token);
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  expect(requests.every(value => !value.includes(token))).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Invalid link' })).toBeVisible();
  await page.goto('/auth/login');
  await page.goBack();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole('heading', { name: 'Invalid link' })).toBeVisible();
  expect(requests.every(value => !value.includes(token))).toBe(true);
});

