import { expect, test } from '@playwright/test';
import { agentIdByHandle, login } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('SIMULATED demo team is clearly labelled and separate from REAL agents', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-overview').click();
  const realBefore = Number(await page.getByTestId('stat-real').locator('p').nth(1).innerText());
  await page.getByTestId('nav-integrations').click();
  await page.getByTestId('simulation-seed').click();
  await expect(page.getByTestId('simulation-status')).toContainText('8 agents');

  await page.getByTestId('nav-agents').click();
  const rows = page.locator('[data-testid^="agent-row-"]');
  await expect(rows).toHaveCount(realBefore + 8);
  // every simulated row carries the SIMULATED badge, and real rows never do
  const simRows = page.locator('[data-testid^="agent-row-"]:has([data-testid="mode-SIMULATED"])');
  await expect(simRows).toHaveCount(8);
  await expect(page.locator('[data-testid^="agent-row-"]:has([data-testid="mode-REAL"]):has([data-testid="mode-SIMULATED"])')).toHaveCount(0);

  await page.getByTestId('nav-overview').click();
  await expect(page.getByTestId('stat-sim').locator('p').nth(1)).toHaveText('8');
  await expect(page.getByTestId('stat-real').locator('p').nth(1)).toHaveText(String(realBefore));
});

test('a simulated task runs on the scripted runtime and shows in the office as SIMULATED', async ({ page }) => {
  await login(page);
  const id = await (async () => {
    await page.goto('/agents');
    const row = page.locator('[data-testid^="agent-row-"]:has([data-testid="mode-SIMULATED"])').first();
    await expect(row).toBeVisible();
    return (await row.getAttribute('data-testid'))!.replace('agent-row-', '');
  })();
  await expect(page.getByTestId(`agent-state-${id}`)).toHaveAttribute('data-state', /idle|registered|working/, { timeout: 30_000 });
  await page.getByTestId('nav-tasks').click();
  await page.getByTestId('task-create').click();
  await page.getByTestId('task-title').fill('Draft the release notes');
  await page.getByTestId('task-objective').fill('Write release notes for v1.');
  await page.getByTestId('task-assignee').selectOption(id);
  await expect(page.getByText('This agent is SIMULATED')).toBeVisible();
  await page.getByTestId('create-task-submit').click();
  await expect(page.getByTestId('task-detail-status')).toHaveText('Completed', { timeout: 60_000 });
  await expect(page.getByTestId('task-detail').getByTestId('mode-SIMULATED').first()).toBeVisible();

  await page.getByTestId('nav-office').click();
  await page.getByTestId('filter-REAL').click();
  await expect(page.getByTestId(`office-agent-${id}`)).toHaveCount(0); // REAL-only view hides simulated characters
  await page.getByTestId('filter-SIMULATED').click();
  await expect(page.getByTestId(`office-agent-${id}`)).toHaveAttribute('data-agent-mode', 'SIMULATED');
});

test('office renders (WebGL canvas), selecting a character opens its panel, WASD avatar toggles', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-office').click();
  await expect(page.getByTestId('office-canvas')).toHaveAttribute('data-ready', 'true');
  const canvas = page.getByTestId('office-canvas').locator('canvas');
  await expect(canvas).toBeVisible();
  const first = page.locator('[data-testid^="office-agent-"]').first();
  await first.dispatchEvent('click');
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  await page.getByTestId('toggle-avatar').check();
  await page.keyboard.press('d');
  await page.getByTestId('toggle-table').click();
  await expect(page.getByTestId('office-table')).toBeVisible();
  await page.screenshot({ path: 'test-results/office-table.png' });
  await page.getByTestId('toggle-table').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/office.png' });
});

test('simulated data can be removed completely', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-integrations').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('simulation-clear').click();
  await expect(page.getByTestId('simulation-status')).toContainText('No simulated data');
  await page.getByTestId('nav-agents').click();
  await expect(page.locator('[data-testid^="agent-row-"]:has([data-testid="mode-SIMULATED"])')).toHaveCount(0);
  void agentIdByHandle;
});

test('foundation-only modules say so instead of faking features', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-projects').click();
  await expect(page.getByTestId('foundation-notice')).toBeVisible();
  await page.getByTestId('nav-hive').click();
  await expect(page.getByTestId('foundation-notice')).toBeVisible();
});
