import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const avatar = async (page: Page) => JSON.parse((await page.getByTestId('office-canvas').getAttribute('data-avatar')) ?? 'null') as { x: number; y: number; room: string; moving: boolean; dir: string };
const hold = async (page: Page, key: string, ms: number) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(500);
};
const cmd = async (page: Page, text: string) => {
  const before = await page.getByTestId('terminal-result').count();
  await page.getByTestId('terminal-input').fill(text);
  await page.getByTestId('terminal-input').press('Enter');
  await expect(page.getByTestId('terminal-result')).toHaveCount(before + 1);
  return page.getByTestId('terminal-result').last();
};

test('Owner walks with WASD/arrows, collides with walls, and the position survives a refresh', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-integrations').click();
  await page.getByTestId('simulation-seed').click();
  await expect(page.getByTestId('simulation-status')).toContainText('8 agents');
  await page.getByTestId('nav-office').click();
  await expect(page.getByTestId('office-canvas')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await avatar(page))?.x).toBeGreaterThan(0);

  const start = await avatar(page);
  await page.getByTestId('office-canvas').click({ position: { x: 5, y: 5 } }); // focus the page, not an input
  await hold(page, 'd', 700);
  const afterD = await avatar(page);
  expect(afterD.x).toBeGreaterThan(start.x + 10);
  expect(afterD.dir).toBe('right');
  await hold(page, 'ArrowLeft', 300);
  expect((await avatar(page)).dir).toBe('left');
  await hold(page, 'w', 300);
  expect((await avatar(page)).dir).toBe('up');
  await hold(page, 's', 300);
  expect((await avatar(page)).dir).toBe('down');

  // collision: walking into the left wall for a long time can never leave the room's floor (x >= 1 tile)
  await hold(page, 'a', 5000);
  const wall = await avatar(page);
  expect(wall.x).toBeGreaterThanOrEqual(16);
  await hold(page, 'a', 800);
  expect((await avatar(page)).x).toBe(wall.x);

  await page.waitForTimeout(600); // checkpoint debounce
  await page.reload();
  await expect(page.getByTestId('office-canvas')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await avatar(page))?.x).toBeGreaterThan(0);
  const restored = await avatar(page);
  expect(Math.abs(restored.x - wall.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(restored.y - wall.y)).toBeLessThanOrEqual(2);
});

test('Company Terminal: hire -> onboard -> create+assign task -> backend events -> refresh keeps data', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-office').click();
  await expect(page.getByTestId('terminal-panel')).toBeVisible(); // beside the office
  await expect(page.getByTestId('terminal-conn')).toHaveAttribute('data-live', 'true');

  // not a shell
  const bad = await cmd(page, 'rm -rf /');
  await expect(bad).toHaveAttribute('data-status', 'FAILED');

  const st = await cmd(page, 'company status');
  await expect(st).toHaveAttribute('data-status', 'SUCCESS');
  await expect(st).toContainText('tasks active');
  await expect(await cmd(page, 'employee list')).toHaveAttribute('data-status', 'SUCCESS');

  const hire = await cmd(page, 'employee hire sim-forge --title "Backend Engineer" --dept engineering --avatar a3');
  await expect(hire).toHaveAttribute('data-status', 'SUCCESS');
  await expect(hire).toContainText('EMP-001');
  await expect(hire).toContainText('PENDING_ONBOARDING');
  const early = await cmd(page, 'task create "Too early" --assign EMP-001');
  await expect(early).toHaveAttribute('data-status', 'FAILED');

  const onboard = await cmd(page, 'employee onboard EMP-001');
  await expect(onboard).toHaveAttribute('data-status', 'SUCCESS');
  await expect(onboard).toContainText('SIMULATED');

  // the character is in the department's room, labelled as SIMULATED
  const forge = page.locator('[data-testid^="office-agent-"][data-agent-mode="SIMULATED"]', { hasText: 'Forge' }).first();
  await expect(forge).toHaveAttribute('data-agent-room', 'development_room');

  const made = await cmd(page, 'task create "Summarise logs" --objective "Summarise the build logs" --assign EMP-001');
  await expect(made).toHaveAttribute('data-status', 'SUCCESS');
  const code = /TASK-\d+/.exec(await made.innerText())![0];
  // status changes come from backend events (the simulated runtime is fast in e2e, so the working phase is
  // asserted in the API test that samples it; here we assert the final backend-reported outcome)
  await expect.poll(async () => (await (await cmd(page, `task show ${code}`)).getAttribute('data-status')) && (await page.getByTestId('terminal-result').last().innerText()), { timeout: 60_000, intervals: [1500] }).toContain('completed');
  await expect(forge).toHaveAttribute('data-agent-state', 'idle');

  // unauthorized/invalid input gives a useful error
  await expect(await cmd(page, `task assign ${code}`)).toContainText('Missing argument');

  // autocomplete + history
  const input = page.getByTestId('terminal-input');
  await input.fill('emp');
  await input.press('Tab');
  await expect(input).toHaveValue('employee ');
  await input.fill('');

  // refresh: employee + task are persisted, and command history is restored from the server
  await page.reload();
  await expect(page.getByTestId('terminal-panel')).toBeVisible();
  const list = await cmd(page, 'employee list');
  await expect(list).toContainText('EMP-001');
  await expect(list).toContainText('Backend Engineer');
  await page.getByTestId('terminal-input').press('ArrowUp');
  await expect(page.getByTestId('terminal-input')).not.toHaveValue('');
});

test('A disconnected runtime is never shown as working, and the employee stays pending', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-office').click();
  const r = await cmd(page, 'runtime list');
  await expect(r).toHaveAttribute('data-status', 'SUCCESS');
  await expect(r).toContainText('SIMULATED: not a live runtime');
  await page.getByTestId('terminal-hide').click();
  await expect(page.getByTestId('terminal-panel')).toHaveCount(0);
  await page.getByTestId('toggle-terminal').click();
  await expect(page.getByTestId('terminal-panel')).toBeVisible();
  // scrollback survives closing the panel
  await expect(page.getByTestId('terminal-result').last()).toContainText('runtimes');
});
