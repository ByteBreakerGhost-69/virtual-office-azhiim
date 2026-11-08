import type { FastifyInstance } from 'fastify';
import { ActivityQuerySchema, CreateMemoryBodySchema, CreateProjectBodySchema, UpdateSettingsBodySchema, MemoryScopeSchema, type OverviewDTO } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../lib/errors.js';
import { newId, parse } from '../../lib/util.js';
import { memoryDTO, projectDTO } from '../../dto/mappers.js';
import { rowToEvent } from '../../events/event-service.js';
import { AGENT_INCLUDE } from '../agents/agent-service.js';
import type { Guard } from '../auth/guard.js';
import type { SimulationService } from '../simulation/simulation-service.js';

export function registerMiscRoutes(app: FastifyInstance, ctx: () => AppContext, guard: Guard, sim: SimulationService): void {
  const ws = (req: { auth?: { workspaceId: string } }) => req.auth!.workspaceId;

  app.get('/overview', { preHandler: guard('view') }, async (req): Promise<OverviewDTO> => {
    const c = ctx();
    const w = ws(req);
    const settings = await c.settings.get(w);
    const [agentRows, tasks, pending, active, integrations] = await Promise.all([
      c.db.agent.findMany({ where: { workspaceId: w }, include: AGENT_INCLUDE }),
      c.db.task.groupBy({ by: ['status'], where: { workspaceId: w }, _count: { _all: true } }),
      c.db.approval.count({ where: { workspaceId: w, status: 'pending' } }),
      c.db.run.count({ where: { workspaceId: w, state: { in: ['created', 'planning', 'awaiting_approval', 'queued', 'running', 'verifying'] } } }),
      c.db.integration.findMany({ where: { workspaceId: w }, orderBy: { createdAt: 'asc' } }),
    ]);
    const byState: Record<string, number> = {};
    const byMode: Record<string, number> = {};
    for (const a of agentRows) {
      const d = c.agents.toDTO(a, settings);
      byState[d.state] = (byState[d.state] ?? 0) + 1;
      byMode[d.mode] = (byMode[d.mode] ?? 0) + 1;
    }
    return {
      generatedAt: c.clock.now().toISOString(), windowSeconds: 0, agentsByState: byState, agentsByMode: byMode,
      tasksByStatus: Object.fromEntries(tasks.map((t) => [t.status, t._count._all])), pendingApprovals: pending, activeRuns: active,
      integrations: integrations.map((i) => ({ id: i.id, name: i.name, kind: i.kind, mode: i.mode, status: i.status, lastSuccessAt: i.lastSuccessAt?.toISOString() ?? null })),
      dispatchPaused: settings.dispatchPaused,
    };
  });

  app.get('/activity', { preHandler: guard('view') }, async (req) => {
    const q = parse(ActivityQuerySchema, req.query);
    let before: { at: Date; id: string } | null = null;
    if (q.cursor) {
      const [at, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      if (at && id && !Number.isNaN(Date.parse(at))) before = { at: new Date(at), id };
    }
    const rows = await ctx().db.activityEvent.findMany({
      where: {
        workspaceId: ws(req), ...(q.agentId ? { agentId: q.agentId } : {}), ...(q.taskId ? { taskId: q.taskId } : {}), ...(q.severity ? { severity: q.severity } : {}), ...(q.mode ? { mode: q.mode } : {}),
        ...(before ? { OR: [{ occurredAt: { lt: before.at } }, { occurredAt: before.at, id: { lt: before.id } }] } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page.map(rowToEvent), nextCursor: rows.length > q.limit && last ? Buffer.from(`${last.occurredAt.toISOString()}|${last.id}`).toString('base64url') : null };
  });

  // ---- projects & hive (foundation)
  app.get('/projects', { preHandler: guard('view') }, async (req) =>
    (await ctx().db.project.findMany({ where: { workspaceId: ws(req) }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { tasks: true } } } })).map(projectDTO));
  app.post('/projects', { preHandler: guard('task.create') }, async (req, reply) => {
    const b = parse(CreateProjectBodySchema, req.body);
    const p = await ctx().db.project.create({ data: { id: newId(), workspaceId: ws(req), name: b.name, description: b.description ?? null } });
    reply.code(201);
    return projectDTO(p);
  });
  app.get('/memory', { preHandler: guard('view') }, async (req) => {
    const s = (req.query as { scope?: string }).scope;
    const scope = s ? MemoryScopeSchema.safeParse(s) : null;
    return (await ctx().db.memoryRecord.findMany({ where: { workspaceId: ws(req), ...(scope?.success ? { scope: scope.data } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 })).map(memoryDTO);
  });
  app.post('/memory', { preHandler: guard('agent.manage') }, async (req, reply) => {
    const b = parse(CreateMemoryBodySchema, req.body);
    const m = await ctx().db.memoryRecord.create({ data: { id: newId(), workspaceId: ws(req), scope: b.scope, scopeRefId: b.scopeRefId ?? null, content: b.content, source: `user:${req.auth!.userId}`, ownerId: req.auth!.userId } });
    reply.code(201);
    return memoryDTO(m);
  });

  // ---- settings & control
  app.get('/settings', { preHandler: guard('view') }, async (req) => ctx().settings.get(ws(req)));
  app.patch('/settings', { preHandler: guard('settings.manage') }, async (req) => {
    const c = ctx();
    const patch = parse(UpdateSettingsBodySchema, req.body);
    const cur = await c.settings.get(ws(req));
    const next = { ...cur, ...patch };
    if (next.offlineAfterMs <= next.staleAfterMs) throw new ApiError('validation_error', 'offlineAfterMs must be greater than staleAfterMs');
    const saved = await c.settings.update(ws(req), patch);
    await c.audit.log({ workspaceId: ws(req), actorUserId: req.auth!.userId, action: 'settings.update', details: patch as Record<string, unknown> });
    return saved;
  });
  app.post('/control/emergency-stop', { preHandler: guard('control.emergency') }, async (req) => {
    const results = await ctx().orchestrator.emergencyStop(ws(req), req.auth!.userId);
    return { dispatchPaused: true, results, scope: 'Pauses new dispatch and asks every runtime to cancel its active runs. Runs a runtime cannot confirm are marked blocked, not cancelled. It does not undo actions that already happened.' };
  });
  app.post('/control/resume-dispatch', { preHandler: guard('control.emergency') }, async (req) => {
    const c = ctx();
    await c.settings.update(ws(req), { dispatchPaused: false });
    await c.audit.log({ workspaceId: ws(req), actorUserId: req.auth!.userId, action: 'control.resume_dispatch' });
    await c.events.emit({ workspaceId: ws(req), type: 'control.dispatch_resumed', source: { kind: 'user', ref: req.auth!.userId }, mode: 'REAL', summary: 'Dispatch resumed' });
    return { dispatchPaused: false };
  });

  // ---- simulation
  app.get('/simulation', { preHandler: guard('view') }, async (req) => sim.status(ws(req)));
  app.post('/simulation/seed', { preHandler: guard('simulation.manage') }, async (req, reply) => {
    reply.code(201);
    return sim.seed(ws(req), req.auth!.userId);
  });
  app.delete('/simulation', { preHandler: guard('simulation.manage') }, async (req) => sim.clear(ws(req), req.auth!.userId));
  void newId;
}
