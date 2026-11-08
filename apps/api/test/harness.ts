import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import { CSRF_HEADER, SESSION_COOKIE } from '@avo/shared';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://avo:avo_dev_password@127.0.0.1:5433/avo_test';
export const PASSWORD = 'correct horse battery staple';

export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    databaseUrl: TEST_DB_URL, host: '127.0.0.1', port: 0, encryptionKey: randomBytes(32), cookieSecure: false, corsOrigins: ['http://localhost:5173'],
    sessionTtlMs: 3600_000, logLevel: 'silent', simulationSpeed: 400, loginMaxAttempts: 3, loginWindowMs: 60_000, retryBaseMs: 0, ...over,
  };
}

export async function until<T>(fn: () => Promise<T | false | undefined | null>, ms = 8000, label = 'condition'): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

export async function truncateAll(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
}

export class Client {
  cookie = '';
  csrf = '';
  constructor(private readonly app: FastifyInstance) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as 'GET', url: `/api/v1${url}`,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { [CSRF_HEADER]: this.csrf } : {}), ...headers },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const set = res.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : set;
    if (first?.startsWith(`${SESSION_COOKIE}=`)) this.cookie = first.split(';')[0]!;
    let json: any = undefined;
    try { json = res.body ? JSON.parse(res.body) : undefined; } catch { /* not json */ }
    if (json?.csrfToken) this.csrf = json.csrfToken;
    return { status: res.statusCode, json, body: res.body, headers: res.headers };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b: unknown = {}) => this.req('POST', u, b);
  patch = (u: string, b: unknown) => this.req('PATCH', u, b);
  del = (u: string) => this.req('DELETE', u);
}

export interface Harness extends BuiltApp {
  db: Db;
  owner: Client;
}

export async function startHarness(opts: { config?: Partial<AppConfig>; adapterFactory?: Parameters<typeof buildApp>[0]['adapterFactory'] } = {}): Promise<Harness> {
  const config = testConfig(opts.config);
  const db = createDb(config.databaseUrl);
  await truncateAll(db);
  const built = await buildApp({ config, db, logger: process.env.TEST_LOG ? { level: 'error' } : false, ...(opts.adapterFactory ? { adapterFactory: opts.adapterFactory } : {}) });
  const owner = new Client(built.app);
  const r = await owner.post('/auth/setup', { username: 'owner', password: PASSWORD, displayName: 'The Owner' });
  if (r.status !== 201) throw new Error(`setup failed: ${r.body}`);
  built.ctx.heartbeat!.start(); // adapters prove liveness exactly as in production
  const stop = built.stop;
  return { ...built, db, owner, stop: async () => { await stop(); await db.$disconnect(); } };
}

export async function seedSim(h: Harness) {
  const r = await h.owner.post('/simulation/seed');
  if (r.status !== 201) throw new Error(`seed failed: ${r.body}`);
  await h.ctx.heartbeat!.pollOnce();
  const agents = (await h.owner.get('/agents')).json as any[];
  return agents;
}
