import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HermesAdapter, type RuntimeEvent } from '../src/index.js';
import { startHermesContractDouble, type HermesDoubleHandle } from '../src/testing/index.js';

let dbl: HermesDoubleHandle;
const mk = (over: Partial<ConstructorParameters<typeof HermesAdapter>[0]> = {}, logs: string[] = []) =>
  new HermesAdapter(
    { integrationId: 'i1', baseUrl: dbl.url, secret: dbl.apiKey, timeoutMs: 2000, ...over },
    { logger: { debug: (m) => logs.push(m), warn: (m, x) => logs.push(m + JSON.stringify(x ?? {})), error: (m, x) => logs.push(m + JSON.stringify(x ?? {})) } },
  );
const input = (objective: string, key = 'k-1') => ({
  runId: 'r1', taskId: 't1', traceId: 'tr1', idempotencyKey: key, runtimeRef: null, objective, allowedCapabilities: ['text.generate'],
});
const collect = (a: HermesAdapter, id: string) =>
  new Promise<RuntimeEvent[]>((resolve) => {
    const ev: RuntimeEvent[] = [];
    const sub = a.watchRun(id, (e) => {
      ev.push(e);
      if (['task.completed', 'task.failed', 'task.cancelled', 'runtime.disconnected'].includes(e.type)) {
        sub.close();
        resolve(ev);
      }
    });
  });

beforeEach(async () => {
  dbl = await startHermesContractDouble({ stepMs: 30 });
});
afterEach(async () => {
  await dbl.close();
});

describe('HermesAdapter against the contract double', () => {
  it('healthCheck ok with capabilities', async () => {
    const r = await mk().healthCheck();
    expect(r.ok && r.value.ok).toBe(true);
    expect(r.ok && r.value.capabilities).toContain('hermes.run_submission');
  });
  it('reports a wrong API key honestly (health is unauthenticated)', async () => {
    const r = await mk({ secret: 'wrong' }).healthCheck();
    expect(r.ok && r.value.ok).toBe(false);
    expect(r.ok && r.value.detail).toMatch(/invalid API key/);
  });
  it('reports unreachable runtimes as not ok', async () => {
    const r = await mk({ baseUrl: 'http://127.0.0.1:9' }).healthCheck();
    expect(r.ok && r.value.ok).toBe(false);
  });
  it('unhealthy /health => not ok', async () => {
    dbl.controls.failHealth = true;
    const r = await mk().healthCheck();
    expect(r.ok && r.value.ok).toBe(false);
  });
  it('dispatch sends bearer + Idempotency-Key and replays safely', async () => {
    const a = mk();
    const r1 = await a.dispatchTask(input('write a haiku', 'same-key'));
    const r2 = await a.dispatchTask(input('write a haiku', 'same-key'));
    expect(r1.ok && r2.ok && r1.value.providerRunId === r2.value.providerRunId).toBe(true);
    const post = dbl.received.find((x) => x.method === 'POST' && x.path === '/v1/runs');
    expect(post?.headers.authorization).toBe(`Bearer ${dbl.apiKey}`);
    expect(post?.headers['idempotency-key']).toBe('same-key');
  });
  it('maps a full run to normalized events and completes', async () => {
    const a = mk();
    const d = await a.dispatchTask(input('summarize the doc'));
    if (!d.ok) throw new Error('dispatch failed');
    const ev = await collect(a, d.value.providerRunId);
    const types = ev.map((e) => e.type);
    expect(types).toContain('task.progress');
    expect(types.at(-1)).toBe('task.completed');
    expect(ev.find((e) => e.type === 'task.output')).toMatchObject({ final: true });
  });
  it('approval round-trip (approve)', async () => {
    const a = mk();
    const d = await a.dispatchTask(input('deploy the site'));
    if (!d.ok) throw new Error('dispatch failed');
    const ev: RuntimeEvent[] = [];
    const done = new Promise<void>((resolve) => {
      a.watchRun(d.value.providerRunId, async (e) => {
        ev.push(e);
        if (e.type === 'action.approval_required') {
          expect(e.category).toBe('deployment');
          const r = await a.decideApproval(d.value.providerRunId, e.requestRef, 'approve');
          expect(r.ok).toBe(true);
        }
        if (e.type === 'task.completed') resolve();
      });
    });
    await done;
    expect(ev.some((e) => e.type === 'action.approval_required')).toBe(true);
  });
  it('approval reject => task.failed', async () => {
    const a = mk();
    const d = await a.dispatchTask(input('delete the data'));
    if (!d.ok) throw new Error('dispatch failed');
    const result = new Promise<RuntimeEvent>((resolve) => {
      a.watchRun(d.value.providerRunId, async (e) => {
        if (e.type === 'action.approval_required') await a.decideApproval(d.value.providerRunId, e.requestRef, 'reject');
        if (e.type === 'task.failed') resolve(e);
      });
    });
    expect((await result).type).toBe('task.failed');
  });
  it('cancel stops a run', async () => {
    const a = mk();
    const d = await a.dispatchTask(input('long task'));
    if (!d.ok) throw new Error('dispatch failed');
    expect((await a.cancelRun(d.value.providerRunId)).ok).toBe(true);
    const snap = await a.getRun(d.value.providerRunId);
    expect(snap.ok && snap.value.status).toBe('cancelled');
  });
  it('pause/resume are NOT_SUPPORTED, never a fake success', async () => {
    const a = mk();
    const p = await a.pauseAgent();
    expect(!p.ok && p.error.code).toBe('NOT_SUPPORTED');
    const r = await a.resumeAgent();
    expect(!r.ok && r.error.code).toBe('NOT_SUPPORTED');
    expect(a.descriptor.features.pause).toBe(false);
  });
  it('429 is retryable RATE_LIMITED, 503 retryable UNREACHABLE', async () => {
    dbl.controls.maxConcurrentRuns = 0;
    const r = await mk().dispatchTask(input('x'));
    expect(!r.ok && r.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    dbl.controls.maxConcurrentRuns = 10;
    dbl.controls.draining = true;
    const r2 = await mk().dispatchTask(input('y', 'k-2'));
    expect(!r2.ok && r2.error.retryable).toBe(true);
  });
  it('timeout after sending POST /v1/runs is AMBIGUOUS (not a plain failure)', async () => {
    dbl.controls.holdRunResponseMs = 600;
    const r = await mk({ timeoutMs: 100 }).dispatchTask(input('slow', 'k-3'));
    expect(!r.ok && r.error.code).toBe('AMBIGUOUS');
  });
  it('wrong key on dispatch => UNAUTHORIZED and the key never appears in logs', async () => {
    const logs: string[] = [];
    const a = mk({ secret: 'super-secret-key-123' }, logs);
    const r = await a.dispatchTask(input('x', 'k-4'));
    expect(!r.ok && r.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(r)).not.toContain('super-secret-key-123');
    expect(logs.join('\n')).not.toContain('super-secret-key-123');
  });
  it('recovers from a dropped event stream by reconnecting', async () => {
    dbl.controls.dropSseAfter = 2;
    const a = mk();
    const d = await a.dispatchTask(input('survive a drop'));
    if (!d.ok) throw new Error('dispatch failed');
    const ev = await collect(a, d.value.providerRunId);
    expect(ev.at(-1)?.type).toBe('task.completed');
  });
  it('interrupted outcome => task.failed', async () => {
    dbl.controls.outcome = 'interrupted';
    const a = mk();
    const d = await a.dispatchTask(input('interrupt me'));
    if (!d.ok) throw new Error('dispatch failed');
    expect((await collect(a, d.value.providerRunId)).at(-1)?.type).toBe('task.failed');
  });
  it('encodes the profile in the provider run id and uses /p/<profile>/', async () => {
    const a = mk();
    const d = await a.dispatchTask({ ...input('profiled', 'k-5'), runtimeRef: 'research' });
    if (!d.ok) throw new Error('dispatch failed');
    expect(d.value.providerRunId.startsWith('research::')).toBe(true);
    expect(dbl.received.some((r) => r.path === '/p/research/v1/runs')).toBe(true);
    expect((await a.getRun(d.value.providerRunId)).ok).toBe(true);
  });
});
