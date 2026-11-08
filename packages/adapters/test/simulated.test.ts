import { describe, expect, it } from 'vitest';
import { SimulatedAdapter, createAdapter, ADAPTER_DESCRIPTORS, AdapterUnavailableError, type RuntimeEvent } from '../src/index.js';

const input = (objective: string, id = 'r1', ref: string | null = 'agent-a') => ({
  runId: id, taskId: 't', traceId: 'tr', idempotencyKey: `${id}:1`, runtimeRef: ref, objective, allowedCapabilities: [],
});
const run = async (a: SimulatedAdapter, objective: string, onEvent?: (e: RuntimeEvent) => void, id = 'r1') => {
  const d = await a.dispatchTask(input(objective, id));
  if (!d.ok) throw new Error('dispatch failed');
  return new Promise<RuntimeEvent[]>((resolve) => {
    const ev: RuntimeEvent[] = [];
    a.watchRun(d.value.providerRunId, (e) => {
      ev.push(e);
      onEvent?.(e);
      if (e.type === 'task.completed' || e.type === 'task.failed' || e.type === 'task.cancelled') resolve(ev);
    });
  });
};
const types = (ev: RuntimeEvent[]) => ev.map((e) => e.type + ('note' in e ? ':' + e.note : ''));

describe('SimulatedAdapter', () => {
  it('is labelled simulated and never constructible as HERMES', () => {
    const a = createAdapter('SIMULATED', { integrationId: 'i' });
    expect(a.kind).toBe('SIMULATED');
    expect(a.descriptor.simulated).toBe(true);
    expect(ADAPTER_DESCRIPTORS.HERMES.simulated).toBe(false);
  });
  it('runs a scripted timeline and labels every generated string [SIMULATED]', async () => {
    const a = new SimulatedAdapter({ integrationId: 'i' }, { speed: 200, peers: ['agent-b'] });
    const ev = await run(a, 'research competitors');
    expect(ev[0]?.type).toBe('task.accepted');
    const done = ev.at(-1);
    expect(done?.type).toBe('task.completed');
    for (const e of ev) {
      if (e.type === 'task.progress') expect(e.note.startsWith('[SIMULATED]')).toBe(true);
      if (e.type === 'task.completed') expect(e.summary.startsWith('[SIMULATED]')).toBe(true);
    }
    await a.disconnect();
  });
  it('is deterministic for the same seed and run id', async () => {
    const mk = () => new SimulatedAdapter({ integrationId: 'i' }, { seed: 7, speed: 500, peers: ['agent-b'] });
    const a = mk(), b = mk();
    const [x, y] = await Promise.all([run(a, 'same objective'), run(b, 'same objective')]);
    expect(types(x)).toEqual(types(y));
    await a.disconnect(); await b.disconnect();
  });
  it('waits on the approval gate and continues on approve', async () => {
    const a = new SimulatedAdapter({ integrationId: 'i' }, { speed: 500 });
    let decided = false;
    const ev = await run(a, 'deploy the release', (e) => {
      if (e.type === 'action.approval_required' && !decided) {
        decided = true;
        void a.decideApproval(e.providerRunId, e.requestRef, 'approve');
      }
    });
    expect(ev.some((e) => e.type === 'action.approval_required')).toBe(true);
    expect(ev.at(-1)?.type).toBe('task.completed');
    await a.disconnect();
  });
  it('fails the run when the approval is rejected', async () => {
    const a = new SimulatedAdapter({ integrationId: 'i' }, { speed: 500 });
    const ev = await run(a, 'delete old records', (e) => {
      if (e.type === 'action.approval_required') void a.decideApproval(e.providerRunId, e.requestRef, 'reject');
    });
    expect(ev.at(-1)).toMatchObject({ type: 'task.failed', reason: 'approval_rejected' });
    await a.disconnect();
  });
  it('cancels a running run', async () => {
    const a = new SimulatedAdapter({ integrationId: 'i' }, { speed: 1 });
    const d = await a.dispatchTask(input('long job'));
    if (!d.ok) throw new Error('x');
    await a.cancelRun(d.value.providerRunId);
    const s = await a.getRun(d.value.providerRunId);
    expect(s.ok && s.value.status).toBe('cancelled');
    await a.disconnect();
  });
  it('emits its own heartbeats (so a stopped process goes stale like a real runtime)', async () => {
    const a = new SimulatedAdapter({ integrationId: 'i' }, { heartbeatIntervalMs: 20 });
    const beats: RuntimeEvent[] = [];
    a.subscribeEvents((e) => beats.push(e));
    await a.connect();
    await new Promise((r) => setTimeout(r, 90));
    expect(beats.filter((e) => e.type === 'agent.heartbeat').length).toBeGreaterThanOrEqual(2);
    await a.disconnect();
  });
  it('dispatch is idempotent per key', async () => {
    const a = new SimulatedAdapter({ integrationId: 'i' }, { speed: 1000 });
    const x = await a.dispatchTask(input('a'));
    const y = await a.dispatchTask(input('a'));
    expect(x.ok && y.ok && x.value.providerRunId === y.value.providerRunId).toBe(true);
    await a.disconnect();
  });
  it('unavailable kinds throw AdapterUnavailableError', () => {
    expect(() => createAdapter('OPENCLAW', { integrationId: 'i' })).toThrow(AdapterUnavailableError);
    expect(() => createAdapter('INTERNAL', { integrationId: 'i' })).toThrow(AdapterUnavailableError);
    expect(ADAPTER_DESCRIPTORS.OPENCLAW.available).toBe(false);
  });
});
