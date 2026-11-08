import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { actorsOf, agentIdByHandle, login, OWNER } from './helpers.js';

/**
 * The thin end-to-end slice with a REAL-mode integration:
 * register agent -> create + assign task -> runtime runs it -> status changes from runtime data -> visible in the pixel office.
 * The runtime here is the Hermes API *contract test double* (a test tool, not Hermes).
 */
test.describe.configure({ mode: 'serial' });

test('first run: create the Owner account and see an honest empty office', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('setup-form')).toBeVisible();
  await page.getByTestId('setup-username').fill(OWNER.username);
  await page.getByTestId('setup-password').fill(OWNER.password);
  await page.getByTestId('setup-confirm').fill(OWNER.password);
  await page.getByTestId('setup-submit').click();
  await expect(page.getByTestId('current-user')).toContainText('Owner');
  await page.getByTestId('nav-office').click();
  await expect(page.getByText('The office is empty because no agent is registered.')).toBeVisible();
});

test('language switch + audio is off by default', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('toggle-music')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('language-switch').selectOption('id');
  await expect(page.getByTestId('nav-agents')).toContainText('Agen');
  await page.getByTestId('language-switch').selectOption('en');
  await expect(page.getByTestId('nav-agents')).toContainText('Agents');
});

test('register a REAL Hermes agent and run a task through the runtime', async ({ page }) => {
  await login(page);

  // integration
  await page.getByTestId('nav-integrations').click();
  await page.getByTestId('integration-add').click();
  await page.getByTestId('int-name').fill('Hermes (contract double)');
  await page.getByTestId('int-url').fill('http://127.0.0.1:8643');
  await page.getByTestId('int-secret').fill('e2e-double-key');
  await page.getByTestId('int-submit').click();
  const card = page.locator('[data-testid^="integration-"][data-integration-mode="REAL"]').first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Check now' }).click();
  await expect(card).toHaveAttribute('data-integration-status', 'connected');
  await expect(card).not.toContainText('e2e-double-key'); // secrets are never shown

  // agent
  await page.getByTestId('nav-agents').click();
  await page.getByTestId('agent-register').click();
  await page.getByTestId('reg-integration').selectOption({ index: 1 });
  await page.getByTestId('reg-runtimeref').fill('default');
  await page.getByTestId('reg-name').fill('Atlas');
  await page.getByTestId('reg-handle').fill('atlas');
  await page.getByTestId('reg-title').fill('Research Engineer');
  await page.getByTestId('reg-dept').selectOption({ label: 'Research' });
  await page.getByTestId('reg-submit').click();
  const id = await agentIdByHandle(page, 'atlas');
  // state comes from the runtime health check, not from the UI
  await expect(page.getByTestId(`agent-state-${id}`)).toHaveAttribute('data-state', 'idle', { timeout: 40_000 });

  // task
  await page.getByTestId('nav-tasks').click();
  await page.getByTestId('task-create').click();
  await page.getByTestId('task-title').fill('Summarise the weekly report');
  await page.getByTestId('task-objective').fill('Write a short summary of the weekly report.');
  await page.getByTestId('task-assignee').selectOption(id);
  await page.getByTestId('create-task-submit').click();

  await expect(page.getByTestId('task-detail')).toBeVisible();
  // working state is observed from the runtime while the run is in flight
  await page.getByTestId('nav-office').click();
  const btn = page.getByTestId(`office-agent-${id}`);
  await expect(btn).toHaveAttribute('data-agent-state', /working|thinking/, { timeout: 30_000 });
  await expect(btn).toHaveAttribute('data-agent-mode', 'REAL');
  await expect.poll(async () => (await actorsOf(page))[id]?.room).toBe('research_room');

  await page.getByTestId('nav-tasks').click();
  await expect(page.locator('[data-testid^="task-row-"]').first()).toHaveAttribute('data-task-status', 'completed', { timeout: 60_000 });

  // click the character's list button -> detail panel
  await page.getByTestId('nav-office').click();
  await page.getByTestId(`office-agent-${id}`).dispatchEvent('click');
  const panel = page.getByTestId('agent-panel');
  await expect(panel).toContainText('Atlas');
  await expect(panel).toContainText('Research Engineer');
  await expect(panel.getByTestId('mode-REAL')).toBeVisible();
  await expect(panel.getByTestId('agent-activity')).toContainText(/./);
});

test('a REAL approval gate blocks until the owner decides; reject fails the task', async ({ page }) => {
  await login(page);
  const id = await agentIdByHandle(page, 'atlas');
  await expect(page.getByTestId(`agent-state-${id}`)).toHaveAttribute('data-state', 'idle', { timeout: 40_000 });
  await page.getByTestId('nav-tasks').click();
  await page.getByTestId('task-create').click();
  await page.getByTestId('task-title').fill('Delete stale records');
  await page.getByTestId('task-objective').fill('delete stale records from the staging bucket');
  await page.getByTestId('task-assignee').selectOption(id);
  await page.getByTestId('create-task-submit').click();

  await page.getByTestId('nav-approvals').click();
  const reject = page.locator('[data-testid^="approval-reject-"]').first();
  await expect(reject).toBeVisible({ timeout: 40_000 });
  await reject.click(); // no reason yet -> must be refused client-side
  await expect(page.getByText('Enter a reason to reject.')).toBeVisible();
  await page.locator('[data-testid^="approval-reason-"]').first().fill('Too risky for staging');
  await reject.click();
  await expect(page.locator('[data-approval-status="rejected"]').first()).toBeVisible();
  await page.getByTestId('nav-tasks').click();
  await expect(page.locator('[data-testid^="task-row-"][data-task-status="failed"]').first()).toBeVisible({ timeout: 40_000 });
  // regression: after a rejected approval the agent must go back to idle (never stay "thinking" without a run)
  await page.getByTestId('nav-agents').click();
  await expect(page.getByTestId(`agent-state-${id}`)).toHaveAttribute('data-state', 'idle', { timeout: 20_000 });
});

test('when the runtime disappears the office stops claiming the agent is working', async ({ page }) => {
  await login(page);
  // a second runtime instance that we can kill
  const proc: ChildProcess = spawn('npx', ['tsx', '../../packages/adapters/src/testing/cli.ts'], { env: { ...process.env, HERMES_DOUBLE_PORT: '8644', HERMES_DOUBLE_KEY: 'k2', HERMES_DOUBLE_STEP_MS: '300' }, stdio: 'ignore', detached: true });
  try {
    await new Promise((r) => setTimeout(r, 4000));
    await page.getByTestId('nav-integrations').click();
    await page.getByTestId('integration-add').click();
    await page.getByTestId('int-name').fill('Second runtime');
    await page.getByTestId('int-url').fill('http://127.0.0.1:8644');
    await page.getByTestId('int-secret').fill('k2');
    await page.getByTestId('int-submit').click();
    const card = page.locator('[data-integration-mode="REAL"]', { hasText: 'Second runtime' });
    await card.getByRole('button', { name: 'Check now' }).click();
    await expect(card).toHaveAttribute('data-integration-status', 'connected');

    await page.getByTestId('nav-agents').click();
    await page.getByTestId('agent-register').click();
    await page.getByTestId('reg-integration').selectOption({ label: 'Second runtime (Hermes Agent)' });
    await page.getByTestId('reg-name').fill('Nova');
    await page.getByTestId('reg-handle').fill('nova');
    await page.getByTestId('reg-title').fill('Ops Agent');
    await page.getByTestId('reg-submit').click();
    const id = await agentIdByHandle(page, 'nova');
    await expect(page.getByTestId(`agent-state-${id}`)).toHaveAttribute('data-state', 'idle', { timeout: 40_000 });

    process.kill(-proc.pid!, 'SIGKILL');
    // never keeps "idle"/"working": downgraded to unknown/offline by the backend
    await expect(page.getByTestId(`agent-state-${id}`)).toHaveAttribute('data-state', /unknown|offline/, { timeout: 90_000 });
    await page.getByTestId('nav-office').click();
    await expect(page.getByTestId(`office-agent-${id}`)).toHaveAttribute('data-agent-state', /unknown|offline/);
    await expect(page.getByTestId(`office-agent-${id}`)).not.toHaveAttribute('data-agent-pose', /working|thinking|meeting/);
  } finally {
    try { process.kill(-proc.pid!, 'SIGKILL'); } catch { /* already gone */ }
  }
});
