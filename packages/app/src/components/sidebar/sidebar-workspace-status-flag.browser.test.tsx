import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import {
  getSidebarWorkspaceStatusFlagPresentation,
  SidebarWorkspaceStatusFlag,
} from "./sidebar-workspace-status-flag";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "cockpit.status.needsInput": "Needs input",
        "cockpit.status.failed": "Failed",
        "cockpit.status.running": "Working",
        "cockpit.status.attention": "Ready",
      })[key] ?? key,
  }),
}));

interface MountedFlag {
  root: Root;
  container: HTMLDivElement;
}

const mountedFlags: MountedFlag[] = [];

function mountFlag(bucket: SidebarStateBucket, loading = false): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<SidebarWorkspaceStatusFlag bucket={bucket} loading={loading} />));
  mountedFlags.push({ root, container });
  return container;
}

afterEach(() => {
  for (const mounted of mountedFlags.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("SidebarWorkspaceStatusFlag", () => {
  it.each([
    ["running", "Working"],
    ["attention", "Ready"],
    ["needs_input", "Needs input"],
    ["failed", "Failed"],
  ] as const)("renders a labeled, readable %s flag", (bucket, label) => {
    const container = mountFlag(bucket);
    const flag = container.querySelector(`[data-testid="sidebar-workspace-status-${bucket}"]`);

    expect(flag).toBeInstanceOf(HTMLElement);
    expect(flag?.textContent).toBe(label);
    expect(flag?.getAttribute("role")).toBe("status");
    expect(flag?.getBoundingClientRect().height).toBeGreaterThanOrEqual(22);
  });

  it("keeps idle and row-operation states quiet", () => {
    expect(mountFlag("done").childElementCount).toBe(0);
    expect(mountFlag("running", true).childElementCount).toBe(0);
  });

  it("maps every state to one semantic badge variant", () => {
    expect(getSidebarWorkspaceStatusFlagPresentation("running")).toMatchObject({
      variant: "info",
    });
    expect(getSidebarWorkspaceStatusFlagPresentation("attention")).toMatchObject({
      variant: "success",
    });
    expect(getSidebarWorkspaceStatusFlagPresentation("needs_input")).toMatchObject({
      variant: "warning",
    });
    expect(getSidebarWorkspaceStatusFlagPresentation("failed")).toMatchObject({
      variant: "error",
    });
    expect(getSidebarWorkspaceStatusFlagPresentation("done")).toBeNull();
  });
});
