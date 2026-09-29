import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  isExplorerSidebarOpen,
  openExplorerSidebarView,
  resolveExplorerSidebarPresentation,
  showInitialWorkspaceReferences,
  toggleExplorerSidebar,
} from "@/workspace-tabs/explorer-sidebar";

const WORKSPACE_KEY = "server-1:ws-main";
const CHECKOUT = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({
    mobilePanel: { target: "agent", revision: 0 },
    explorerTab: "files",
    explorerTabByCheckout: {},
  });
});

describe("Explorer sidebar", () => {
  it("selects the Explorer shell from layout and split capabilities", () => {
    expect(resolveExplorerSidebarPresentation({ isCompact: true })).toBe("overlay");
    expect(
      resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: false }),
    ).toBe("dock");
    expect(resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: true })).toBe(
      "pane",
    );
  });

  it("uses the compact explorer without creating a desktop pane", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "changes",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("creates a dedicated desktop Explorer containing only its requested tree", () => {
    openExplorerSidebarView({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "files",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    expect(paneId).not.toBeNull();
    expect(layout && collectAllTabs(layout.root).map((tab) => tab.target.kind)).toContain("files");
  });

  it("toggles the desktop Explorer independently of ordinary panes", () => {
    const input = {
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };
    openExplorerSidebarView({ ...input, view: "files" });
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(false);
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(true);
    const openedState = useWorkspaceLayoutStore.getState();
    const openedLayout = openedState.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(openedState, WORKSPACE_KEY);
    const explorerPane =
      openedLayout && explorerPaneId ? findPaneById(openedLayout.root, explorerPaneId) : null;
    const activeExplorerTarget =
      openedLayout && explorerPane
        ? collectAllTabs(openedLayout.root).find((tab) => tab.tabId === explorerPane.focusedTabId)
            ?.target.kind
        : null;
    expect(activeExplorerTarget).toBe("files");
  });

  it("toggles the compact Explorer without changing its selected view", () => {
    usePanelStore.getState().setExplorerTabForCheckout({ ...CHECKOUT, tab: "files" });
    const input = {
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };

    toggleExplorerSidebar(input);

    expect(isExplorerSidebarOpen(input)).toBe(true);
    expect(usePanelStore.getState().explorerTab).toBe("files");
  });

  it.each([
    "See https://linear.app/acme/issue/ENG-1234/fix",
    "See https://acme.slack.com/archives/C123/p1700000000123456",
  ])("opens References for an initial %s link", (text) => {
    showInitialWorkspaceReferences({
      serverId: "server-1",
      workspaceId: "ws-main",
      text,
      isCompact: false,
      supportsPaneSplits: true,
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    const pane = layout && paneId ? findPaneById(layout.root, paneId) : null;
    expect(selectIsExplorerSidebarVisible(state, WORKSPACE_KEY)).toBe(true);
    expect(
      layout && pane
        ? collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId)?.target.kind
        : null,
    ).toBe("references");
    expect(layout.focusedPaneId).not.toBe(paneId);
  });

  it("keeps the existing Explorer defaults for messages without a reference", () => {
    showInitialWorkspaceReferences({
      serverId: "server-1",
      workspaceId: "ws-main",
      text: "https://linear.app/docs/api-and-webhooks",
      isCompact: false,
      supportsPaneSplits: true,
    });
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("does not create a desktop Explorer pane on compact layouts", () => {
    showInitialWorkspaceReferences({
      serverId: "server-1",
      workspaceId: "ws-main",
      text: "https://linear.app/acme/issue/ENG-1234",
      isCompact: true,
      supportsPaneSplits: true,
    });
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });
});
