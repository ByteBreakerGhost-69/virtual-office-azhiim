import type { ActionCategory } from '@avo/shared';
import {
  type AdapterConfig,
  type AdapterDescriptor,
  type AdapterResult,
  type ApprovalRequestRef,
  type DiscoveredAgent,
  type DispatchInput,
  type DispatchOutput,
  type HealthReport,
  type ProviderRunSnapshot,
  type ProviderRunStatus,
  type RuntimeAdapter,
  type RuntimeEvent,
  type RuntimeEventHandler,
  type Subscription,
  fail,
  ok,
} from '../types.js';
import { hashString, mulberry32 } from '../util.js';

export const SIMULATED_DESCRIPTOR: AdapterDescriptor = {
  kind: 'SIMULATED',
  label: 'Simulated runtime (scripted demo)',
  available: true,
  simulated: true,
  features: { pause: true, resume: true, cancel: true, approvals: true, eventStream: true },
  config: { baseUrlRequired: false, secretRequired: false },
  notes: 'Scripted, deterministic demo runtime. Everything it produces is labelled [SIMULATED] and is never mixed with REAL runtime data.',
};

export interface SimulatedAdapterOptions {
  seed?: number;
  /** Timeline speed multiplier (tests use large values). */
  speed?: number;
  clock?: { now(): Date };
  heartbeatIntervalMs?: number;
  peers?: string[];
}

interface SimRun {
  id: string;
  input: DispatchInput;
  status: ProviderRunStatus;
  events: RuntimeEvent[];
  timers: Set<ReturnType<typeof setTimeout>>;
  output: string | null;
  failureReason: string | null;
  approval?: { ref: ApprovalRequestRef; resolve: (d: 'approve' | 'reject') => void };
  cancel: () => void;
  cancelled: boolean;
}

const TOOLS = ['web.search', 'file.read', 'code.execute', 'file.write', 'web.browse'] as const;
const GATE_PATTERN = /deploy|publish|delete/i;

export class SimulatedAdapter implements RuntimeAdapter {
  readonly kind = 'SIMULATED' as const;
  readonly descriptor = SIMULATED_DESCRIPTOR;
  private readonly speed: number;
  private readonly now: () => Date;
  private readonly hbMs: number;
  private readonly seed: number;
  private peers: string[];
  private readonly runs = new Map<string, SimRun>();
  private readonly runHandlers = new Map<string, Set<RuntimeEventHandler>>();
  private readonly adapterHandlers = new Set<RuntimeEventHandler>();
  private readonly paused = new Set<string>();
  private hb: ReturnType<typeof setInterval> | null = null;
  private counter = 0;

  constructor(
    readonly config: AdapterConfig,
    opts: SimulatedAdapterOptions = {},
  ) {
    this.speed = Math.max(0.01, opts.speed ?? 1);
    this.now = () => (opts.clock ? opts.clock.now() : new Date());
    this.hbMs = opts.heartbeatIntervalMs ?? 3000;
    this.seed = opts.seed ?? 1;
    this.peers = opts.peers ?? [];
  }

  setPeers(refs: string[]): void {
    this.peers = [...refs];
  }

  // ----- lifecycle -----
  async connect(): Promise<AdapterResult<void>> {
    this.startHeartbeats();
    return ok(undefined);
  }

  async healthCheck(): Promise<AdapterResult<HealthReport>> {
    return ok({ ok: true, latencyMs: 0, checkedAt: this.now().toISOString(), detail: 'SIMULATED runtime (in-process)', capabilities: ['simulated.runs'] });
  }

  async listAgents(): Promise<AdapterResult<DiscoveredAgent[]>> {
    return fail('NOT_SUPPORTED', 'The simulated runtime has no discoverable agents; agents are created by the simulation seed.');
  }

  async disconnect(): Promise<void> {
    if (this.hb) clearInterval(this.hb);
    this.hb = null;
    for (const r of this.runs.values()) {
      r.cancelled = true;
      r.cancel();
    }
    this.adapterHandlers.clear();
    this.runHandlers.clear();
  }

  private startHeartbeats(): void {
    if (this.hb) return;
    this.hb = setInterval(() => this.emitAdapter({ type: 'agent.heartbeat', at: this.now().toISOString(), runtimeRef: null }), this.hbMs);
    this.hb.unref?.();
    this.emitAdapter({ type: 'agent.heartbeat', at: this.now().toISOString(), runtimeRef: null });
  }

  // ----- run API -----
  async dispatchTask(input: DispatchInput): Promise<AdapterResult<DispatchOutput>> {
    const existing = [...this.runs.values()].find((r) => r.input.idempotencyKey === input.idempotencyKey);
    if (existing) return ok({ providerRunId: existing.id });
    if (input.runtimeRef && this.paused.has(input.runtimeRef)) return fail('REJECTED', 'Simulated agent is paused', false);
    const id = `sim-${hashString(input.runId).toString(36)}-${++this.counter}`;
    const run: SimRun = {
      id,
      input,
      status: 'running',
      events: [],
      timers: new Set(),
      output: null,
      failureReason: null,
      cancelled: false,
      cancel: () => {
        for (const t of run.timers) clearTimeout(t);
        run.timers.clear();
        run.approval?.resolve('reject');
      },
    };
    this.runs.set(id, run);
    this.startHeartbeats();
    void this.script(run).catch(() => undefined);
    return ok({ providerRunId: id });
  }

  async getRun(providerRunId: string): Promise<AdapterResult<ProviderRunSnapshot>> {
    const r = this.runs.get(providerRunId);
    if (!r) return fail('REJECTED', 'Unknown simulated run (the simulated runtime lost its memory, e.g. after a restart)', false);
    return ok({ providerRunId, status: r.status, output: r.output, usage: null, failureReason: r.failureReason });
  }

  async cancelRun(providerRunId: string): Promise<AdapterResult<void>> {
    const r = this.runs.get(providerRunId);
    if (!r) return fail('REJECTED', 'Unknown simulated run', false);
    if (r.status !== 'running') return ok(undefined);
    r.cancelled = true;
    r.cancel();
    this.finish(r, { type: 'task.cancelled', at: this.now().toISOString(), providerRunId: r.id }, 'cancelled');
    return ok(undefined);
  }

  async decideApproval(providerRunId: string, requestRef: ApprovalRequestRef, decision: 'approve' | 'reject'): Promise<AdapterResult<void>> {
    const r = this.runs.get(providerRunId);
    if (!r?.approval || r.approval.ref.requestId !== requestRef.requestId) return fail('CONFLICT', 'No such pending approval', false);
    r.approval.resolve(decision);
    return ok(undefined);
  }

  async pauseAgent(runtimeRef: string | null): Promise<AdapterResult<void>> {
    this.paused.add(runtimeRef ?? '*');
    return ok(undefined);
  }
  async resumeAgent(runtimeRef: string | null): Promise<AdapterResult<void>> {
    this.paused.delete(runtimeRef ?? '*');
    return ok(undefined);
  }

  subscribeEvents(handler: RuntimeEventHandler): Subscription {
    this.adapterHandlers.add(handler);
    return { close: () => this.adapterHandlers.delete(handler) };
  }

  watchRun(providerRunId: string, handler: RuntimeEventHandler): Subscription {
    let set = this.runHandlers.get(providerRunId);
    if (!set) this.runHandlers.set(providerRunId, (set = new Set()));
    set.add(handler);
    const run = this.runs.get(providerRunId);
    // Replay what already happened so a late watcher never misses the start of a run.
    if (run) for (const e of [...run.events]) queueMicrotask(() => set?.has(handler) && handler(e));
    return { close: () => set?.delete(handler) };
  }

  // ----- scripted timeline -----
  private emitAdapter(e: RuntimeEvent): void {
    for (const h of [...this.adapterHandlers]) h(e);
  }

  private emitRun(r: SimRun, e: RuntimeEvent): void {
    r.events.push(e);
    for (const h of [...(this.runHandlers.get(r.id) ?? [])]) h(e);
  }

  private finish(r: SimRun, e: RuntimeEvent, status: ProviderRunStatus): void {
    if (r.status !== 'running') return;
    r.status = status;
    this.emitRun(r, e);
  }

  private wait(r: SimRun, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        r.timers.delete(t);
        resolve();
      }, Math.max(0, ms / this.speed));
      r.timers.add(t);
      if (r.cancelled) {
        clearTimeout(t);
        resolve();
      }
    });
  }

  private async script(r: SimRun): Promise<void> {
    const rng = mulberry32(this.seed ^ hashString(r.input.runId));
    const at = () => this.now().toISOString();
    const pid = r.id;
    const alive = () => !r.cancelled && r.status === 'running';

    await this.wait(r, 300);
    if (!alive()) return;
    this.emitRun(r, { type: 'task.accepted', at: at(), providerRunId: pid });
    this.emitRun(r, { type: 'task.progress', at: at(), providerRunId: pid, kind: 'thinking', note: '[SIMULATED] Analysing the task' });
    await this.wait(r, 900 + rng() * 800);

    const tools = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < tools && alive(); i++) {
      while (alive() && this.isPaused(r)) await this.wait(r, 200);
      const tool = TOOLS[Math.floor(rng() * TOOLS.length)] ?? 'web.search';
      this.emitRun(r, { type: 'task.progress', at: at(), providerRunId: pid, kind: 'tool', tool, note: `[SIMULATED] Using ${tool}` });
      await this.wait(r, 1200 + rng() * 1300);
      if (!alive()) return;
      this.emitRun(r, { type: 'task.progress', at: at(), providerRunId: pid, kind: 'tool', tool, note: `[SIMULATED] Finished ${tool}` });
    }
    if (!alive()) return;

    const peer = this.peers.filter((p) => p !== r.input.runtimeRef)[Math.floor(rng() * Math.max(1, this.peers.length))];
    if (peer && rng() < 0.6) {
      this.emitRun(r, { type: 'agent.message', at: at(), providerRunId: pid, fromRuntimeRef: r.input.runtimeRef, toRuntimeRef: peer, body: '[SIMULATED] Quick sync: sharing interim findings before I finish.' });
      await this.wait(r, 1500);
      if (!alive()) return;
    }

    if (GATE_PATTERN.test(r.input.objective)) {
      const category: ActionCategory = /delete/i.test(r.input.objective) ? 'destructive' : /deploy/i.test(r.input.objective) ? 'deployment' : 'external.publish';
      const ref: ApprovalRequestRef = { requestId: `sim-approval-${pid}`, executionGeneration: 1 };
      const decision = await new Promise<'approve' | 'reject'>((resolve) => {
        r.approval = { ref, resolve };
        this.emitRun(r, {
          type: 'action.approval_required',
          at: at(),
          providerRunId: pid,
          requestRef: ref,
          category,
          target: '[SIMULATED] target',
          argsSummary: `[SIMULATED] Requests permission for a ${category} action described in: ${r.input.objective.slice(0, 120)}`,
          risk: category === 'destructive' ? 'critical' : 'high',
          payload: { runId: r.input.runId, category, objective: r.input.objective },
        });
      });
      delete r.approval;
      if (!alive()) return;
      if (decision === 'reject') {
        r.failureReason = 'approval_rejected';
        this.finish(r, { type: 'task.failed', at: at(), providerRunId: pid, reason: 'approval_rejected', retryable: false }, 'failed');
        return;
      }
    }

    await this.wait(r, 700);
    if (!alive()) return;
    const output = `[SIMULATED] Completed "${r.input.objective.slice(0, 80)}". This text was produced by the scripted demo runtime, not by a real agent.`;
    r.output = output;
    this.emitRun(r, { type: 'task.output', at: at(), providerRunId: pid, content: output, final: true });
    this.finish(r, { type: 'task.completed', at: at(), providerRunId: pid, summary: output, output }, 'completed');
  }

  private isPaused(r: SimRun): boolean {
    return this.paused.has('*') || (r.input.runtimeRef !== null && this.paused.has(r.input.runtimeRef));
  }
}
