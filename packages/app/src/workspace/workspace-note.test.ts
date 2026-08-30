import { describe, expect, it } from "vitest";
import { normalizeWorkspaceNote } from "./workspace-note";

describe("normalizeWorkspaceNote", () => {
  it("trims a note", () => {
    expect(normalizeWorkspaceNote("  Investigate auth  ")).toBe("Investigate auth");
  });

  it("folds pasted line breaks into a single line", () => {
    expect(normalizeWorkspaceNote("Investigate auth\nthen ship\r\ntoday")).toBe(
      "Investigate auth then ship today",
    );
  });

  it("returns null when clearing a note", () => {
    expect(normalizeWorkspaceNote(" \n \r\n ")).toBeNull();
  });
});
