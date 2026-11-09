import { ACTIVE_RUN_STATES, AVATAR_IDS, type AgentDTO, type EventSource } from '@avo/shared';
import type { AppContext } from '../../context.js';
import type { Agent } from '../../generated/prisma/client.js';
import { conflict, notFound, ApiError } from '../../lib/errors.js';
import { formatCode, nextSequence } from '../../lib/sequence.js';
import { AGENT_INCLUDE } from '../agents/agent-service.js';

export interface HireInput {
  agentRef: string;
  title?: string | undefined;
  departmentRef?: string | undefined;
  managerRef?: string | undefined;
  avatarId?: string | undefined;
  responsibilities?: string[] | undefined;
}
export interface Actor {
  userId: string;
  source: EventSource;
}

/**
 * Employee lifecycle on top of existing runtime agents (PRD employee-management 7.2).
 * An employee is never ACTIVE until its runtime has been health-checked by onboarding.
 */
export class EmployeeService {
  constructor(private readonly ctx: () => AppContext) {}

  /** Accepts EMP-001, an agent handle, or an agent id. */
  async resolve(workspaceId: string, ref: string): Promise<Agent> {
    const c = this.ctx();
    const r = ref.trim();
    const row = await c.db.agent.findFirst({ where: { workspaceId, OR: [{ employeeCode: r.toUpperCase() }, { handle: r }, { id: r }] } });
    if (!row) throw notFound(`Employee or agent "${ref}"`);
    return row;
  }

  async resolveEmployee(workspaceId: string, ref: string): Promise<Agent> {
    const row = await this.resolve(workspaceId, ref);
    if (!row.employeeCode) throw conflict(`"${ref}" is a runtime agent, not an employee yet. Run: employee hire ${row.handle}`);
    return row;
  }

  async list(workspaceId: string, filter: { departmentKey?: string; status?: string } = {}): Promise<AgentDTO[]> {
    const c = this.ctx();
    const rows = await c.db.agent.findMany({
      where: { workspaceId, employeeCode: { not: null }, ...(filter.status ? { employmentStatus: filter.status as never } : {}), ...(filter.departmentKey ? { department: { key: filter.departmentKey } } : {}) },
      include: AGENT_INCLUDE,
      orderBy: { employeeCode: 'asc' },
    });
    const s = await c.settings.get(workspaceId);
    return rows.map((r) => c.agents.toDTO(r, s));
  }

  /** Runtime agents that exist but are not employees. */
  async candidates(workspaceId: string): Promise<AgentDTO[]> {
    const c = this.ctx();
    const rows = await c.db.agent.findMany({ where: { workspaceId, employeeCode: null }, include: AGENT_INCLUDE, orderBy: { name: 'asc' } });
    const s = await c.settings.get(workspaceId);
    return rows.map((r) => c.agents.toDTO(r, s));
  }

  async hire(workspaceId: string, actor: Actor, input: HireInput): Promise<AgentDTO> {
    const c = this.ctx();
    const agent = await this.resolve(workspaceId, input.agentRef);
    if (agent.employeeCode) throw conflict(`${agent.name} is already employee ${agent.employeeCode}`);
    if (input.avatarId && !(AVATAR_IDS as readonly string[]).includes(input.avatarId)) throw new ApiError('validation_error', `avatar must be one of: ${AVATAR_IDS.join(', ')}`);
    const dept = input.departmentRef
      ? await c.db.department.findFirst({ where: { workspaceId, OR: [{ key: input.departmentRef }, { id: input.departmentRef }] } })
      : null;
    if (input.departmentRef && !dept) throw notFound(`Department "${input.departmentRef}"`);
    const manager = input.managerRef ? await this.resolveEmployee(workspaceId, input.managerRef) : null;
    if (manager && manager.id === agent.id) throw conflict('An employee cannot report to themselves');

    const row = await c.db.$transaction(async (tx) => {
      const n = await nextSequence(tx, workspaceId, 'employee');
      return tx.agent.update({
        where: { id: agent.id },
        data: {
          employeeCode: formatCode('EMP', n),
          employmentStatus: 'PENDING_ONBOARDING',
          ...(input.title ? { title: input.title } : {}),
          ...(dept ? { departmentId: dept.id, homeRoom: dept.homeRoom } : {}),
          ...(manager ? { reportsToAgentId: manager.id } : {}),
          ...(input.avatarId ? { avatarId: input.avatarId } : {}),
          ...(input.responsibilities ? { responsibilities: input.responsibilities } : {}),
        },
      });
    });
    await c.audit.log({ workspaceId, actorUserId: actor.userId, action: 'employee.hire', entity: 'agent', entityId: row.id, details: { employeeCode: row.employeeCode, department: dept?.key ?? null } });
    await c.events.emit({ workspaceId, type: 'employee.hired', source: actor.source, mode: row.mode, agentId: row.id, params: { agent: row.name, code: row.employeeCode! }, summary: `${row.name} hired as ${row.employeeCode} (pending onboarding)` });
    return (await c.agents.refreshById(workspaceId, row.id))!;
  }

  /**
   * Onboarding = a real runtime health check. ACTIVE only when the integration answers; otherwise the employee
   * stays PENDING_ONBOARDING and the caller gets the reason (PRD 7.2: never show active without a verified connection).
   */
  async onboard(workspaceId: string, actor: Actor, ref: string): Promise<{ ok: boolean; reason: string; agent: AgentDTO }> {
    const c = this.ctx();
    const emp = await this.resolveEmployee(workspaceId, ref);
    if (emp.employmentStatus !== 'PENDING_ONBOARDING') throw conflict(`${emp.employeeCode} is ${emp.employmentStatus}; only PENDING_ONBOARDING employees can be onboarded`);
    const integration = c.heartbeat ? await c.heartbeat.check(emp.integrationId) : await c.db.integration.findUnique({ where: { id: emp.integrationId } });
    const ok = !!integration && (integration.status === 'connected' || integration.status === 'degraded');
    const reason = ok
      ? `Runtime "${integration!.name}" is ${integration!.status}${emp.mode === 'SIMULATED' ? ' (SIMULATED runtime, not a live agent)' : ''}`
      : `Runtime health check failed: ${integration?.lastError ?? integration?.status ?? 'integration missing'}`;
    if (ok) {
      await c.db.agent.update({ where: { id: emp.id }, data: { employmentStatus: 'ACTIVE' } });
      await c.audit.log({ workspaceId, actorUserId: actor.userId, action: 'employee.onboard', entity: 'agent', entityId: emp.id, details: { employeeCode: emp.employeeCode, integration: integration!.status } });
      await c.events.emit({ workspaceId, type: 'employee.onboarded', source: actor.source, mode: emp.mode, agentId: emp.id, params: { agent: emp.name, code: emp.employeeCode! }, summary: `${emp.employeeCode} onboarded` });
    } else {
      await c.audit.log({ workspaceId, actorUserId: actor.userId, action: 'employee.onboard.failed', entity: 'agent', entityId: emp.id, details: { reason } });
    }
    return { ok, reason, agent: (await c.agents.refreshById(workspaceId, emp.id))! };
  }

  async setSuspended(workspaceId: string, actor: Actor, ref: string, suspend: boolean): Promise<AgentDTO> {
    const c = this.ctx();
    const emp = await this.resolveEmployee(workspaceId, ref);
    if (suspend) {
      if (emp.employmentStatus !== 'ACTIVE') throw conflict(`${emp.employeeCode} is ${emp.employmentStatus}; only ACTIVE employees can be suspended`);
      if (await c.db.run.count({ where: { agentId: emp.id, state: { in: [...ACTIVE_RUN_STATES] } } })) throw conflict(`${emp.employeeCode} has an active run. Cancel or stop it first.`);
    } else if (emp.employmentStatus !== 'SUSPENDED') throw conflict(`${emp.employeeCode} is ${emp.employmentStatus}; only SUSPENDED employees can be resumed`);
    await c.db.agent.update({
      where: { id: emp.id },
      data: suspend ? { employmentStatus: 'SUSPENDED', enabled: false } : { employmentStatus: 'ACTIVE', enabled: true, storedState: 'registered', stateSince: c.clock.now(), stateSource: 'system' },
    });
    const type = suspend ? 'employee.suspended' : 'employee.resumed';
    await c.audit.log({ workspaceId, actorUserId: actor.userId, action: type, entity: 'agent', entityId: emp.id, details: { employeeCode: emp.employeeCode } });
    await c.events.emit({ workspaceId, type, source: actor.source, mode: emp.mode, agentId: emp.id, params: { agent: emp.name, code: emp.employeeCode! }, summary: `${emp.employeeCode} ${suspend ? 'suspended' : 'resumed'}` });
    return (await c.agents.refreshById(workspaceId, emp.id))!;
  }
}
