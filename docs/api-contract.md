# API Contract (v1)

Source of truth for the HTTP/WebSocket surface that `apps/api` implements and `apps/web` consumes.
Types, enums and request schemas live in `packages/shared` (`dto.ts`, `api.ts`, `events.ts`). Runtime adapters
implement `packages/adapters/src/types.ts`. If this file and the shared package disagree, the shared package wins; fix this file.

- Base path `/api/v1`. JSON only. All timestamps ISO-8601 UTC (`Z`).
- Dev ports: API `8787`, web `5173` (Vite proxies `/api` and `/api/v1/ws` to the API).
- Every non-2xx response: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
  Codes: `validation_error` (400), `unauthenticated` (401), `forbidden` (403), `not_found` (404), `conflict` (409),
  `not_supported` (422, an adapter returned NOT_SUPPORTED), `runtime_unreachable` (502), `rate_limited` (429), `internal` (500).

## Auth, sessions, RBAC

- First run: `GET /auth/status` → `{ setupRequired, authenticated, user? }`. `POST /auth/setup` works only while there are zero users,
  creates the Owner + default workspace + default departments, and logs in.
- `POST /auth/login` (rate limited per IP+username) sets the `avo_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`)
  and returns `{ user, csrfToken }`. `POST /auth/logout`. `GET /auth/me` → `{ user, csrfToken, workspace }`.
- Passwords: `crypto.scrypt` with per-user random salt, constant-time compare. Sessions: 32 random bytes; only the SHA-256 is stored.
- Every mutating request (POST/PATCH/PUT/DELETE) must carry `x-csrf-token` and a same-origin `Origin` (or allowed `CORS_ORIGINS`).
- RBAC is enforced in the backend with `can(role, action)` from `@avo/shared`. Every query is scoped by `workspaceId` from the session.
- Audit log entries for: login success/failure, logout, setup, permission-relevant actions, integration changes, approvals, emergency stop, settings changes.

## Endpoints

| Method + path | Purpose | Action required |
|---|---|---|
| `GET /health` | liveness (no auth) `{status:'ok'}` | none |
| `GET /overview` | `OverviewDTO` (counts by state/mode/status, pending approvals, active runs, integration health) | view |
| `GET /agents?mode=` / `GET /agents/:id` | `AgentDTO[]` / detail `{ agent, currentTask, runs, recentEvents, messages }` | view |
| `POST /agents` | register (`RegisterAgentBodySchema`) | agent.manage |
| `PATCH /agents/:id`, `DELETE /agents/:id` | edit / remove registration | agent.manage |
| `POST /agents/:id/enable` · `/disable` | enable/disable | agent.manage |
| `POST /agents/:id/pause` · `/resume` | adapter pause/resume or `422 not_supported` | run.control |
| `PATCH /agents/:id/assignment` | department/role/title/reportsTo | agent.manage |
| `GET /organization` | `OrganizationDTO` | view |
| `GET /departments` / `POST /departments` / `PATCH /departments/:id` | departments | view / agent.manage |
| `GET /integrations` | `IntegrationDTO[]` | view |
| `GET /integrations/kinds` | `AdapterDescriptor[]` (OPENCLAW/INTERNAL are `available:false`) | view |
| `POST /integrations` · `PATCH /integrations/:id` · `DELETE /integrations/:id` | manage (secret encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`; never returned) | integration.manage |
| `POST /integrations/:id/check` | run `healthCheck()` now, persist status/capabilities | integration.manage |
| `GET /integrations/:id/discover` | adapter `listAgents()` (may be `not_supported`) | integration.manage |
| `GET /tasks?status=&agentId=&projectId=&mode=` / `GET /tasks/:id` | list / detail `{ task, runs, approvals, messages, events }` | view |
| `POST /tasks` | create (`CreateTaskBodySchema`); assigns if `assigneeAgentId` set | task.create |
| `PATCH /tasks/:id` | edit while not running | task.create |
| `POST /tasks/:id/assign` | assign / reassign, then dispatch | task.create |
| `POST /tasks/:id/cancel` · `/retry` | cancel (stops the provider run if supported) / new attempt | task.cancel / task.create |
| `GET /runs?active=true` · `GET /runs/:id` · `POST /runs/:id/stop` | runs and stop | view / run.control |
| `GET /approvals?status=` · `POST /approvals/:id/decide` | queue / decision with reason (bound to payload hash) | view / approval.decide |
| `GET /activity?cursor=&limit=&agentId=&taskId=&severity=&mode=` | `Page<DomainEvent>`, newest first | view |
| `GET /projects` · `POST /projects` | Projects foundation | view / task.create |
| `GET /memory?scope=` · `POST /memory` | Hive foundation (scoped records with provenance) | view / agent.manage |
| `GET /settings` · `PATCH /settings` | `SettingsDTO` | view / settings.manage |
| `POST /control/emergency-stop` | pause dispatch + cancel every active run via adapters (best effort; response lists each result) | control.emergency |
| `POST /control/resume-dispatch` | clears the dispatch pause | control.emergency |
| `GET /simulation` · `POST /simulation/seed` · `DELETE /simulation` | status / create SIMULATED integration + 8 sample agents / remove all SIMULATED data | simulation.manage |

Pagination: cursor = opaque string; `nextCursor: null` at the end.

## WebSocket `GET /api/v1/ws`

Cookie-authenticated (same session). Server → client messages are `WsServerMessage` (`hello`, `event`, `agent`, `agent.removed`, `ping` every 15 s).
Clients never send commands over the socket; they use HTTP. Subscriptions are workspace-scoped. A `agent` message carries the complete, truthful `AgentDTO`
and is sent after every change **including stale/offline downgrades computed by the server's 2-second state ticker**.
The UI must show a "connection lost / data may be stale" indicator when the socket is closed and must refetch after reconnecting.

## Truthfulness rules (non-negotiable)

1. An agent's `state` is `effectiveAgentState(...)` of `storedState` + `lastSeenAt` + integration health. Only adapter data (heartbeat/health poll or run events) may update `lastSeenAt`/`storedState`.
   Never set an agent to idle/working from the UI, a timer, or an assumption.
2. REAL agents only use REAL adapters (`HERMES`, later `OPENCLAW`/`INTERNAL`). SIMULATED agents only use the `SIMULATED` adapter. The backend rejects any cross-over
   (e.g. registering a REAL agent on a SIMULATED integration). Simulated events have `source.kind = 'simulation'` and `mode = 'SIMULATED'`.
   Aggregations always keep the two modes separate (`agentsByMode`).
3. A task is `completed` only when the adapter reports completion (and the run passed the verifying step: output present when `expectedOutput` is set,
   otherwise it is marked `completed` with an explicit note that no automatic verification criteria were given).
4. Every run has a `traceId`, plan record, and a recorded state history (`run.state.changed` events).
5. `NOT_SUPPORTED` adapter results surface as `422 not_supported`, never as success.
6. Approvals are bound to the payload hash. Expired approvals reject the action and the run becomes `blocked`/`rejected`, never silently proceed.

## Orchestrator (MVP behaviour)

`created → planning → (awaiting_approval) → queued → running → verifying → completed`, with `rejected | blocked | failed | cancelled | timed_out`.

- **Planning** (MVP, rule-based and honest about it): produce a persisted, versioned plan `{ goal, assumptions, subtasks:[{id,title,assignee,dependsOn}], requiredCapabilities, completionCriteria, risk, approvalGates, selectionRationale }`.
  A single-agent task yields one subtask. No LLM planner in the MVP; the plan record says `planner: "rule-based/v1"`.
- **Assignment eligibility** (all must hold): agent enabled; integration connected; effective state not in {offline, unknown, error, stopped, paused}; has required declared capabilities
  (if the task lists any); under `maxConcurrentRunsPerAgent`; dispatch not paused. Selection reasons are stored in the plan.
- **Dispatch**: lease-based claim in Postgres (`Run.leaseOwner/leaseUntil`), idempotency key = `runId:attempt`. Ambiguous dispatch timeouts are reconciled with `getRun` before any retry.
  Retries: only for retryable adapter errors, max 2, exponential backoff + jitter.
- **Events**: adapter `RuntimeEvent`s are mapped to `agent.status` (working/thinking/waiting/idle/…), run state transitions, `Message` rows, approvals and `DomainEvent`s; all persisted before being broadcast.
- **Recovery**: on API start, active runs with a `providerRunId` are reconciled via `getRun` (completed → finish; unknown/unreachable → `blocked` with reason); runs of the SIMULATED adapter that lost memory are marked `failed: simulation_restarted`.
- **Deadlines**: `deadlineAt` enforced by a sweeper → `timed_out` + provider cancel attempt.

## Simulated runtime

Scripted, deterministic (seeded) timeline per task: accepted → thinking → 1–3 tool steps → optional peer message → optional approval gate (objective contains `deploy`, `publish`, `delete`) → completed.
It emits heartbeats itself, so stopping the API makes simulated agents stale like real ones. The UI renders a persistent **SIMULATED** label on every simulated entity.

## Hermes adapter (REAL)

Implemented against the documented Hermes Agent API server (`API_SERVER_ENABLED=true`, default `http://127.0.0.1:8642`, `Authorization: Bearer <API_SERVER_KEY>`):
`GET /health`, `GET /v1/capabilities`, `GET /v1/models`, `POST /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events` (SSE), `POST /v1/runs/{id}/stop`, `POST /v1/runs/{id}/approval`.
It is contract-tested against a local test double (`@avo/adapters/testing`) that implements those documented shapes. **The double is a test tool, not a runtime.**
Verification against a live Hermes install is a manual release-gate step (see `docs/hermes-integration.md`). `pause/resume` return `NOT_SUPPORTED`.
