import type { WorkspaceReferenceProvider } from "./messages.js";

const URL_PATTERN = /https:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[),.;:!?\]}]+$/;
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;

export interface WorkspaceReferenceTarget {
  key: string;
  provider: WorkspaceReferenceProvider;
  url: string;
  identifier: string;
  channelId?: string;
  threadTs?: string;
}

function slackPermalinkTimestamp(value: string): string | null {
  if (!/^\d{7,}$/.test(value)) return null;
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

export function extractWorkspaceReferenceTargetsFromText(text: string): WorkspaceReferenceTarget[] {
  const byKey = new Map<string, WorkspaceReferenceTarget>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const target = normalizeWorkspaceReferenceUrl(match[0]);
    if (target) byKey.set(target.key, target);
  }
  return [...byKey.values()];
}

export function hasWorkspaceReferenceLink(text: string): boolean {
  return extractWorkspaceReferenceTargetsFromText(text).length > 0;
}
