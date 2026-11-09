# Company Terminal

Not a shell. Input → tokenizer → registry lookup → role check (`can(role, action)`) → argument validation → handler → audit + `CommandExecution`.
Result contract: `{executionId, command, status, message, data, view, requiresApproval, approvalId?, auditId, traceId, durationMs}`; status ∈ SUCCESS, FAILED, REJECTED, PENDING_APPROVAL, RUNNING, CANCELLED, PARTIAL_SUCCESS (only the first four occur today).

API: `GET /terminal/commands`, `POST /terminal/execute {input}`, `GET /terminal/history`. REST: `/employees*`, `PUT/GET /office/position`.

Commands: help · company status · department list · employee list|candidates|show|hire|onboard|suspend|resume · task list|show|create|assign|cancel · approval list|approve|reject · runtime list · office status|room list|employee-location.
Add a command by appending a `CommandDef` to a module in `apps/api/src/modules/terminal/commands/` and the registry list. UI: Tab completes, ↑/↓ history, Ctrl+L clear, `clear`.
Not yet: natural-language planning, approval-gated dangerous commands (offboard etc.), meeting/message/report/project commands (their phases).
