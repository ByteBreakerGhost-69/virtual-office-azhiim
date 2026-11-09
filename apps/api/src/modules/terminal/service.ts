import { booleanFlagNames, can, parseInput, redactInput, resolveCommand, type CommandHistoryEntry, type CommandResult, type CommandStatus, type UserRole } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../lib/errors.js';
import { newId } from '../../lib/util.js';
import { EmployeeService } from '../employees/employee-service.js';
import { TaskService } from '../tasks/task-service.js';
import { metaOf, REGISTRY } from './registry.js';
import type { CommandContext, CommandDef } from './types.js';

const BOOL_FLAGS = booleanFlagNames(REGISTRY.map(metaOf));

/** Nearest registered command names for "did you mean" (simple prefix/edit-free heuristic; no guessing of intent). */
function suggest(words: string[]): string[] {
  const first = words[0]?.toLowerCase();
  if (!first) return [];
  const group = REGISTRY.filter((d) => d.path[0] === first);
  const pool = group.length ? group : REGISTRY.filter((d) => d.path[0]!.startsWith(first.slice(0, 2)));
  return pool.slice(0, 5).map((d) => d.path.join(' '));
}

export class TerminalService {
  constructor(private readonly ctx: () => AppContext) {}

  private validate(def: CommandDef, args: string[], flags: Record<string, string | true>): string | null {
    const required = def.args.filter((a) => a.required).length;
    if (args.length < required) return `Missing argument <${def.args[args.length]!.name}>. Usage: ${def.usage}`;
    if (args.length > def.args.length) return `Too many arguments (got ${args.length}, expected ${def.args.length}). Quote values that contain spaces. Usage: ${def.usage}`;
    for (const [name, value] of Object.entries(flags)) {
      const f = def.flags.find((x) => x.name === name);
      if (!f) return `Unknown flag --${name}. Usage: ${def.usage}`;
      if (!f.boolean && value === true) return `Flag --${name} needs a value. Usage: ${def.usage}`;
      if (f.boolean && value !== true) return `Flag --${name} takes no value`;
      if (f.values && typeof value === 'string' && !f.values.includes(value)) return `--${name} must be one of: ${f.values.join(', ')}`;
    }
    const missing = def.flags.find((f) => f.required && flags[f.name] === undefined);
    if (missing) return `Missing --${missing.name}. Usage: ${def.usage}`;
    return null;
  }

  async execute(workspaceId: string, user: { userId: string; role: UserRole }, rawInput: string): Promise<CommandResult> {
    const c = this.ctx();
    const started = Date.now();
    const traceId = newId();
    const executionId = newId();
    const input = redactInput(rawInput.trim());
    let def: CommandDef | null = null;
    let auditId: string | null = null;
    let out: { status: CommandStatus; message: string; data?: unknown; view?: CommandResult['view']; approvalId?: string };

    try {
      const parsed = parseInput(rawInput, BOOL_FLAGS);
      if (parsed.error) throw new ApiError('validation_error', parsed.error);
      const hit = resolveCommand(REGISTRY, parsed.words);
      if (!hit) {
        const s = suggest(parsed.words);
        out = { status: 'FAILED', message: `Unknown command "${parsed.words.slice(0, 3).join(' ')}". This terminal only runs registered company commands (it is not a shell).${s.length ? ` Did you mean: ${s.join(' | ')}?` : ''} Type "help".` };
      } else {
        def = hit.command;
        const problem = this.validate(def, hit.positionals, parsed.flags);
        if (!can(user.role, def.action)) {
          out = { status: 'REJECTED', message: `Permission denied: role ${user.role} cannot run "${def.path.join(' ')}" (requires ${def.action}).` };
          auditId = await c.audit.log({ workspaceId, actorUserId: user.userId, action: 'terminal.denied', entity: 'command', entityId: def.name, traceId, details: { source: 'CLI', input, role: user.role, requires: def.action } });
        } else if (problem) {
          out = { status: 'FAILED', message: problem };
        } else {
          const cctx: CommandContext = { c, workspaceId, userId: user.userId, role: user.role, traceId, source: { kind: 'user', ref: user.userId }, employees: new EmployeeService(this.ctx), tasks: new TaskService(this.ctx), registry: REGISTRY };
          const o = await def.run(cctx, { args: hit.positionals, flags: parsed.flags });
          out = { status: o.status ?? 'SUCCESS', message: o.message, ...(o.data !== undefined ? { data: o.data } : {}), ...(o.view ? { view: o.view } : {}), ...(o.approvalId ? { approvalId: o.approvalId } : {}) };
          if (def.mutating) auditId = await c.audit.log({ workspaceId, actorUserId: user.userId, action: `terminal.${def.name}`, entity: 'command', entityId: executionId, traceId, details: { source: 'CLI', input, status: out.status } });
        }
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Internal error while running the command (see server log)';
      if (!(err instanceof ApiError)) c.log.error({ err, traceId }, 'terminal command crashed');
      out = { status: 'FAILED', message };
      if (def?.mutating) auditId = await c.audit.log({ workspaceId, actorUserId: user.userId, action: `terminal.${def.name}.failed`, entity: 'command', entityId: executionId, traceId, details: { source: 'CLI', input, error: message } }).catch(() => null);
    }

    const durationMs = Date.now() - started;
    await c.db.commandExecution.create({ data: { id: executionId, workspaceId, userId: user.userId, input, command: def?.name ?? null, status: out.status, message: out.message.slice(0, 2000), durationMs, auditId, traceId } });
    return { executionId, command: def?.name ?? null, status: out.status, message: out.message, ...(out.data !== undefined ? { data: out.data } : {}), ...(out.view ? { view: out.view } : {}), requiresApproval: out.status === 'PENDING_APPROVAL', ...(out.approvalId ? { approvalId: out.approvalId } : {}), auditId, traceId, durationMs };
  }

  async history(workspaceId: string, userId: string, limit = 100): Promise<CommandHistoryEntry[]> {
    const rows = await this.ctx().db.commandExecution.findMany({ where: { workspaceId, userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.min(limit, 500) });
    return rows.reverse().map((r) => ({ id: r.id, input: r.input, command: r.command, status: r.status as CommandStatus, message: r.message, createdAt: r.createdAt.toISOString() }));
  }
}
