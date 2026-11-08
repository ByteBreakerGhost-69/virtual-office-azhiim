import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { API_PREFIX, SESSION_COOKIE } from '@avo/shared';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { createDb, type Db } from './db.js';
import { EventService } from './events/event-service.js';
import { ApiError } from './lib/errors.js';
import { systemClock, type Clock } from './lib/util.js';
import { AgentService } from './modules/agents/agent-service.js';
import { registerAgentRoutes } from './modules/agents/routes.js';
import { ApprovalService } from './modules/approvals/approval-service.js';
import { AuditService } from './modules/audit/audit-service.js';
import { AuthService } from './modules/auth/auth-service.js';
import { makeGuard, originAllowed } from './modules/auth/guard.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerIntegrationRoutes } from './modules/integrations/routes.js';
import { registerMiscRoutes } from './modules/misc/routes.js';
import { SettingsService } from './modules/settings/settings-service.js';
import { SimulationService } from './modules/simulation/simulation-service.js';
import { registerTaskRoutes } from './modules/tasks/routes.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { Hub } from './realtime/hub.js';
import { AdapterManager, type AdapterFactory } from './runtime/adapter-manager.js';
import { HeartbeatService } from './runtime/heartbeat.js';

export interface BuildOptions {
  config: AppConfig;
  db?: Db;
  clock?: Clock;
  adapterFactory?: AdapterFactory;
  /** Start tickers/heartbeat/sweepers. Tests leave this off and call the services directly. */
  background?: boolean;
  logger?: boolean | { level: string; redact?: string[] };
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  stop(): Promise<void>;
}

export async function buildApp(opts: BuildOptions): Promise<BuiltApp> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'] },
    trustProxy: false,
  });
  const ownsDb = !opts.db;
  const db = opts.db ?? createDb(config.databaseUrl);
  const clock = opts.clock ?? systemClock;
  const hub = new Hub();
  const events = new EventService(db, hub, clock);
  const settings = new SettingsService(db);
  const agents = new AgentService(db, hub, events, settings, clock);
  const adapters = new AdapterManager(config, opts.adapterFactory);
  const audit = new AuditService(db);
  const ctxRef: { current?: AppContext } = {};
  const getCtx = () => ctxRef.current!;
  const orchestrator = new Orchestrator(getCtx);
  const approvals = new ApprovalService(getCtx);
  const heartbeat = new HeartbeatService(getCtx);
  const ctx: AppContext = { db, config, clock, hub, events, settings, agents, adapters, orchestrator, approvals, audit, heartbeat, log: app.log };
  ctxRef.current = ctx;

  await app.register(cookie);
  await app.register(cors, { origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'x-csrf-token'] });
  await app.register(websocket);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'validation_error', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: { code: status === 429 ? 'rate_limited' : 'validation_error', message: (err as Error).message } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } }));

  const auth = new AuthService(getCtx);
  const guard = makeGuard(app, getCtx, auth);
  const sim = new SimulationService(getCtx);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      registerAuthRoutes(api, getCtx, auth, guard);
      registerAgentRoutes(api, getCtx, guard);
      registerIntegrationRoutes(api, getCtx, guard);
      registerTaskRoutes(api, getCtx, guard);
      registerMiscRoutes(api, getCtx, guard, sim);

      api.get('/ws', { websocket: true }, async (socket, req) => {
        if (!originAllowed(req, ctx)) return socket.close(4403, 'origin not allowed');
        const a = await auth.resolve(req.cookies[SESSION_COOKIE]);
        if (!a) return socket.close(4401, 'unauthenticated');
        const off = hub.add(a.workspaceId, socket);
        socket.send(JSON.stringify({ type: 'hello', serverTime: clock.now().toISOString(), workspaceId: a.workspaceId }));
        socket.on('close', off);
        socket.on('error', off);
      });
    },
    { prefix: API_PREFIX },
  );

  const timers: ReturnType<typeof setInterval>[] = [];
  if (opts.background) {
    await orchestrator.recover().catch((err) => app.log.error({ err }, 'recovery failed'));
    heartbeat.start();
    const every = (ms: number, fn: () => Promise<void> | void) => {
      const t = setInterval(() => void Promise.resolve(fn()).catch((err) => app.log.error({ err }, 'background task failed')), ms);
      t.unref?.();
      timers.push(t);
    };
    every(2000, () => agents.tick());
    every(2000, () => orchestrator.sweep());
    every(15_000, () => hub.ping(clock.now().toISOString()));
  }

  return {
    app,
    ctx,
    async stop() {
      for (const t of timers) clearInterval(t);
      heartbeat.stop();
      orchestrator.shutdown();
      await orchestrator.idle().catch(() => undefined);
      hub.closeAll();
      await adapters.shutdown();
      await app.close();
      if (ownsDb) await db.$disconnect();
    },
  };
}
