import type { RuntimeKind } from '@avo/shared';
import { type AdapterConfig, type AdapterDescriptor, type RuntimeAdapter, AdapterUnavailableError } from './types.js';
import type { AdapterDeps } from './logger.js';
import { HERMES_DESCRIPTOR, HermesAdapter } from './hermes/hermes-adapter.js';
import { SIMULATED_DESCRIPTOR, SimulatedAdapter } from './simulated/simulated-adapter.js';

const unavailable = (kind: RuntimeKind, label: string, notes: string): AdapterDescriptor => ({
  kind,
  label,
  available: false,
  simulated: false,
  features: { pause: false, resume: false, cancel: false, approvals: false, eventStream: false },
  config: { baseUrlRequired: true, secretRequired: false },
  notes,
});

export const ADAPTER_DESCRIPTORS: Record<RuntimeKind, AdapterDescriptor> = {
  HERMES: HERMES_DESCRIPTOR,
  SIMULATED: SIMULATED_DESCRIPTOR,
  OPENCLAW: unavailable('OPENCLAW', 'OpenClaw', 'Planned. The adapter interface supports it; no implementation exists yet.'),
  INTERNAL: unavailable('INTERNAL', 'Internal runtime', 'Planned. The adapter interface supports it; no implementation exists yet.'),
};

export function getDescriptor(kind: RuntimeKind): AdapterDescriptor {
  return ADAPTER_DESCRIPTORS[kind];
}

export function createAdapter(kind: RuntimeKind, config: AdapterConfig, deps: AdapterDeps & { simulated?: ConstructorParameters<typeof SimulatedAdapter>[1] } = {}): RuntimeAdapter {
  switch (kind) {
    case 'HERMES':
      return new HermesAdapter(config, deps);
    case 'SIMULATED':
      return new SimulatedAdapter(config, { ...deps.simulated, ...(deps.clock ? { clock: deps.clock } : {}) });
    default:
      throw new AdapterUnavailableError(kind, `${ADAPTER_DESCRIPTORS[kind].label} adapter is not implemented yet`);
  }
}
