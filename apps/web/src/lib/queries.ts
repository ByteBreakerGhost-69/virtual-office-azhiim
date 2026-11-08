import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentDTO, ApprovalDTO, DepartmentDTO, DomainEvent, IntegrationDTO, MemoryRecordDTO, MessageDTO, OrganizationDTO, OverviewDTO, ProjectDTO, RunDTO, SettingsDTO, TaskDTO, UserDTO,
} from '@avo/shared';
import { api, qs } from './api.js';

export interface AuthStatus { setupRequired: boolean; authenticated: boolean; user?: UserDTO }
export interface Me { user: UserDTO; csrfToken: string; workspace: { id: string; name: string } }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface AdapterDescriptor { kind: string; label: string; available: boolean; simulated: boolean; features: IntegrationDTO['features']; config: { baseUrlRequired: boolean; secretRequired: boolean; baseUrlExample?: string }; notes?: string }
export interface AgentDetail { agent: AgentDTO; currentTask: TaskDTO | null; runs: RunDTO[]; recentEvents: DomainEvent[]; messages: MessageDTO[] }
export interface TaskDetail { task: TaskDTO; runs: RunDTO[]; approvals: ApprovalDTO[]; messages: MessageDTO[]; events: DomainEvent[] }
export interface SimulationStatus { present: boolean; integrationId: string | null; agents: number; warning: string }

export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentDTO[]>('/agents'), refetchInterval: 20_000 });
export const useAgent = (id: string | null) => useQuery({ queryKey: ['agent', id], queryFn: () => api.get<AgentDetail>(`/agents/${id}`), enabled: !!id, placeholderData: keepPreviousData });
export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewDTO>('/overview'), refetchInterval: 15_000 });
export const useTasks = (f: { status?: string; agentId?: string; mode?: string } = {}) => useQuery({ queryKey: ['tasks', f], queryFn: () => api.get<TaskDTO[]>(`/tasks${qs(f)}`), placeholderData: keepPreviousData });
export const useTask = (id: string | null) => useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDetail>(`/tasks/${id}`), enabled: !!id });
export const useApprovals = (status?: string) => useQuery({ queryKey: ['approvals', status ?? 'all'], queryFn: () => api.get<ApprovalDTO[]>(`/approvals${qs({ status })}`), refetchInterval: 10_000 });
export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: () => api.get<IntegrationDTO[]>('/integrations') });
export const useAdapterKinds = () => useQuery({ queryKey: ['integration-kinds'], queryFn: () => api.get<AdapterDescriptor[]>('/integrations/kinds') });
export const useOrganization = () => useQuery({ queryKey: ['organization'], queryFn: () => api.get<OrganizationDTO>('/organization') });
export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => api.get<DepartmentDTO[]>('/departments') });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsDTO>('/settings') });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectDTO[]>('/projects') });
export const useMemory = (scope?: string) => useQuery({ queryKey: ['memory', scope ?? 'all'], queryFn: () => api.get<MemoryRecordDTO[]>(`/memory${qs({ scope })}`) });
export const useSimulation = () => useQuery({ queryKey: ['simulation'], queryFn: () => api.get<SimulationStatus>('/simulation') });
export const useActivity = (f: { agentId?: string; taskId?: string; severity?: string; mode?: string; limit?: number } = {}) =>
  useQuery({ queryKey: ['activity', f], queryFn: () => api.get<Page<DomainEvent>>(`/activity${qs({ limit: 50, ...f })}`), placeholderData: keepPreviousData });

/** Mutation helper that refreshes everything a change could affect. */
export function useAction<TArgs, TResult = unknown>(fn: (args: TArgs) => Promise<TResult>, invalidate: string[][] = [['agents'], ['tasks'], ['overview'], ['approvals'], ['integrations'], ['activity'], ['organization'], ['simulation']]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void invalidate.forEach((k) => void qc.invalidateQueries({ queryKey: k })) });
}
