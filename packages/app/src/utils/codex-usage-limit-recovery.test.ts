import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  isCodexUsageLimitError,
  isLatestConversationMessageCodexUsageLimit,
} from "./codex-usage-limit-recovery";

const usageLimitError =
  "[System Error] You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 16th, 2026 3:58 PM.";
const usageLimitUpgradeError =
  "[System Error] You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:13 PM.";
const usageLimitCurlyApostropheError =
  "[System Error] You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 26th, 2026 11:55 PM.";
const partialReplyBeforeUsageLimit =
  "18 分钟，仍无错误。当前最重要的是不把长构建误判成失败或重复发起；我继续守这条 runo. " +
  "[System Error] You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 22nd, 2026 11:29 AM.";

function message(
  kind: "user_message" | "assistant_message",
  text: string,
  timestamp: number,
): StreamItem {
  return {
    kind,
    id: `${kind}-${timestamp}`,
    text,
    timestamp: new Date(timestamp),
  };
}

describe("Codex usage-limit recovery", () => {
  it("matches the Codex usage-limit system error family", () => {
    expect(isCodexUsageLimitError(usageLimitError)).toBe(true);
    expect(isCodexUsageLimitError(usageLimitUpgradeError)).toBe(true);
    expect(isCodexUsageLimitError(usageLimitCurlyApostropheError)).toBe(true);
    expect(isCodexUsageLimitError(partialReplyBeforeUsageLimit)).toBe(true);
    expect(
      isCodexUsageLimitError(
        "[System Error] Selected model is at capacity. Please try a different model.",
      ),
    ).toBe(false);
    expect(
      isCodexUsageLimitError(
        "[System Error] You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at .",
      ),
    ).toBe(false);
  });

  it("selects a session when the usage-limit error is the last conversation message", () => {
    expect(
      isLatestConversationMessageCodexUsageLimit({
        tail: [
          message("user_message", "Do the work", 1),
          message("assistant_message", usageLimitError, 2),
        ],
        head: [],
      }),
    ).toBe(true);
  });

  it("does not select a session after a newer continue prompt", () => {
    expect(
      isLatestConversationMessageCodexUsageLimit({
        tail: [message("assistant_message", usageLimitError, 1)],
        head: [message("user_message", "Continue from where you left off.", 2)],
      }),
    ).toBe(false);
  });

  it("uses the newest reply across authoritative tail and live head", () => {
    expect(
      isLatestConversationMessageCodexUsageLimit({
        tail: [message("assistant_message", usageLimitError, 3)],
        head: [message("assistant_message", "Older live reply", 2)],
      }),
    ).toBe(true);
  });

  it("uses the complete latest reply instead of the truncated sidebar preview", () => {
    expect(
      isLatestConversationMessageCodexUsageLimit({
        tail: [
          message(
            "assistant_message",
            `${"Still monitoring the run. ".repeat(50)}${usageLimitError}`,
            1,
          ),
        ],
        head: [],
      }),
    ).toBe(true);
  });
});
