import type { AppContext } from '../../context.js';
import { ApiError, conflict } from '../../lib/errors.js';
import { newId } from '../../lib/util.js';
import { AGENT_INCLUDE } from '../agents/agent-service.js';

interface SimAgent {
  handle: string; name: string; title: string; dept: string; orgRole: 'leader' | 'manager' | 'specialist' | 'assistant'; reportsTo?: string; capabilities: string[]; permissions: string[];
}

/** The scripted demo team. Everything it creates is mode=SIMULATED and lives on the SIMULATED integration only. */
export const SIM_TEAM: SimAgent[] = [
  { handle: 'sim-nova', name: 'Nova Reyes', title: 'Chief of Staff', dept: 'leadership', orgRole: 'leader', capabilities: ['text.generate', 'web.search'], permissions: ['text.generate'] },
  { handle: 'sim-atlas', name: 'Atlas Chen', title: 'Operations Manager', dept: 'operations', orgRole: 'manager', reportsTo: 'sim-nova', capabilities: ['text.generate', 'file.read'], permissions: ['text.generate', 'file.read'] },
  { handle: 'sim-pixel', name: 'Pixel Okafor', title: 'Support Coordinator', dept: 'operations', orgRole: 'specialist', reportsTo: 'sim-atlas', capabilities: ['text.generate', 'web.search'], permissions: ['text.generate'] },
  { handle: 'sim-forge', name: 'Forge Nakamura', title: 'Lead Engineer', dept: 'engineering', orgRole: 'manager', reportsTo: 'sim-nova', capabilities: ['code.write', 'code.execute', 'file.read', 'file.write'], permissions: ['code.write', 'file.read'] },
  { handle: 'sim-byte', name: 'Byte Silva', title: 'Backend Developer', dept: 'engineering', orgRole: 'specialist', reportsTo: 'sim-forge', capabilities: ['code.write', 'code.execute', 'terminal.execute', 'github.issue.create'], permissions: ['code.write', 'file.write'] },
  { handle: 'sim-lumen', name: 'Lumen Haddad', title: 'Research Lead', dept: 'research', orgRole: 'manager', reportsTo: 'sim-nova', capabilities: ['web.search', 'web.browse', 'text.generate'], permissions: ['web.search', 'web.browse'] },
  { handle: 'sim-sage', name: 'Sage Novak', title: 'Data Analyst', dept: 'research', orgRole: 'specialist', reportsTo: 'sim-lumen', capabilities: ['code.execute', 'file.read', 'web.search'], permissions: ['file.read'] },
  { handle: 'sim-rack', name: 'Rack Ibrahim', title: 'Infrastructure Engineer', dept: 'infrastructure', orgRole: 'specialist', reportsTo: 'sim-forge', capabilities: ['terminal.execute', 'file.read', 'code.execute'], permissions: ['file.read'] },
];

export class SimulationService {
  constructor(private readonly ctx: () => AppContext) {}

  async status(workspaceId: string) {
    const c = this.ctx();
    const integration = await c.db.integration.findFirst({ where: { workspaceId, kind: 'SIMULATED' } });
    const agents = await c.db.agent.count({ where: { workspaceId, mode: 'SIMULATED' } });
    return { present: !!integration, integrationId: integration?.id ?? null, agents, warning: 'SIMULATED data is scripted demo data. It is never mixed with REAL runtime data.' };
  }

  async seed(workspaceId: string, userId: string) {
    const c = this.ctx();
    if (await c.db.integration.findFirst({ where: { workspaceId, kind: 'SIMULATED' } })) throw conflict('The simulated demo team already exists');
    const depts = await c.db.department.findMany({ where: { workspaceId } });
    const integrationId = newId();
    await c.db.integration.create({ data: { id: integrationId, workspaceId, kind: 'SIMULATED', mode: 'SIMULATED', name: 'Simulated demo runtime (scripted)' } });
    const ids = new Map<string, string>();
    for (const a of SIM_TEAM) {
      const d = depts.find((x) => x.key === a.dept);
      const id = newId();
      ids.set(a.handle, id);
      await c.db.agent.create({
        data: {
          id, workspaceId, integrationId, mode: 'SIMULATED', name: a.name, handle: a.handle, title: a.title, departmentId: d?.id ?? null, orgRole: a.orgRole,
          runtimeRef: a.handle, capabilities: a.capabilities, permissions: a.permissions, appearanceSeed: `${a.handle}-seed`, homeRoom: d?.homeRoom ?? 'employee_workspace', storedState: 'registered', stateSource: 'simulation',
        },
      });
    }
    for (const a of SIM_TEAM) if (a.reportsTo) await c.db.agent.update({ where: { id: ids.get(a.handle)! }, data: { reportsToAgentId: ids.get(a.reportsTo)! } });
    await c.audit.log({ workspaceId, actorUserId: userId, action: 'simulation.seed', details: { agents: SIM_TEAM.length } });
    await c.events.emit({ workspaceId, type: 'simulation.seeded', source: { kind: 'user', ref: userId }, mode: 'SIMULATED', integrationId, params: { agents: SIM_TEAM.length }, summary: `Simulated demo team created (${SIM_TEAM.length} agents). All data from it is SIMULATED.` });
    await c.heartbeat?.check(integrationId);
    const rows = await c.db.agent.findMany({ where: { integrationId }, include: AGENT_INCLUDE });
    for (const r of rows) await c.agents.refresh(r, { force: true });
    return this.status(workspaceId);
  }

  /** Removes ONLY simulated data. Real data is never touched. */
  async clear(workspaceId: string, userId: string) {
    const c = this.ctx();
    const integration = await c.db.integration.findFirst({ where: { workspaceId, kind: 'SIMULATED' } });
    if (!integration) throw new ApiError('not_found', 'No simulated data to remove');
    const agents = await c.db.agent.findMany({ where: { workspaceId, mode: 'SIMULATED' }, select: { id: true } });
    await c.db.$transaction([
      c.db.activityEvent.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
      c.db.message.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
      c.db.approval.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
      c.db.agent.updateMany({ where: { workspaceId, mode: 'SIMULATED' }, data: { currentTaskId: null } }),
      c.db.run.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
      c.db.task.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
      c.db.agent.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
      c.db.integration.deleteMany({ where: { workspaceId, mode: 'SIMULATED' } }),
    ]);
    c.adapters.evict(integration.id);
    for (const a of agents) {
      c.agents.forget(a.id);
      c.hub.broadcast(workspaceId, { type: 'agent.removed', agentId: a.id });
    }
    await c.audit.log({ workspaceId, actorUserId: userId, action: 'simulation.clear', details: { agents: agents.length } });
    await c.events.emit({ workspaceId, type: 'simulation.cleared', source: { kind: 'user', ref: userId }, mode: 'REAL', params: { agents: agents.length }, summary: `All simulated data removed (${agents.length} agents)` });
    return this.status(workspaceId);
  }
}
