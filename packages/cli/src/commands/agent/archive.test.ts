import { describe, expect, it } from "vitest";
import { archiveAgentWithClient, type ArchiveAgentClient } from "./archive.js";

const targetId = "11111111-1111-4111-8111-111111111111";
const target = {
  id: targetId,
  title: "Old task",
  status: "idle",
  archivedAt: null,
};

describe("archiveAgentWithClient", () => {
  it("archives an agent by exact ID without depending on the first directory page", async () => {
    const archived: string[] = [];
    const client: ArchiveAgentClient = {
      fetchAgent: async ({ agentId }) => (agentId === targetId ? { agent: target } : null),
      fetchAgents: async () => {
        throw new Error("The target is not on the first directory page");
      },
      archiveAgent: async (agentId) => {
        archived.push(agentId);
        return { archivedAt: "2026-09-29T00:00:00.000Z" };
      },
    };

    const result = await archiveAgentWithClient(client, targetId, false);

    expect(archived).toEqual([targetId]);
    expect(result).toEqual({
      agentId: targetId,
      status: "archived",
      archivedAt: "2026-09-29T00:00:00.000Z",
    });
  });

  it("finds a partial title beyond the first directory page", async () => {
    const archived: string[] = [];
    const cursors: Array<string | undefined> = [];
    const client: ArchiveAgentClient = {
      fetchAgent: async () => null,
      fetchAgents: async ({ page }) => {
        cursors.push(page?.cursor);
        return page?.cursor
          ? { entries: [{ agent: target }], pageInfo: { nextCursor: null } }
          : {
              entries: [{ agent: { ...target, id: "another-id", title: "New task" } }],
              pageInfo: { nextCursor: "page-2" },
            };
      },
      archiveAgent: async (agentId) => {
        archived.push(agentId);
        return { archivedAt: "2026-09-29T00:00:00.000Z" };
      },
    };

    await archiveAgentWithClient(client, "Old", false);

    expect(cursors).toEqual([undefined, "page-2"]);
    expect(archived).toEqual([targetId]);
  });

  it("rejects an already archived agent without archiving it again", async () => {
    const archived: string[] = [];
    const client: ArchiveAgentClient = {
      fetchAgent: async () => ({ agent: { ...target, archivedAt: "2026-09-28T00:00:00.000Z" } }),
      fetchAgents: async () => {
        throw new Error("Directory lookup was not expected");
      },
      archiveAgent: async (agentId) => {
        archived.push(agentId);
        return { archivedAt: "2026-09-29T00:00:00.000Z" };
      },
    };

    await expect(archiveAgentWithClient(client, targetId, false)).rejects.toMatchObject({
      code: "AGENT_ALREADY_ARCHIVED",
    });
    expect(archived).toEqual([]);
  });

  it("rejects a running agent without force", async () => {
    const archived: string[] = [];
    const client: ArchiveAgentClient = {
      fetchAgent: async () => ({ agent: { ...target, status: "running" } }),
      fetchAgents: async () => {
        throw new Error("Directory lookup was not expected");
      },
      archiveAgent: async (agentId) => {
        archived.push(agentId);
        return { archivedAt: "2026-09-29T00:00:00.000Z" };
      },
    };

    await expect(archiveAgentWithClient(client, targetId, false)).rejects.toMatchObject({
      code: "AGENT_RUNNING",
    });
    expect(archived).toEqual([]);
  });
});
