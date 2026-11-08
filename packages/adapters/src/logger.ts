export interface AdapterLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
export const silentLogger: AdapterLogger = { debug() {}, warn() {}, error() {} };

export interface AdapterDeps {
  clock?: { now(): Date };
  random?: () => number;
  fetch?: typeof fetch;
  logger?: AdapterLogger;
}

/** Never let a secret reach a log line. */
export function redact(text: string, secret?: string | null): string {
  let out = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***');
  if (secret && secret.length >= 4) out = out.split(secret).join('***');
  return out;
}
