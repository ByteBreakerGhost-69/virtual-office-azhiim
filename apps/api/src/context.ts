import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import type { Hub } from './realtime/hub.js';
import type { EventService } from './events/event-service.js';
import type { Clock } from './lib/util.js';
import type { SettingsService } from './modules/settings/settings-service.js';
import type { AgentService } from './modules/agents/agent-service.js';
import type { AdapterManager } from './runtime/adapter-manager.js';
import type { Orchestrator } from './orchestrator/orchestrator.js';
import type { ApprovalService } from './modules/approvals/approval-service.js';
import type { AuditService } from './modules/audit/audit-service.js';
import type { HeartbeatService } from './runtime/heartbeat.js';

/** Everything a module needs. Built once in app.ts; modules read members at call time (no import cycles). */
export interface AppContext {
  db: Db;
  config: AppConfig;
  clock: Clock;
  hub: Hub;
  events: EventService;
  settings: SettingsService;
  agents: AgentService;
  adapters: AdapterManager;
  orchestrator: Orchestrator;
  approvals: ApprovalService;
  audit: AuditService;
  heartbeat?: HeartbeatService;
  log: FastifyBaseLogger;
}
