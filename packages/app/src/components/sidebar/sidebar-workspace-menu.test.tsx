/**
 * @vitest-environment jsdom
 */
import React, { type ComponentType, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          "sidebar.workspace.actions.menu": "Workspace actions",
          "cockpit.actions.snooze": "Snooze",
          "cockpit.actions.wake": "Wake",
        })[key] ?? key,
    }),
  };
});

interface MockMenuItemProps {
  children?: ReactNode;
  leading?: ReactNode;
  onSelect?: () => void;
  testID?: string;
  trailing?: ReactNode;
}

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuItem: ({ children, leading, onSelect, testID, trailing }: MockMenuItemProps) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {leading}
      {children}
      {trailing}
    </button>
  ),
  DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuTrigger: () => null,
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children?: ReactNode }) => children,
  ContextMenuContent: ({ children }: { children?: ReactNode }) => children,
  ContextMenuItem: ({ children, leading, onSelect, testID, trailing }: MockMenuItemProps) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {leading}
      {children}
      {trailing}
    </button>
  ),
  ContextMenuTrigger: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/components/ui/shortcut", () => ({
  Shortcut: ({ chord }: { chord: string[][] }) => (
    <span data-testid="snooze-shortcut">{chord.flat().join("+")}</span>
  ),
}));

vi.mock("@/workspace/open-in-file-manager/menu-item", () => ({
  OpenInFileManagerMenuItem: () => null,
}));

vi.mock("@/workspace-labels/picker", () => ({
  useWorkspaceLabelMenuPages: () => [],
  WORKSPACE_LABEL_PAGE_ID: "workspace-labels",
}));

let SidebarWorkspaceMenu: ComponentType<
  import("./sidebar-workspace-menu").SidebarWorkspaceMenuProps
>;

beforeAll(async () => {
  vi.stubGlobal("React", React);
  ({ SidebarWorkspaceMenu } = await import("./sidebar-workspace-menu"));
});

afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("SidebarWorkspaceMenu snooze action", () => {
  it("snoozes an active workspace and shows its shortcut", () => {
    const onToggleSnooze = vi.fn();

    render(
      <SidebarWorkspaceMenu
        workspaceKey="server:workspace"
        onArchive={vi.fn()}
        onToggleSnooze={onToggleSnooze}
        snoozeShortcutKeys={[["mod", "shift", "S"]]}
      />,
    );

    const action = screen.getByTestId("sidebar-workspace-menu-snooze-server:workspace");
    expect(action.textContent).toContain("Snooze");
    expect(screen.getByTestId("snooze-shortcut").textContent).toBe("mod+shift+S");

    fireEvent.click(action);
    expect(onToggleSnooze).toHaveBeenCalledOnce();
  });

  it("offers Wake for a snoozed workspace", () => {
    render(
      <SidebarWorkspaceMenu
        workspaceKey="server:workspace"
        onArchive={vi.fn()}
        isSnoozed
        onToggleSnooze={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("sidebar-workspace-menu-snooze-server:workspace").textContent,
    ).toContain("Wake");
  });
});
