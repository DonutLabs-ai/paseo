import { z } from "zod";
import type { WorkspaceReferenceProvider } from "@getpaseo/protocol/messages";

const URL_PATTERN = /https:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[),.;:!?\]}]+$/;
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;
const MAX_SLACK_MESSAGE_CHARS = 2_400;
const JsonValueSchema = z.json();
type JsonValue = z.infer<typeof JsonValueSchema>;

export interface WorkspaceReferenceTarget {
  key: string;
  provider: WorkspaceReferenceProvider;
  url: string;
  identifier: string;
  channelId?: string;
  threadTs?: string;
}

export interface WorkspaceReferenceSource {
  title: string;
  content: string;
}

const LinearIssueSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  state: z.object({ name: z.string() }),
});

const LinearIssueResponseSchema = z.object({
  data: z.object({ issue: LinearIssueSchema.nullable() }).nullable().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

const SlackMessageSchema = z
  .object({
    ts: z.string(),
    text: z.string().default(""),
    user: z.string().optional(),
    username: z.string().optional(),
    bot_profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const SlackRepliesResponseSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    messages: z.array(SlackMessageSchema).default([]),
    response_metadata: z.object({ next_cursor: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const SlackAuthResponseSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    team: z.string().optional(),
    user: z.string().optional(),
    team_id: z.string().optional(),
    user_id: z.string().optional(),
  })
  .passthrough();

const LinearViewerResponseSchema = z.object({
  data: z
    .object({ viewer: z.object({ name: z.string(), email: z.string().optional() }) })
    .optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

const LINEAR_ISSUE_QUERY = `
  query PaseoWorkspaceReference($id: String!) {
    issue(id: $id) {
      identifier
      title
      description
      url
      state { name }
    }
  }
`;

const LINEAR_VIEWER_QUERY = `query PaseoWorkspaceReferenceViewer { viewer { name email } }`;

function slackPermalinkTimestamp(value: string): string | null {
  if (!/^\d{7,}$/.test(value)) return null;
  if (value.length <= 6) return null;
  return `${value.slice(0, -6)}.${value.slice(-6)}`;
}

function normalizeSlackThreadTs(url: URL, permalinkDigits: string): string | null {
  const queryThreadTs = url.searchParams.get("thread_ts")?.trim();
  if (queryThreadTs && /^\d+\.\d+$/.test(queryThreadTs)) return queryThreadTs;
  return slackPermalinkTimestamp(permalinkDigits);
}

export function normalizeWorkspaceReferenceUrl(rawUrl: string): WorkspaceReferenceTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl.replace(TRAILING_PUNCTUATION, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "linear.app") {
    const issueIndex = segments.indexOf("issue");
    const identifier = issueIndex >= 0 ? segments[issueIndex + 1] : undefined;
    if (!identifier || !LINEAR_IDENTIFIER.test(identifier)) return null;
    const normalizedIdentifier = identifier.toUpperCase();
    return {
      provider: "linear",
      key: `linear:${normalizedIdentifier}`,
      identifier: normalizedIdentifier,
      url: `${url.origin}/${segments.slice(0, issueIndex + 2).join("/")}`,
    };
  }

  if (!url.hostname.endsWith(".slack.com")) return null;
  const archivesIndex = segments.indexOf("archives");
  const channelId = archivesIndex >= 0 ? segments[archivesIndex + 1] : undefined;
  const messagePart = archivesIndex >= 0 ? segments[archivesIndex + 2] : undefined;
  if (!channelId || !messagePart?.startsWith("p")) return null;
  const permalinkDigits = messagePart.slice(1);
  const threadTs = normalizeSlackThreadTs(url, permalinkDigits);
  if (!threadTs) return null;
  const team = url.hostname.slice(0, -".slack.com".length);
  return {
    provider: "slack",
    key: `slack:${team}:${channelId}:${threadTs}`,
    identifier: `${channelId}:${threadTs}`,
    channelId,
    threadTs,
    url: `https://${url.hostname}/archives/${channelId}/p${threadTs.replace(".", "")}`,
  };
}

export function extractWorkspaceReferenceTargets(value: unknown): WorkspaceReferenceTarget[] {
  const serialized = JSON.stringify(value);
  if (!serialized) return [];
  const json = JsonValueSchema.parse(JSON.parse(serialized));
  const byKey = new Map<string, WorkspaceReferenceTarget>();
  const visit = (node: JsonValue): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(URL_PATTERN)) {
        const target = normalizeWorkspaceReferenceUrl(match[0]);
        if (target) byKey.set(target.key, target);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node && typeof node === "object") {
      for (const child of Object.values(node)) visit(child);
    }
  };
  visit(json);
  return [...byKey.values()];
}

function describeHttpFailure(provider: "Linear" | "Slack", status: number): string {
  if (status === 401 || status === 403) return `${provider} rejected the configured credential`;
  if (status === 429) return `${provider} rate limit reached`;
  return `${provider} API request failed with HTTP ${status}`;
}

async function linearGraphql(token: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(describeHttpFailure("Linear", response.status));
  return response.json();
}

export async function verifyLinearCredential(token: string): Promise<string> {
  const parsed = LinearViewerResponseSchema.parse(
    await linearGraphql(token, LINEAR_VIEWER_QUERY, {}),
  );
  if (parsed.errors?.length)
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  if (!parsed.data?.viewer) throw new Error("Linear returned no viewer identity");
  return parsed.data.viewer.email
    ? `${parsed.data.viewer.name} (${parsed.data.viewer.email})`
    : parsed.data.viewer.name;
}

export async function fetchLinearReference(
  target: WorkspaceReferenceTarget,
  token: string,
): Promise<WorkspaceReferenceSource> {
  const parsed = LinearIssueResponseSchema.parse(
    await linearGraphql(token, LINEAR_ISSUE_QUERY, { id: target.identifier }),
  );
  if (parsed.errors?.length)
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  const issue = parsed.data?.issue;
  if (!issue) throw new Error(`Linear issue ${target.identifier} was not found`);
  return {
    title: `${issue.identifier} ${issue.title}`,
    content: [
      `Status: ${issue.state.name}`,
      "Description:",
      issue.description?.trim() || "No description.",
    ].join("\n"),
  };
}

async function slackApi(token: string, method: string, params: URLSearchParams): Promise<unknown> {
  const response = await fetch(`https://slack.com/api/${method}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(describeHttpFailure("Slack", response.status));
  return response.json();
}

export async function verifySlackCredential(token: string): Promise<string> {
  const parsed = SlackAuthResponseSchema.parse(
    await slackApi(token, "auth.test", new URLSearchParams()),
  );
  if (!parsed.ok)
    throw new Error(`Slack rejected the configured credential: ${parsed.error ?? "unknown error"}`);
  const team = parsed.team ?? parsed.team_id ?? "Slack";
  const user = parsed.user ?? parsed.user_id;
  return user ? `${team} · ${user}` : team;
}

function slackAuthor(message: z.infer<typeof SlackMessageSchema>): string {
  return message.username ?? message.bot_profile?.name ?? message.user ?? "Unknown author";
}

function slackMessageText(message: z.infer<typeof SlackMessageSchema>): string {
  const text = message.text.trim() || "(empty message)";
  if (text.length <= MAX_SLACK_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_SLACK_MESSAGE_CHARS - 1)}…`;
}

export async function fetchSlackReference(
  target: WorkspaceReferenceTarget,
  token: string,
): Promise<WorkspaceReferenceSource> {
  if (!target.channelId || !target.threadTs) throw new Error("Invalid Slack thread target");
  const messages = new Map<string, z.infer<typeof SlackMessageSchema>>();
  let cursor = "";
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams({
      channel: target.channelId,
      ts: target.threadTs,
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    const parsed = SlackRepliesResponseSchema.parse(
      await slackApi(token, "conversations.replies", params),
    );
    if (!parsed.ok)
      throw new Error(`Slack could not read the thread: ${parsed.error ?? "unknown error"}`);
    for (const message of parsed.messages) messages.set(message.ts, message);
    cursor = parsed.response_metadata?.next_cursor?.trim() ?? "";
    if (!cursor) break;
    if (page === 49) throw new Error("Slack thread exceeds the supported 10,000-message limit");
  }

  const ordered = [...messages.values()].sort((left, right) => Number(left.ts) - Number(right.ts));
  const root = ordered.find((message) => message.ts === target.threadTs) ?? ordered[0];
  if (!root) throw new Error("Slack returned an empty thread");
  const replies = ordered.filter((message) => message.ts !== root.ts).slice(-5);
  const rendered = [root, ...replies]
    .map((message, index) => {
      const role = index === 0 ? "OP" : `Recent reply ${index}`;
      return `${role} — ${slackAuthor(message)}:\n${slackMessageText(message)}`;
    })
    .join("\n\n");
  return {
    title: root.text.trim().split("\n")[0]?.slice(0, 120) || "Slack thread",
    content: rendered,
  };
}
