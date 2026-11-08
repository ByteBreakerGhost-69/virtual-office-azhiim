import type { AgentDTO, AgentState, RoomKey } from '@avo/shared';

export type ViewFilter = 'ALL' | 'REAL' | 'SIMULATED';

export type OfficeSfx = 'select' | 'deselect' | 'footstep' | 'door';

/** All user-visible text the scene needs (so the engine itself has no hard-coded language). */
export interface OfficeLabels {
  real: string;
  simulated: string;
  you: string;
  staleOverlay: string;
  roomNames: Record<RoomKey, string>;
  states: Record<AgentState, string>;
  /** aria-label of the keyboard-accessible agent list that mirrors the canvas */
  agentListLabel: string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
}

export interface OfficeCanvasProps {
  /** Truthful agents from the backend. The scene may only draw what these fields say. */
  agents: AgentDTO[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  filter: ViewFilter;
  labels: OfficeLabels;
  reducedMotion: boolean;
  /** Extra feature: Owner avatar moved with WASD. */
  avatarEnabled: boolean;
  /** false => realtime connection lost; scene shows a stale overlay. */
  live: boolean;
  onSfx?: (name: OfficeSfx) => void;
  className?: string;
}
