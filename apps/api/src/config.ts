import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(8787),
  APP_ENCRYPTION_KEY: z
    .string({ error: 'APP_ENCRYPTION_KEY is required (generate one with: openssl rand -base64 32)' })
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)'),
  COOKIE_SECURE: bool.default(false),
  CORS_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(24 * 7),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Simulated runtime pacing (1 = real time). */
  SIMULATION_SPEED: z.coerce.number().min(0.1).default(1),
});

export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  encryptionKey: Buffer;
  cookieSecure: boolean;
  corsOrigins: string[];
  sessionTtlMs: number;
  logLevel: string;
  simulationSpeed: number;
  loginMaxAttempts: number;
  loginWindowMs: number;
  /** base delay for dispatch retry backoff (tests set 0) */
  retryBaseMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = EnvSchema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}\nCopy .env.example to .env and fill it in.`);
  }
  const e = r.data;
  return {
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    encryptionKey: Buffer.from(e.APP_ENCRYPTION_KEY, 'base64'),
    cookieSecure: e.COOKIE_SECURE,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600_000,
    logLevel: e.LOG_LEVEL,
    simulationSpeed: e.SIMULATION_SPEED,
    loginMaxAttempts: 8,
    loginWindowMs: 15 * 60_000,
    retryBaseMs: 500,
  };
}
