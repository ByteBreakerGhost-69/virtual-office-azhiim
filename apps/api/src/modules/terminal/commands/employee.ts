import { AVATAR_IDS, EMPLOYMENT_STATUSES, type AgentDTO } from '@avo/shared';
import type { CommandDef } from '../types.js';
import { flag, kv, table } from '../types.js';

const row = (d: AgentDTO): string[] => [d.employeeCode ?? '-', d.name, d.title, d.departmentKey ?? '-', d.employmentStatus ?? '-', `${d.state}${d.stale ? '*' : ''}`, d.mode];
const COLS = ['code', 'name', 'title', 'dept', 'employment', 'runtime state', 'mode'];
const detail = (d: AgentDTO) =>
  kv([
    ['employee', `${d.employeeCode ?? '(not hired)'} · ${d.name} (@${d.handle})`],
    ['title', d.title],
    ['department', d.departmentName ?? '-'],
    ['employment', d.employmentStatus ?? 'not an employee'],
    ['runtime', `${d.integrationName} [${d.mode}] ${d.integrationStatus}`],
    ['state', `${d.state}${d.stale ? ' (stale: data too old to trust)' : ''}${d.stateReason ? ` · ${d.stateReason.code}` : ''}`],
    ['office', `${d.placement.room} · ${d.placement.pose}`],
    ['current task', d.currentTaskTitle ?? '-'],
    ['avatar', d.avatarId ?? 'auto'],
  ]);

export const employeeCommands: CommandDef[] = [
  {
    name: 'employee.list', path: ['employee', 'list'], summary: 'List employees (hired agents)', usage: 'employee list [--dept <key>] [--status <s>]', example: 'employee list --dept engineering',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [{ name: 'dept', summary: 'department key', ref: 'department' }, { name: 'status', summary: 'employment status', values: EMPLOYMENT_STATUSES }],
    async run({ workspaceId, employees }, inv) {
      const list = await employees.list(workspaceId, { ...(flag(inv, 'dept') ? { departmentKey: flag(inv, 'dept')! } : {}), ...(flag(inv, 'status') ? { status: flag(inv, 'status')! } : {}) });
      return { message: `${list.length} employees`, data: list.map((d) => ({ id: d.id, code: d.employeeCode, name: d.name, title: d.title, department: d.departmentKey, employment: d.employmentStatus, state: d.state, stale: d.stale, mode: d.mode })), view: table(COLS, list.map(row)) };
    },
  },
  {
    name: 'employee.candidates', path: ['employee', 'candidates'], summary: 'Runtime agents that are not yet employees', usage: 'employee candidates', example: 'employee candidates',
    action: 'view', risk: 'low', mutating: false, args: [], flags: [],
    async run({ workspaceId, employees }) {
      const list = await employees.candidates(workspaceId);
      return { message: `${list.length} agents available to hire`, data: list.map((d) => ({ id: d.id, handle: d.handle, name: d.name, mode: d.mode })), view: table(['handle', 'name', 'runtime', 'mode', 'state'], list.map((d) => [d.handle, d.name, d.integrationName, d.mode, d.state])) };
    },
  },
  {
    name: 'employee.show', path: ['employee', 'show'], summary: 'Show one employee', usage: 'employee show <employee>', example: 'employee show EMP-001',
    action: 'view', risk: 'low', mutating: false, args: [{ name: 'employee', required: true, summary: 'EMP code or handle', ref: 'employee' }], flags: [],
    async run({ c, workspaceId, employees }, inv) {
      const a = await employees.resolve(workspaceId, inv.args[0]!);
      const d = (await c.agents.dto(workspaceId, a.id))!;
      return { message: `${d.name}`, data: d, view: detail(d) };
    },
  },
  {
    name: 'employee.hire', path: ['employee', 'hire'], summary: 'Register an existing runtime agent as an employee (identity, title, department, avatar)', usage: 'employee hire <agent> [--title <t>] [--dept <key>] [--manager <EMP>] [--avatar <id>] [--responsibility <text>]', example: 'employee hire atlas --title "Backend Engineer" --dept engineering --avatar a3',
    action: 'agent.manage', risk: 'medium', mutating: true,
    args: [{ name: 'agent', required: true, summary: 'agent handle (see: employee candidates)', ref: 'agent' }],
    flags: [{ name: 'title', summary: 'job title' }, { name: 'dept', summary: 'department key', ref: 'department' }, { name: 'manager', summary: 'manager employee', ref: 'employee' }, { name: 'avatar', summary: 'avatar preset', values: AVATAR_IDS }, { name: 'responsibility', summary: 'one responsibility line' }],
    async run({ workspaceId, userId, source, employees }, inv) {
      const d = await employees.hire(workspaceId, { userId, source }, {
        agentRef: inv.args[0]!, title: flag(inv, 'title'), departmentRef: flag(inv, 'dept'), managerRef: flag(inv, 'manager'), avatarId: flag(inv, 'avatar'),
        responsibilities: flag(inv, 'responsibility') ? [flag(inv, 'responsibility')!] : undefined,
      });
      return { message: `${d.name} hired as ${d.employeeCode}. Status PENDING_ONBOARDING; run "employee onboard ${d.employeeCode}" to verify the runtime.`, data: { id: d.id, code: d.employeeCode, employment: d.employmentStatus, room: d.placement.room }, view: detail(d) };
    },
  },
  {
    name: 'employee.onboard', path: ['employee', 'onboard'], summary: 'Health-check the runtime and activate the employee', usage: 'employee onboard <employee>', example: 'employee onboard EMP-001',
    action: 'agent.manage', risk: 'medium', mutating: true, args: [{ name: 'employee', required: true, summary: 'EMP code', ref: 'employee' }], flags: [],
    async run({ workspaceId, userId, source, employees }, inv) {
      const r = await employees.onboard(workspaceId, { userId, source }, inv.args[0]!);
      return r.ok
        ? { message: `${r.agent.employeeCode} is now ACTIVE. ${r.reason}`, data: { code: r.agent.employeeCode, employment: r.agent.employmentStatus }, view: detail(r.agent) }
        : { status: 'FAILED', message: `${r.agent.employeeCode} stays PENDING_ONBOARDING. ${r.reason}`, data: { code: r.agent.employeeCode, employment: r.agent.employmentStatus } };
    },
  },
  {
    name: 'employee.suspend', path: ['employee', 'suspend'], summary: 'Suspend an ACTIVE employee (blocks new tasks; refused while a run is active)', usage: 'employee suspend <employee>', example: 'employee suspend EMP-001',
    action: 'agent.manage', risk: 'medium', mutating: true, args: [{ name: 'employee', required: true, summary: 'EMP code', ref: 'employee' }], flags: [],
    async run({ workspaceId, userId, source, employees }, inv) {
      const d = await employees.setSuspended(workspaceId, { userId, source }, inv.args[0]!, true);
      return { message: `${d.employeeCode} suspended`, data: { code: d.employeeCode, employment: d.employmentStatus } };
    },
  },
  {
    name: 'employee.resume', path: ['employee', 'resume'], summary: 'Resume a SUSPENDED employee', usage: 'employee resume <employee>', example: 'employee resume EMP-001',
    action: 'agent.manage', risk: 'medium', mutating: true, args: [{ name: 'employee', required: true, summary: 'EMP code', ref: 'employee' }], flags: [],
    async run({ workspaceId, userId, source, employees }, inv) {
      const d = await employees.setSuspended(workspaceId, { userId, source }, inv.args[0]!, false);
      return { message: `${d.employeeCode} resumed (ACTIVE)`, data: { code: d.employeeCode, employment: d.employmentStatus } };
    },
  },
];
