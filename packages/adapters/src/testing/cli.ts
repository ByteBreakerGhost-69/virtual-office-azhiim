// Standalone launcher for the Hermes contract TEST DOUBLE (used by the e2e suite).
import { startHermesContractDouble } from './hermes-contract-double.js';

const port = Number(process.env.HERMES_DOUBLE_PORT ?? 8642);
const apiKey = process.env.HERMES_DOUBLE_KEY ?? 'test-double-key';
const h = await startHermesContractDouble({ port, apiKey, stepMs: Number(process.env.HERMES_DOUBLE_STEP_MS ?? 400) });
console.log(`[hermes-contract-double] TEST DOUBLE listening on ${h.url} (not a real Hermes)`);
process.on('SIGTERM', () => void h.close().then(() => process.exit(0)));
process.on('SIGINT', () => void h.close().then(() => process.exit(0)));
