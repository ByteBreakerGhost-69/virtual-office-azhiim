import type { UserRole } from './enums.js';

export const ACTIONS = [
  'view',
  'agent.manage',
  'task.create',
  'task.cancel',
  'run.control',
  'approval.decide',
  'integration.manage',
  'settings.manage',
  'control.emergency',
  'simulation.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<UserRole, readonly Action[]> = {
  OWNER: ACTIONS,
  OPERATOR: ['view', 'task.create', 'task.cancel', 'run.control', 'approval.decide'],
  OBSERVER: ['view'],
};

/** Single source of truth for RBAC. Backend enforces it; UI only uses it to hide controls. */
export function can(role: UserRole, action: Action): boolean {
  return MATRIX[role].includes(action);
}
