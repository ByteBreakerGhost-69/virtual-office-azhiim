import type { CreateTaskBodySchema, DataMode, EventSource } from '@avo/shared';
import type { z } from 'zod';
import type { AppContext } from '../../context.js';
import { conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/util.js';
import { formatCode, nextSequence } from '../../lib/sequence.js';
import { taskDTO } from '../../dto/mappers.js';

export const TASK_INCLUDE = { project: { select: { name: true } }, assignee: { select: { name: true } }, createdBy: { select: { displayName: true } }, dependencies: { select: { dependsOnId: true } } } as const;

type CreateBody = z.infer<typeof CreateTaskBodySchema>;

/** The one place tasks are created/assigned. REST routes and the Company Terminal both call this (no second path). */
export class TaskService {
  constructor(private readonly ctx: () => AppContext) {}

  async validateLinks(workspaceId: string, b: { assigneeAgentId?: string | null | undefined; projectId?: string | null | undefined; dependsOn?: string[] | undefined }): Promise<DataMode | null> {
    const c = this.ctx();
    let mode: DataMode | null = null;
    if (b.assigneeAgentId) {
      const a = await c.db.agent.findFirst({ where: { id: b.assigneeAgentId, workspaceId } });
      if (!a) throw notFound('Assignee agent');
      if (!a.enabled) throw conflict('The assignee is disabled');
      if (a.employeeCode && a.employmentStatus !== 'ACTIVE') throw conflict(`${a.employeeCode} is ${a.employmentStatus}; only ACTIVE employees can receive tasks`);
      mode = a.mode;
    }
    if (b.projectId && !(await c.db.project.findFirst({ where: { id: b.projectId, workspaceId } }))) throw notFound('Project');
    if (b.dependsOn?.length) {
      const deps = await c.db.task.findMany({ where: { id: { in: b.dependsOn }, workspaceId } });
      if (deps.length !== new Set(b.dependsOn).size) throw notFound('Dependency task');
      if (mode && deps.some((d) => d.assigneeAgentId && d.mode !== mode)) throw conflict('REAL and SIMULATED tasks cannot depend on each other');
    }
    return mode;
  }

  async create(workspaceId: string, userId: string, b: CreateBody, source: EventSource) {
    const c = this.ctx();
    const mode = await this.validateLinks(workspaceId, b);
    const id = newId();
    const number = await nextSequence(c.db, workspaceId, 'task');
    await c.db.task.create({
      data: {
        id, workspaceId, taskNumber: number, title: b.title, objective: b.objective, expectedOutput: b.expectedOutput ?? null, priority: b.priority, status: b.assigneeAgentId ? 'assigned' : 'awaiting_assignment',
        mode: mode ?? 'REAL', assigneeAgentId: b.assigneeAgentId ?? null, projectId: b.projectId ?? null, createdById: userId, dueAt: b.dueAt ? new Date(b.dueAt) : null,
        requiresApproval: b.requiresApproval, requiredCapabilities: b.requiredCapabilities,
        dependencies: { create: b.dependsOn.map((d) => ({ dependsOnId: d })) },
      },
    });
    await c.events.emit({ workspaceId, type: 'task.created', source, mode: mode ?? 'REAL', taskId: id, agentId: b.assigneeAgentId ?? null, params: { task: b.title, code: formatCode('TASK', number) }, summary: `Task ${formatCode('TASK', number)} "${b.title}" created` });
    if (b.assigneeAgentId) await c.orchestrator.startRun(workspaceId, id);
    return taskDTO(await c.db.task.findUniqueOrThrow({ where: { id }, include: TASK_INCLUDE }));
  }

  async assign(workspaceId: string, taskId: string, agentId: string) {
    const c = this.ctx();
    const t = await c.db.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!t) throw notFound('Task');
    if (['running', 'awaiting_approval', 'completed'].includes(t.status)) throw conflict(`Task is ${t.status}`);
    const mode = await this.validateLinks(workspaceId, { assigneeAgentId: agentId });
    await c.db.task.update({ where: { id: taskId }, data: { assigneeAgentId: agentId, mode: mode ?? t.mode } });
    await c.orchestrator.startRun(workspaceId, taskId);
    return taskDTO(await c.db.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE }));
  }

  /** Accepts a uuid or TASK-001. */
  async resolve(workspaceId: string, ref: string) {
    const c = this.ctx();
    const m = /^task-(\d+)$/i.exec(ref.trim());
    const row = m ? await c.db.task.findFirst({ where: { workspaceId, taskNumber: Number(m[1]) }, include: TASK_INCLUDE }) : await c.db.task.findFirst({ where: { workspaceId, id: ref }, include: TASK_INCLUDE });
    if (!row) throw notFound(`Task ${ref}`);
    return row;
  }
}
