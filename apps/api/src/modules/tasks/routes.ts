import type { FastifyInstance } from 'fastify';
import { ApprovalStatusSchema, AssignTaskBodySchema, CreateTaskBodySchema, DecideApprovalBodySchema, UpdateTaskBodySchema, TaskStatusSchema, type DataMode } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError, conflict, notFound } from '../../lib/errors.js';
import { newId, parse } from '../../lib/util.js';
import { approvalDTO, messageDTO, runDTO, taskDTO } from '../../dto/mappers.js';
import { rowToEvent } from '../../events/event-service.js';
import type { Guard } from '../auth/guard.js';
import { TaskService, TASK_INCLUDE } from './task-service.js';

export function registerTaskRoutes(app: FastifyInstance, ctx: () => AppContext, guard: Guard): void {
  const ws = (req: { auth?: { workspaceId: string } }) => req.auth!.workspaceId;
  const idOf = (req: { params: unknown }) => (req.params as { id: string }).id;

  app.get('/tasks', { preHandler: guard('view') }, async (req) => {
    const q = req.query as { status?: string; agentId?: string; projectId?: string; mode?: string };
    const status = q.status ? TaskStatusSchema.safeParse(q.status) : null;
    const rows = await ctx().db.task.findMany({
      where: { workspaceId: ws(req), ...(status?.success ? { status: status.data } : {}), ...(q.agentId ? { assigneeAgentId: q.agentId } : {}), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.mode === 'REAL' || q.mode === 'SIMULATED' ? { mode: q.mode as DataMode } : {}) },
      orderBy: { createdAt: 'desc' }, take: 300, include: TASK_INCLUDE,
    });
    return rows.map(taskDTO);
  });

  app.get('/tasks/:id', { preHandler: guard('view') }, async (req) => {
    const c = ctx();
    const id = idOf(req);
    const t = await c.db.task.findFirst({ where: { id, workspaceId: ws(req) }, include: TASK_INCLUDE });
    if (!t) throw notFound('Task');
    const [runs, approvals, messages, events, transitions] = await Promise.all([
      c.db.run.findMany({ where: { taskId: id }, orderBy: { createdAt: 'desc' }, include: { agent: { select: { name: true } } } }),
      c.db.approval.findMany({ where: { taskId: id, workspaceId: ws(req) }, orderBy: { requestedAt: 'desc' }, include: { agent: { select: { name: true } } } }),
      c.db.message.findMany({ where: { taskId: id, workspaceId: ws(req) }, orderBy: { createdAt: 'asc' }, take: 200 }),
      c.db.activityEvent.findMany({ where: { taskId: id, workspaceId: ws(req) }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100 }),
      c.db.runStateTransition.findMany({ where: { run: { taskId: id } }, orderBy: { at: 'asc' } }),
    ]);
    return {
      task: taskDTO(t),
      runs: runs.map(runDTO),
      approvals: approvals.map((a) => approvalDTO({ ...a, taskTitle: t.title })),
      messages: messages.map(messageDTO),
      events: events.map(rowToEvent),
      transitions: transitions.map((x) => ({ runId: x.runId, from: x.fromState, to: x.toState, reason: x.reason, at: x.at.toISOString(), traceId: x.traceId })),
    };
  });

  const tasks = () => new TaskService(ctx);
  const validateLinks = (workspaceId: string, b: Parameters<TaskService['validateLinks']>[1]) => tasks().validateLinks(workspaceId, b);

  app.post('/tasks', { preHandler: guard('task.create') }, async (req, reply) => {
    const b = parse(CreateTaskBodySchema, req.body);
    const task = await tasks().create(ws(req), req.auth!.userId, b, { kind: 'user', ref: req.auth!.userId });
    reply.code(201);
    return task;
  });

  app.patch('/tasks/:id', { preHandler: guard('task.create') }, async (req) => {
    const c = ctx();
    const id = idOf(req);
    const b = parse(UpdateTaskBodySchema, req.body);
    const t = await c.db.task.findFirst({ where: { id, workspaceId: ws(req) } });
    if (!t) throw notFound('Task');
    if (['running', 'awaiting_approval'].includes(t.status)) throw conflict('Stop the run before editing this task');
    await validateLinks(ws(req), b);
    await c.db.task.update({
      where: { id },
      data: {
        ...(b.title !== undefined ? { title: b.title } : {}), ...(b.objective !== undefined ? { objective: b.objective } : {}), ...(b.expectedOutput !== undefined ? { expectedOutput: b.expectedOutput } : {}),
        ...(b.priority !== undefined ? { priority: b.priority } : {}), ...(b.projectId !== undefined ? { projectId: b.projectId } : {}), ...(b.dueAt !== undefined ? { dueAt: b.dueAt ? new Date(b.dueAt) : null } : {}),
        ...(b.requiresApproval !== undefined ? { requiresApproval: b.requiresApproval } : {}), ...(b.requiredCapabilities !== undefined ? { requiredCapabilities: b.requiredCapabilities } : {}),
      },
    });
    return taskDTO(await c.db.task.findUniqueOrThrow({ where: { id }, include: TASK_INCLUDE }));
  });

  app.post('/tasks/:id/assign', { preHandler: guard('task.create') }, async (req) => {
    const b = parse(AssignTaskBodySchema, req.body);
    return tasks().assign(ws(req), idOf(req), b.agentId);
  });

  app.post('/tasks/:id/cancel', { preHandler: guard('task.cancel') }, async (req) => {
    const c = ctx();
    await c.orchestrator.cancelTask(ws(req), idOf(req), req.auth!.userId);
    return taskDTO(await c.db.task.findFirstOrThrow({ where: { id: idOf(req), workspaceId: ws(req) }, include: TASK_INCLUDE }));
  });

  app.post('/tasks/:id/retry', { preHandler: guard('task.create') }, async (req) => {
    const c = ctx();
    await c.orchestrator.retryTask(ws(req), idOf(req));
    return taskDTO(await c.db.task.findFirstOrThrow({ where: { id: idOf(req), workspaceId: ws(req) }, include: TASK_INCLUDE }));
  });

  // ---- runs
  app.get('/runs', { preHandler: guard('view') }, async (req) => {
    const active = (req.query as { active?: string }).active === 'true';
    const rows = await ctx().db.run.findMany({
      where: { workspaceId: ws(req), ...(active ? { state: { in: ['created', 'planning', 'awaiting_approval', 'queued', 'running', 'verifying', 'blocked'] } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200, include: { agent: { select: { name: true } } },
    });
    return rows.map(runDTO);
  });
  app.get('/runs/:id', { preHandler: guard('view') }, async (req) => {
    const c = ctx();
    const r = await c.db.run.findFirst({ where: { id: idOf(req), workspaceId: ws(req) }, include: { agent: { select: { name: true } }, transitions: { orderBy: { at: 'asc' } } } });
    if (!r) throw notFound('Run');
    return { ...runDTO(r), transitions: r.transitions.map((x) => ({ from: x.fromState, to: x.toState, reason: x.reason, at: x.at.toISOString() })) };
  });
  app.post('/runs/:id/stop', { preHandler: guard('run.control') }, async (req) => {
    const c = ctx();
    const run = await c.orchestrator.loadRun(idOf(req));
    if (!run || run.workspaceId !== ws(req)) throw notFound('Run');
    await c.orchestrator.stopRun(run, req.auth!.userId, 'stopped_by_user');
    return runDTO((await c.orchestrator.loadRun(run.id))!);
  });

  // ---- approvals
  app.get('/approvals', { preHandler: guard('view') }, async (req) => {
    const s = (req.query as { status?: string }).status;
    const st = s ? ApprovalStatusSchema.safeParse(s) : null;
    return ctx().approvals.list(ws(req), st?.success ? st.data : undefined);
  });
  app.post('/approvals/:id/decide', { preHandler: guard('approval.decide') }, async (req) => {
    const b = parse(DecideApprovalBodySchema, req.body);
    return ctx().approvals.decide(ws(req), req.auth!.userId, idOf(req), b);
  });
  void ApiError;
}
