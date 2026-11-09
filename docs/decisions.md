# Decision log

| # | Decision | Why |
|---|---|---|
| 1 | npm workspaces monorepo, TypeScript everywhere | one contract package shared by API and web |
| 2 | Fastify + Prisma + PostgreSQL | requested stack; Postgres leases give dispatch safety without Redis yet |
| 3 | All pixel art drawn by code | requested; consistent palette; testable; no licensing issues |
| 4 | Adapters behind `RuntimeAdapter` | Hermes first, never a permanent dependency; OpenClaw/internal declared `available:false` |
| 5 | SIMULATED is a separate adapter + integration | the PRD forbids mixing; separation is structural, not a flag |
| 6 | Status derived server-side (`effectiveAgentState`) | stale data must degrade honestly; the browser never decides |
| 7 | Persist events, then broadcast | the UI can always rebuild from the log |
| 8 | Compare-and-set run transitions with bounded retry | a late runtime outcome must not be lost to a concurrent approval resume |
| 9 | Existing repository content ignored | owner instruction ("treat as empty") |
| 10 | Not pushed to GitHub | owner wants to review the ZIP first |

## Virtual Company evolution (Milestone 1)
See docs/virtual-company/audit-and-status.md for the audit, assumptions and per-criterion evidence.
