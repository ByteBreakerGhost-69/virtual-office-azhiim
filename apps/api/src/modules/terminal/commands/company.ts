import { ROOM_KEYS } from '@avo/shared';
import { AGENT_INCLUDE } from '../../agents/agent-service.js';
import type { CommandDef } from '../types.js';
import { kv, table } from '../types.js';

export const companyCommands: CommandDef[] = [
  {
    name: 'help', path: ['help'], summary: 'List commands, or show usage for a command group (e.g. help task)', usage: 'help [topic]', example: 'help employee',
    action: 'view', risk: 'low', mutating: false, args: [{ name: 'topic', required: false, summary: 'command group or full command' }], flags: [],
    async run(ctx, inv) {
      const topic = inv.args[0]?.toLowerCase();
      const list = ctx.registry.filter((d) => d.name !== 'help' && (!topic || d.path[0] === topic || d.name === topic));
      if (topic && list.length === 0) return { status: 'FAILED', message: `No help for "${topic}". Try: help` };
      return { message: topic ? `Commands in "${topic}"` : 'Available commands (type "help <group>" for details)', view: table(['command', 'description', 'needs'], list.map((d) => [d.path.join(' '), d.summary, d.action])), data: list.map((d) => ({ name: d.name, usage: d.usage, example: d.example })) };
    },
  },
  {
    name: 'company.status', path: ['company', 'status'], summary: 'Live company snapshot straight from the backend', usage: 'company status', example: 'company status',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [],
    async run({ c, workspaceId }) {
      const [agents, employees, tasks, approvals, runs, integrations, ws] = await Promise.all([
        c.db.agent.findMany({ where: { workspaceId }, include: AGENT_INCLUDE }),
        c.db.agent.count({ where: { workspaceId, employeeCode: { not: null } } }),
        c.db.task.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }),
        c.db.approval.count({ where: { workspaceId, status: 'pending' } }),
        c.db.run.count({ where: { workspaceId, state: { in: ['created', 'planning', 'awaiting_approval', 'queued', 'running', 'verifying'] } } }),
        c.db.integration.findMany({ where: { workspaceId } }),
        c.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      ]);
      const settings = await c.settings.get(workspaceId);
      const byState: Record<string, number> = {};
      for (const a of agents) {
        const s = c.agents.toDTO(a, settings).state;
        byState[s] = (byState[s] ?? 0) + 1;
      }
      const taskCount = (k: string) => tasks.find((t) => t.status === k)?._count._all ?? 0;
      const active = taskCount('running') + taskCount('awaiting_approval');
      const data = { company: ws.name, employees, agents: agents.length, agentsByState: byState, tasksByStatus: Object.fromEntries(tasks.map((t) => [t.status, t._count._all])), activeRuns: runs, pendingApprovals: approvals, integrations: integrations.map((i) => ({ name: i.name, mode: i.mode, status: i.status })), dispatchPaused: settings.dispatchPaused };
      return {
        message: `${ws.name}: ${employees} employees, ${active} tasks active, ${approvals} approvals pending`,
        data,
        view: kv([
          ['company', ws.name],
          ['employees', String(employees)],
          ['runtime agents', `${agents.length} (${Object.entries(byState).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})`],
          ['tasks active', String(active)],
          ['tasks by status', Object.entries(data.tasksByStatus).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'],
          ['approvals pending', String(approvals)],
          ['runtimes', integrations.map((i) => `${i.name} [${i.mode}] ${i.status}`).join('; ') || 'none configured'],
          ['dispatch', settings.dispatchPaused ? 'PAUSED (emergency stop)' : 'enabled'],
        ]),
      };
    },
  },
  {
    name: 'department.list', path: ['department', 'list'], summary: 'List departments with headcount', usage: 'department list', example: 'department list',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [],
    async run({ c, workspaceId }) {
      const rows = await c.db.department.findMany({ where: { workspaceId }, orderBy: { name: 'asc' }, include: { _count: { select: { agents: true } } } });
      return { message: `${rows.length} departments`, data: rows.map((d) => ({ key: d.key, name: d.name, room: d.homeRoom, headcount: d._count.agents })), view: table(['key', 'name', 'room', 'headcount'], rows.map((d) => [d.key, d.name, d.homeRoom, String(d._count.agents)])) };
    },
  },
  {
    name: 'office.room.list', path: ['office', 'room', 'list'], summary: 'List office rooms and who is in each (derived from verified state)', usage: 'office room list', example: 'office room list',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [],
    async run({ c, workspaceId }) {
      const settings = await c.settings.get(workspaceId);
      const rows = await c.db.agent.findMany({ where: { workspaceId }, include: AGENT_INCLUDE });
      const by = new Map<string, string[]>();
      for (const r of rows) {
        const d = c.agents.toDTO(r, settings);
        const k = d.placement.room;
        by.set(k, [...(by.get(k) ?? []), d.employeeCode ?? d.handle]);
      }
      return { message: `${ROOM_KEYS.length} rooms`, data: Object.fromEntries(ROOM_KEYS.map((k) => [k, by.get(k) ?? []])), view: table(['room', 'occupants'], ROOM_KEYS.map((k) => [k, (by.get(k) ?? []).join(', ') || '-'])) };
    },
  },
  {
    name: 'office.status', path: ['office', 'status'], summary: 'Where everyone is and why (placement reasons)', usage: 'office status', example: 'office status',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [],
    async run({ c, workspaceId }) {
      const settings = await c.settings.get(workspaceId);
      const rows = await c.db.agent.findMany({ where: { workspaceId }, include: AGENT_INCLUDE, orderBy: { name: 'asc' } });
      const dtos = rows.map((r) => c.agents.toDTO(r, settings));
      return { message: `${dtos.length} characters in the office`, data: dtos.map((d) => ({ id: d.id, code: d.employeeCode, room: d.placement.room, pose: d.placement.pose, state: d.state, reason: d.placement.reason.code })), view: table(['who', 'state', 'room', 'pose', 'because'], dtos.map((d) => [d.employeeCode ?? d.handle, d.state, d.placement.room, d.placement.pose, d.placement.reason.code])) };
    },
  },
  {
    name: 'office.employee-location', path: ['office', 'employee-location'], summary: 'Show where one employee is and why', usage: 'office employee-location <employee>', example: 'office employee-location EMP-001',
    action: 'view', risk: 'low', mutating: false, args: [{ name: 'employee', required: true, summary: 'EMP code or handle', ref: 'employee' }], flags: [],
    async run({ c, workspaceId, employees }, inv) {
      const a = await employees.resolve(workspaceId, inv.args[0]!);
      const d = (await c.agents.dto(workspaceId, a.id))!;
      return { message: `${d.employeeCode ?? d.handle} is in ${d.placement.room} (${d.placement.pose}) because ${d.placement.reason.code}`, data: d.placement, view: kv([['who', `${d.name} (${d.employeeCode ?? d.handle})`], ['state', `${d.state}${d.stale ? ' (stale)' : ''}`], ['room', d.placement.room], ['pose', d.placement.pose], ['reason', d.placement.reason.code]]) };
    },
  },
];
