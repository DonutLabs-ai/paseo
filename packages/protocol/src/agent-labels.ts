export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
export const SCHEDULE_ID_LABEL = "paseo.schedule-id";
export const SCHEDULE_RUN_ID_LABEL = "paseo.schedule-run";
export const SCHEDULE_RUN_STARTED_AT_LABEL = "paseo.schedule-run-started-at";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getScheduleRunStartedAtFromLabels(
  labels: Record<string, unknown> | null | undefined,
): string | null {
  const startedAt = labels?.[SCHEDULE_RUN_STARTED_AT_LABEL];
  if (typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt))) {
    return null;
  }
  return startedAt;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}
