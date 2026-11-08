import { expect, type Page } from '@playwright/test';

export const OWNER = { username: 'owner', password: 'correct-horse-battery-staple' };

export async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('login-form')).toBeVisible();
  await page.getByTestId('login-username').fill(OWNER.username);
  await page.getByTestId('login-password').fill(OWNER.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('current-user')).toBeVisible();
}

export async function agentIdByHandle(page: Page, handle: string): Promise<string> {
  await page.getByTestId('nav-agents').click();
  const row = page.locator(`[data-testid^="agent-row-"][data-agent-handle="${handle}"]`);
  await expect(row).toBeVisible();
  return (await row.getAttribute('data-testid'))!.replace('agent-row-', '');
}

export async function actorsOf(page: Page): Promise<Record<string, { room: string; walking: boolean; pose: string }>> {
  const raw = await page.getByTestId('office-canvas').getAttribute('data-actors');
  const arr = raw ? (JSON.parse(raw) as { id: string; room: string; walking: boolean; pose: string }[]) : [];
  return Object.fromEntries(arr.map((a) => [a.id, a]));
}
