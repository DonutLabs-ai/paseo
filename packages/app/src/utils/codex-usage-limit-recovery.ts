import type { StreamItem } from "@/types/stream";
import { selectLatestWorkspaceConversationMessage } from "@/utils/workspace-activity-preview";

const CODEX_USAGE_LIMIT_PREFIX =
  "[System Error] You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at ";

export function isCodexUsageLimitError(message: string): boolean {
  if (!message.startsWith(CODEX_USAGE_LIMIT_PREFIX) || !message.endsWith(".")) return false;
  const retryAt = message.slice(CODEX_USAGE_LIMIT_PREFIX.length, -1).trim();
  return retryAt.length > 0;
}

export function isLatestConversationMessageCodexUsageLimit(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
}): boolean {
  const latest = selectLatestWorkspaceConversationMessage(input);
  return latest?.kind === "reply" && isCodexUsageLimitError(latest.text);
}
