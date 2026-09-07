/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarSnoozedSection } from "./sidebar-snoozed-section";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/components/sidebar/sidebar-workspace-row-content", () => ({
  sidebarWorkspaceRowStyles: { rowIndented: {} },
}));
vi.mock("lucide-react-native", () => ({
  ChevronDown: () => <span data-icon="chevron-down" />,
  ChevronUp: () => <span data-icon="chevron-up" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "cockpit.status.snoozed" ? "Snoozed" : key),
  }),
}));

describe("SidebarSnoozedSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("keeps snoozed workspaces folded until the dedicated row is pressed", () => {
    act(() => {
      root?.render(
        <SidebarSnoozedSection count={2}>
          <span data-testid="snoozed-workspace">Workspace</span>
        </SidebarSnoozedSection>,
      );
    });

    const toggle = container?.querySelector('[data-testid="sidebar-snoozed-toggle"]');
    expect(toggle).toBeInstanceOf(HTMLElement);
    expect(container?.querySelector('[data-testid="sidebar-snoozed-list"]')).toBeNull();

    act(() => {
      if (!(toggle instanceof HTMLElement)) {
        throw new Error("Snoozed toggle did not render");
      }
      toggle.click();
    });

    expect(container?.querySelector('[data-testid="sidebar-snoozed-list"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="snoozed-workspace"]')).not.toBeNull();
  });

  it("omits the section when there are no visible snoozed workspaces", () => {
    act(() => {
      root?.render(
        <SidebarSnoozedSection count={0}>
          <span>Workspace</span>
        </SidebarSnoozedSection>,
      );
    });

    expect(container?.querySelector('[data-testid="sidebar-snoozed-section"]')).toBeNull();
  });
});
