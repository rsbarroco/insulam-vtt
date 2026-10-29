import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN } from './instance';

const SOURCE = 'https://character-maker.example.test';

async function enableFixture(context: BrowserContext) {
  await context.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = await response.json() as Record<string, unknown>;
    await route.fulfill({ response, json: { ...config, characterMaker: { origin: SOURCE } } });
  });
  // This is a synthetic browser protocol fixture, NOT the private source API
  // or a test of its account/session/ownership implementation.
  await context.route(`${SOURCE}/vtt/connect?**`, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <html lang="en"><title>Synthetic CharacterMaker consent</title><body>
      <button id="consent">Send synthetic read-only snapshot</button>
      <script>
        document.getElementById('consent').onclick = () => {
          const search = new URL(location.href).searchParams;
          opener.postMessage(JSON.stringify({
            type: 'insulam.character.projection', version: 1, state: search.get('state'),
            character: {schemaVersion: 1, readOnly: true, characterId: 'synthetic-link-qa',
              displayName: 'Link QA Adventurer', hp: {current: 7, max: 12}, defense: 14, initiative: 2}
          }), search.get('origin'));
        };
      </script></body></html>` });
  });
}

async function openCharacters(page: Page) {
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/characters');
  await expect(page.getByRole('heading', { name: 'CharacterMaker — read-only snapshot preview' })).toBeVisible();
}

test('receives an explicitly consented snapshot across two browser origins without saving it', async ({ page, context }) => {
  await enableFixture(context);
  await openCharacters(page);
  const writes: string[] = [];
  page.on('request', (request) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open CharacterMaker', exact: true }).click();
  const popup = await popupPromise;
  await expect(page.getByText(/Waiting for your approval in CharacterMaker/)).toBeVisible();
  await popup.getByRole('button', { name: 'Send synthetic read-only snapshot' }).click();
  const snapshot = page.getByRole('region', { name: 'CharacterMaker snapshot' });
  await expect(snapshot).toContainText('Link QA Adventurer');
  await expect(snapshot).toContainText('7 / 12');
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('synthetic-link-qa');
  await page.getByRole('button', { name: 'Remove snapshot' }).click();
  await expect(snapshot).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'CharacterMaker snapshot' })).toHaveCount(0);
});

test('shows a recoverable message when the browser refuses a popup', async ({ page, context }) => {
  await enableFixture(context);
  await page.addInitScript(() => { window.open = () => null; });
  await openCharacters(page);
  await page.getByRole('button', { name: 'Open CharacterMaker', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/popup/i);
  await expect(page.getByRole('button', { name: 'Open CharacterMaker', exact: true })).toBeEnabled();
});
