import { describe, expect, it } from "vitest";
import { buildCockpitAgentUsageByWorkspace } from "./use-cockpit-agent-usage";

describe("cockpit agent usage", () => {
  it("projects the active workspace agent context without per-card subscriptions", () => {
    const agent = {
      provider: "codex",
      lastUsage: {
        contextWindowMaxTokens: 200_000,
        contextWindowUsedTokens: 50_000,
        totalCostUsd: 1.25,
      },
    };
    const workspace = {
      workspaceKey: "host:workspace",
      serverId: "host",
      agentId: "agent-1",
    };

    const usage = buildCockpitAgentUsageByWorkspace({
      workspaces: [workspace],
      sessions: [{ serverId: "host", agents: new Map([["agent-1", agent]]) }],
    });

    expect(usage.get("host:workspace")).toEqual({
      provider: "codex",
      contextWindowMaxTokens: 200_000,
      contextWindowUsedTokens: 50_000,
      totalCostUsd: 1.25,
    });
  });
});
