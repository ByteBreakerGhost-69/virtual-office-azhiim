# Connecting a real Hermes Agent

The Hermes adapter (`packages/adapters/src/hermes`) talks to the **Hermes Agent API server**. It is written against the
documented API; **it has only been tested against a local contract test double, never against a live Hermes install.**
Do the live verification below before relying on it.

## 1. Enable the API server in Hermes
Set (in the Hermes environment, per its docs): `API_SERVER_ENABLED=true` and an `API_SERVER_KEY`. Default address:
`http://127.0.0.1:8642`.

## 2. Add the integration
Integrations → Add integration → *Hermes Agent*. Base URL `http://127.0.0.1:8642`, API key = your `API_SERVER_KEY`.
The key is encrypted with `APP_ENCRYPTION_KEY` (AES-256-GCM) and is never shown again. Press **Check now**: the status
becomes *Connected* only when `GET /health` succeeds. Capabilities come from `GET /v1/capabilities`.

## 3. Register the agent
Agents → Register agent. The *runtime identifier* is the Hermes profile/agent name. A registered agent stays **Unknown**
until the runtime reports it; it never shows *Idle* by assumption.

## 4. What is and isn't supported
| Command | Hermes adapter |
|---|---|
| dispatch / events (SSE) / status / cancel (`/v1/runs/{id}/stop`) | yes |
| approvals (`/v1/runs/{id}/approval`) | yes — see risk 1 |
| pause / resume | **NOT_SUPPORTED** (UI returns `422 not_supported`, never fakes success) |

## 5. Live-verification checklist (release gate)
1. Check now → Connected; stop Hermes → within the thresholds in Settings the agent turns Unknown/Offline.
2. Dispatch a trivial task → run reaches `completed`, output is stored, the character walks to its desk and works.
3. Dispatch a task that triggers a Hermes approval → it appears in Approvals; approve once and reject once.
4. Stop a run mid-way (Tasks → Stop run) → Hermes confirms the cancellation.
5. Restart the API during a run → on boot the run is reconciled via `GET /v1/runs/{id}` (never silently lost).

## Known risks
1. The approval `choice` values sent by the adapter (`once` / `deny`) are inferred from the Hermes docs and **must be
   confirmed** against a live install; if they differ, approvals will fail loudly (not silently succeed).
2. Event field names are mapped defensively; unknown events are ignored, not guessed.
3. Network failures never produce fake states: an unreachable runtime → integration *Disconnected* → agents *Unknown*.

## Adding another runtime (OpenClaw, internal)
Implement `RuntimeAdapter` from `packages/adapters/src/types.ts`, register it in `registry.ts`, set `available: true`.
Nothing else in the API or UI depends on Hermes.
