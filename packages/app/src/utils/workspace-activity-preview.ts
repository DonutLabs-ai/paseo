import type { StreamItem } from "@/types/stream";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

const MAX_PREVIEW_LENGTH = 1_000;

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

function normalizePreviewText(value: string): string | null {
  const normalized = value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]\s)\s*/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

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
  return findLatestMessage(input.head, input.kind) ?? findLatestMessage(input.tail, input.kind);
}

/**
 * A compact view of the conversation that can be rendered outside the full agent panel.
 *
 * The head is the live/newer stream lane, so it wins over the authoritative tail when both
 * contain a candidate. While an agent is running, a prompt newer than the last reply is the
 * useful preview: it names the work that has just started instead of repeating the prior turn's
 * answer. Once any assistant output arrives, the reply becomes the preview again.
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
