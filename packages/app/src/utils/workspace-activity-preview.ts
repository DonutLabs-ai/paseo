import type { StreamItem } from "@/types/stream";
import { createMarkdownParser } from "@/utils/markdown-parser";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

const MAX_PREVIEW_LENGTH = 1_000;
const INTERNAL_CITATION_BLOCK = /<(oai-[a-z0-9-]+-citation)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const previewMarkdownParser = createMarkdownParser({ linkify: true });
// Preview projection never opens a parsed destination. Accept every scheme so local file images
// and provider-specific links still reduce to their visible alt/label text instead of leaking raw
// Markdown syntax into the sidebar.
previewMarkdownParser.validateLink = () => true;

export interface WorkspaceActivityPreview {
  latestPrompt: string | null;
  latestReply: string | null;
  activityPreview: string | null;
  activityPreviewKind: "prompt" | "reply" | null;
}

interface PreviewMessage {
  text: string;
  timestamp: Date;
}

function markdownToPlainText(value: string): string {
  const tokens = previewMarkdownParser.parse(value.replace(INTERNAL_CITATION_BLOCK, ""), {});
  const blocks: string[] = [];
  let listItemDepth = 0;

  for (const token of tokens) {
    if (token.type === "list_item_open") {
      listItemDepth += 1;
      continue;
    }
    if (token.type === "list_item_close") {
      listItemDepth -= 1;
      continue;
    }
    if (token.type === "inline") {
      const inlineText = (token.children ?? [])
        .map((child) => {
          if (child.type === "softbreak" || child.type === "hardbreak") {
            return " ";
          }
          return child.content;
        })
        .join("");
      blocks.push(listItemDepth > 0 ? inlineText.replace(/^\[[ xX]\]\s+/, "") : inlineText);
      continue;
    }
    if (token.type === "fence" || token.type === "code_block") {
      blocks.push(token.content);
    }
  }

  return blocks.join(" ");
}

function normalizePreviewText(value: string): string | null {
  const normalized = markdownToPlainText(value).replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

function findLatestMessage(
  items: readonly StreamItem[],
  kind: "user_message" | "assistant_message",
): PreviewMessage | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== kind) {
      continue;
    }
    const text = normalizePreviewText(item.text);
    if (text) {
      return { text, timestamp: item.timestamp };
    }
  }
  return null;
}

function selectLatestMessage(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  kind: "user_message" | "assistant_message";
}): PreviewMessage | null {
  const headMessage = findLatestMessage(input.head, input.kind);
  const tailMessage = findLatestMessage(input.tail, input.kind);
  if (headMessage === null) {
    return tailMessage;
  }
  if (tailMessage === null || headMessage.timestamp >= tailMessage.timestamp) {
    return headMessage;
  }
  return tailMessage;
}

/**
 * A compact view of the conversation that can be rendered outside the full agent panel.
 *
 * The head is the live stream lane, but an authoritative tail refresh can become newer before a
 * stale head is reconciled away. Compare their timestamps and only prefer head when they tie.
 * While an agent is running, a prompt newer than the last reply is the useful preview: it names
 * the work that has just started instead of repeating the prior turn's answer. Once any assistant
 * output arrives, the reply becomes the preview again.
 */
export function selectWorkspaceActivityPreview(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  status: SidebarStateBucket;
}): WorkspaceActivityPreview {
  const prompt = selectLatestMessage({ ...input, kind: "user_message" });
  const reply = selectLatestMessage({ ...input, kind: "assistant_message" });
  const shouldShowPrompt =
    input.status === "running" &&
    prompt !== null &&
    (reply === null || prompt.timestamp > reply.timestamp);

  const activity = shouldShowPrompt ? prompt : (reply ?? prompt);
  let activityPreviewKind: WorkspaceActivityPreview["activityPreviewKind"] = null;
  if (activity !== null) {
    activityPreviewKind = activity === prompt ? "prompt" : "reply";
  }
  return {
    latestPrompt: prompt?.text ?? null,
    latestReply: reply?.text ?? null,
    activityPreview: activity?.text ?? null,
    activityPreviewKind,
  };
}
