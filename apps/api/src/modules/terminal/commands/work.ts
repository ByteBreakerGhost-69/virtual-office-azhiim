import { PRIORITIES, TASK_STATUSES, type TaskDTO } from '@avo/shared';
import { conflict, notFound } from '../../../lib/errors.js';
import type { CommandDef } from '../types.js';
import { flag, kv, table } from '../types.js';

const TASK_COLS = ['code', 'title', 'status', 'priority', 'assignee', 'mode'];
const trow = (t: TaskDTO): string[] => [t.code ?? t.id.slice(0, 8), t.title, t.status, t.priority, t.assigneeName ?? '-', t.mode];

export const workCommands: CommandDef[] = [
  {
    name: 'task.list', path: ['task', 'list'], summary: 'List tasks', usage: 'task list [--status <s>] [--employee <EMP>]', example: 'task list --status running',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [{ name: 'status', summary: 'task status', values: TASK_STATUSES }, { name: 'employee', summary: 'assignee', ref: 'employee' }],
    async run({ c, workspaceId, employees }, inv) {
      const emp = flag(inv, 'employee') ? await employees.resolve(workspaceId, flag(inv, 'employee')!) : null;
      const status = flag(inv, 'status');
      const rows = await c.db.task.findMany({
        where: { workspaceId, ...(status ? { status: status as never } : {}), ...(emp ? { assigneeAgentId: emp.id } : {}) },
        orderBy: { createdAt: 'desc' }, take: 50, include: { assignee: { select: { name: true } } },
      });
      return { message: `${rows.length} tasks${rows.length === 50 ? ' (latest 50)' : ''}`, data: rows.map((t) => ({ id: t.id, code: t.taskNumber, title: t.title, status: t.status })), view: table(TASK_COLS, rows.map((t) => [t.taskNumber ? `TASK-${String(t.taskNumber).padStart(3, '0')}` : t.id.slice(0, 8), t.title, t.status, t.priority, t.assignee?.name ?? '-', t.mode])) };
    },
  },
  {
    name: 'task.show', path: ['task', 'show'], summary: 'Show one task with its latest run and events', usage: 'task show <task>', example: 'task show TASK-001',
    action: 'view', risk: 'low', mutating: false, args: [{ name: 'task', required: true, summary: 'TASK code', ref: 'task' }], flags: [],
    async run({ c, workspaceId, tasks }, inv) {
      const t = await tasks.resolve(workspaceId, inv.args[0]!);
      const [run, events] = await Promise.all([
        c.db.run.findFirst({ where: { taskId: t.id }, orderBy: { createdAt: 'desc' } }),
        c.db.activityEvent.findMany({ where: { workspaceId, taskId: t.id }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 5 }),
      ]);
      const code = t.taskNumber ? `TASK-${String(t.taskNumber).padStart(3, '0')}` : t.id.slice(0, 8);
      return {
        message: `${code}: ${t.title} [${t.status}]`,
        data: { id: t.id, code, status: t.status, runState: run?.state ?? null, runId: run?.id ?? null },
        view: kv([
          ['task', `${code} · ${t.title}`], ['status', t.status], ['priority', t.priority], ['mode', t.mode], ['assignee', t.assignee?.name ?? 'unassigned'],
          ['objective', t.objective], ['run', run ? `${run.state}${run.failureReason ? ` · ${run.failureReason}` : ''}` : 'no run yet'],
          ['recent events', events.map((e) => `${e.occurredAt.toISOString().slice(11, 19)} ${e.summary}`).join('\n') || 'none'],
        ]),
      };
    },
  },
  {
    name: 'task.create', path: ['task', 'create'], summary: 'Create a task; add --assign to hand it to an employee immediately', usage: 'task create "<title>" [--objective <text>] [--assign <EMP>] [--priority <p>]', example: 'task create "Fix login bug" --objective "Reproduce and fix the 500" --assign EMP-001',
    action: 'task.create', risk: 'medium', mutating: true, args: [{ name: 'title', required: true, summary: 'task title (quote it)' }],
    flags: [{ name: 'objective', summary: 'what must be achieved (defaults to the title)' }, { name: 'assign', summary: 'assignee', ref: 'employee' }, { name: 'priority', summary: 'priority', values: PRIORITIES }],
    async run({ workspaceId, userId, source, employees, tasks }, inv) {
      const assignee = flag(inv, 'assign') ? await employees.resolveEmployee(workspaceId, flag(inv, 'assign')!) : null;
      const t = await tasks.create(workspaceId, userId, { title: inv.args[0]!, objective: flag(inv, 'objective') ?? inv.args[0]!, priority: (flag(inv, 'priority') ?? 'normal') as never, assigneeAgentId: assignee?.id ?? null, dependsOn: [], requiresApproval: false, requiredCapabilities: [] }, source);
      return { message: `${t.code ?? t.id} created${assignee ? ` and dispatched to ${assignee.employeeCode}` : ' (unassigned)'}. Status ${t.status}.`, data: { id: t.id, code: t.code, status: t.status }, view: table(TASK_COLS, [trow(t)]) };
    },
  },
  {
    name: 'task.assign', path: ['task', 'assign'], summary: 'Assign a task to an employee; the backend dispatches it to that employee\'s runtime', usage: 'task assign <task> <employee>', example: 'task assign TASK-001 EMP-001',
    action: 'task.create', risk: 'medium', mutating: true, args: [{ name: 'task', required: true, summary: 'TASK code', ref: 'task' }, { name: 'employee', required: true, summary: 'EMP code', ref: 'employee' }], flags: [],
    async run({ workspaceId, employees, tasks }, inv) {
      const t = await tasks.resolve(workspaceId, inv.args[0]!);
      const emp = await employees.resolveEmployee(workspaceId, inv.args[1]!);
      const r = await tasks.assign(workspaceId, t.id, emp.id);
      return { message: `${r.code ?? r.id} assigned to ${emp.employeeCode}. Status ${r.status}; execution state comes from the runtime.`, data: { id: r.id, code: r.code, status: r.status }, view: table(TASK_COLS, [trow(r)]) };
    },
  },
  {
    name: 'task.cancel', path: ['task', 'cancel'], summary: 'Cancel a task (stops its active run when the runtime supports it)', usage: 'task cancel <task>', example: 'task cancel TASK-001',
    action: 'task.cancel', risk: 'medium', mutating: true, args: [{ name: 'task', required: true, summary: 'TASK code', ref: 'task' }], flags: [],
    async run({ c, workspaceId, userId, tasks }, inv) {
      const t = await tasks.resolve(workspaceId, inv.args[0]!);
      if (['completed', 'cancelled'].includes(t.status)) throw conflict(`Task is already ${t.status}`);
      await c.orchestrator.cancelTask(workspaceId, t.id, userId);
      const after = await c.db.task.findUnique({ where: { id: t.id } });
      return { message: `${t.taskNumber ? `TASK-${String(t.taskNumber).padStart(3, '0')}` : t.id} is now ${after?.status ?? 'unknown'}`, data: { id: t.id, status: after?.status } };
    },
  },
  {
    name: 'approval.list', path: ['approval', 'list'], summary: 'List pending approvals', usage: 'approval list [--all]', example: 'approval list',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [{ name: 'all', summary: 'include decided approvals', boolean: true }],
    async run({ c, workspaceId }, inv) {
      const list = await c.approvals.list(workspaceId, inv.flags.all ? undefined : 'pending');
      return { message: `${list.length} approvals`, data: list.map((a) => ({ id: a.id, status: a.status })), view: table(['id', 'status', 'agent', 'action', 'risk', 'target'], list.map((a) => [a.id.slice(0, 8), a.status, a.agentName, a.actionCategory, a.risk, a.target])) };
    },
  },
  ...(['approve', 'reject'] as const).map((decision): CommandDef => ({
    name: `approval.${decision}`, path: ['approval', decision], summary: `${decision === 'approve' ? 'Approve' : 'Reject'} a pending approval`, usage: `approval ${decision} <id> [--reason <text>]`, example: `approval ${decision} 1a2b3c4d`,
    action: 'approval.decide', risk: 'high', mutating: true, args: [{ name: 'id', required: true, summary: 'approval id or unique prefix', ref: 'approval' }], flags: [{ name: 'reason', summary: 'why' }],
    async run({ c, workspaceId, userId }, inv) {
      const ref = inv.args[0]!;
      if (ref.length < 6) throw notFound(`Approval "${ref}" (use at least 6 characters of the id)`);
      const matches = await c.db.approval.findMany({ where: { workspaceId, id: { startsWith: ref } }, take: 2 });
      if (matches.length === 0) throw notFound(`Approval "${ref}"`);
      if (matches.length > 1) throw conflict(`"${ref}" matches several approvals; type more characters`);
      const a = matches[0]!;
      const r = await c.approvals.decide(workspaceId, userId, a.id, { decision, reason: flag(inv, 'reason'), payloadHash: a.payloadHash });
      return { message: `Approval ${a.id.slice(0, 8)} ${decision}d (${a.actionCategory} on ${a.target})`, data: { id: a.id, result: r } };
    },
  })),
  {
    name: 'runtime.list', path: ['runtime', 'list'], summary: 'List runtime integrations and their verified status', usage: 'runtime list', example: 'runtime list',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [],
    async run({ c, workspaceId }) {
      const rows = await c.db.integration.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { agents: true } } } });
      return {
        message: `${rows.length} runtimes`,
        data: rows.map((i) => ({ id: i.id, kind: i.kind, mode: i.mode, status: i.status })),
        view: table(['name', 'kind', 'mode', 'status', 'last ok', 'agents', 'note'], rows.map((i) => [i.name, i.kind, i.mode, i.status, i.lastSuccessAt?.toISOString().slice(11, 19) ?? 'never', String(i._count.agents), i.mode === 'SIMULATED' ? 'SIMULATED: not a live runtime' : i.lastError ?? ''])),
      };
    },
  },
];
