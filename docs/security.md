# Security notes

* Passwords: `crypto.scrypt`, per-user salt, constant-time compare; minimum 12 characters; login rate limited.
* Sessions: 32 random bytes in an `HttpOnly; SameSite=Lax` cookie (`Secure` via `COOKIE_SECURE=true`); only the SHA-256 is stored.
* CSRF: every mutating request needs `x-csrf-token` (HMAC of the session) and a same-origin/allowed `Origin`.
* RBAC (`OWNER`, `OPERATOR`, `OBSERVER`) enforced in the backend (`can(role, action)`); the UI only hides controls. All queries are workspace-scoped.
* Secrets: integration keys are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`, never returned by the API, never logged. Losing the key means re-entering secrets. Rotate by editing the integration.
* Agent output is untrusted: rendered as plain text, never as HTML; it cannot change policy. Approvals are decided by the owner in the backend-enforced queue.
* Audit log: setup, login success/failure, logout, integration changes, approvals, emergency stop, settings.
* Emergency stop: pauses dispatch and asks every active run to cancel via its adapter; unsupported runtimes are listed in the response.
* Revoke a runtime credential: edit/delete the integration. Isolate a runtime: Disable the agent or delete the integration. Backups: `pg_dump` the `avo` database; keep `APP_ENCRYPTION_KEY` separately.
* Not yet: sandboxing of agent tools (the runtime owns that), multi-user invitations, TLS termination, dependency/secret scanning in CI.
