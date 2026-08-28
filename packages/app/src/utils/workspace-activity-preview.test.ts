import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { selectWorkspaceActivityPreview } from "./workspace-activity-preview";

function message(
  kind: "user_message" | "assistant_message",
  text: string,
  second: number,
): StreamItem {
  return {
    kind,
    id: `${kind}-${second}`,
    text,
    timestamp: new Date(2026, 0, 1, 0, 0, second),
  };
}

describe("selectWorkspaceActivityPreview", () => {
  it("uses a newer live reply ahead of the authoritative tail", () => {
    const result = selectWorkspaceActivityPreview({
      tail: [
        message("user_message", "Old prompt", 1),
        message("assistant_message", "Old reply", 2),
      ],
      head: [message("assistant_message", "**Implementing** the cockpit now.", 3)],
      status: "running",
    });

    expect(result).toEqual({
      latestPrompt: "Old prompt",
      latestReply: "Implementing the cockpit now.",
      activityPreview: "Implementing the cockpit now.",
      activityPreviewKind: "reply",
    });
  });

  it("shows a new prompt while the running agent has not replied yet", () => {
    const result = selectWorkspaceActivityPreview({
      tail: [message("assistant_message", "Previous answer", 1)],
      head: [message("user_message", "Add workspace summaries", 2)],
      status: "running",
    });

    expect(result.activityPreview).toBe("Add workspace summaries");
    expect(result.activityPreviewKind).toBe("prompt");
    expect(result.latestReply).toBe("Previous answer");
  });

  it("keeps the latest reply for a completed workspace", () => {
    const result = selectWorkspaceActivityPreview({
      tail: [message("assistant_message", "Done", 1), message("user_message", "Follow-up", 2)],
      head: [],
      status: "done",
    });

    expect(result.activityPreview).toBe("Done");
    expect(result.activityPreviewKind).toBe("reply");
  });

  it("normalizes markdown and ignores blank messages", () => {
    const result = selectWorkspaceActivityPreview({
      tail: [
        message("assistant_message", "   ", 1),
        message(
          "assistant_message",
          "## Result\n\n- Fixed [the bug](https://example.com)\n- ![capture](file:///tmp/a.png)",
          2,
        ),
      ],
      head: [],
      status: "attention",
    });

    expect(result.latestReply).toBe("Result Fixed the bug capture");
  });

  it("returns an empty preview when the conversation has no messages", () => {
    expect(selectWorkspaceActivityPreview({ tail: [], head: [], status: "done" })).toEqual({
      latestPrompt: null,
      latestReply: null,
      activityPreview: null,
      activityPreviewKind: null,
    });
  });
});
