import { ACTIVE_RUN_STATES, TERMINAL_RUN_STATES, type EventType, type RunState, type TaskStatus } from '@avo/shared';
import type { DispatchInput, RuntimeAdapter, Subscription } from '@avo/adapters';
import type { AppContext } from '../context.js';
import { Prisma } from '../db.js';
import type { Run, Task } from '../generated/prisma/client.js';
import { AGENT_INCLUDE, type AgentRow } from '../modules/agents/agent-service.js';
import { ApiError, conflict, notFound } from '../lib/errors.js';
import { backoff, newId, sleep } from '../lib/util.js';
import { evaluateEligibility } from './eligibility.js';
import { buildPlan } from './planner.js';
import { RunEventProcessor } from './run-events.js';

export type RunWithAgent = Run & { agent: AgentRow; task: Task };
const RUN_INCLUDE = { agent: { include: AGENT_INCLUDE }, task: true } as const;

const ALLOWED: Record<RunState, RunState[]> = {
  created: ['planning', 'cancelled', 'failed', 'blocked'],
  planning: ['awaiting_approval', 'queued', 'blocked', 'failed', 'cancelled'],
  awaiting_approval: ['queued', 'running', 'rejected', 'blocked', 'cancelled', 'failed', 'timed_out'],
  queued: ['running', 'failed', 'blocked', 'cancelled', 'awaiting_approval'],
  running: ['verifying', 'awaiting_approval', 'failed', 'cancelled', 'timed_out', 'blocked'],
  verifying: ['completed', 'failed', 'cancelled'],
  blocked: ['running', 'failed', 'cancelled', 'timed_out', 'awaiting_approval', 'verifying'],
  completed: [], rejected: [], failed: [], cancelled: [], timed_out: [],
};

const TASK_STATUS: Record<RunState, TaskStatus> = {
  created: 'assigned', planning: 'assigned', queued: 'assigned', awaiting_approval: 'awaiting_approval', running: 'running', verifying: 'running',
  completed: 'completed', rejected: 'blocked', blocked: 'blocked', failed: 'failed', cancelled: 'cancelled', timed_out: 'failed',
};

const TASK_EVENT: Partial<Record<RunState, EventType>> = { completed: 'task.completed', failed: 'task.failed', timed_out: 'task.failed', cancelled: 'task.cancelled', blocked: 'task.blocked', rejected: 'task.blocked' };

export class Orchestrator {
  private readonly watchers = new Map<string, Subscription>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly processor: RunEventProcessor;
  readonly instanceId = newId();

  constructor(private readonly ctx: () => AppContext) {
    this.processor = new RunEventProcessor(ctx, this);
  }

  // ------------------------------------------------------------------ reads
  loadRun(id: string): Promise<RunWithAgent | null> {
    return this.ctx().db.run.findUnique({ where: { id }, include: RUN_INCLUDE });
  }

  private async activeRunCount(agentId: string): Promise<number> {
    return this.ctx().db.run.count({ where: { agentId, state: { in: [...ACTIVE_RUN_STATES] } } });
  }

  // ------------------------------------------------------------------ state machine
  async transition(runId: string, to: RunState, opts: { reason?: string; patch?: Prisma.RunUpdateInput } = {}): Promise<RunWithAgent> {
    // A lost compare-and-set re-validates against the fresh state (illegal transitions still throw), so a runtime
    // outcome is never dropped just because an approval resume committed a moment earlier.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.transitionOnce(runId, to, opts);
      } catch (err) {
        if (attempt < 3 && err instanceof ApiError && err.code === 'conflict' && /changed concurrently/.test(err.message)) continue;
        throw err;
      }
    }
  }

  private async transitionOnce(runId: string, to: RunState, opts: { reason?: string; patch?: Prisma.RunUpdateInput } = {}): Promise<RunWithAgent> {
    const c = this.ctx();
    const run = await this.loadRun(runId);
    if (!run) throw notFound('Run');
    if (run.state === to) return run;
    if (!ALLOWED[run.state].includes(to)) {
      throw conflict(`Illegal run transition ${run.state} → ${to}`);
    }
    const now = c.clock.now();
    const terminal = TERMINAL_RUN_STATES.includes(to);
    const failing = to === 'failed' || to === 'timed_out' || to === 'blocked' || to === 'rejected';
    await c.db.$transaction(async (tx) => {
      // Compare-and-set: two concurrent transitions can never overwrite each other (e.g. runtime failure vs. approval resume).
      const won = await tx.run.updateMany({
        where: { id: runId, state: run.state },
        data: { state: to, ...(terminal ? { finishedAt: now } : {}), ...(failing && opts.reason ? { failureReason: opts.reason } : {}), ...(opts.patch as Prisma.RunUpdateManyMutationInput | undefined) },
      });
      if (won.count === 0) throw conflict(`Run ${runId} changed concurrently (was ${run.state})`);
      await tx.runStateTransition.create({ data: { id: newId(), runId, fromState: run.state, toState: to, reason: opts.reason ?? null, traceId: run.traceId, at: now } });
      await tx.task.update({
        where: { id: run.taskId },
        data: { status: TASK_STATUS[to], blockedReason: to === 'blocked' || to === 'rejected' ? opts.reason ?? null : null, ...(terminal ? {} : { currentRunId: run.id }) },
      });
    });
    const mode = run.mode;
    const source = { kind: 'orchestrator' as const, ref: this.instanceId };
    await c.events.emit({
      workspaceId: run.workspaceId, type: 'run.state.changed', source, mode, agentId: run.agentId, taskId: run.taskId, runId, traceId: run.traceId,
      severity: to === 'failed' || to === 'timed_out' ? 'error' : to === 'blocked' || to === 'rejected' ? 'warn' : 'info',
      params: { from: run.state, to, reason: opts.reason ?? null, task: run.task.title }, summary: `Run ${run.state} → ${to}${opts.reason ? ` (${opts.reason})` : ''}`,
    });
    const taskEvent = TASK_EVENT[to];
    if (taskEvent) {
      await c.events.emit({
        workspaceId: run.workspaceId, type: taskEvent, source, mode, agentId: run.agentId, taskId: run.taskId, runId, traceId: run.traceId,
        severity: taskEvent === 'task.failed' ? 'error' : taskEvent === 'task.blocked' ? 'warn' : 'info',
        params: { task: run.task.title, agent: run.agent.name, reason: opts.reason ?? null }, summary: `Task "${run.task.title}" ${to}${opts.reason ? `: ${opts.reason}` : ''}`,
      });
    }
    if (terminal || to === 'blocked') await this.releaseAgent(run, to);
    return (await this.loadRun(runId))!;
  }

  private async releaseAgent(run: RunWithAgent, to: RunState): Promise<void> {
    const c = this.ctx();
    if (to !== 'blocked') {
      this.watchers.get(run.id)?.close();
      this.watchers.delete(run.id);
    }
    const agent = await c.db.agent.findUnique({ where: { id: run.agentId } });
    if (!agent) return;
    if (agent.currentTaskId === run.taskId) {
      const stillActive = to === 'blocked';
      await c.db.agent.update({ where: { id: agent.id }, data: { currentTaskId: stillActive ? agent.currentTaskId : null } });
    }
    if (to !== 'blocked') await this.settleAgent(run.agentId, run.workspaceId, run.mode);
    else await c.agents.refreshById(run.workspaceId, run.agentId);
  }

  /**
   * An agent with no active run must not keep claiming "thinking/working/waiting". Safe to call any time
   * (e.g. after an approval decision that raced with the runtime's own outcome).
   */
  async settleAgent(agentId: string, workspaceId: string, mode: string): Promise<void> {
    const c = this.ctx();
    const agent = await c.db.agent.findUnique({ where: { id: agentId } });
    if (!agent) return;
    if ((await this.activeRunCount(agentId)) === 0 && ['thinking', 'working', 'waiting', 'starting'].includes(agent.storedState)) {
      await c.agents.setStored(agentId, 'idle', { source: mode === 'SIMULATED' ? 'simulation' : 'runtime', note: null });
    }
    await c.agents.refreshById(workspaceId, agentId);
  }

  // ------------------------------------------------------------------ start / plan / dispatch
  async startRun(workspaceId: string, taskId: string): Promise<RunWithAgent | null> {
    const c = this.ctx();
    const task = await c.db.task.findFirst({ where: { id: taskId, workspaceId }, include: { dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } } } });
    if (!task) throw notFound('Task');
    if (!task.assigneeAgentId) {
      await c.db.task.update({ where: { id: task.id }, data: { status: 'awaiting_assignment' } });
      return null;
    }
    const agent = await c.agents.load(workspaceId, task.assigneeAgentId);
    if (!agent) throw notFound('Agent');
    const settings = await c.settings.get(workspaceId);

    const open = task.dependencies.filter((d) => d.dependsOn.status !== 'completed');
    if (open.length) {
      await this.blockTask(task, agent, `dependency: waiting for ${open.map((d) => d.dependsOn.title).join(', ')}`);
      return null;
    }
    const active = await c.db.run.findFirst({ where: { taskId: task.id, state: { in: [...ACTIVE_RUN_STATES] } } });
    if (active) throw conflict('This task already has an active run');

    const attempt = (await c.db.run.count({ where: { taskId: task.id } })) + 1;
    const runId = newId();
    const traceId = newId();
    const now = c.clock.now();
    await c.db.run.create({ data: { id: runId, workspaceId, taskId: task.id, agentId: agent.id, mode: agent.mode, state: 'created', attempt, traceId, idempotencyKey: `${runId}:${attempt}`, outputs: [] } });
    await c.db.runStateTransition.create({ data: { id: newId(), runId, fromState: null, toState: 'created', reason: null, traceId, at: now } });
    await c.db.task.update({ where: { id: task.id }, data: { currentRunId: runId, mode: agent.mode, status: 'assigned', blockedReason: null } });
    await c.events.emit({ workspaceId, type: 'task.assigned', source: { kind: 'orchestrator', ref: this.instanceId }, mode: agent.mode, agentId: agent.id, taskId: task.id, runId, traceId, params: { task: task.title, agent: agent.name }, summary: `Task "${task.title}" assigned to ${agent.name}` });

    await this.transition(runId, 'planning', { reason: 'planning' });
    const eff = c.agents.toDTO(agent, settings);
    const elig = evaluateEligibility({
      enabled: agent.enabled, integrationConnected: agent.integration.status === 'connected' || agent.integration.status === 'degraded', effectiveState: eff.state,
      declaredCapabilities: agent.capabilities, requiredCapabilities: task.requiredCapabilities, activeRuns: 0, maxConcurrent: settings.maxConcurrentRunsPerAgent, dispatchPaused: settings.dispatchPaused,
    });
    // concurrency counts other runs of this agent (excluding the one just created)
    const others = (await this.activeRunCount(agent.id)) - 1;
    if (others >= settings.maxConcurrentRunsPerAgent && elig.eligible) {
      elig.eligible = false;
      elig.reasons.push('concurrency_limit');
      elig.checks.under_concurrency_limit = false;
    }
    const plan = buildPlan({ task, agent, eligibility: elig, dependencyTitles: task.dependencies.map((d) => d.dependsOn.title) });
    await c.db.run.update({ where: { id: runId }, data: { planJson: plan as unknown as Prisma.InputJsonValue, planVersion: 1 } });
    if (!elig.eligible) {
      return this.transition(runId, 'blocked', { reason: `not_eligible: ${elig.reasons.join(', ')}` });
    }
    const run = (await this.loadRun(runId))!;
    if (task.requiresApproval) {
      await this.transition(runId, 'awaiting_approval', { reason: 'pre_run_approval' });
      await c.approvals.createPreRun((await this.loadRun(runId))!);
      return this.loadRun(runId);
    }
    await this.transition(run.id, 'queued', { reason: 'eligible' });
    void this.dispatch(run.id).catch((err) => c.log.error({ err }, 'dispatch crashed'));
    return this.loadRun(run.id);
  }

  private async blockTask(task: Task, agent: AgentRow, reason: string): Promise<void> {
    const c = this.ctx();
    await c.db.task.update({ where: { id: task.id }, data: { status: 'blocked', blockedReason: reason, mode: agent.mode } });
    await c.events.emit({ workspaceId: task.workspaceId, type: 'task.blocked', source: { kind: 'orchestrator', ref: this.instanceId }, mode: agent.mode, agentId: agent.id, taskId: task.id, severity: 'warn', params: { task: task.title, reason }, summary: `Task "${task.title}" blocked: ${reason}` });
  }

  /** Lease-based claim, idempotent dispatch, bounded retries (ARCHITECTURE 6). */
  async dispatch(runId: string): Promise<void> {
    const c = this.ctx();
    const now = c.clock.now();
    const claimed = await c.db.run.updateMany({
      where: { id: runId, state: 'queued', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseOwner: this.instanceId, leaseUntil: new Date(now.getTime() + 30_000) },
    });
    if (claimed.count === 0) return;
    const run = await this.loadRun(runId);
    if (!run) return;
    const settings = await c.settings.get(run.workspaceId);
    const adapter = await c.adapters.get(run.agent.integration);
    await this.syncPeers(adapter, run);

    const deps = await c.db.taskDependency.findMany({ where: { taskId: run.taskId }, include: { dependsOn: { select: { title: true } } } });
    const depRuns = await c.db.run.findMany({ where: { taskId: { in: (await c.db.taskDependency.findMany({ where: { taskId: run.taskId }, select: { dependsOnId: true } })).map((d) => d.dependsOnId) }, state: 'completed' }, select: { resultSummary: true, taskId: true } });
    const input: DispatchInput = {
      runId: run.id, taskId: run.taskId, traceId: run.traceId, idempotencyKey: run.idempotencyKey, runtimeRef: run.agent.runtimeRef,
      objective: run.task.objective, expectedOutput: run.task.expectedOutput, deadlineAt: new Date(now.getTime() + settings.runDeadlineMs).toISOString(),
      allowedCapabilities: run.agent.permissions,
      context: deps.map((d) => `Dependency "${d.dependsOn.title}" completed: ${depRuns.find((r) => r.taskId === d.dependsOnId)?.resultSummary ?? '(no summary)'}`),
    };

    let res = await adapter.dispatchTask(input);
    for (let attempt = 0; !res.ok && res.error.retryable && attempt < 2; attempt++) {
      await sleep(backoff(attempt, c.config.retryBaseMs));
      res = await adapter.dispatchTask(input); // same idempotency key: a replay cannot start the work twice
    }
    await c.db.run.update({ where: { id: runId }, data: { leaseOwner: null, leaseUntil: null } });
    if (!res.ok) {
      const code = res.error.code;
      const reason = `dispatch_failed: ${code}: ${res.error.message}`;
      await this.transition(runId, code === 'AMBIGUOUS' || code === 'UNREACHABLE' || code === 'TIMEOUT' ? 'blocked' : 'failed', { reason });
      return;
    }
    const startedAt = c.clock.now();
    await this.transition(runId, 'running', { reason: 'dispatched', patch: { providerRunId: res.value.providerRunId, startedAt, deadlineAt: new Date(startedAt.getTime() + settings.runDeadlineMs) } });
    await c.db.agent.update({ where: { id: run.agentId }, data: { currentTaskId: run.taskId } });
    await c.events.emit({ workspaceId: run.workspaceId, type: 'task.started', source: { kind: 'orchestrator', ref: this.instanceId }, mode: run.mode, agentId: run.agentId, taskId: run.taskId, runId, traceId: run.traceId, params: { task: run.task.title, agent: run.agent.name }, summary: `${run.agent.name} started "${run.task.title}"` });
    await c.agents.touch({ agentId: run.agentId });
    await c.agents.setStored(run.agentId, 'thinking', { source: run.mode === 'SIMULATED' ? 'simulation' : `runtime:${run.agent.integration.kind.toLowerCase()}`, note: 'Task accepted' });
    await c.agents.refreshById(run.workspaceId, run.agentId);
    this.attachWatcher(runId, adapter, res.value.providerRunId);
  }

  private async syncPeers(adapter: RuntimeAdapter, run: RunWithAgent): Promise<void> {
    const setPeers = (adapter as unknown as { setPeers?: (r: string[]) => void }).setPeers;
    if (!setPeers) return;
    const peers = await this.ctx().db.agent.findMany({ where: { integrationId: run.agent.integrationId, enabled: true }, select: { runtimeRef: true } });
    setPeers.call(adapter, peers.map((p) => p.runtimeRef).filter((r): r is string => !!r));
  }

  attachWatcher(runId: string, adapter: RuntimeAdapter, providerRunId: string): void {
    this.watchers.get(runId)?.close();
    const sub = adapter.watchRun(providerRunId, (e) => {
      const prev = this.queues.get(runId) ?? Promise.resolve();
      const next = prev.then(() => this.processor.handle(runId, e)).catch((err) => this.ctx().log.error({ err }, 'run event failed'));
      this.queues.set(runId, next);
    });
    this.watchers.set(runId, sub);
  }

  /** Test helper: wait until every queued run event has been processed. */
  async idle(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  // ------------------------------------------------------------------ completion & verification
  async completeRun(run: RunWithAgent, summary: string, output: string | undefined, usage: Record<string, unknown> | undefined): Promise<void> {
    const c = this.ctx();
    const fresh = (await this.loadRun(run.id))!;
    if (TERMINAL_RUN_STATES.includes(fresh.state)) return;
    if (fresh.state === 'blocked' || fresh.state === 'awaiting_approval') await this.transition(run.id, 'running', { reason: 'runtime_reported_completion' });
    await this.transition(run.id, 'verifying', { reason: 'verifying' });
    const stored = Array.isArray(fresh.outputs) ? fresh.outputs.length : 0;
    const hasOutput = !!output?.trim() || stored > 0;
    if (fresh.task.expectedOutput && !hasOutput) {
      await this.transition(run.id, 'failed', { reason: 'verification_failed: the task expected output but the runtime produced none' });
      return;
    }
    await this.transition(run.id, 'completed', {
      reason: fresh.task.expectedOutput ? 'verified: output present' : 'completed: no automatic verification criteria were given',
      patch: { resultSummary: summary.slice(0, 2000), ...(usage ? { usage: usage as Prisma.InputJsonValue } : {}) },
    });
    await this.onTaskCompleted(run.workspaceId, run.taskId);
    void c;
  }

  async onTaskCompleted(workspaceId: string, taskId: string): Promise<void> {
    const c = this.ctx();
    const dependents = await c.db.task.findMany({
      where: { workspaceId, dependencies: { some: { dependsOnId: taskId } }, status: { in: ['created', 'blocked', 'awaiting_assignment'] }, assigneeAgentId: { not: null } },
      include: { dependencies: { include: { dependsOn: { select: { status: true } } } } },
    });
    for (const d of dependents) {
      if (d.status === 'blocked' && !d.blockedReason?.startsWith('dependency:')) continue;
      if (d.dependencies.every((x) => x.dependsOn.status === 'completed')) await this.startRun(workspaceId, d.id).catch((err) => c.log.error({ err }, 'dependent start failed'));
    }
  }

  // ------------------------------------------------------------------ user controls
  async cancelTask(workspaceId: string, taskId: string, userId: string): Promise<void> {
    const c = this.ctx();
    const run = await c.db.run.findFirst({ where: { workspaceId, taskId, state: { in: [...ACTIVE_RUN_STATES, 'blocked'] } }, orderBy: { createdAt: 'desc' }, include: RUN_INCLUDE });
    if (!run) {
      const t = await c.db.task.findFirst({ where: { id: taskId, workspaceId } });
      if (!t) throw notFound('Task');
      if (['completed', 'failed', 'cancelled'].includes(t.status)) throw conflict(`Task is already ${t.status}`);
      await c.db.task.update({ where: { id: taskId }, data: { status: 'cancelled', blockedReason: null } });
      await c.events.emit({ workspaceId, type: 'task.cancelled', source: { kind: 'user', ref: userId }, mode: t.mode, taskId, params: { task: t.title }, summary: `Task "${t.title}" cancelled` });
      return;
    }
    await this.stopRun(run, userId, 'cancelled_by_user');
  }

  async stopRun(run: RunWithAgent, userId: string, reason: string): Promise<void> {
    const c = this.ctx();
    if (run.providerRunId) {
      const adapter = await c.adapters.get(run.agent.integration);
      const r = await adapter.cancelRun(run.providerRunId);
      if (!r.ok) {
        if (r.error.code === 'NOT_SUPPORTED') throw new ApiError('not_supported', r.error.message);
        throw new ApiError('runtime_unreachable', `Could not confirm the stop with the runtime: ${r.error.message}`);
      }
    }
    await c.audit.log({ workspaceId: run.workspaceId, actorUserId: userId, action: 'run.stop', entity: 'run', entityId: run.id, details: { reason } });
    await this.transition(run.id, 'cancelled', { reason });
  }

  async retryTask(workspaceId: string, taskId: string): Promise<RunWithAgent | null> {
    const t = await this.ctx().db.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!t) throw notFound('Task');
    if (['running', 'completed'].includes(t.status)) throw conflict(`Task is ${t.status}`);
    return this.startRun(workspaceId, taskId);
  }

  async emergencyStop(workspaceId: string, userId: string): Promise<{ runId: string; stopped: boolean; detail: string }[]> {
    const c = this.ctx();
    await c.settings.update(workspaceId, { dispatchPaused: true });
    const runs = await c.db.run.findMany({ where: { workspaceId, state: { in: [...ACTIVE_RUN_STATES] } }, include: RUN_INCLUDE });
    const results: { runId: string; stopped: boolean; detail: string }[] = [];
    for (const run of runs) {
      try {
        if (run.providerRunId) {
          const adapter = await c.adapters.get(run.agent.integration);
          const r = await adapter.cancelRun(run.providerRunId);
          if (!r.ok) {
            await this.transition(run.id, 'blocked', { reason: `emergency_stop_unconfirmed: ${r.error.message}` }).catch(() => undefined);
            results.push({ runId: run.id, stopped: false, detail: r.error.message });
            continue;
          }
        }
        await this.transition(run.id, 'cancelled', { reason: 'emergency_stop' });
        results.push({ runId: run.id, stopped: true, detail: 'stopped' });
      } catch (err) {
        results.push({ runId: run.id, stopped: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    await c.audit.log({ workspaceId, actorUserId: userId, action: 'control.emergency_stop', details: { results } });
    await c.events.emit({ workspaceId, type: 'control.emergency_stop', source: { kind: 'user', ref: userId }, mode: 'REAL', severity: 'critical', params: { stopped: results.filter((r) => r.stopped).length, total: results.length }, summary: `Emergency stop: ${results.filter((r) => r.stopped).length}/${results.length} runs stopped, dispatch paused`, payload: { results } });
    return results;
  }

  // ------------------------------------------------------------------ sweepers & recovery
  async sweep(): Promise<void> {
    const c = this.ctx();
    await c.approvals.sweepExpired();
    const late = await c.db.run.findMany({ where: { state: { in: ['running', 'awaiting_approval', 'blocked'] }, deadlineAt: { lt: c.clock.now() } }, include: RUN_INCLUDE });
    for (const run of late) {
      if (run.providerRunId) {
        const adapter = await c.adapters.get(run.agent.integration);
        await adapter.cancelRun(run.providerRunId).catch(() => undefined);
      }
      await this.transition(run.id, 'timed_out', { reason: 'deadline_exceeded' }).catch(() => undefined);
    }
  }

  async reconcile(runId: string, reason: string): Promise<void> {
    const c = this.ctx();
    const run = await this.loadRun(runId);
    if (!run || TERMINAL_RUN_STATES.includes(run.state)) return;
    if (!run.providerRunId) {
      if (['created', 'planning', 'queued'].includes(run.state)) await this.transition(run.id, 'blocked', { reason: 'restart_before_dispatch' });
      return;
    }
    const adapter = await c.adapters.get(run.agent.integration);
    const snap = await adapter.getRun(run.providerRunId);
    if (!snap.ok) {
      if (snap.error.code === 'REJECTED' && run.mode === 'SIMULATED') await this.transition(run.id, 'failed', { reason: 'simulation_restarted' });
      else if (snap.error.code === 'REJECTED') await this.transition(run.id, 'blocked', { reason: 'runtime_does_not_know_this_run' });
      else if (run.state !== 'blocked') await this.transition(run.id, 'blocked', { reason }).catch(() => undefined);
      return;
    }
    const s = snap.value;
    switch (s.status) {
      case 'completed': await this.completeRun(run, (s.output ?? 'Run completed').slice(0, 400), s.output ?? undefined, s.usage ?? undefined); break;
      case 'failed': case 'interrupted': await this.transition(run.id, 'failed', { reason: s.failureReason ?? `runtime reported ${s.status}` }); break;
      case 'cancelled': await this.transition(run.id, 'cancelled', { reason: 'runtime reported cancelled' }); break;
      case 'running': case 'stopping':
        if (run.state === 'blocked') await this.transition(run.id, 'running', { reason: 'runtime reconnected' });
        this.attachWatcher(run.id, adapter, run.providerRunId);
        break;
      default: if (run.state !== 'blocked') await this.transition(run.id, 'blocked', { reason: 'runtime_status_unknown' });
    }
  }

  async onIntegrationConnected(integrationId: string): Promise<void> {
    const c = this.ctx();
    const runs = await c.db.run.findMany({ where: { state: 'blocked', providerRunId: { not: null }, agent: { integrationId } }, select: { id: true } });
    for (const r of runs) await this.reconcile(r.id, 'reconnected').catch((err) => c.log.error({ err }, 'reconcile failed'));
  }

  /** On API start: nothing is assumed about runs that were in flight. */
  async recover(): Promise<void> {
    const c = this.ctx();
    const runs = await c.db.run.findMany({ where: { state: { in: [...ACTIVE_RUN_STATES, 'blocked'] } }, select: { id: true } });
    for (const r of runs) await this.reconcile(r.id, 'recovered_after_restart').catch((err) => c.log.error({ err }, 'recovery failed'));
  }

  shutdown(): void {
    for (const s of this.watchers.values()) s.close();
    this.watchers.clear();
  }
}
