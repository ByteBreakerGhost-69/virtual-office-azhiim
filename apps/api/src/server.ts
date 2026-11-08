// Load the repo-root .env if present (Node >= 20.12). Real environment variables always win.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* no .env file: rely on the process environment */
}

import { loadConfig } from './config.js';
import { buildApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const { app, stop } = await buildApp({ config, background: true });
await app.listen({ host: config.host, port: config.port });
app.log.info(`Azhiim Virtual Office API listening on http://${config.host}:${config.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void stop().then(() => process.exit(0)));
}
