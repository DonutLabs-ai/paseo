import { z } from "zod";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { WorkspaceReferenceProvider } from "@getpaseo/protocol/messages";

const URL_PATTERN = /https:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[),.;:!?\]}]+$/;
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;
const MAX_SLACK_MESSAGE_CHARS = 2_400;
const MAX_REFERENCE_EXCERPT_CHARS = 800;
const MAX_LINEAR_EXCERPT_PARAGRAPHS = 3;

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
  excerpt: string;
}

function truncateExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function firstParagraphs(text: string, maxParagraphs: number): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, maxParagraphs);
  return truncateExcerpt(paragraphs.join("\n\n"), MAX_REFERENCE_EXCERPT_CHARS);
}

function balancedSections(sections: string[]): string {
  if (sections.length === 0) return "";
  const separatorChars = Math.max(0, sections.length - 1) * 2;
  const sectionChars = Math.max(
    1,
    Math.floor((MAX_REFERENCE_EXCERPT_CHARS - separatorChars) / sections.length),
  );
  return sections.map((section) => truncateExcerpt(section, sectionChars)).join("\n\n");
}

const LinearIssueSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});

const LinearIssueResponseSchema = z.object({
  data: z.object({ issue: LinearIssueSchema.nullable() }).nullable().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

const SlackTextObjectSchema = z.object({ text: z.string() }).passthrough();

interface SlackRichTextElement {
  type?: string;
  text?: string;
  url?: string;
  user_id?: string;
  channel_id?: string;
  name?: string;
  range?: string;
  elements?: SlackRichTextElement[];
}

const SlackRichTextElementSchema: z.ZodType<SlackRichTextElement> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      url: z.string().optional(),
      user_id: z.string().optional(),
      channel_id: z.string().optional(),
      name: z.string().optional(),
      range: z.string().optional(),
      elements: z.array(SlackRichTextElementSchema).optional(),
    })
    .passthrough(),
);

const SlackBlockSchema = z
  .object({
    text: SlackTextObjectSchema.optional(),
    fields: z.array(SlackTextObjectSchema).optional(),
    elements: z.array(SlackRichTextElementSchema).optional(),
  })
  .passthrough();

const SlackAttachmentSchema = z
  .object({
    title: z.string().optional(),
    pretext: z.string().optional(),
    text: z.string().optional(),
    fallback: z.string().optional(),
  })
  .passthrough();

const SlackMessageSchema = z
  .object({
    ts: z.string(),
    text: z.string().default(""),
    user: z.string().optional(),
    username: z.string().optional(),
    bot_profile: z.object({ name: z.string().optional() }).passthrough().optional(),
    attachments: z.array(SlackAttachmentSchema).optional(),
    blocks: z.array(SlackBlockSchema).optional(),
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

const SlackUserResponseSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        name: z.string().optional(),
        real_name: z.string().optional(),
        profile: z
          .object({
            display_name: z.string().optional(),
            real_name: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
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

export function extractWorkspaceReferenceTargets(
  item: AgentTimelineItem,
): WorkspaceReferenceTarget[] {
  if (item.type !== "user_message") return [];
  const byKey = new Map<string, WorkspaceReferenceTarget>();
  for (const match of item.text.matchAll(URL_PATTERN)) {
    const target = normalizeWorkspaceReferenceUrl(match[0]);
    if (target) byKey.set(target.key, target);
  }
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
    excerpt: firstParagraphs(
      issue.description?.trim() || "No description.",
      MAX_LINEAR_EXCERPT_PARAGRAPHS,
    ),
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

export interface SlackUserResolver {
  resolve(userId: string): Promise<string | null>;
}

export function createSlackUserResolver(
  token: string,
  onLookupError: (userId: string, error: unknown) => void,
): SlackUserResolver {
  const cachedNames = new Map<string, Promise<string | null>>();
  return {
    resolve(userId) {
      const existing = cachedNames.get(userId);
      if (existing) return existing;
      const lookup = (async (): Promise<string | null> => {
        try {
          const parsed = SlackUserResponseSchema.parse(
            await slackApi(token, "users.info", new URLSearchParams({ user: userId })),
          );
          if (!parsed.ok || !parsed.user) {
            throw new Error(
              `Slack could not read user ${userId}: ${parsed.error ?? "unknown error"}`,
            );
          }
          return (
            parsed.user.profile?.display_name?.trim() ||
            parsed.user.profile?.real_name?.trim() ||
            parsed.user.real_name?.trim() ||
            parsed.user.name?.trim() ||
            null
          );
        } catch (error) {
          onLookupError(userId, error);
          return null;
        }
      })();
      cachedNames.set(userId, lookup);
      return lookup;
    },
  };
}

function slackAuthor(
  message: z.infer<typeof SlackMessageSchema>,
  userNames: ReadonlyMap<string, string>,
): string {
  return (
    message.username ??
    message.bot_profile?.name ??
    (message.user ? (userNames.get(message.user) ?? message.user) : undefined) ??
    "Unknown author"
  );
}

function decodeSlackEntities(text: string): string {
  const replacements: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };
  return text.replace(/&(amp|lt|gt);/g, (entity) => replacements[entity] ?? entity);
}

function renderSlackInlineSyntax(text: string, userNames: ReadonlyMap<string, string>): string {
  const rendered = text.replace(/<([^>]+)>/g, (match, token: string) => {
    if (token.startsWith("@")) {
      const [userId, label] = token.slice(1).split("|", 2);
      return `@${userNames.get(userId) ?? label ?? userId}`;
    }
    if (token.startsWith("#")) {
      const [channelId, label] = token.slice(1).split("|", 2);
      return `#${label ?? channelId}`;
    }
    if (token.startsWith("!")) {
      const [command, label] = token.split("|", 2);
      return label ?? `@${command.slice(1)}`;
    }
    const [url, label] = token.split("|", 2);
    if (url.startsWith("mailto:")) return label ?? url.slice("mailto:".length);
    if (/^https?:\/\//.test(url)) return label ?? url;
    return match;
  });
  return decodeSlackEntities(rendered)
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(^|[\s([{>])\*([^*\n]+)\*(?=$|[\s)\]},.!?:;])/gm, "$1$2")
    .replace(/(^|[\s([{>])_([^_\n]+)_(?=$|[\s)\]},.!?:;])/gm, "$1$2")
    .replace(/(^|[\s([{>])~([^~\n]+)~(?=$|[\s)\]},.!?:;])/gm, "$1$2");
}

function renderSlackRichTextElement(
  element: SlackRichTextElement,
  userNames: ReadonlyMap<string, string>,
): string {
  if (element.type === "user" && element.user_id)
    return `@${userNames.get(element.user_id) ?? element.user_id}`;
  if (element.type === "channel" && element.channel_id) return `#${element.channel_id}`;
  if (element.type === "emoji" && element.name) return `:${element.name}:`;
  if (element.type === "broadcast" && element.range) return `@${element.range}`;
  if (element.type === "link") return element.text ?? element.url ?? "";
  if (element.text) return element.text;
  return (
    element.elements?.map((child) => renderSlackRichTextElement(child, userNames)).join("") ?? ""
  );
}

function collectSlackRichTextUserIds(element: SlackRichTextElement, userIds: Set<string>): void {
  if (element.type === "user" && element.user_id) userIds.add(element.user_id);
  for (const child of element.elements ?? []) collectSlackRichTextUserIds(child, userIds);
}

function collectSlackInlineUserIds(text: string, userIds: Set<string>): void {
  for (const match of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/gi)) {
    const userId = match[1];
    if (userId) userIds.add(userId);
  }
}

function collectSlackMessageUserIds(
  message: z.infer<typeof SlackMessageSchema>,
  userIds: Set<string>,
): void {
  if (message.user) userIds.add(message.user);
  collectSlackInlineUserIds(message.text, userIds);
  for (const attachment of message.attachments ?? []) {
    for (const text of [
      attachment.title,
      attachment.pretext,
      attachment.text,
      attachment.fallback,
    ]) {
      if (text) collectSlackInlineUserIds(text, userIds);
    }
  }
  for (const block of message.blocks ?? []) {
    if (block.text) collectSlackInlineUserIds(block.text.text, userIds);
    for (const field of block.fields ?? []) collectSlackInlineUserIds(field.text, userIds);
    for (const element of block.elements ?? []) collectSlackRichTextUserIds(element, userIds);
  }
}

function uniqueNonEmptyParts(parts: Array<string | undefined>): string[] {
  const unique = new Set<string>();
  for (const part of parts) {
    const normalized = part?.trim();
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

function slackAttachmentText(message: z.infer<typeof SlackMessageSchema>): string {
  return (message.attachments ?? [])
    .map((attachment) => {
      const content = uniqueNonEmptyParts([attachment.title, attachment.pretext, attachment.text]);
      return (content.length > 0 ? content : uniqueNonEmptyParts([attachment.fallback])).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function slackBlockText(
  message: z.infer<typeof SlackMessageSchema>,
  userNames: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  for (const block of message.blocks ?? []) {
    if (block.text?.text.trim()) parts.push(block.text.text);
    for (const field of block.fields ?? []) {
      if (field.text.trim()) parts.push(field.text);
    }
    const richText = block.elements
      ?.map((element) => renderSlackRichTextElement(element, userNames))
      .join("")
      .trim();
    if (richText) parts.push(richText);
  }
  return parts.join("\n");
}

function slackMessageText(
  message: z.infer<typeof SlackMessageSchema>,
  userNames: ReadonlyMap<string, string>,
): string {
  const text = renderSlackInlineSyntax(
    message.text.trim() || slackAttachmentText(message) || slackBlockText(message, userNames),
    userNames,
  ).trim();
  if (!text) return "(empty message)";
  if (text.length <= MAX_SLACK_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_SLACK_MESSAGE_CHARS - 1)}…`;
}

export async function fetchSlackReference(
  target: WorkspaceReferenceTarget,
  token: string,
  userResolver: SlackUserResolver,
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
  const selectedMessages = [root, ...replies];
  const userIds = new Set<string>();
  for (const message of selectedMessages) collectSlackMessageUserIds(message, userIds);
  const userNames = new Map<string, string>();
  await Promise.all(
    [...userIds].map(async (userId) => {
      const name = await userResolver.resolve(userId);
      if (name) userNames.set(userId, name);
    }),
  );
  const rendered = selectedMessages.map((message, index) => {
    const role = index === 0 ? "OP" : `Recent reply ${index}`;
    return `${role} — ${slackAuthor(message, userNames)}:\n${slackMessageText(message, userNames)}`;
  });
  return {
    title: slackMessageText(root, userNames).split("\n")[0]?.slice(0, 120) || "Slack thread",
    excerpt: balancedSections(rendered),
  };
}
