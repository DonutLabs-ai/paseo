import type { StreamItem } from "@/types/stream";
import { selectLatestWorkspaceConversationMessage } from "@/utils/workspace-activity-preview";

const CODEX_USAGE_LIMIT_PREFIX = "[System Error] You've hit your usage limit. ";
const CODEX_USAGE_LIMIT_STANDARD_ACTION =
  "Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at ";
const CODEX_USAGE_LIMIT_UPGRADE_ACTION =
  "Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at ";
const CODEX_USAGE_LIMIT_ACTIONS = [
  CODEX_USAGE_LIMIT_STANDARD_ACTION,
  CODEX_USAGE_LIMIT_UPGRADE_ACTION,
] as const;

export function isCodexUsageLimitError(message: string): boolean {
  const normalizedMessage = message.trimEnd();
  const errorStart = normalizedMessage.lastIndexOf(CODEX_USAGE_LIMIT_PREFIX);
  if (errorStart === -1 || !normalizedMessage.endsWith(".")) return false;
  const errorMessage = normalizedMessage.slice(errorStart);
  const action = CODEX_USAGE_LIMIT_ACTIONS.find((candidate) =>
    errorMessage.startsWith(candidate, CODEX_USAGE_LIMIT_PREFIX.length),
  );
  if (action === undefined) return false;
  const retryAt = errorMessage.slice(CODEX_USAGE_LIMIT_PREFIX.length + action.length, -1).trim();
  return retryAt.length > 0;
}

export function isLatestConversationMessageCodexUsageLimit(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
}): boolean {
  const latest = selectLatestWorkspaceConversationMessage(input);
  return latest?.kind === "reply" && isCodexUsageLimitError(latest.text);
}
