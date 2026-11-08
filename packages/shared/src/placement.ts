import type { AgentState, DataMode } from './enums.js';

/** Rooms of the spaceship. Layout lives in the web app; keys are shared. */
export const ROOM_KEYS = [
  'main_office',
  'employee_workspace',
  'development_room',
  'research_room',
  'meeting_room',
  'server_room',
  'lounge',
] as const;
export type RoomKey = (typeof ROOM_KEYS)[number];

/** Sprite animations of a character (walking is transitional and render-only). */
export const POSES = ['idle', 'working', 'thinking', 'talking', 'meeting', 'resting'] as const;
export type Pose = (typeof POSES)[number];

/** Status overlays shown as icon + text (never color alone). */
export const OVERLAYS = ['waiting', 'blocked', 'paused', 'error', 'offline', 'unknown', 'starting', 'stopping'] as const;
export type Overlay = (typeof OVERLAYS)[number];

export const DEFAULT_DEPARTMENTS = [
  { key: 'leadership', name: 'Leadership', color: '#4aa8ff', homeRoom: 'main_office' },
  { key: 'operations', name: 'Operations', color: '#f2b84b', homeRoom: 'employee_workspace' },
  { key: 'engineering', name: 'Engineering', color: '#2fd6e6', homeRoom: 'development_room' },
  { key: 'research', name: 'Research', color: '#9b7bff', homeRoom: 'research_room' },
  { key: 'infrastructure', name: 'Infrastructure', color: '#5fd38d', homeRoom: 'server_room' },
] as const satisfies readonly { key: string; name: string; color: string; homeRoom: RoomKey }[];

export const DEFAULT_THRESHOLDS = {
  /** No heartbeat for this long -> state shown as `unknown` (stale). */
  staleAfterMs: 15_000,
  /** No heartbeat for this long -> state shown as `offline`. */
  offlineAfterMs: 60_000,
  /** Idle this long -> the character walks to the lounge and rests. */
  restAfterIdleMs: 120_000,
  /** A message/meeting counts as "recent" for this long. */
  talkWindowMs: 20_000,
} as const;
export type Thresholds = { staleAfterMs: number; offlineAfterMs: number; restAfterIdleMs: number; talkWindowMs: number };

export interface ReasonCode {
  code: string;
  params: Record<string, string | number | boolean | null>;
}

export interface EffectiveState {
  state: AgentState;
  /** true when `state` was downgraded because live data is missing or old. */
  stale: boolean;
  reason: ReasonCode;
}

export interface EffectiveStateInput {
  storedState: AgentState;
  mode: DataMode;
  lastSeenAt: string | null;
  integrationConnected: boolean;
  enabled: boolean;
  now: Date;
  thresholds?: Partial<Thresholds>;
}

/**
 * Truthful state: the stored state is only trusted while the runtime keeps proving it is alive.
 * Nothing here can *upgrade* a state (never "online" because the UI assumes it).
 */
export function effectiveAgentState(input: EffectiveStateInput): EffectiveState {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  if (!input.enabled) return { state: 'stopped', stale: false, reason: { code: 'disabled', params: {} } };
  if (input.storedState === 'registered') return { state: 'registered', stale: false, reason: { code: 'registered_no_signal', params: {} } };
  if (!input.lastSeenAt) {
    return { state: 'unknown', stale: true, reason: { code: 'never_seen', params: {} } };
  }
  const ageMs = Math.max(0, input.now.getTime() - new Date(input.lastSeenAt).getTime());
  const ageS = Math.round(ageMs / 1000);
  if (ageMs >= t.offlineAfterMs) {
    return { state: 'offline', stale: true, reason: { code: 'no_heartbeat_offline', params: { seconds: ageS } } };
  }
  if (!input.integrationConnected || ageMs >= t.staleAfterMs) {
    return {
      state: 'unknown',
      stale: true,
      reason: { code: input.integrationConnected ? 'no_heartbeat_stale' : 'runtime_disconnected', params: { seconds: ageS } },
    };
  }
  return { state: input.storedState, stale: false, reason: { code: 'runtime_reported', params: { seconds: ageS } } };
}

export interface PlacementInput {
  effective: AgentState;
  homeRoom: RoomKey;
  /** When the *effective* state last changed (used for the "idle long enough to rest" rule). */
  stateSince: string | null;
  now: Date;
  /** Most recent real message/meeting event involving this agent, if any. */
  recentTalk?: { at: string; kind: 'message' | 'meeting' } | null;
  thresholds?: Partial<Thresholds>;
}

export interface Placement {
  room: RoomKey;
  pose: Pose;
  overlay: Overlay | null;
  reason: ReasonCode;
}

/**
 * Where a character stands and what it does. Pure function of REAL state + REAL events:
 * movement only happens because a state transition or event happened.
 */
export function resolvePlacement(input: PlacementInput): Placement {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const home = input.homeRoom;
  const s = input.effective;

  const overlayStates: Partial<Record<AgentState, Overlay>> = {
    waiting: 'waiting',
    blocked: 'blocked',
    paused: 'paused',
    error: 'error',
    offline: 'offline',
    unknown: 'unknown',
    starting: 'starting',
    stopping: 'stopping',
    stopped: 'offline',
    registered: 'unknown',
  };
  const overlay = overlayStates[s] ?? null;
  if (overlay) return { room: home, pose: 'idle', overlay, reason: { code: `state_${s}`, params: {} } };

  const talkAge = input.recentTalk ? input.now.getTime() - new Date(input.recentTalk.at).getTime() : Infinity;
  if (input.recentTalk && talkAge >= 0 && talkAge <= t.talkWindowMs) {
    if (input.recentTalk.kind === 'meeting') return { room: 'meeting_room', pose: 'meeting', overlay: null, reason: { code: 'in_meeting', params: {} } };
    return { room: home, pose: 'talking', overlay: null, reason: { code: 'recent_message', params: {} } };
  }

  if (s === 'working') return { room: home, pose: 'working', overlay: null, reason: { code: 'run_active', params: {} } };
  if (s === 'thinking') return { room: home, pose: 'thinking', overlay: null, reason: { code: 'run_thinking', params: {} } };

  // idle
  const idleMs = input.stateSince ? input.now.getTime() - new Date(input.stateSince).getTime() : 0;
  if (idleMs >= t.restAfterIdleMs) {
    return { room: 'lounge', pose: 'resting', overlay: null, reason: { code: 'idle_resting', params: { seconds: Math.round(idleMs / 1000) } } };
  }
  return { room: home, pose: 'idle', overlay: null, reason: { code: 'idle', params: {} } };
}
