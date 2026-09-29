import { Command } from "commander";
import { connectToDaemon, resolveAgentId } from "../../utils/client.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

/** Result type for agent archive command */
export interface AgentArchiveResult {
  agentId: string;
  status: "archived";
  archivedAt: string;
}

/** Schema for archive command output */
export const archiveSchema: OutputSchema<AgentArchiveResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "STATUS", field: "status" },
    { header: "ARCHIVED AT", field: "archivedAt" },
  ],
};

export function addArchiveOptions(cmd: Command): Command {
  return cmd
    .description("Archive an agent (soft-delete)")
    .argument("<id>", "Agent ID, prefix, or name")
    .option("--force", "Force archive running agent (interrupts active run first)");
}

export interface AgentArchiveOptions extends CommandOptions {
  force?: boolean;
  host?: string;
}

export type AgentArchiveCommandResult = SingleResult<AgentArchiveResult>;

interface ArchivableAgent {
  id: string;
  title?: string | null;
  status: string;
  archivedAt?: string | null;
}

export interface ArchiveAgentClient {
  fetchAgent(options: { agentId: string }): Promise<{ agent: ArchivableAgent } | null>;
  fetchAgents(options: {
    filter: { includeArchived: true };
    page: { limit: number; cursor?: string };
  }): Promise<{
    entries: Array<{ agent: ArchivableAgent }>;
    pageInfo: { nextCursor: string | null };
  }>;
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>;
}

export async function archiveAgentWithClient(
  client: ArchiveAgentClient,
  agentIdArg: string,
  force: boolean,
): Promise<AgentArchiveResult> {
  // The daemon resolves full IDs, unique prefixes, and exact titles against the entire store.
  // A directory query only returns its first 200 entries unless it is paginated.
  const directResult = await client.fetchAgent({ agentId: agentIdArg });
  let agent = directResult?.agent;
  if (!agent) {
    // Preserve the CLI's case-insensitive and partial-title matching semantics.
    const agents: ArchivableAgent[] = [];
    let cursor: string | null = null;
    do {
      const page = await client.fetchAgents({
        filter: { includeArchived: true },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      agents.push(...page.entries.map((entry) => entry.agent));
      cursor = page.pageInfo.nextCursor;
    } while (cursor);
    const agentId = resolveAgentId(agentIdArg, agents);
    agent = agents.find((entry) => entry.id === agentId);
  }

  if (!agent) {
    const error: CommandError = {
      code: "AGENT_NOT_FOUND",
      message: `Agent not found: ${agentIdArg}`,
      details: 'Use "paseo ls" to list available agents',
    };
    throw error;
  }

  const agentId = agent.id;
  if (agent.archivedAt) {
    const error: CommandError = {
      code: "AGENT_ALREADY_ARCHIVED",
      message: `Agent ${agentId.slice(0, 7)} is already archived`,
      details: `Archived at: ${agent.archivedAt}`,
    };
    throw error;
  }

  if (agent.status === "running" && !force) {
    const error: CommandError = {
      code: "AGENT_RUNNING",
      message: `Agent ${agentId.slice(0, 7)} is currently running`,
      details:
        "Use --force to archive a running agent (it will interrupt the active run), or stop it first with: paseo agent stop. Use paseo agent delete to hard-delete it.",
    };
    throw error;
  }

  const result = await client.archiveAgent(agentId);
  return { agentId, status: "archived", archivedAt: result.archivedAt };
}

export async function runArchiveCommand(
  agentIdArg: string,
  options: AgentArchiveOptions,
  _command: Command,
): Promise<AgentArchiveCommandResult> {
  // Validate arguments
  if (!agentIdArg || agentIdArg.trim().length === 0) {
    const error: CommandError = {
      code: "MISSING_AGENT_ID",
      message: "Agent ID is required",
      details: "Usage: paseo agent archive <id-or-name>",
    };
    throw error;
  }

  const client = await connectToDaemon({ target: options.daemonTarget });

  try {
    const data = await archiveAgentWithClient(client, agentIdArg, Boolean(options.force));

    await client.close();

    return {
      type: "single",
      data,
      schema: archiveSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});

    // Re-throw CommandError as-is
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "ARCHIVE_FAILED",
      message: `Failed to archive agent: ${message}`,
    };
    throw error;
  }
}
