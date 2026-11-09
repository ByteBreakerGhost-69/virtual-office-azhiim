import type { CommandMeta, CommandStatus, EventSource, TerminalView, UserRole } from '@avo/shared';
import type { AppContext } from '../../context.js';
import type { EmployeeService } from '../employees/employee-service.js';
import type { TaskService } from '../tasks/task-service.js';

/** What a handler receives. Handlers never see raw input text, only validated args. */
export interface CommandContext {
  c: AppContext;
  workspaceId: string;
  userId: string;
  role: UserRole;
  traceId: string;
  source: EventSource;
  employees: EmployeeService;
  tasks: TaskService;
  /** all registered commands (for `help`) */
  registry: readonly CommandDef[];
}

export interface Invocation {
  args: string[];
  flags: Record<string, string | true>;
}

export interface Outcome {
  status?: CommandStatus;
  message: string;
  data?: unknown;
  view?: TerminalView;
  approvalId?: string;
}

export interface CommandDef extends CommandMeta {
  run(ctx: CommandContext, inv: Invocation): Promise<Outcome>;
}

export const flag = (inv: Invocation, name: string): string | undefined => {
  const v = inv.flags[name];
  return typeof v === 'string' ? v : undefined;
};
export const has = (inv: Invocation, name: string): boolean => inv.flags[name] !== undefined;
export const table = (columns: string[], rows: string[][]): TerminalView => ({ kind: 'table', columns, rows });
export const kv = (pairs: [string, string][]): TerminalView => ({ kind: 'kv', pairs: pairs.map(([key, value]) => ({ key, value })) });
