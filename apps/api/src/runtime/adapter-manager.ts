import { createAdapter, type AdapterConfig, type RuntimeAdapter, type RuntimeEvent } from '@avo/adapters';
import type { RuntimeKind } from '@avo/shared';
import type { AppConfig } from '../config.js';
import type { Integration } from '../generated/prisma/client.js';
import { decryptSecret } from '../lib/crypto.js';

export type AdapterFactory = (kind: RuntimeKind, config: AdapterConfig) => RuntimeAdapter;
export type AdapterEventListener = (integration: Integration, e: RuntimeEvent) => void;

interface Entry {
  adapter: RuntimeAdapter;
  signature: string;
  unsubscribe: () => void;
}

/** One adapter instance per integration; rebuilt automatically when its configuration changes. */
export class AdapterManager {
  private readonly entries = new Map<string, Entry>();
  private listener: AdapterEventListener | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly factory?: AdapterFactory,
  ) {}

  onAdapterEvent(l: AdapterEventListener): void {
    this.listener = l;
  }

  async get(integration: Integration): Promise<RuntimeAdapter> {
    const signature = `${integration.kind}|${integration.baseUrl ?? ''}|${integration.encryptedSecret ?? ''}`;
    const hit = this.entries.get(integration.id);
    if (hit && hit.signature === signature) return hit.adapter;
    if (hit) this.evict(integration.id);

    const cfg: AdapterConfig = {
      integrationId: integration.id,
      baseUrl: integration.baseUrl,
      secret: integration.encryptedSecret ? decryptSecret(integration.encryptedSecret, this.config.encryptionKey) : null,
      timeoutMs: 10_000,
    };
    const adapter = this.factory
      ? this.factory(integration.kind, cfg)
      : createAdapter(integration.kind, cfg, { simulated: { speed: this.config.simulationSpeed, heartbeatIntervalMs: 3000 } });
    const sub = adapter.subscribeEvents((e) => this.listener?.(integration, e));
    this.entries.set(integration.id, { adapter, signature, unsubscribe: () => sub.close() });
    if (integration.kind === 'SIMULATED') void adapter.connect();
    return adapter;
  }

  evict(integrationId: string): void {
    const e = this.entries.get(integrationId);
    if (!e) return;
    e.unsubscribe();
    void e.adapter.disconnect();
    this.entries.delete(integrationId);
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.entries.keys()]) this.evict(id);
  }
}
