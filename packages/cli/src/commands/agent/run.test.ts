import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRunWorkspaceSource,
  resolveRunPromptInput,
  resolveExistingRunWorkspace,
  resolveRunCallerAgentId,
  runRunCommand,
  type AgentRunOptions,
} from "./run";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

describe("managed agent caller context", () => {
  it("propagates a trimmed PASEO_AGENT_ID", () => {
    expect(resolveRunCallerAgentId({ PASEO_AGENT_ID: "  parent-agent  " })).toBe("parent-agent");
  });

  it("omits blank caller ids", () => {
    expect(resolveRunCallerAgentId({ PASEO_AGENT_ID: "   " })).toBeUndefined();
  });
});

describe("run prompt input", () => {
  it("reads a prompt from a file without placing its contents in the command arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paseo-run-prompt-"));
    try {
      const promptPath = join(directory, "prompt.txt");
      const prompt = "full issue context\n".repeat(16_384);
      await writeFile(promptPath, prompt);

      await expect(resolveRunPromptInput(undefined, promptPath)).resolves.toBe(prompt);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects combining a positional prompt with --prompt-file", async () => {
    await expect(resolveRunPromptInput("inline", "/tmp/prompt.txt")).rejects.toMatchObject({
      code: "CONFLICTING_PROMPT_INPUT",
    });
  });

  it("rejects an empty prompt file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paseo-run-empty-prompt-"));
    try {
      const promptPath = join(directory, "prompt.txt");
      await writeFile(promptPath, "  \n");

      await expect(resolveRunPromptInput(undefined, promptPath)).rejects.toMatchObject({
        code: "MISSING_PROMPT",
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe("existing run workspace resolution", () => {
  it("queries the daemon for an exact workspace id and uses its directory", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "workspace-2", workspaceDirectory: "/workspace/two" }],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "workspace-2")).resolves.toEqual({
      id: "workspace-2",
      cwd: "/workspace/two",
    });
    expect(fetchWorkspaces).toHaveBeenCalledWith({
      filter: { query: "workspace-2" },
      page: { limit: 200 },
    });
  });

  it("rejects a workspace id absent from daemon state", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "missing")).rejects.toMatchObject(
      {
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: missing",
      },
    );
  });
});

describe("new run workspace project placement", () => {
  it("threads an explicit project into a worktree workspace source", () => {
    expect(
      buildRunWorkspaceSource(
        {
          newWorkspace: "worktree",
          project: "prj_automations",
          base: "origin/develop",
          worktreeSlug: "tes-123",
        },
        "/repo",
      ),
    ).toEqual({
      kind: "worktree",
      cwd: "/repo",
      projectId: "prj_automations",
      action: "branch-off",
      baseBranch: "origin/develop",
      worktreeSlug: "tes-123",
    });
  });
});

// validateRunOptions runs before the CLI ever connects to a daemon, so these
// invalid combinations reject without one running.
describe("runRunCommand option validation", () => {
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function expectInvalidOptions(
    options: Omit<AgentRunOptions, "daemonTarget">,
    messageMatch: RegExp,
  ) {
    await expect(
      runRunCommand("do something", { ...options, daemonTarget }, {} as never),
    ).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
      message: expect.stringMatching(messageMatch),
    });
  }

  it("rejects --new-workspace combined with --workspace", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", workspace: "ws-1" },
      /--new-workspace and --workspace cannot be combined/,
    );
  });

  it("rejects --project without explicit workspace creation", async () => {
    await expectInvalidOptions(
      { project: "prj_automations" },
      /--project requires --new-workspace/,
    );
  });

  it("rejects --project combined with an existing workspace", async () => {
    await expectInvalidOptions(
      { project: "prj_automations", workspace: "ws-1" },
      /--project and --workspace cannot be combined/,
    );
  });

  it("allows explicit worktree workspace creation through validation", async () => {
    // Explicit workspace creation with no --workspace
    // must clear validation. It still fails later (provider resolution), which
    // is enough to prove the new guard did not reject it.
    await expect(
      runRunCommand(
        "do something",
        { newWorkspace: "worktree", provider: undefined, daemonTarget },
        {} as never,
      ),
    ).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("rejects unknown new workspace kinds", async () => {
    await expectInvalidOptions({ newWorkspace: "container" }, /Unsupported new workspace kind/);
  });

  it("rejects two workspace creation flags", async () => {
    await expectInvalidOptions(
      { newWorkspace: "local", worktree: "legacy-slug" },
      /--new-workspace and --worktree cannot be combined/,
    );
  });

  it("rejects an unknown worktree creation mode before connecting", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", worktreeMode: "container" },
      /Unsupported worktree mode/,
    );
  });
});
