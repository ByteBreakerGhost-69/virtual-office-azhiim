import { describe, expect, it } from 'vitest';
import { effectiveAgentState, resolvePlacement } from '../src/index.js';

const now = new Date('2026-11-08T00:10:00.000Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
const base = { mode: 'REAL' as const, integrationConnected: true, enabled: true, now };

describe('effectiveAgentState', () => {
  it('trusts a fresh heartbeat', () => {
    const r = effectiveAgentState({ ...base, storedState: 'working', lastSeenAt: ago(2) });
    expect(r).toMatchObject({ state: 'working', stale: false });
  });
  it('downgrades to unknown when heartbeat is stale', () => {
    const r = effectiveAgentState({ ...base, storedState: 'working', lastSeenAt: ago(30) });
    expect(r).toMatchObject({ state: 'unknown', stale: true });
  });
  it('downgrades to offline after the offline window', () => {
    const r = effectiveAgentState({ ...base, storedState: 'idle', lastSeenAt: ago(120) });
    expect(r).toMatchObject({ state: 'offline', stale: true });
  });
  it('never shows an agent as active when the integration is disconnected', () => {
    const r = effectiveAgentState({ ...base, integrationConnected: false, storedState: 'working', lastSeenAt: ago(1) });
    expect(r.state).toBe('unknown');
    expect(r.reason.code).toBe('runtime_disconnected');
  });
  it('never-seen agents are unknown, not idle', () => {
    expect(effectiveAgentState({ ...base, storedState: 'idle', lastSeenAt: null }).state).toBe('unknown');
  });
  it('disabled agents are stopped', () => {
    expect(effectiveAgentState({ ...base, enabled: false, storedState: 'working', lastSeenAt: ago(1) }).state).toBe('stopped');
  });
});

describe('resolvePlacement', () => {
  const p = (over: Partial<Parameters<typeof resolvePlacement>[0]>) =>
    resolvePlacement({ effective: 'idle', homeRoom: 'development_room', stateSince: ago(5), now, ...over });
  it('working stays at the home room desk', () => expect(p({ effective: 'working' })).toMatchObject({ room: 'development_room', pose: 'working' }));
  it('thinking uses the thinking pose', () => expect(p({ effective: 'thinking' }).pose).toBe('thinking'));
  it('long idle goes to the lounge to rest', () => expect(p({ stateSince: ago(300) })).toMatchObject({ room: 'lounge', pose: 'resting' }));
  it('short idle stays home', () => expect(p({})).toMatchObject({ room: 'development_room', pose: 'idle' }));
  it('recent meeting event moves to the meeting room', () =>
    expect(p({ effective: 'working', recentTalk: { at: ago(3), kind: 'meeting' } })).toMatchObject({ room: 'meeting_room', pose: 'meeting' }));
  it('old talk is ignored', () => expect(p({ effective: 'working', recentTalk: { at: ago(300), kind: 'message' } }).pose).toBe('working'));
  it('offline/unknown/blocked never animate as working', () => {
    for (const s of ['offline', 'unknown', 'blocked', 'paused', 'error', 'waiting'] as const) {
      const r = p({ effective: s, recentTalk: { at: ago(1), kind: 'meeting' } });
      expect(r.pose).toBe('idle');
      expect(r.overlay).not.toBeNull();
    }
  });
});
