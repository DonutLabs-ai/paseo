import { describe, expect, test } from "vitest";
import {
  getParentAgentIdFromLabels,
  getScheduleRunStartedAtFromLabels,
  getOpenAgentTabLabel,
  hasOpenAgentTab,
  isDelegatedAgent,
  isOpenAgentTabLabel,
  PARENT_AGENT_ID_LABEL,
  SCHEDULE_RUN_STARTED_AT_LABEL,
} from "./agent-labels.js";

describe("agent label policy", () => {
  test("treats a non-empty parent agent label as delegation", () => {
    const labels = { [PARENT_AGENT_ID_LABEL]: " parent-agent \n" };

    expect(getParentAgentIdFromLabels(labels)).toBe("parent-agent");
    expect(isDelegatedAgent({ labels })).toBe(true);
  });

  test("ignores missing, empty, and non-string parent agent labels", () => {
    expect(isDelegatedAgent({ labels: {} })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } })).toBe(false);
  });

  test("treats any true client-scoped open-tab label as open", () => {
    const desktopLabel = getOpenAgentTabLabel("desktop-client");
    const mobileLabel = getOpenAgentTabLabel("mobile-client");

    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "true" })).toBe(true);
    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "false" })).toBe(false);
    expect(hasOpenAgentTab({})).toBe(false);
  });

  test("recognizes only client-scoped open-tab labels", () => {
    expect(isOpenAgentTabLabel(getOpenAgentTabLabel("client-a"))).toBe(true);
    expect(isOpenAgentTabLabel("paseo.open-agent-tab")).toBe(false);
    expect(isOpenAgentTabLabel("custom.open-agent-tab.client-a")).toBe(false);
  });

  test("reads only valid schedule run timestamps", () => {
    expect(
      getScheduleRunStartedAtFromLabels({
        [SCHEDULE_RUN_STARTED_AT_LABEL]: "2026-09-03T09:00:00.000Z",
      }),
    ).toBe("2026-09-03T09:00:00.000Z");
    expect(
      getScheduleRunStartedAtFromLabels({ [SCHEDULE_RUN_STARTED_AT_LABEL]: "not-a-date" }),
    ).toBeNull();
    expect(getScheduleRunStartedAtFromLabels({ [SCHEDULE_RUN_STARTED_AT_LABEL]: 42 })).toBeNull();
  });
});
