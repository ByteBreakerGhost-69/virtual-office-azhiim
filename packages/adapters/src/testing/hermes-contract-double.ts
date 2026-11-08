/**
 * TEST DOUBLE — implements the documented Hermes API shapes; it is not Hermes and passing against it
 * does not prove compatibility with a live install. Used only by contract tests and the e2e suite.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface HermesDoubleOptions {
  apiKey?: string;
  port?: number;
  /** ms between scripted run events */
  stepMs?: number;
}

interface DoubleRun {
  id: string;
  input: string;
  status: 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  output: string;
  events: { event: string; data: unknown }[];
  waiters: Set<(e: { event: string; data: unknown }) => void>;
  approvalResolve?: (choice: string) => void;
  timers: Set<ReturnType<typeof setTimeout>>;
  profile: string | null;
}

export interface HermesDoubleControls {
  delayMs: number;
  failHealth: boolean;
  requireKey: boolean;
  /** drop each SSE connection after N events (0 = never) */
  dropSseAfter: number;
  /** if the objective matches, emit approval.request and wait */
  approvalPattern: RegExp | null;
  maxConcurrentRuns: number;
  draining: boolean;
  outcome: 'completed' | 'interrupted';
  /** hold POST /v1/runs this long before answering (to test ambiguous timeouts) */
  holdRunResponseMs: number;
}

export interface HermesDoubleHandle {
  url: string;
  apiKey: string;
  controls: HermesDoubleControls;
  received: { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown }[];
  runs: Map<string, DoubleRun>;
  close(): Promise<void>;
}

export async function startHermesContractDouble(opts: HermesDoubleOptions = {}): Promise<HermesDoubleHandle> {
  const apiKey = opts.apiKey ?? 'test-double-key';
  const stepMs = opts.stepMs ?? 150;
  const controls: HermesDoubleControls = {
    delayMs: 0,
    failHealth: false,
    requireKey: true,
    dropSseAfter: 0,
    approvalPattern: /deploy|publish|delete/i,
    maxConcurrentRuns: 10,
    draining: false,
    outcome: 'completed',
    holdRunResponseMs: 0,
  };
  const received: HermesDoubleHandle['received'] = [];
  const runs = new Map<string, DoubleRun>();
  const idem = new Map<string, string>();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', ...extra });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        try {
          resolve(b ? JSON.parse(b) : undefined);
        } catch {
          resolve(undefined);
        }
      });
    });

  const push = (run: DoubleRun, event: string, data: unknown) => {
    const e = { event, data };
    run.events.push(e);
    for (const w of run.waiters) w(e);
  };
  const after = (run: DoubleRun, ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      run.timers.delete(t);
      fn();
    }, ms);
    run.timers.add(t);
  };

  const script = (run: DoubleRun) => {
    after(run, stepMs, () => {
      push(run, 'tool.started', { tool: 'web.search' });
      after(run, stepMs, () => {
        push(run, 'tool.completed', { tool: 'web.search' });
        const finish = () => {
          after(run, stepMs, () => {
            if (run.status !== 'running') return;
            if (controls.outcome === 'interrupted') {
              run.status = 'interrupted';
              push(run, 'run.interrupted', { reason: 'interrupted by test double' });
              return;
            }
            for (const piece of ['Done: ', run.input.slice(0, 40)]) {
              run.output += piece;
              push(run, 'message.delta', { delta: piece });
            }
            run.status = 'completed';
            push(run, 'run.completed', { output: run.output, usage: { input_tokens: 10, output_tokens: 5 } });
          });
        };
        if (controls.approvalPattern?.test(run.input)) {
          push(run, 'approval.request', { request_id: `appr-${run.id}`, execution_generation: 1, summary: `Run command for: ${run.input.slice(0, 60)}`, tool: 'terminal' });
          run.approvalResolve = (choice) => {
            if (choice === 'deny') {
              run.status = 'interrupted';
              push(run, 'run.interrupted', { reason: 'approval denied' });
            } else finish();
          };
        } else finish();
      });
    });
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/^\/p\/[^/]+/, '');
    const profile = /^\/p\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    received.push({ method: req.method ?? 'GET', path: url.pathname, headers: { ...req.headers }, body });
    if (controls.delayMs) await sleep(controls.delayMs);

    if (path === '/health' || path === '/v1/health') {
      if (controls.failHealth) return json(res, 503, { status: 'down' });
      return json(res, 200, { status: 'ok' });
    }
    if (controls.requireKey && req.headers.authorization !== `Bearer ${apiKey}`) {
      return json(res, 401, { error: { code: 'invalid_api_key', message: 'Invalid API key' } });
    }
    if (path === '/v1/capabilities' && req.method === 'GET') {
      return json(res, 200, { object: 'hermes.api_server.capabilities', features: { run_submission: true, run_events_sse: true, run_stop: true, reasoning_streaming: true } });
    }
    if (path === '/v1/models' && req.method === 'GET') {
      return json(res, 200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model' }] });
    }
    if (path === '/v1/runs' && req.method === 'POST') {
      if (controls.draining) return json(res, 503, { error: { code: 'runtime_draining', message: 'draining' } }, { 'retry-after': '1' });
      const active = [...runs.values()].filter((r) => r.status === 'running').length;
      if (active >= controls.maxConcurrentRuns) return json(res, 429, { error: { message: `Too many concurrent runs (max ${controls.maxConcurrentRuns})` } });
      const key = req.headers['idempotency-key'];
      if (typeof key === 'string' && idem.has(key)) return json(res, 200, { run_id: idem.get(key), status: 'started' }, { 'idempotency-replayed': 'true' });
      const input = typeof (body as { input?: unknown })?.input === 'string' ? ((body as { input: string }).input) : '';
      if (!input) return json(res, 400, { error: { code: 'invalid_params', message: 'input required' } });
      const run: DoubleRun = { id: randomUUID(), input, status: 'running', output: '', events: [], waiters: new Set(), timers: new Set(), profile };
      runs.set(run.id, run);
      if (typeof key === 'string') idem.set(key, run.id);
      script(run);
      if (controls.holdRunResponseMs) await sleep(controls.holdRunResponseMs);
      return json(res, 200, { run_id: run.id, status: 'started' });
    }
    const m = /^\/v1\/runs\/([^/]+)(\/events|\/stop|\/approval)?$/.exec(path);
    if (m) {
      const run = runs.get(m[1] ?? '');
      if (!run) return json(res, 404, { error: { message: 'run not found' } });
      if (!m[2] && req.method === 'GET') {
        return json(res, 200, { object: 'hermes.run', id: run.id, status: run.status, output: run.output, usage: null });
      }
      if (m[2] === '/stop' && req.method === 'POST') {
        for (const t of run.timers) clearTimeout(t);
        run.timers.clear();
        if (run.status === 'running') {
          run.status = 'cancelled';
          push(run, 'run.cancelled', {});
        }
        return json(res, 200, { status: 'stopping' });
      }
      if (m[2] === '/approval' && req.method === 'POST') {
        const b = body as { request_id?: string; choice?: string } | undefined;
        if (!run.approvalResolve || b?.request_id !== `appr-${run.id}`) return json(res, 409, { error: { code: 'stale_generation', message: 'no pending approval' } });
        const resolve = run.approvalResolve;
        delete run.approvalResolve;
        resolve(b?.choice ?? 'deny');
        return json(res, 200, { status: 'ok' });
      }
      if (m[2] === '/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        let sent = 0;
        const write = (e: { event: string; data: unknown }) => {
          res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
          sent++;
          if (controls.dropSseAfter && sent >= controls.dropSseAfter) {
            run.waiters.delete(write);
            res.end();
          }
        };
        res.write(': keepalive\n\n');
        for (const e of run.events) write(e);
        if (run.status !== 'running' && !res.writableEnded) return res.end();
        run.waiters.add(write);
        req.on('close', () => run.waiters.delete(write));
        return;
      }
    }
    return json(res, 404, { error: { message: `not found: ${path}` } });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    controls,
    received,
    runs,
    close: () =>
      new Promise<void>((resolve) => {
        for (const r of runs.values()) for (const t of r.timers) clearTimeout(t);
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
