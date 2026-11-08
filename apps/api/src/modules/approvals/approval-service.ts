import type { ApprovalRequestRef } from '@avo/adapters';
import type { ApprovalStatus } from '@avo/shared';
import { Prisma } from '../../db.js';
import type { AppContext } from '../../context.js';
import { approvalDTO } from '../../dto/mappers.js';
import { ApiError, conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/util.js';
import { payloadHash } from '../../lib/crypto.js';
import type { RunWithAgent } from '../../orchestrator/orchestrator.js';

interface StoredRef {
  requestRef?: ApprovalRequestRef;
  payload?: unknown;
}

export class ApprovalService {
  constructor(private readonly ctx: () => AppContext) {}

  async list(workspaceId: string, status?: ApprovalStatus) {
    const rows = await this.ctx().db.approval.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: 200,
      include: { agent: { select: { name: true } } },
    });
    const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
    const tasks = await this.ctx().db.task.findMany({ where: { id: { in: taskIds }, workspaceId }, select: { id: true, title: true } });
    const titles = new Map(tasks.map((t) => [t.id, t.title]));
    return rows.map((r) => approvalDTO({ ...r, taskTitle: r.taskId ? titles.get(r.taskId) ?? null : null }));
  }

  async createPreRun(run: RunWithAgent): Promise<void> {
    const c = this.ctx();
    const s = await c.settings.get(run.workspaceId);
    const payload = { gate: 'pre_run', taskId: run.taskId, agentId: run.agentId, objective: run.task.objective };
    const a = await c.db.approval.create({
      data: {
        id: newId(), workspaceId: run.workspaceId, runId: run.id, taskId: run.taskId, agentId: run.agentId, gate: 'pre_run', status: 'pending', mode: run.mode,
        actionCategory: 'out_of_scope', target: run.task.title, argsSummary: run.task.objective.slice(0, 500), payloadHash: payloadHash(payload), risk: 'medium',
        consequence: 'The agent starts executing this task as soon as you approve.',
        expiresAt: new Date(c.clock.now().getTime() + s.approvalTtlMs),
        providerRequestRef: { payload } as Prisma.InputJsonValue,
      },
    });
    await this.announce(run, a.id, 'pre_run');
  }

  async createRuntime(run: RunWithAgent, e: { requestRef: ApprovalRequestRef; category: string; target: string; argsSummary: string; risk: 'low' | 'medium' | 'high' | 'critical'; payload: unknown }): Promise<void> {
    const c = this.ctx();
    const s = await c.settings.get(run.workspaceId);
    const a = await c.db.approval.create({
      data: {
        id: newId(), workspaceId: run.workspaceId, runId: run.id, taskId: run.taskId, agentId: run.agentId, gate: 'runtime', status: 'pending', mode: run.mode,
        actionCategory: e.category, target: e.target, argsSummary: e.argsSummary, payloadHash: payloadHash(e.payload), risk: e.risk,
        consequence: `Approving lets ${run.agent.name} perform a "${e.category}" action on ${e.target}. Rejecting stops that action.`,
        expiresAt: new Date(c.clock.now().getTime() + s.approvalTtlMs),
        providerRequestRef: { requestRef: e.requestRef, payload: e.payload } as unknown as Prisma.InputJsonValue,
      },
    });
    await c.orchestrator.transition(run.id, 'awaiting_approval', { reason: 'approval_required' });
    await c.agents.setStored(run.agentId, 'waiting', { source: run.mode === 'SIMULATED' ? 'simulation' : 'runtime', note: 'Waiting for approval' });
    await this.announce(run, a.id, 'runtime');
  }

  private async announce(run: RunWithAgent, approvalId: string, gate: string): Promise<void> {
    const c = this.ctx();
    const a = await c.db.approval.findUniqueOrThrow({ where: { id: approvalId } });
    await c.events.emit({
      workspaceId: run.workspaceId, type: 'approval.requested', source: { kind: run.mode === 'SIMULATED' ? 'simulation' : 'runtime', ref: run.agent.integrationId }, mode: run.mode,
      agentId: run.agentId, taskId: run.taskId, runId: run.id, traceId: run.traceId, severity: 'warn',
      params: { agent: run.agent.name, category: a.actionCategory, gate }, summary: `${run.agent.name} requests approval: ${a.actionCategory} → ${a.target}`,
      payload: { approvalId, risk: a.risk, expiresAt: a.expiresAt.toISOString() },
    });
    await c.agents.refreshById(run.workspaceId, run.agentId);
  }

  async decide(workspaceId: string, userId: string, id: string, body: { decision: 'approve' | 'reject'; reason?: string | undefined; payloadHash?: string | undefined }) {
    const c = this.ctx();
    const a = await c.db.approval.findFirst({ where: { id, workspaceId } });
    if (!a) throw notFound('Approval');
    if (a.status !== 'pending') throw conflict(`Approval is already ${a.status}`);
    if (a.expiresAt.getTime() <= c.clock.now().getTime()) {
      await this.expireOne(a.id);
      throw conflict('Approval expired; the action was not authorised');
    }
    if (body.decision === 'reject' && !body.reason?.trim()) throw new ApiError('validation_error', 'A reason is required when rejecting');
    const ref = (a.providerRequestRef ?? {}) as StoredRef;
    const recomputed = payloadHash(ref.payload);
    if (recomputed !== a.payloadHash || (body.payloadHash && body.payloadHash !== a.payloadHash)) {
      throw conflict('The action payload no longer matches what was requested; a new approval is required');
    }
    const run = a.runId ? await c.orchestrator.loadRun(a.runId) : null;
    const status: ApprovalStatus = body.decision === 'approve' ? 'approved' : 'rejected';

    if (a.gate === 'runtime') {
      if (!run?.providerRunId || !ref.requestRef) throw conflict('Run is no longer waiting for this approval');
      const adapter = await c.adapters.get(run.agent.integration);
      const r = await adapter.decideApproval(run.providerRunId, ref.requestRef, body.decision, body.reason);
      if (!r.ok) {
        if (r.error.code === 'NOT_SUPPORTED') throw new ApiError('not_supported', r.error.message);
        throw new ApiError('runtime_unreachable', `The runtime did not accept the decision: ${r.error.message}`);
      }
    }
    await c.db.approval.update({ where: { id: a.id }, data: { status, decidedAt: c.clock.now(), decidedById: userId, reason: body.reason ?? null } });
    await c.audit.log({ workspaceId, actorUserId: userId, action: `approval.${status}`, entity: 'approval', entityId: a.id, details: { runId: a.runId, category: a.actionCategory, reason: body.reason ?? null } });
    await c.events.emit({
      workspaceId, type: 'approval.decided', source: { kind: 'user', ref: userId }, mode: a.mode, agentId: a.agentId, taskId: a.taskId, runId: a.runId,
      traceId: run?.traceId, severity: 'info', params: { decision: status, category: a.actionCategory }, summary: `Approval ${status}: ${a.actionCategory} → ${a.target}`, payload: { approvalId: a.id, reason: body.reason ?? null },
    });

    if (run) {
      if (a.gate === 'pre_run') {
        if (status === 'approved') {
          await c.orchestrator.transition(run.id, 'queued', { reason: 'approved' });
          void c.orchestrator.dispatch(run.id);
        } else await c.orchestrator.transition(run.id, 'rejected', { reason: `approval_rejected: ${body.reason ?? ''}`.trim() });
      } else {
        // The runtime may already have reported the outcome (e.g. rejection => failure); only resume if still waiting.
        const cur = await c.orchestrator.loadRun(run.id);
        if (cur?.state !== 'awaiting_approval') return approvalDTO(await c.db.approval.findUniqueOrThrow({ where: { id: a.id }, include: { agent: { select: { name: true } } } }));
        await c.orchestrator.transition(run.id, 'running', { reason: `approval_${status}` }).catch(() => undefined); // lost the race to the runtime's own outcome: fine
        await c.agents.setStored(run.agentId, 'thinking', { source: run.mode === 'SIMULATED' ? 'simulation' : 'runtime', note: status === 'approved' ? 'Approval granted' : 'Approval rejected' });
      }
      await c.orchestrator.settleAgent(run.agentId, workspaceId, run.mode); // never leave an agent "thinking" without an active run
    }
    const fresh = await c.db.approval.findUniqueOrThrow({ where: { id: a.id }, include: { agent: { select: { name: true } } } });
    return approvalDTO(fresh);
  }

  private async expireOne(id: string): Promise<void> {
    const c = this.ctx();
    const a = await c.db.approval.findUnique({ where: { id } });
    if (!a || a.status !== 'pending') return;
    await c.db.approval.update({ where: { id }, data: { status: 'expired', decidedAt: c.clock.now(), reason: 'expired' } });
    const run = a.runId ? await c.orchestrator.loadRun(a.runId) : null;
    if (run && a.gate === 'runtime' && run.providerRunId) {
      const ref = (a.providerRequestRef ?? {}) as StoredRef;
      if (ref.requestRef) {
        const adapter = await c.adapters.get(run.agent.integration);
        await adapter.decideApproval(run.providerRunId, ref.requestRef, 'reject', 'expired').catch(() => undefined);
      }
    }
    if (run) await c.orchestrator.transition(run.id, a.gate === 'pre_run' ? 'rejected' : 'blocked', { reason: 'approval_expired' });
    await c.events.emit({
      workspaceId: a.workspaceId, type: 'approval.expired', source: { kind: 'system' }, mode: a.mode, agentId: a.agentId, taskId: a.taskId, runId: a.runId, traceId: run?.traceId,
      severity: 'warn', params: { category: a.actionCategory }, summary: `Approval expired: ${a.actionCategory} → ${a.target}. The action was NOT executed.`, payload: { approvalId: id },
    });
    if (run) await c.agents.refreshById(a.workspaceId, run.agentId);
  }

  async sweepExpired(): Promise<number> {
    const c = this.ctx();
    const due = await c.db.approval.findMany({ where: { status: 'pending', expiresAt: { lte: c.clock.now() } }, select: { id: true } });
    for (const d of due) await this.expireOne(d.id);
    return due.length;
  }
}
