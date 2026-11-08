# Azhiim Virtual Office

A top-down 16-bit **spaceship office** that is a live command center for your **real AI agents**.
Every character on the map is a registered agent; where it stands and what it does comes only from data its runtime reported.
Nothing is faked: if a runtime goes silent, the character is dimmed and shown as *unknown/offline*, never "working".

> **Ringkasan (ID):** `docker compose up -d db` → salin `.env.example` ke `.env` (isi `APP_ENCRYPTION_KEY`) → `npm install` → `npm run db:migrate` → `npm run dev` → buka http://localhost:5173, buat akun Owner. Tim demo **SIMULASI** (berlabel jelas, terpisah dari agen nyata) ada di *Integrasi*. Bahasa Indonesia/English lewat pemilih bahasa.

## What works today (v0.1)
The thin end-to-end slice: **register an agent → create and assign a task → the runtime runs it → status changes come from runtime events → visible in the pixel office** (REAL via the Hermes adapter, or SIMULATED via the scripted runtime).

Modules: Overview · Virtual Office · Agents · Tasks · Organization · Activity · Approvals · Integrations · Settings. *Projects* and *Hive* are data foundations only and say so on the page.
Also: Indonesian/English UI, Owner auth + RBAC foundation, approvals with payload-hash binding, emergency stop, chiptune music/SFX (off by default), WASD avatar (extra).

## Requirements
Node ≥ 20.19 (22 recommended), npm, PostgreSQL 16 (Docker Compose included).

## Install & run
```bash
docker compose up -d db                # PostgreSQL on 127.0.0.1:5432
cp .env.example .env                   # then set APP_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npm install                            # also runs `prisma generate`
npm run db:migrate                     # applies prisma/migrations
npm run db:seed                        # optional, idempotent (default departments)
npm run dev                            # API :8787 + web :5173
```
Open http://localhost:5173 → *Create the Owner account* (password ≥ 12 chars). Then either
* **Integrations → Add integration → Hermes Agent** (see `docs/hermes-integration.md`) and register agents on it, or
* **Integrations → Create the simulated team** to explore with 8 clearly-labelled SIMULATED agents.

## Tests
```bash
npm run typecheck
npm test            # shared, adapters (contract double), API integration (needs PostgreSQL), web unit
npm run test:e2e    # Playwright: real API + Vite + Hermes contract double (needs PostgreSQL)
```
Env for tests: `TEST_DATABASE_URL` (default `…127.0.0.1:5433/avo_test`) and `E2E_DATABASE_URL`; both are **wiped** by the test suites — never point them at data you care about. Offline machines can reuse an installed Chromium with `PW_CHROMIUM_PATH=/path/to/chrome`. CI (`.github/workflows/ci.yml`) also runs `prisma migrate deploy` and a `db:check` drift check.

## Layout
```
apps/api        Fastify + Prisma + PostgreSQL (auth, RBAC, agents, tasks, orchestrator, approvals, WebSocket)
apps/web        React + PixiJS + Tailwind (pixel engine in src/office, pages in src/features)
packages/shared Contracts shared by both sides: enums, DTOs, request schemas, RBAC, placement/state rules
packages/adapters  Runtime adapters: Hermes (real), Simulated, test double; OpenClaw/Internal declared, not built
docs/           api-contract · hermes-integration · pixel-art · security · decisions
```

## Honesty rules (enforced in code and tests)
1. Agent status = `effectiveAgentState(runtime-reported state, last signal, integration health)`. Silence downgrades to *unknown/offline*.
2. REAL and SIMULATED never mix: separate integrations, separate counts, `SIMULATED` label everywhere, backend rejects cross-over.
3. `NOT_SUPPORTED` runtime commands return `422`, never success. A task is *completed* only when the runtime says so.
4. Approvals are enforced by the backend, bound to a payload hash, and expired approvals never authorise anything.

## Known limitations (read before relying on it)
* **The Hermes adapter has been tested only against a local contract test double** that implements the documented API. Live verification is a manual release gate (`docs/hermes-integration.md`); the approval `choice` values are the least certain part.
* The planner is rule-based (`rule-based/v1`), not an LLM. Redis/BullMQ is not used yet (leases in PostgreSQL).
* Prisma migrations were generated from `schema.prisma` by `apps/api/scripts/schema-to-sql.ts` in an environment where Prisma's engine could not be downloaded; the test suites apply that SQL directly. Run `npm run db:migrate` and `npm run db:check` on your machine/CI to confirm Prisma agrees.
* Local-first, single Owner. Bind address defaults to `127.0.0.1`; LAN use needs `API_HOST`, `CORS_ORIGINS`, `COOKIE_SECURE` and TLS review first.
* Activity text from the backend is English; labels, states, rooms and event types are localised.
