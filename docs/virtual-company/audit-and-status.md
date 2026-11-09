# Azhiim Virtual Company — Repository audit & implementation status

Repository assumption: `~/projects/virtual-office-azhiim` is not available in the build sandbox; this tree (v0.1.0 delivered earlier, same stack) is treated as the existing repository. Nothing was pushed to GitHub.
Version stays **0.1.0** in package.json: PRD rule "do not bump versions because UI is done"; v0.2.0 needs Milestone 1 **and** 2.

Labels: IMPLEMENTED, TESTED, VERIFIED_LIVE, PARTIALLY_IMPLEMENTED, NOT_IMPLEMENTED, NOT_VERIFIED (PRD definitions).

## Phase 0 audit (state at start of this work, v0.1.0)

| Feature | Existing state | Missing work | Proposed action |
|---|---|---|---|
| Monorepo, stack | TESTED. npm workspaces, Fastify, Prisma 7, React 19, PixiJS 8, Tailwind 4 | none | keep |
| Auth, RBAC, CSRF, audit log | TESTED. OWNER/OPERATOR/OBSERVER, scrypt, sessions, `can()` | PRD roles Executive/Dept Manager not modelled | reuse `can()`; extend in Phase 2 |
| Secrets | TESTED. AES-256-GCM | none | reuse |
| Agent model | TESTED. name, handle, title, dept, orgRole, reportsTo, capabilities, state | no employee code / employment lifecycle / avatar | Milestone 1: identity layer on `Agent` |
| Task model + orchestrator | TESTED. lease dispatch, run state machine, events, approvals, recovery | no human-friendly IDs, no REVIEW/validation gate, no projects→tasks flow | M1: TASK-nnn; validation in Phase 4 |
| Runtime adapters | Hermes: TESTED vs contract double only = **NOT_VERIFIED live**. Simulated: IMPLEMENTED/TESTED. OpenClaw: NOT_IMPLEMENTED | live Hermes test, OpenClaw | Phase 5 (needs a live runtime) |
| Realtime (WS), truthful state/placement | TESTED | movement events | reuse |
| Pixel office | TESTED. 7-room ship, procedural 16x24 characters, collision grid, door/corridor routing | PRD lists 10 rooms; no A* (waypoint routing suffices on this layout); room config not data-driven | keep rooms (mapping below); A* when layout becomes data-driven |
| Owner avatar | PARTIALLY_IMPLEMENTED. WASD behind a toggle, no persistence, facing lost on stop | persistence, arrows, always-on | done in M1 |
| Company Terminal | NOT_IMPLEMENTED | everything | done in M1 (registry, parser, authz, audit, autocomplete, history) |
| Natural-language planner | NOT_IMPLEMENTED | Phase 3 | open |
| Approval from terminal for dangerous commands | PARTIALLY: approvals exist for runtime/pre-run gates | generic command approvals (suspend/offboard) | Phase 3 |
| Projects, meetings, messaging, finance, knowledge, reports | NOT_IMPLEMENTED (foundation placeholders say so) | Phases 4,6,7 | open |
| CI | IMPLEMENTED, **NOT_VERIFIED** (never run on GitHub). `prisma migrate` never run in sandbox | run CI / `db:migrate` + `db:check` locally | owner to run |

Room mapping (PRD → existing keys): Executive Office → main_office; Engineering Lab → development_room; Research Lab → research_room; Operations/Marketing/Finance → employee_workspace; Meeting Room → meeting_room; Server Room → server_room; Lounge → lounge. Archive Room: NOT_IMPLEMENTED.

## Milestone 1 — Living Virtual Office (12 criteria)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Owner avatar walks with WASD | TESTED | e2e 03 test 1 (also arrow keys) |
| 2 | Four-direction walk animation | TESTED (e2e asserts facing right/left/up/down); frames are procedural | e2e 03 |
| 3 | Collision and pathfinding | PARTIALLY_IMPLEMENTED. Collision TESTED (e2e wall test). Routing = door/corridor waypoints, **not A\*** | layout.ts `walkableAt`, `route` |
| 4 | Employee characters can be added | TESTED | API terminal.test hire; e2e |
| 5 | Profile + department | TESTED | `employee show`, AgentPanel shows code/employment |
| 6 | Appears in matching room | TESTED | e2e: Forge in `development_room` |
| 7 | Terminal beside the office | TESTED | e2e (panel visible, resizable S/M/L, hide/show) |
| 8 | `company status`, `employee list` | TESTED | API + e2e |
| 9 | Create and assign tasks | TESTED | `task create --assign`, `task assign`, e2e |
| 10 | Status from backend | TESTED | scene only consumes AgentDTO; command output is server-rendered |
| 11 | Offline runtime never "working" | TESTED | API test (dead Hermes → stays PENDING_ONBOARDING, not working); v0.1.0 e2e disconnect test |
| 12 | Data persists after refresh | TESTED | e2e: avatar position, employee list, history restored |

Counts: **11 of 12 fully satisfied; #3 partial (no A\*).** Milestone 1 is therefore NOT declared complete.

Tests now: shared 13, adapters 31, API 35 (+11), web 4, e2e 13 (+3). typecheck, build clean.

## Runtime verification

| Runtime | Status |
|---|---|
| Hermes (contract double) | TESTED |
| Hermes (live) | NOT_VERIFIED |
| OpenClaw | NOT_IMPLEMENTED |
| Simulated | IMPLEMENTED, TESTED (always labelled SIMULATED) |

## Assumptions / decisions
- v0.1.0 agents are backfilled by migration 0002 as ACTIVE employees EMP-001.. (they were operating); new agents are *not* employees until `employee hire`.
- Employees need `employee onboard` (real health check) before ACTIVE; non-ACTIVE employees cannot receive tasks. Agents without a code stay assignable (v0.1.0 compatibility).
- Owner position stored only as resting checkpoint (`CharacterPosition`), not per frame. Server validates room + bounds; walkability is re-validated by the client on load. Employee positions are derived from verified state, so not stored.
- Terminal is not a shell; every input resolves to a registered command, role-checked via `can()`; mutating commands audited (`terminal.<cmd>`), every input (incl. rejected) stored in `CommandExecution` with secrets redacted.
- Task numbering via per-workspace `Counter`.
- Migration 0002 hand-written (Prisma engine unavailable); schema parity checked with pg_dump against the schema-derived SQL. Run `npm run db:migrate && npm run db:check` locally.
- Known issue: API suite had one timing flake when run concurrently with typecheck (passes alone, 5/5).
