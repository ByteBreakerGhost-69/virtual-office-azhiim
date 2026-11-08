import type { RiskLevel } from '@avo/shared';

export interface PlanInput {
  task: { id: string; title: string; objective: string; expectedOutput: string | null; requiredCapabilities: string[]; requiresApproval: boolean };
  agent: { id: string; name: string; capabilities: string[] };
  eligibility: { checks: Record<string, boolean>; reasons: string[] };
  dependencyTitles: string[];
}

export interface Plan {
  planner: 'rule-based/v1';
  goal: string;
  assumptions: string[];
  subtasks: { id: string; title: string; assignee: string; dependsOn: string[] }[];
  requiredCapabilities: string[];
  completionCriteria: string[];
  risk: RiskLevel;
  approvalGates: string[];
  selectionRationale: { agent: string; checks: Record<string, boolean>; reasons: string[] };
}

const HIGH = /\b(deploy|publish|delete|drop|wipe|purchase|pay|transfer|production)\b/i;

/** MVP planner: honest and deterministic (no LLM). One subtask per task; the plan says so. */
export function buildPlan(i: PlanInput): Plan {
  const risk: RiskLevel = HIGH.test(i.task.objective) ? 'high' : 'low';
  return {
    planner: 'rule-based/v1',
    goal: i.task.title,
    assumptions: [
      'Single-agent execution: the assigned agent performs the whole objective.',
      ...(i.dependencyTitles.length ? [`Dependencies completed first: ${i.dependencyTitles.join(', ')}`] : []),
    ],
    subtasks: [{ id: 's1', title: i.task.title, assignee: i.agent.name, dependsOn: [] }],
    requiredCapabilities: i.task.requiredCapabilities,
    completionCriteria: i.task.expectedOutput
      ? [`The runtime reports completion AND produces output matching: ${i.task.expectedOutput}`]
      : ['The runtime reports completion. No automatic verification criteria were provided.'],
    risk,
    approvalGates: [...(i.task.requiresApproval ? ['pre_run: owner approval required'] : []), ...(risk === 'high' ? ['runtime: protected actions need approval'] : [])],
    selectionRationale: { agent: i.agent.name, checks: i.eligibility.checks, reasons: i.eligibility.reasons },
  };
}
