import type { FastifyInstance } from 'fastify';
import { AssignmentBodySchema, RegisterAgentBodySchema, UpdateAgentBodySchema, type OrganizationDTO, type RoomKey } from '@avo/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { ApiError, conflict, notFound } from '../../lib/errors.js';
import { newId, parse } from '../../lib/util.js';
import { messageDTO, runDTO, taskDTO } from '../../dto/mappers.js';
import { rowToEvent } from '../../events/event-service.js';
import { AGENT_INCLUDE } from './agent-service.js';
import type { Guard } from '../auth/guard.js';

const DepartmentBody = z.object({ key: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/), name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), homeRoom: z.enum(['main_office', 'employee_workspace', 'development_room', 'research_room', 'meeting_room', 'server_room', 'lounge']) });

export function registerAgentRoutes(app: FastifyInstance, ctx: () => AppContext, guard: Guard): void {
  const wsOf = (req: { auth?: { workspaceId: string } }) => req.auth!.workspaceId;
  const idParam = (req: { params: unknown }) => (req.params as { id: string }).id;

  app.get('/agents', { preHandler: guard('view') }, async (req) => {
    const c = ctx();
    const mode = (req.query as { mode?: string }).mode;
    const rows = await c.db.agent.findMany({ where: { workspaceId: wsOf(req), ...(mode === 'REAL' || mode === 'SIMULATED' ? { mode } : {}) }, include: AGENT_INCLUDE, orderBy: [{ mode: 'asc' }, { name: 'asc' }] });
    const s = await c.settings.get(wsOf(req));
    return rows.map((r) => c.agents.toDTO(r, s));
  });

  app.get('/agents/:id', { preHandler: guard('view') }, async (req) => {
    const c = ctx();
    const ws = wsOf(req);
    const id = idParam(req);
    const row = await c.agents.load(ws, id);
    if (!row) throw notFound('Agent');
    const agent = c.agents.toDTO(row, await c.settings.get(ws));
    const [task, runs, events, messages] = await Promise.all([
      row.currentTaskId ? c.db.task.findFirst({ where: { id: row.currentTaskId, workspaceId: ws }, include: { project: { select: { name: true } }, assignee: { select: { name: true } }, createdBy: { select: { displayName: true } }, dependencies: { select: { dependsOnId: true } } } }) : null,
      c.db.run.findMany({ where: { agentId: id, workspaceId: ws }, orderBy: { createdAt: 'desc' }, take: 10, include: { agent: { select: { name: true } } } }),
      c.db.activityEvent.findMany({ where: { workspaceId: ws, agentId: id }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 40 }),
      c.db.message.findMany({ where: { workspaceId: ws, OR: [{ fromId: id }, { toId: id }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return { agent, currentTask: task ? taskDTO(task) : null, runs: runs.map(runDTO), recentEvents: events.map(rowToEvent), messages: messages.map(messageDTO) };
  });

  app.post('/agents', { preHandler: guard('agent.manage') }, async (req, reply) => {
    const c = ctx();
    const ws = wsOf(req);
    const b = parse(RegisterAgentBodySchema, req.body);
    const integration = await c.db.integration.findFirst({ where: { id: b.integrationId, workspaceId: ws } });
    if (!integration) throw notFound('Integration');
    if (await c.db.agent.findFirst({ where: { workspaceId: ws, handle: b.handle } })) throw conflict(`Handle "${b.handle}" is already used`);
    const dept = b.departmentId ? await c.db.department.findFirst({ where: { id: b.departmentId, workspaceId: ws } }) : null;
    if (b.departmentId && !dept) throw notFound('Department');
    if (b.reportsToAgentId && !(await c.db.agent.findFirst({ where: { id: b.reportsToAgentId, workspaceId: ws } }))) throw notFound('Reports-to agent');
    const row = await c.db.agent.create({
      data: {
        id: newId(), workspaceId: ws, integrationId: integration.id, mode: integration.mode, name: b.name, handle: b.handle, title: b.title,
        departmentId: dept?.id ?? null, orgRole: b.orgRole, reportsToAgentId: b.reportsToAgentId ?? null,
        runtimeRef: b.runtimeRef ?? (integration.mode === 'SIMULATED' ? b.handle : null),
        capabilities: b.capabilities, permissions: b.permissions, appearanceSeed: `${b.handle}-${newId().slice(0, 8)}`,
        homeRoom: b.homeRoom ?? dept?.homeRoom ?? 'employee_workspace', storedState: 'registered', stateSource: 'system',
      },
      include: AGENT_INCLUDE,
    });
    await c.audit.log({ workspaceId: ws, actorUserId: req.auth!.userId, action: 'agent.register', entity: 'agent', entityId: row.id, details: { handle: b.handle, integrationId: integration.id } });
    await c.events.emit({ workspaceId: ws, type: 'agent.registered', source: { kind: 'user', ref: req.auth!.userId }, mode: row.mode, agentId: row.id, params: { agent: row.name }, summary: `Agent ${row.name} registered` });
    const dto = await c.agents.refresh(row, { force: true });
    void c.heartbeat?.check(integration.id).catch(() => undefined);
    reply.code(201);
    return dto;
  });

  app.patch('/agents/:id', { preHandler: guard('agent.manage') }, async (req) => {
    const c = ctx();
    const ws = wsOf(req);
    const id = idParam(req);
    const b = parse(UpdateAgentBodySchema, req.body);
    const row = await c.agents.load(ws, id);
    if (!row) throw notFound('Agent');
    if (b.handle && b.handle !== row.handle && (await c.db.agent.findFirst({ where: { workspaceId: ws, handle: b.handle } }))) throw conflict(`Handle "${b.handle}" is already used`);
    await c.db.agent.update({
      where: { id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}), ...(b.handle !== undefined ? { handle: b.handle } : {}), ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.runtimeRef !== undefined ? { runtimeRef: b.runtimeRef } : {}), ...(b.capabilities !== undefined ? { capabilities: b.capabilities } : {}),
        ...(b.permissions !== undefined ? { permissions: b.permissions } : {}), ...(b.homeRoom !== undefined ? { homeRoom: b.homeRoom } : {}),
        ...(b.orgRole !== undefined ? { orgRole: b.orgRole } : {}), ...(b.departmentId !== undefined ? { departmentId: b.departmentId } : {}),
        ...(b.reportsToAgentId !== undefined ? { reportsToAgentId: b.reportsToAgentId } : {}),
      },
    });
    await c.audit.log({ workspaceId: ws, actorUserId: req.auth!.userId, action: 'agent.update', entity: 'agent', entityId: id, details: { fields: Object.keys(b) } });
    await c.events.emit({ workspaceId: ws, type: 'agent.updated', source: { kind: 'user', ref: req.auth!.userId }, mode: row.mode, agentId: id, params: { agent: row.name }, summary: `Agent ${row.name} updated` });
    return (await c.agents.refreshById(ws, id))!;
  });

  app.delete('/agents/:id', { preHandler: guard('agent.manage') }, async (req) => {
    const c = ctx();
    const ws = wsOf(req);
    const id = idParam(req);
    const row = await c.agents.load(ws, id);
    if (!row) throw notFound('Agent');
    if (await c.db.run.count({ where: { agentId: id } })) throw conflict('This agent has run history. Disable it instead of removing it.');
    await c.db.agent.delete({ where: { id } });
    c.agents.forget(id);
    await c.audit.log({ workspaceId: ws, actorUserId: req.auth!.userId, action: 'agent.remove', entity: 'agent', entityId: id });
    await c.events.emit({ workspaceId: ws, type: 'agent.removed', source: { kind: 'user', ref: req.auth!.userId }, mode: row.mode, agentId: id, params: { agent: row.name }, summary: `Agent ${row.name} removed` });
    c.hub.broadcast(ws, { type: 'agent.removed', agentId: id });
    return { ok: true };
  });

  const toggle = (path: 'enable' | 'disable') =>
    app.post(`/agents/:id/${path}`, { preHandler: guard('agent.manage') }, async (req) => {
      const c = ctx();
      const ws = wsOf(req);
      const id = idParam(req);
      const row = await c.agents.load(ws, id);
      if (!row) throw notFound('Agent');
      if (path === 'disable' && (await c.db.run.count({ where: { agentId: id, state: { in: ['created', 'planning', 'awaiting_approval', 'queued', 'running', 'verifying'] } } }))) throw conflict('Stop the active run first');
      await c.db.agent.update({ where: { id }, data: { enabled: path === 'enable', ...(path === 'enable' ? { storedState: 'registered', stateSince: c.clock.now(), stateSource: 'system' } : {}) } });
      await c.audit.log({ workspaceId: ws, actorUserId: req.auth!.userId, action: `agent.${path}`, entity: 'agent', entityId: id });
      return (await c.agents.refreshById(ws, id))!;
    });
  toggle('enable');
  toggle('disable');

  const control = (path: 'pause' | 'resume') =>
    app.post(`/agents/:id/${path}`, { preHandler: guard('run.control') }, async (req) => {
      const c = ctx();
      const ws = wsOf(req);
      const id = idParam(req);
      const row = await c.agents.load(ws, id);
      if (!row) throw notFound('Agent');
      const adapter = await c.adapters.get(row.integration);
      const r = path === 'pause' ? await adapter.pauseAgent(row.runtimeRef) : await adapter.resumeAgent(row.runtimeRef);
      if (!r.ok) throw new ApiError(r.error.code === 'NOT_SUPPORTED' ? 'not_supported' : 'runtime_unreachable', r.error.message);
      await c.agents.setStored(id, path === 'pause' ? 'paused' : 'idle', { source: row.mode === 'SIMULATED' ? 'simulation' : 'runtime', note: null });
      await c.audit.log({ workspaceId: ws, actorUserId: req.auth!.userId, action: `agent.${path}`, entity: 'agent', entityId: id });
      return (await c.agents.refreshById(ws, id))!;
    });
  control('pause');
  control('resume');

  app.patch('/agents/:id/assignment', { preHandler: guard('agent.manage') }, async (req) => {
    const c = ctx();
    const ws = wsOf(req);
    const id = idParam(req);
    const b = parse(AssignmentBodySchema, req.body);
    const row = await c.agents.load(ws, id);
    if (!row) throw notFound('Agent');
    const dept = b.departmentId ? await c.db.department.findFirst({ where: { id: b.departmentId, workspaceId: ws } }) : null;
    if (b.departmentId && !dept) throw notFound('Department');
    if (b.reportsToAgentId === id) throw conflict('An agent cannot report to itself');
    await c.db.agent.update({ where: { id }, data: { departmentId: dept?.id ?? null, orgRole: b.orgRole, ...(b.title ? { title: b.title } : {}), ...(b.reportsToAgentId !== undefined ? { reportsToAgentId: b.reportsToAgentId } : {}), ...(dept ? { homeRoom: dept.homeRoom } : {}) } });
    await c.audit.log({ workspaceId: ws, actorUserId: req.auth!.userId, action: 'agent.assignment', entity: 'agent', entityId: id, details: b as Record<string, unknown> });
    return (await c.agents.refreshById(ws, id))!;
  });

  // ---- organization
  app.get('/organization', { preHandler: guard('view') }, async (req): Promise<OrganizationDTO> => {
    const c = ctx();
    const ws = wsOf(req);
    const [departments, agents] = await Promise.all([c.db.department.findMany({ where: { workspaceId: ws }, orderBy: { name: 'asc' } }), c.db.agent.findMany({ where: { workspaceId: ws }, select: { id: true, departmentId: true } })]);
    return {
      departments: departments.map((d) => ({ id: d.id, key: d.key, name: d.name, color: d.color, homeRoom: d.homeRoom as RoomKey, agentIds: agents.filter((a) => a.departmentId === d.id).map((a) => a.id) })),
      unassignedAgentIds: agents.filter((a) => !a.departmentId).map((a) => a.id),
    };
  });
  app.get('/departments', { preHandler: guard('view') }, async (req) => ctx().db.department.findMany({ where: { workspaceId: wsOf(req) }, orderBy: { name: 'asc' } }));
  app.post('/departments', { preHandler: guard('agent.manage') }, async (req, reply) => {
    const c = ctx();
    const b = parse(DepartmentBody, req.body);
    if (await c.db.department.findFirst({ where: { workspaceId: wsOf(req), key: b.key } })) throw conflict('Department key already exists');
    const d = await c.db.department.create({ data: { id: newId(), workspaceId: wsOf(req), ...b } });
    reply.code(201);
    return d;
  });
  app.patch('/departments/:id', { preHandler: guard('agent.manage') }, async (req) => {
    const c = ctx();
    const id = idParam(req);
    const b = parse(DepartmentBody.partial(), req.body);
    if (!(await c.db.department.findFirst({ where: { id, workspaceId: wsOf(req) } }))) throw notFound('Department');
    return c.db.department.update({ where: { id }, data: b });
  });
}
