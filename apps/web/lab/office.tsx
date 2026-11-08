/**
 * DEV-ONLY harness for visually verifying the pixel engine with hand-written AgentDTOs.
 * These agents are fixtures for screenshots, never shown in the product.
 */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_DEPARTMENTS, ROOM_KEYS, type AgentDTO, type AgentState, type Pose, type RoomKey, type Overlay } from '@avo/shared';
import { OfficeCanvas } from '../src/office/index.js';
import type { OfficeLabels } from '../src/office/types.js';

const now = new Date().toISOString();
function mk(i: number, name: string, dept: (typeof DEFAULT_DEPARTMENTS)[number]['key'], mode: 'REAL' | 'SIMULATED', state: AgentState, room: RoomKey | null, pose: Pose, overlay: Overlay | null, role: AgentDTO['orgRole'] = 'specialist'): AgentDTO {
  const d = DEFAULT_DEPARTMENTS.find((x) => x.key === dept)!;
  return {
    id: `a${i}`, name, handle: name.toLowerCase(), title: 'Fixture', mode, runtimeKind: mode === 'REAL' ? 'HERMES' : 'SIMULATED', integrationId: 'i', integrationName: 'fx', integrationStatus: 'connected', runtimeRef: null,
    departmentId: dept, departmentKey: dept, departmentName: d.name, departmentColor: d.color, orgRole: role, reportsToAgentId: null, enabled: true, storedState: state, state, stale: state === 'unknown' || state === 'offline',
    stateReason: { code: 'x', params: {} }, stateSince: now, stateSource: 'fixture', lastSeenAt: now, currentTaskId: null, currentTaskTitle: null, capabilities: [], permissions: [], appearanceSeed: `seed-${name}`,
    homeRoom: d.homeRoom, placement: { room: room ?? d.homeRoom, pose, overlay, reason: { code: 'x', params: {} } }, activityNote: null, supports: { pause: false, resume: false, cancel: true }, createdAt: `2026-01-0${i + 1}T00:00:00Z`,
  } as AgentDTO;
}
const labels: OfficeLabels = {
  real: 'REAL', simulated: 'SIM', you: 'You', staleOverlay: 'Connection lost — data may be stale',
  roomNames: { main_office: 'Leader Room', employee_workspace: 'Employee Workspace', development_room: 'Development Room', research_room: 'Research Room', meeting_room: 'Meeting Room', server_room: 'Server Room', lounge: 'Lounge' },
  states: { registered: 'registered', starting: 'starting', idle: 'idle', working: 'working', thinking: 'thinking', waiting: 'waiting', blocked: 'blocked', paused: 'paused', stopping: 'stopping', stopped: 'stopped', error: 'error', offline: 'offline', unknown: 'unknown' } as OfficeLabels['states'],
  agentListLabel: 'Agents', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset zoom',
};

function Lab() {
  const q = new URLSearchParams(location.search);
  const [sel, setSel] = useState<string | null>(q.get('sel'));
  const [step, setStep] = useState(0);
  const agents = useMemo<AgentDTO[]>(() => {
    const base = [
      mk(0, 'Aria', 'leadership', 'REAL', 'working', null, 'working', null, 'leader'),
      mk(1, 'Bolt', 'operations', 'REAL', 'idle', null, 'idle', null),
      mk(2, 'Cody', 'engineering', 'REAL', 'thinking', null, 'thinking', null),
      mk(3, 'Dara', 'research', 'SIMULATED', 'working', null, 'working', null),
      mk(4, 'Echo', 'infrastructure', 'SIMULATED', 'waiting', null, 'idle', 'waiting'),
      mk(5, 'Finn', 'engineering', 'SIMULATED', 'idle', 'lounge', 'resting', null),
      mk(6, 'Gale', 'operations', 'REAL', 'unknown', null, 'idle', 'unknown'),
      mk(7, 'Hex', 'research', 'SIMULATED', 'working', 'meeting_room', 'meeting', null),
    ];
    if (step % 2 === 1) {
      base[1] = mk(1, 'Bolt', 'operations', 'REAL', 'working', 'meeting_room', 'meeting', null);
      base[2] = mk(2, 'Cody', 'engineering', 'REAL', 'idle', 'lounge', 'resting', null);
    }
    return base;
  }, [step]);
  void ROOM_KEYS;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <button data-testid="lab-step" onClick={() => setStep((s) => s + 1)} style={{ position: 'absolute', zIndex: 5, left: 8, bottom: 8 }}>move</button>
      <OfficeCanvas className="lab" agents={agents} selectedAgentId={sel} onSelectAgent={setSel} filter={(q.get('filter') as 'ALL') ?? 'ALL'} labels={labels} reducedMotion={q.get('rm') === '1'} avatarEnabled={q.get('avatar') === '1'} live={q.get('live') !== '0'} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
