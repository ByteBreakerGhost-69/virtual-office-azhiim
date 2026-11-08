import type { AgentState } from '@avo/shared';

export const INELIGIBLE_STATES: readonly AgentState[] = ['offline', 'unknown', 'error', 'stopped', 'paused', 'registered', 'starting', 'stopping', 'blocked'];

export interface EligibilityInput {
  enabled: boolean;
  integrationConnected: boolean;
  effectiveState: AgentState;
  declaredCapabilities: string[];
  requiredCapabilities: string[];
  activeRuns: number;
  maxConcurrent: number;
  dispatchPaused: boolean;
}

/** ORCHESTRATOR_SPEC 3. Returns every reason, so the selection is explainable and recorded. */
export function evaluateEligibility(i: EligibilityInput): { eligible: boolean; reasons: string[]; checks: Record<string, boolean> } {
  const missing = i.requiredCapabilities.filter((c) => !i.declaredCapabilities.includes(c));
  const checks = {
    dispatch_not_paused: !i.dispatchPaused,
    agent_enabled: i.enabled,
    runtime_connected: i.integrationConnected,
    state_allows_work: !INELIGIBLE_STATES.includes(i.effectiveState),
    has_required_capabilities: missing.length === 0,
    under_concurrency_limit: i.activeRuns < i.maxConcurrent,
  };
  const reasons: string[] = [];
  if (!checks.dispatch_not_paused) reasons.push('dispatch_paused');
  if (!checks.agent_enabled) reasons.push('agent_disabled');
  if (!checks.runtime_connected) reasons.push('runtime_not_connected');
  if (!checks.state_allows_work) reasons.push(`agent_state_${i.effectiveState}`);
  if (!checks.has_required_capabilities) reasons.push(`missing_capabilities:${missing.join(',')}`);
  if (!checks.under_concurrency_limit) reasons.push('concurrency_limit');
  return { eligible: reasons.length === 0, reasons, checks };
}
