import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BellRing,
  Columns2,
  GitBranch,
  GitPullRequest,
  Moon,
  Pencil,
  Plus,
  Rows2,
  StepForward,
  X,
} from "lucide-react-native";
import { AGENT_CONTINUE_PROMPT } from "@getpaseo/protocol/agent-continuation";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { router } from "expo-router";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { DiffStat } from "@/components/diff-stat";
import { ContextWindowMeter } from "@/components/context-window-meter";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { StatusRing } from "@/components/status-ring";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { ToolbarButton, ToolbarControls } from "@/components/ui/pane-content-toolbar";
import { SidebarModelProvider, useSidebarModel } from "@/components/sidebar/sidebar-model";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  navigateToLastWorkspace,
  navigateToWorkspace,
  rememberLastWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import {
  useCockpitLayoutStore,
  useCockpitLayoutStoreHydrated,
} from "@/stores/cockpit-layout-store";
import { useCockpitSnoozeStore } from "@/stores/cockpit-snooze-store";
import { buildNewWorkspaceRoute, buildOpenProjectRoute } from "@/utils/host-routes";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { findAdjacentPane } from "@/utils/split-navigation";
import type { SplitNode, SplitPane } from "@/stores/workspace-layout-store";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { WorkspaceNoteModal } from "@/workspace/workspace-note-modal";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import {
  dispatchComposerAgentMessage,
  queueComposerMessage,
  type QueueWriter,
} from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { CockpitToggleButton } from "./cockpit-toggle-button";
import { CockpitAttentionMenu } from "./cockpit-attention-menu";
import { CockpitTelemetryBar } from "./cockpit-telemetry-bar";
import {
  COCKPIT_CARD_TITLE_LINE_HEIGHT,
  COCKPIT_STATUS_DOT_MARGIN_TOP,
  COCKPIT_STATUS_DOT_SIZE,
  COCKPIT_STATUS_RING_FRAME_SIZE,
  shouldShowCockpitQuickReply,
  shouldStackCockpitCardHeader,
} from "./cockpit-card-presentation";
import { resolveCockpitQuickReplyAction } from "./cockpit-quick-reply";
import { buildCockpitProjectScopes, resolveActiveCockpitProject } from "./cockpit-project-scope";
import { useCockpitAgentUsage, type CockpitAgentUsage } from "./use-cockpit-agent-usage";
import {
  COCKPIT_CARD_GAP,
  COCKPIT_HORIZONTAL_PADDING,
  collectCockpitPanes,
  filterCockpitLayout,
  findCockpitPane,
  getCockpitLayoutMinimumHeight,
  getCockpitPaneMoveTarget,
  getCockpitPaneWorkspaceKey,
  type CockpitLayout,
  type CockpitPaneMoveDirection,
  type CockpitPaneMoveTarget,
} from "./cockpit-layout";

const STATUS_LABEL_KEYS = {
  needs_input: "cockpit.status.needsInput",
  failed: "cockpit.status.failed",
  running: "cockpit.status.running",
  attention: "cockpit.status.attention",
  done: "cockpit.status.done",
} as const;

const PR_STATE_LABEL_KEYS = {
  open: "workspace.git.pr.states.open",
  merged: "workspace.git.pr.states.merged",
  closed: "workspace.git.pr.states.closed",
} as const;

interface CockpitCardSize {
  width: number;
  height: number;
}

type CockpitPaneMoveTargets = Record<CockpitPaneMoveDirection, CockpitPaneMoveTarget | null>;

function buildCockpitPaneMoveTargets(
  layout: CockpitLayout | null,
): ReadonlyMap<string, CockpitPaneMoveTargets> {
  const targets = new Map<string, CockpitPaneMoveTargets>();
  if (!layout) return targets;
  for (const pane of collectCockpitPanes(layout.root)) {
    targets.set(pane.id, {
      left: getCockpitPaneMoveTarget(layout.root, pane.id, "left"),
      right: getCockpitPaneMoveTarget(layout.root, pane.id, "right"),
      up: getCockpitPaneMoveTarget(layout.root, pane.id, "up"),
      down: getCockpitPaneMoveTarget(layout.root, pane.id, "down"),
    });
  }
  return targets;
}

function encodeNoQuickReplyImages(): Promise<Array<{ data: string; mimeType: string }>> {
  return Promise.resolve([]);
}

function navigateToCockpitWorkspace(workspace: SidebarWorkspaceEntry): void {
  if (workspace.agentId) {
    navigateToWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      target: { kind: "agent", agentId: workspace.agentId },
    });
    return;
  }
  navigateToWorkspace({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
}

function resolveCockpitPaneWorkspace(
  layout: CockpitLayout | null,
  paneId: string | null,
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
): SidebarWorkspaceEntry | null {
  if (!layout || !paneId) return null;
  const pane = findCockpitPane(layout.root, paneId);
  const workspaceKey = pane ? getCockpitPaneWorkspaceKey(pane) : null;
  return workspaceKey ? (workspaceEntriesByKey.get(workspaceKey) ?? null) : null;
}

function rememberCockpitWorkspace(workspace: SidebarWorkspaceEntry | null): void {
  if (!workspace) return;
  rememberLastWorkspaceSelection({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
}

export function CockpitScreen() {
  const isRouteFocused = useIsFocused();
  return (
    <SidebarModelProvider active={isRouteFocused}>
      <CockpitScreenContent isRouteFocused={isRouteFocused} />
    </SidebarModelProvider>
  );
}

function CockpitScreenContent({ isRouteFocused }: { isRouteFocused: boolean }) {
  const { t } = useTranslation();
  const { allProjects, allWorkspaceEntriesByKey, workspaceEntriesByKey, isInitialLoad } =
    useSidebarModel();
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const preferredWorkspaceKey = lastWorkspaceSelection
    ? `${lastWorkspaceSelection.serverId}:${lastWorkspaceSelection.workspaceId}`
    : null;
  const projectScopes = useMemo(() => buildCockpitProjectScopes(allProjects), [allProjects]);
  const activeProject = useMemo(
    () =>
      resolveActiveCockpitProject({
        projects: projectScopes,
        preferredWorkspaceKey,
      }),
    [preferredWorkspaceKey, projectScopes],
  );
  const activeProjectViewKey = activeProject?.projectViewKey ?? null;
  const layout = useCockpitLayoutStore((state) =>
    activeProjectViewKey ? (state.layoutsByProject[activeProjectViewKey]?.layout ?? null) : null,
  );
  const reconcileProjects = useCockpitLayoutStore((state) => state.reconcileProjects);
  const splitPane = useCockpitLayoutStore((state) => state.splitPane);
  const movePane = useCockpitLayoutStore((state) => state.movePane);
  const addEmptyPane = useCockpitLayoutStore((state) => state.addEmptyPane);
  const closePane = useCockpitLayoutStore((state) => state.closePane);
  const focusPane = useCockpitLayoutStore((state) => state.focusPane);
  const focusWorkspace = useCockpitLayoutStore((state) => state.focusWorkspace);
  const snoozedAtByWorkspace = useCockpitSnoozeStore((state) => state.snoozedAtByWorkspace);
  const setSnoozed = useCockpitSnoozeStore((state) => state.setSnoozed);
  const layoutHydrated = useCockpitLayoutStoreHydrated();
  const activeWorkspaceKeys = useMemo(
    () => new Set(activeProject?.workspaceKeys ?? []),
    [activeProject],
  );
  const activeWorkspaceEntriesByKey = useMemo(() => {
    const entries = new Map<string, SidebarWorkspaceEntry>();
    for (const workspaceKey of activeWorkspaceKeys) {
      const entry = workspaceEntriesByKey.get(workspaceKey);
      if (entry) entries.set(workspaceKey, entry);
    }
    return entries;
  }, [activeWorkspaceKeys, workspaceEntriesByKey]);
  const visibleWorkspaceKeys = useMemo(
    () => new Set(activeWorkspaceEntriesByKey.keys()),
    [activeWorkspaceEntriesByKey],
  );
  const projectNamesByWorkspace = useMemo(() => {
    const names = new Map<string, string>();
    if (!activeProject) return names;
    for (const workspaceKey of activeProject.workspaceKeys) {
      names.set(workspaceKey, activeProject.projectName);
    }
    return names;
  }, [activeProject]);
  const allWorkspaceEntries = useMemo(
    () => [...allWorkspaceEntriesByKey.values()],
    [allWorkspaceEntriesByKey],
  );
  const activeAllWorkspaceEntries = useMemo(() => {
    const entries: SidebarWorkspaceEntry[] = [];
    for (const workspaceKey of activeWorkspaceKeys) {
      const entry = allWorkspaceEntriesByKey.get(workspaceKey);
      if (entry) entries.push(entry);
    }
    return entries;
  }, [activeWorkspaceKeys, allWorkspaceEntriesByKey]);
  const visibleWorkspaceEntries = useMemo(
    () => [...activeWorkspaceEntriesByKey.values()],
    [activeWorkspaceEntriesByKey],
  );
  const agentUsageByWorkspace = useCockpitAgentUsage(visibleWorkspaceEntries);
  const telemetryServerIds = useMemo(
    () => [...new Set(activeAllWorkspaceEntries.map((workspace) => workspace.serverId))],
    [activeAllWorkspaceEntries],
  );

  useEffect(() => {
    if (!isRouteFocused || !layoutHydrated || isInitialLoad) return;
    reconcileProjects({
      projects: projectScopes,
      preferredWorkspaceKey,
    });
  }, [
    isInitialLoad,
    isRouteFocused,
    layoutHydrated,
    preferredWorkspaceKey,
    projectScopes,
    reconcileProjects,
  ]);

  const visibleLayout = useMemo(
    () => filterCockpitLayout(layout, visibleWorkspaceKeys),
    [layout, visibleWorkspaceKeys],
  );
  const moveTargetsByPane = useMemo(
    () => buildCockpitPaneMoveTargets(visibleLayout),
    [visibleLayout],
  );
  const focusedWorkspace = useMemo(
    () =>
      resolveCockpitPaneWorkspace(
        visibleLayout,
        visibleLayout?.focusedPaneId ?? null,
        activeWorkspaceEntriesByKey,
      ),
    [activeWorkspaceEntriesByKey, visibleLayout],
  );
  const handleFocusPane = useCallback(
    (paneId: string) => {
      if (!activeProjectViewKey) return;
      focusPane(activeProjectViewKey, paneId);
      rememberCockpitWorkspace(
        resolveCockpitPaneWorkspace(visibleLayout, paneId, activeWorkspaceEntriesByKey),
      );
    },
    [activeProjectViewKey, activeWorkspaceEntriesByKey, focusPane, visibleLayout],
  );
  const handleClosePane = useCallback(
    (paneId: string) => {
      if (!activeProjectViewKey) return;
      closePane(activeProjectViewKey, paneId);
      const nextLayout = filterCockpitLayout(
        useCockpitLayoutStore.getState().layoutsByProject[activeProjectViewKey]?.layout ?? null,
        visibleWorkspaceKeys,
      );
      rememberCockpitWorkspace(
        resolveCockpitPaneWorkspace(
          nextLayout,
          nextLayout?.focusedPaneId ?? null,
          activeWorkspaceEntriesByKey,
        ),
      );
    },
    [activeProjectViewKey, activeWorkspaceEntriesByKey, closePane, visibleWorkspaceKeys],
  );
  const handleReturnToWorkspace = useCallback(() => {
    if (focusedWorkspace) {
      navigateToCockpitWorkspace(focusedWorkspace);
      return;
    }
    if (!navigateToLastWorkspace()) {
      router.replace(buildOpenProjectRoute());
    }
  }, [focusedWorkspace]);
  const handleAddPane = useCallback(() => {
    if (activeProjectViewKey) addEmptyPane(activeProjectViewKey);
  }, [activeProjectViewKey, addEmptyPane]);
  const handleSetSnoozed = useCallback(
    (workspaceKey: string, snoozed: boolean) => setSnoozed(workspaceKey, snoozed),
    [setSnoozed],
  );
  const handleSelectAttention = useCallback(
    (workspace: SidebarWorkspaceEntry) => {
      if (!visibleWorkspaceKeys.has(workspace.workspaceKey)) {
        navigateToCockpitWorkspace(workspace);
        return;
      }
      if (!activeProjectViewKey) return;
      focusWorkspace(activeProjectViewKey, workspace.workspaceKey);
      rememberCockpitWorkspace(workspace);
    },
    [activeProjectViewKey, focusWorkspace, visibleWorkspaceKeys],
  );
  const handleSplitPane = useCallback(
    (paneId: string, position: "right" | "down") => {
      if (activeProjectViewKey) splitPane(activeProjectViewKey, paneId, position);
    },
    [activeProjectViewKey, splitPane],
  );
  const handleMovePane = useCallback(
    (paneId: string, direction: CockpitPaneMoveDirection) => {
      if (!activeProjectViewKey) return;
      const target = moveTargetsByPane.get(paneId)?.[direction] ?? null;
      if (!target) return;
      movePane({
        projectViewKey: activeProjectViewKey,
        paneId,
        targetPaneId: target.kind === "pane" ? target.paneId : null,
        direction,
      });
    },
    [activeProjectViewKey, movePane, moveTargetsByPane],
  );
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const headerLeft = useMemo(
    () => (
      <>
        <SidebarMenuToggle />
        <ScreenTitle>{t("cockpit.title")}</ScreenTitle>
      </>
    ),
    [t],
  );
  const headerRight = useMemo(
    () => (
      <View style={styles.headerActions}>
        <CockpitAttentionMenu
          workspaces={allWorkspaceEntries}
          snoozedAtByWorkspace={snoozedAtByWorkspace}
          workspaceTitleSource={workspaceTitleSource}
          onSelect={handleSelectAttention}
        />
        <ToolbarButton
          label={t("workspace.tabs.actions.splitRight")}
          shortcut={splitRightKeys}
          testID="cockpit-add-pane"
          onPress={handleAddPane}
        >
          <ThemedPlus size={15} />
        </ToolbarButton>
        <CockpitToggleButton active onPress={handleReturnToWorkspace} />
      </View>
    ),
    [
      allWorkspaceEntries,
      handleAddPane,
      handleReturnToWorkspace,
      handleSelectAttention,
      snoozedAtByWorkspace,
      splitRightKeys,
      t,
      workspaceTitleSource,
    ],
  );

  const handlePaneKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id === "workspace.pane.split.right") {
        if (visibleLayout?.focusedPaneId) {
          handleSplitPane(visibleLayout.focusedPaneId, "right");
        } else {
          handleAddPane();
        }
        return true;
      }
      if (action.id === "workspace.pane.split.down") {
        if (visibleLayout?.focusedPaneId) {
          handleSplitPane(visibleLayout.focusedPaneId, "down");
        } else {
          handleAddPane();
        }
        return true;
      }

      let direction: CockpitPaneMoveDirection | null = null;
      if (action.id === "workspace.pane.focus.left") direction = "left";
      if (action.id === "workspace.pane.focus.right") direction = "right";
      if (action.id === "workspace.pane.focus.up") direction = "up";
      if (action.id === "workspace.pane.focus.down") direction = "down";
      if (action.id === "workspace.pane.move-tab.left") direction = "left";
      if (action.id === "workspace.pane.move-tab.right") direction = "right";
      if (action.id === "workspace.pane.move-tab.up") direction = "up";
      if (action.id === "workspace.pane.move-tab.down") direction = "down";
      if (!direction || !visibleLayout?.focusedPaneId) return false;
      if (action.id.startsWith("workspace.pane.move-tab.")) {
        handleMovePane(visibleLayout.focusedPaneId, direction);
        return true;
      }
      const adjacentPaneId = findAdjacentPane(
        visibleLayout.root,
        visibleLayout.focusedPaneId,
        direction,
      );
      if (adjacentPaneId) handleFocusPane(adjacentPaneId);
      return true;
    },
    [handleAddPane, handleFocusPane, handleMovePane, handleSplitPane, visibleLayout],
  );

  useKeyboardActionHandler({
    handlerId: "cockpit-pane-layout-actions",
    actions: [
      "workspace.pane.split.right",
      "workspace.pane.split.down",
      "workspace.pane.focus.left",
      "workspace.pane.focus.right",
      "workspace.pane.focus.up",
      "workspace.pane.focus.down",
      "workspace.pane.move-tab.left",
      "workspace.pane.move-tab.right",
      "workspace.pane.move-tab.up",
      "workspace.pane.move-tab.down",
    ] as const,
    enabled: isRouteFocused && layoutHydrated && !isInitialLoad,
    priority: 200,
    handle: handlePaneKeyboardAction,
  });

  let content: ReactElement = (
    <View style={styles.centerState}>
      <LoadingSpinner color={styles.spinner.color} />
    </View>
  );
  if (layoutHydrated && !isInitialLoad && !visibleLayout) {
    content = (
      <View style={styles.centerState}>
        <Text style={styles.emptyTitle}>{t("cockpit.empty.title")}</Text>
        <Text style={styles.emptyDescription}>{t("cockpit.empty.description")}</Text>
        <Button size="sm" leftIcon={ThemedPlus} onPress={handleAddPane}>
          {t("sidebar.workspace.actions.newWorkspace")}
        </Button>
      </View>
    );
  } else if (layoutHydrated && !isInitialLoad && visibleLayout) {
    const minimumHeight = getCockpitLayoutMinimumHeight(visibleLayout.root);
    content = (
      <ScrollView style={styles.contentFrame} contentContainerStyle={styles.scrollContent}>
        <View
          style={[styles.layoutRoot, inlineUnistylesStyle({ minHeight: minimumHeight })]}
          testID="cockpit-pane-layout"
        >
          <CockpitSplitNodeView
            node={visibleLayout.root}
            focusedPaneId={visibleLayout.focusedPaneId}
            workspaceEntriesByKey={activeWorkspaceEntriesByKey}
            projectNamesByWorkspace={projectNamesByWorkspace}
            workspaceTitleSource={workspaceTitleSource}
            agentUsageByWorkspace={agentUsageByWorkspace}
            snoozedAtByWorkspace={snoozedAtByWorkspace}
            moveTargetsByPane={moveTargetsByPane}
            onFocusPane={handleFocusPane}
            onMovePane={handleMovePane}
            onSplitPane={handleSplitPane}
            onClosePane={handleClosePane}
            onSetSnoozed={handleSetSnoozed}
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen} testID="cockpit-screen">
      <ScreenHeader left={headerLeft} right={headerRight} />
      {isRouteFocused ? <CockpitTelemetryBar serverIds={telemetryServerIds} /> : null}
      {content}
    </View>
  );
}

function CockpitSplitNodeView({
  node,
  focusedPaneId,
  workspaceEntriesByKey,
  projectNamesByWorkspace,
  workspaceTitleSource,
  agentUsageByWorkspace,
  snoozedAtByWorkspace,
  moveTargetsByPane,
  onFocusPane,
  onMovePane,
  onSplitPane,
  onClosePane,
  onSetSnoozed,
}: {
  node: SplitNode;
  focusedPaneId: string | null;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByWorkspace: ReadonlyMap<string, string>;
  workspaceTitleSource: "title" | "branch";
  agentUsageByWorkspace: ReadonlyMap<string, CockpitAgentUsage>;
  snoozedAtByWorkspace: Readonly<Record<string, string>>;
  moveTargetsByPane: ReadonlyMap<string, CockpitPaneMoveTargets>;
  onFocusPane: (paneId: string) => void;
  onMovePane: (paneId: string, direction: CockpitPaneMoveDirection) => void;
  onSplitPane: (paneId: string, position: "right" | "down") => void;
  onClosePane: (paneId: string) => void;
  onSetSnoozed: (workspaceKey: string, snoozed: boolean) => void;
}): ReactElement | null {
  if (node.kind === "pane") {
    const workspaceKey = getCockpitPaneWorkspaceKey(node.pane);
    if (!workspaceKey) {
      return (
        <CockpitEmptyPane
          pane={node.pane}
          isFocused={node.pane.id === focusedPaneId}
          moveTargets={moveTargetsByPane.get(node.pane.id) ?? null}
          onFocus={onFocusPane}
          onMove={onMovePane}
          onSplit={onSplitPane}
          onClose={onClosePane}
        />
      );
    }
    const workspace = workspaceEntriesByKey.get(workspaceKey);
    if (!workspace) return null;
    return (
      <CockpitWorkspaceCard
        pane={node.pane}
        workspace={workspace}
        projectName={projectNamesByWorkspace.get(workspaceKey) ?? null}
        title={resolveSidebarWorkspacePrimaryLabel({
          workspace,
          workspaceTitleSource,
        })}
        agentUsage={agentUsageByWorkspace.get(workspaceKey) ?? null}
        isSnoozed={Boolean(snoozedAtByWorkspace[workspaceKey])}
        isFocused={node.pane.id === focusedPaneId}
        moveTargets={moveTargetsByPane.get(node.pane.id) ?? null}
        onFocus={onFocusPane}
        onMove={onMovePane}
        onSplit={onSplitPane}
        onClose={onClosePane}
        onSetSnoozed={onSetSnoozed}
      />
    );
  }

  const groupStyle =
    node.group.direction === "horizontal" ? styles.splitGroupHorizontal : styles.splitGroupVertical;
  return (
    <View style={[styles.splitGroup, groupStyle]} testID={`cockpit-split-${node.group.id}`}>
      {node.group.children.map((child) => (
        <View
          key={child.kind === "pane" ? child.pane.id : child.group.id}
          style={styles.splitChild}
        >
          <CockpitSplitNodeView
            node={child}
            focusedPaneId={focusedPaneId}
            workspaceEntriesByKey={workspaceEntriesByKey}
            projectNamesByWorkspace={projectNamesByWorkspace}
            workspaceTitleSource={workspaceTitleSource}
            agentUsageByWorkspace={agentUsageByWorkspace}
            snoozedAtByWorkspace={snoozedAtByWorkspace}
            moveTargetsByPane={moveTargetsByPane}
            onFocusPane={onFocusPane}
            onMovePane={onMovePane}
            onSplitPane={onSplitPane}
            onClosePane={onClosePane}
            onSetSnoozed={onSetSnoozed}
          />
        </View>
      ))}
    </View>
  );
}

interface CockpitContinueAction {
  label: string;
  disabled: boolean;
  onContinue: () => void;
}

function useCockpitContinueAction({
  workspace,
  paneId,
  isFocused,
  handleFocus,
}: {
  workspace: SidebarWorkspaceEntry;
  paneId: string;
  isFocused: boolean;
  handleFocus: () => void;
}): CockpitContinueAction | null {
  const { t } = useTranslation();
  const [isContinuing, setIsContinuing] = useState(false);
  const client = useHostRuntimeClient(workspace.serverId);
  const isConnected = useHostRuntimeIsConnected(workspace.serverId);
  const toast = useToast();
  const isAgentRunning = useSessionStore((state) =>
    workspace.agentId
      ? selectAgentTurnPresentation(state.sessions[workspace.serverId], workspace.agentId).isActive
      : false,
  );
  const hasPendingPermission = useSessionStore((state) => {
    if (!workspace.agentId) return false;
    const permissions = state.sessions[workspace.serverId]?.pendingPermissions;
    if (!permissions) return false;
    for (const permission of permissions.values()) {
      if (permission.agentId === workspace.agentId) return true;
    }
    return false;
  });
  const canContinue =
    workspace.agentId !== null &&
    isConnected &&
    !isAgentRunning &&
    !hasPendingPermission &&
    !isContinuing;
  const handleContinue = useCallback(() => {
    if (!canContinue || !client || !workspace.agentId) return;
    handleFocus();
    setIsContinuing(true);
    void dispatchComposerAgentMessage({
      client,
      agentId: workspace.agentId,
      text: AGENT_CONTINUE_PROMPT,
      attachments: [],
      encodeImages: encodeNoQuickReplyImages,
      submission: createMessageSubmissionWriter(workspace.serverId),
    })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t("composer.errors.failedToSend"));
      })
      .finally(() => {
        setIsContinuing(false);
      });
  }, [canContinue, client, handleFocus, t, toast, workspace.agentId, workspace.serverId]);

  useKeyboardActionHandler({
    handlerId: `cockpit-agent-continue-${paneId}`,
    actions: ["agent.continue"] as const,
    enabled: isFocused && canContinue,
    priority: 220,
    handle: () => {
      handleContinue();
      return true;
    },
  });

  return useMemo(
    () =>
      workspace.agentId
        ? {
            label: t("composer.continue.continueAgent"),
            disabled: !canContinue,
            onContinue: handleContinue,
          }
        : null,
    [canContinue, handleContinue, t, workspace.agentId],
  );
}

function CockpitWorkspaceCard({
  pane,
  workspace,
  projectName,
  title,
  agentUsage,
  isSnoozed,
  isFocused,
  moveTargets,
  onFocus,
  onMove,
  onSplit,
  onClose,
  onSetSnoozed,
}: {
  pane: SplitPane;
  workspace: SidebarWorkspaceEntry;
  projectName: string | null;
  title: string;
  agentUsage: CockpitAgentUsage | null;
  isSnoozed: boolean;
  isFocused: boolean;
  moveTargets: CockpitPaneMoveTargets | null;
  onFocus: (paneId: string) => void;
  onMove: (paneId: string, direction: CockpitPaneMoveDirection) => void;
  onSplit: (paneId: string, position: "right" | "down") => void;
  onClose: (paneId: string) => void;
  onSetSnoozed: (workspaceKey: string, snoozed: boolean) => void;
}) {
  const { t } = useTranslation();
  const [isArchiving, setIsArchiving] = useState(false);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [cardSize, setCardSize] = useState<CockpitCardSize>({
    width: 0,
    height: 0,
  });
  const client = useHostRuntimeClient(workspace.serverId);
  const isConnected = useHostRuntimeIsConnected(workspace.serverId);
  const archiveController = useWorkspaceArchive({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    ...toWorktreeArchiveRisk(workspace),
    confirmationPolicy: "always",
    onArchiveStarted: () => undefined,
    onArchiveSucceeded: () => onClose(pane.id),
    onSetHiding: setIsArchiving,
  });
  const handleFocus = useCallback(() => onFocus(pane.id), [onFocus, pane.id]);
  const continueAction = useCockpitContinueAction({
    workspace,
    paneId: pane.id,
    isFocused,
    handleFocus,
  });
  const handlePress = useCallback(() => {
    handleFocus();
    navigateToCockpitWorkspace(workspace);
  }, [handleFocus, workspace]);
  const handleArchive = useCallback(() => {
    if (isArchiving) return;
    handleFocus();
    archiveController.archive();
  }, [archiveController, handleFocus, isArchiving]);
  const handleToggleSnooze = useCallback(() => {
    onSetSnoozed(workspace.workspaceKey, !isSnoozed);
  }, [isSnoozed, onSetSnoozed, workspace.workspaceKey]);
  const handleOpenNote = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleFocus();
      setIsNoteOpen(true);
    },
    [handleFocus],
  );
  const handleCloseNote = useCallback(() => setIsNoteOpen(false), []);
  const handleSubmitNote = useCallback(
    async (note: string | null) => {
      if (!client || !isConnected) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspaceTitle(workspace.workspaceId, note);
    },
    [client, isConnected, t, workspace.workspaceId],
  );
  const noteFallbackTitle = workspace.currentBranch ?? workspace.workspaceDirectoryLabel;
  const snoozeAction = useMemo(
    () => ({
      label: isSnoozed ? t("cockpit.actions.wake") : t("cockpit.actions.snooze"),
      active: isSnoozed,
      onToggle: handleToggleSnooze,
    }),
    [handleToggleSnooze, isSnoozed, t],
  );

  useKeyboardActionHandler({
    handlerId: `cockpit-pane-close-${pane.id}`,
    actions: ["workspace.pane.close"] as const,
    enabled: isFocused && !isArchiving,
    priority: 200,
    handle: () => {
      handleArchive();
      return true;
    },
  });

  const statusLabel = isSnoozed
    ? t("cockpit.status.snoozed")
    : t(STATUS_LABEL_KEYS[workspace.statusBucket]);
  const accessibilityLabel = `${title}, ${statusLabel}`;
  const rootStyle = useMemo(
    () => [
      styles.card,
      isFocused ? styles.cardFocused : null,
      isSnoozed ? styles.cardSnoozed : null,
    ],
    [isFocused, isSnoozed],
  );
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextSize = {
      width: Math.floor(event.nativeEvent.layout.width),
      height: Math.floor(event.nativeEvent.layout.height),
    };
    setCardSize((current) =>
      current.width === nextSize.width && current.height === nextSize.height ? current : nextSize,
    );
  }, []);
  const showQuickReply = shouldShowCockpitQuickReply({
    ...cardSize,
    hasAgent: workspace.agentId !== null,
  });
  const stackHeader = shouldStackCockpitCardHeader(cardSize.width);

  return (
    <View
      onFocus={handleFocus}
      onLayout={handleLayout}
      style={rootStyle}
      testID={`cockpit-workspace-card-${workspace.workspaceKey}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onFocus={handleFocus}
        onPressIn={handleFocus}
        onPress={handlePress}
        style={cockpitCardContentStyle}
      >
        <View style={[styles.cardHeader, stackHeader ? styles.cardHeaderStacked : null]}>
          <View
            style={[
              styles.cardIdentityRow,
              stackHeader ? styles.cardIdentityRowStacked : styles.cardIdentityRowInline,
            ]}
          >
            <CockpitStatusIndicator bucket={workspace.statusBucket} snoozed={isSnoozed} />
            <View style={styles.cardTitleGroup}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {title}
                </Text>
                <CockpitWorkspaceNoteButton
                  accessibilityHint={noteFallbackTitle}
                  label={t("sidebar.workspace.actions.rename")}
                  onPress={handleOpenNote}
                  testID={`cockpit-workspace-note-${workspace.workspaceKey}`}
                />
              </View>
              <Text style={styles.statusText} numberOfLines={1}>
                {statusLabel}
              </Text>
            </View>
          </View>
          <View
            style={[styles.cardHeaderDetails, stackHeader ? styles.cardHeaderDetailsStacked : null]}
          >
            <View style={styles.cardMetrics}>
              {workspace.diffStat ? (
                <DiffStat
                  additions={workspace.diffStat.additions}
                  deletions={workspace.diffStat.deletions}
                />
              ) : null}
              {agentUsage ? (
                <ContextWindowMeter
                  maxTokens={agentUsage.contextWindowMaxTokens}
                  usedTokens={agentUsage.contextWindowUsedTokens}
                  totalCostUsd={agentUsage.totalCostUsd}
                  showPercentage
                  serverId={workspace.serverId}
                  provider={agentUsage.provider}
                />
              ) : null}
            </View>
            <CockpitPaneActions
              paneId={pane.id}
              closeLabel={t("sidebar.workspace.actions.archiveWorkspace")}
              closeDisabled={isArchiving}
              continueAction={continueAction}
              snoozeAction={snoozeAction}
              moveTargets={moveTargets}
              onFocus={onFocus}
              onMove={onMove}
              onSplit={onSplit}
              onClose={handleArchive}
            />
          </View>
        </View>

        <View style={styles.metaRow}>
          {projectName ? (
            <Text style={styles.projectName} numberOfLines={1}>
              {projectName}
            </Text>
          ) : null}
          {workspace.currentBranch ? (
            <View style={styles.metaItem}>
              <ThemedGitBranch size={13} />
              <Text style={styles.metaText} numberOfLines={1}>
                {workspace.currentBranch}
              </Text>
            </View>
          ) : null}
          {workspace.prHint ? (
            <View style={styles.metaItem}>
              <ThemedGitPullRequest size={13} />
              <Text style={styles.metaText} numberOfLines={1}>
                #{workspace.prHint.number} · {t(PR_STATE_LABEL_KEYS[workspace.prHint.state])}
              </Text>
            </View>
          ) : null}
        </View>

        <CockpitCardActivity workspace={workspace} />
      </Pressable>
      {!isSnoozed && showQuickReply && workspace.agentId ? (
        <CockpitQuickReply
          agentId={workspace.agentId}
          serverId={workspace.serverId}
          onFocus={handleFocus}
        />
      ) : null}
      {isFocused ? (
        <View
          pointerEvents="none"
          style={styles.cardFocusRing}
          testID={`cockpit-focus-ring-${workspace.workspaceKey}`}
        />
      ) : null}
      <WorkspaceNoteModal
        visible={isNoteOpen}
        note={workspace.title}
        fallbackTitle={noteFallbackTitle}
        onClose={handleCloseNote}
        onSubmit={handleSubmitNote}
        testID={`cockpit-workspace-note-modal-${workspace.workspaceKey}`}
      />
    </View>
  );
}

function CockpitWorkspaceNoteButton({
  accessibilityHint,
  label,
  onPress,
  testID,
}: {
  accessibilityHint: string;
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={6}
      onPress={onPress}
      style={cockpitNoteButtonStyle}
      testID={testID}
    >
      <ThemedPencil size={12} />
    </Pressable>
  );
}

function CockpitCardActivity({ workspace }: { workspace: SidebarWorkspaceEntry }) {
  const { t } = useTranslation();
  const newestRepliesFirst = useMemo(
    () => workspace.recentReplies.toReversed(),
    [workspace.recentReplies],
  );
  return (
    <View style={styles.activityRegion}>
      {workspace.latestPrompt ? (
        <ActivityBlock
          label={t("cockpit.labels.prompt")}
          text={workspace.latestPrompt}
          emptyText={t("cockpit.empty.noPrompt")}
          emphasized={workspace.activityPreviewKind === "prompt"}
          lines={2}
        />
      ) : null}
      <View style={styles.repliesBlock}>
        <Text
          style={
            workspace.activityPreviewKind === "reply"
              ? styles.activityLabelCurrent
              : styles.activityLabel
          }
        >
          {t("cockpit.labels.recentReplies")}
        </Text>
        {newestRepliesFirst.length > 0 ? (
          <View style={styles.repliesViewport}>
            {newestRepliesFirst.map((reply, index) => (
              <View key={reply.id} style={styles.replyItem}>
                <Text
                  style={index === 0 ? styles.replyTextLatest : styles.replyText}
                  numberOfLines={4}
                >
                  {reply.text}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.activityTextEmpty} numberOfLines={2}>
            {workspace.latestPrompt
              ? t("cockpit.empty.waitingForReply")
              : t("cockpit.empty.noActivity")}
          </Text>
        )}
      </View>
    </View>
  );
}

function CockpitQuickReply({
  serverId,
  agentId,
  onFocus,
}: {
  serverId: string;
  agentId: string;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const {
    settings: { sendBehavior },
  } = useAppSettings();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const isAgentRunning = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isActive,
  );
  const hasPendingPermission = useSessionStore((state) => {
    const permissions = state.sessions[serverId]?.pendingPermissions;
    if (!permissions) return false;
    for (const permission of permissions.values()) {
      if (permission.agentId === agentId) return true;
    }
    return false;
  });
  const [draft, setDraft] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quickReplyAction = useMemo(
    () =>
      resolveCockpitQuickReplyAction({
        sendBehavior,
        isAgentRunning,
        hasPendingPermission,
      }),
    [hasPendingPermission, isAgentRunning, sendBehavior],
  );
  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (targetAgentId) =>
        useSessionStore.getState().sessions[serverId]?.queuedMessages.get(targetAgentId) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSubmitting) return;
    setError(null);
    if (quickReplyAction.kind === "queue") {
      const result = queueComposerMessage({
        agentId,
        text,
        attachments: [],
        queue: queueWriter,
      });
      if (!result.queued) return;
      setDraft("");
      setResetKey((current) => current + 1);
      return;
    }
    if (!client || !isConnected) {
      setError(t("workspace.terminal.hostDisconnected"));
      return;
    }

    const activeTurnId =
      quickReplyAction.activeTurnBehavior === "steer"
        ? (useSessionStore.getState().sessions[serverId]?.agents.get(agentId)?.activeTurn?.turnId ??
          undefined)
        : undefined;
    setIsSubmitting(true);
    try {
      await dispatchComposerAgentMessage({
        client,
        agentId,
        text,
        attachments: [],
        encodeImages: encodeNoQuickReplyImages,
        submission: createMessageSubmissionWriter(serverId),
        activeTurnBehavior: quickReplyAction.activeTurnBehavior,
        activeTurnId,
      });
      setDraft("");
      setResetKey((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("composer.errors.failedToSend"));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    agentId,
    client,
    draft,
    isConnected,
    isSubmitting,
    queueWriter,
    quickReplyAction,
    serverId,
    t,
  ]);
  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);
  const handleChangeText = useCallback((text: string) => {
    setDraft(text);
    setError(null);
  }, []);
  const requiresConnection = quickReplyAction.kind === "send";
  const sendDisabled =
    isSubmitting || (requiresConnection && !isConnected) || draft.trim().length === 0;
  const sendAccessibilityState = useMemo(() => ({ disabled: sendDisabled }), [sendDisabled]);
  const sendButtonStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const result = quickReplySendButtonStyle(state);
      if (sendDisabled) result.push(styles.quickReplySendButtonDisabled);
      return result;
    },
    [sendDisabled],
  );

  return (
    <View style={styles.quickReplyArea}>
      <View style={styles.quickReplyRow}>
        <AdaptiveTextInput
          accessibilityLabel={t("composer.input.accessibilityLabel")}
          autoCapitalize="sentences"
          autoCorrect
          blurOnSubmit={false}
          editable={!isSubmitting && (!requiresConnection || isConnected)}
          initialValue=""
          onChangeText={handleChangeText}
          onFocus={onFocus}
          onSubmitEditing={handleSubmit}
          placeholder={t("composer.placeholders.fallback")}
          resetKey={resetKey}
          returnKeyType="send"
          style={styles.quickReplyInput}
          testID={`cockpit-quick-reply-input-${agentId}`}
        />
        <Pressable
          accessibilityLabel={t("composer.input.sendMessage")}
          accessibilityRole="button"
          accessibilityState={sendAccessibilityState}
          disabled={sendDisabled}
          onPress={handleSubmit}
          style={sendButtonStyle}
          testID={`cockpit-quick-reply-send-${agentId}`}
        >
          {isSubmitting ? (
            <LoadingSpinner color={styles.spinner.color} size="small" />
          ) : (
            <ThemedArrowUp size={15} />
          )}
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.quickReplyError} numberOfLines={1}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function CockpitEmptyPane({
  pane,
  isFocused,
  moveTargets,
  onFocus,
  onMove,
  onSplit,
  onClose,
}: {
  pane: SplitPane;
  isFocused: boolean;
  moveTargets: CockpitPaneMoveTargets | null;
  onFocus: (paneId: string) => void;
  onMove: (paneId: string, direction: CockpitPaneMoveDirection) => void;
  onSplit: (paneId: string, position: "right" | "down") => void;
  onClose: (paneId: string) => void;
}) {
  const { t } = useTranslation();
  const handleFocus = useCallback(() => onFocus(pane.id), [onFocus, pane.id]);
  const handleClose = useCallback(() => onClose(pane.id), [onClose, pane.id]);
  const handleCreateWorkspace = useCallback(() => {
    handleFocus();
    router.navigate(buildNewWorkspaceRoute());
  }, [handleFocus]);

  useKeyboardActionHandler({
    handlerId: `cockpit-empty-pane-close-${pane.id}`,
    actions: ["workspace.pane.close"] as const,
    enabled: isFocused,
    priority: 200,
    handle: () => {
      handleClose();
      return true;
    },
  });

  return (
    <View
      style={[styles.card, styles.emptyPane, isFocused ? styles.cardFocused : null]}
      onFocus={handleFocus}
      testID={`cockpit-empty-pane-${pane.id}`}
    >
      <View style={styles.emptyPaneToolbar}>
        <CockpitPaneActions
          paneId={pane.id}
          closeLabel={t("workspace.tabs.actions.closePane")}
          continueAction={null}
          snoozeAction={null}
          moveTargets={moveTargets}
          onFocus={onFocus}
          onMove={onMove}
          onSplit={onSplit}
          onClose={handleClose}
        />
      </View>
      <View style={styles.emptyPaneContent}>
        <ThemedPlus size={20} />
        <Text style={styles.emptyTitle}>{t("sidebar.workspace.actions.newWorkspace")}</Text>
        <Text style={styles.emptyDescription}>{t("cockpit.empty.description")}</Text>
        <Button size="sm" onPress={handleCreateWorkspace}>
          {t("sidebar.workspace.actions.newWorkspace")}
        </Button>
      </View>
      {isFocused ? <View pointerEvents="none" style={styles.cardFocusRing} /> : null}
    </View>
  );
}

function CockpitPaneActions({
  paneId,
  closeLabel,
  closeDisabled = false,
  continueAction,
  snoozeAction,
  moveTargets,
  onFocus,
  onMove,
  onSplit,
  onClose,
}: {
  paneId: string;
  closeLabel: string;
  closeDisabled?: boolean;
  continueAction: CockpitContinueAction | null;
  snoozeAction: { label: string; active: boolean; onToggle: () => void } | null;
  moveTargets: CockpitPaneMoveTargets | null;
  onFocus: (paneId: string) => void;
  onMove: (paneId: string, direction: CockpitPaneMoveDirection) => void;
  onSplit: (paneId: string, position: "right" | "down") => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const moveLeftKeys = useShortcutKeys("workspace-pane-move-tab-left");
  const moveRightKeys = useShortcutKeys("workspace-pane-move-tab-right");
  const moveUpKeys = useShortcutKeys("workspace-pane-move-tab-up");
  const moveDownKeys = useShortcutKeys("workspace-pane-move-tab-down");
  const closeKeys = useShortcutKeys("workspace-pane-close");
  const continueKeys = useShortcutKeys("agent.continue");
  const preparePaneAction = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onFocus(paneId);
    },
    [onFocus, paneId],
  );
  const handleSplitRight = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onSplit(paneId, "right");
    },
    [onSplit, paneId, preparePaneAction],
  );
  const handleSplitDown = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onSplit(paneId, "down");
    },
    [onSplit, paneId, preparePaneAction],
  );
  const handleClose = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onClose();
    },
    [onClose, preparePaneAction],
  );
  const handleMoveLeft = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onMove(paneId, "left");
    },
    [onMove, paneId, preparePaneAction],
  );
  const handleMoveRight = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onMove(paneId, "right");
    },
    [onMove, paneId, preparePaneAction],
  );
  const handleMoveUp = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onMove(paneId, "up");
    },
    [onMove, paneId, preparePaneAction],
  );
  const handleMoveDown = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      onMove(paneId, "down");
    },
    [onMove, paneId, preparePaneAction],
  );
  const handleContinue = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      continueAction?.onContinue();
    },
    [continueAction, preparePaneAction],
  );

  return (
    <View style={styles.paneActionsStack}>
      <ToolbarControls
        style={styles.paneMoveActions}
        testID={`cockpit-pane-move-actions-${paneId}`}
      >
        <ToolbarButton
          label={t("cockpit.actions.moveLeft")}
          shortcut={moveLeftKeys}
          disabled={!moveTargets?.left}
          testID={`cockpit-pane-move-left-${paneId}`}
          onPress={handleMoveLeft}
        >
          <ThemedArrowLeft size={13} />
        </ToolbarButton>
        <ToolbarButton
          label={t("cockpit.actions.moveRight")}
          shortcut={moveRightKeys}
          disabled={!moveTargets?.right}
          testID={`cockpit-pane-move-right-${paneId}`}
          onPress={handleMoveRight}
        >
          <ThemedArrowRight size={13} />
        </ToolbarButton>
        <ToolbarButton
          label={t("cockpit.actions.moveUp")}
          shortcut={moveUpKeys}
          disabled={!moveTargets?.up}
          testID={`cockpit-pane-move-up-${paneId}`}
          onPress={handleMoveUp}
        >
          <ThemedArrowUpMuted size={13} />
        </ToolbarButton>
        <ToolbarButton
          label={t("cockpit.actions.moveDown")}
          shortcut={moveDownKeys}
          disabled={!moveTargets?.down}
          testID={`cockpit-pane-move-down-${paneId}`}
          onPress={handleMoveDown}
        >
          <ThemedArrowDown size={13} />
        </ToolbarButton>
      </ToolbarControls>
      <View style={styles.paneActions}>
        {continueAction ? (
          <ToolbarControls>
            <ToolbarButton
              label={continueAction.label}
              shortcut={continueKeys}
              disabled={continueAction.disabled}
              testID={`cockpit-pane-continue-${paneId}`}
              onPress={handleContinue}
            >
              <ThemedStepForward size={14} />
            </ToolbarButton>
          </ToolbarControls>
        ) : null}
        {snoozeAction ? (
          <CockpitSnoozeActionButton
            paneId={paneId}
            action={snoozeAction}
            preparePaneAction={preparePaneAction}
          />
        ) : null}
        <ToolbarControls>
          <ToolbarButton
            label={t("workspace.tabs.actions.splitRight")}
            shortcut={splitRightKeys}
            testID={`cockpit-pane-split-right-${paneId}`}
            onPress={handleSplitRight}
          >
            <ThemedColumns2 size={14} />
          </ToolbarButton>
          <ToolbarButton
            label={t("workspace.tabs.actions.splitDown")}
            shortcut={splitDownKeys}
            testID={`cockpit-pane-split-down-${paneId}`}
            onPress={handleSplitDown}
          >
            <ThemedRows2 size={14} />
          </ToolbarButton>
        </ToolbarControls>
        <ToolbarControls>
          <ToolbarButton
            label={closeLabel}
            shortcut={closeKeys}
            disabled={closeDisabled}
            testID={`cockpit-pane-close-${paneId}`}
            onPress={handleClose}
          >
            <ThemedClose size={14} />
          </ToolbarButton>
        </ToolbarControls>
      </View>
    </View>
  );
}

function CockpitSnoozeActionButton({
  paneId,
  action,
  preparePaneAction,
}: {
  paneId: string;
  action: { label: string; active: boolean; onToggle: () => void };
  preparePaneAction: (event: GestureResponderEvent) => void;
}) {
  const handleToggle = useCallback(
    (event: GestureResponderEvent) => {
      preparePaneAction(event);
      action.onToggle();
    },
    [action, preparePaneAction],
  );

  return (
    <ToolbarControls>
      <ToolbarButton
        label={action.label}
        selected={action.active}
        testID={`cockpit-pane-snooze-${paneId}`}
        onPress={handleToggle}
      >
        {action.active ? <ThemedBellRing size={14} /> : <ThemedMoon size={14} />}
      </ToolbarButton>
    </ToolbarControls>
  );
}

function CockpitStatusIndicator({
  bucket,
  snoozed,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  snoozed: boolean;
}) {
  if (snoozed) {
    return <View style={[styles.statusDot, styles.statusDotDone]} />;
  }
  if (bucket === "running") {
    return (
      <View style={styles.statusRingFrame} testID="cockpit-running-spinner">
        <StatusRing size="large" testID="cockpit-running-spinner-visual" />
      </View>
    );
  }
  return <View style={[styles.statusDot, resolveStatusDotStyle(bucket)]} />;
}

function ActivityBlock({
  label,
  text,
  emptyText,
  emphasized,
  lines,
}: {
  label: string;
  text: string | null;
  emptyText: string;
  emphasized: boolean;
  lines: number;
}) {
  return (
    <View style={styles.activityBlock}>
      <Text style={emphasized ? styles.activityLabelCurrent : styles.activityLabel}>{label}</Text>
      <Text style={text ? styles.activityText : styles.activityTextEmpty} numberOfLines={lines}>
        {text ?? emptyText}
      </Text>
    </View>
  );
}

function cockpitCardContentStyle(
  state: PressableStateCallbackType & { hovered?: boolean },
): ViewStyle[] {
  const result: ViewStyle[] = [styles.cardContent];
  if (state.hovered) result.push(styles.cardHovered);
  if (state.pressed) result.push(styles.cardPressed);
  return result;
}

function cockpitNoteButtonStyle(
  state: PressableStateCallbackType & { hovered?: boolean },
): ViewStyle[] {
  const result: ViewStyle[] = [styles.noteButton];
  if (state.hovered) result.push(styles.noteButtonHovered);
  if (state.pressed) result.push(styles.noteButtonPressed);
  return result;
}

function quickReplySendButtonStyle(
  state: PressableStateCallbackType & { hovered?: boolean },
): ViewStyle[] {
  const result: ViewStyle[] = [styles.quickReplySendButton];
  if (state.hovered) result.push(styles.quickReplySendButtonHovered);
  if (state.pressed) result.push(styles.quickReplySendButtonPressed);
  return result;
}

function resolveStatusDotStyle(bucket: SidebarWorkspaceEntry["statusBucket"]): ViewStyle {
  if (bucket === "needs_input") return styles.statusDotNeedsInput;
  if (bucket === "failed") return styles.statusDotFailed;
  if (bucket === "attention") return styles.statusDotAttention;
  return styles.statusDotDone;
}

const ThemedGitBranch = withUnistyles(GitBranch, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedGitPullRequest = withUnistyles(GitPullRequest, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedColumns2 = withUnistyles(Columns2, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedRows2 = withUnistyles(Rows2, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedClose = withUnistyles(X, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPlus = withUnistyles(Plus, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowUp = withUnistyles(ArrowUp, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedArrowLeft = withUnistyles(ArrowLeft, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedStepForward = withUnistyles(StepForward, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowRight = withUnistyles(ArrowRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowUpMuted = withUnistyles(ArrowUp, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowDown = withUnistyles(ArrowDown, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedMoon = withUnistyles(Moon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedBellRing = withUnistyles(BellRing, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedPencil = withUnistyles(Pencil, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  contentFrame: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: COCKPIT_HORIZONTAL_PADDING,
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  layoutRoot: {
    flexGrow: 1,
    minWidth: 0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.surface4,
    backgroundColor: theme.colors.surface4,
  },
  splitGroup: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    gap: COCKPIT_CARD_GAP,
    backgroundColor: theme.colors.surface4,
  },
  splitGroupHorizontal: {
    flexDirection: "row",
  },
  splitGroupVertical: {
    flexDirection: "column",
  },
  splitChild: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
  },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 210,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  cardContent: {
    flex: 1,
    minHeight: 0,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    userSelect: "none",
  },
  cardFocused: {
    zIndex: 1,
  },
  cardFocusRing: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
    borderWidth: 2,
    borderColor: theme.colors.accentBright,
  },
  cardSnoozed: {
    opacity: 0.52,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface3,
  },
  cardHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  cardHeaderStacked: {
    flexDirection: "column",
  },
  cardIdentityRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  cardIdentityRowInline: {
    flex: 1,
  },
  cardIdentityRowStacked: {
    width: "100%",
  },
  cardHeaderDetails: {
    minWidth: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  cardHeaderDetailsStacked: {
    width: "100%",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 1,
  },
  cardMetrics: {
    maxWidth: "100%",
    flexShrink: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  cardTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  cardTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  cardTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: COCKPIT_CARD_TITLE_LINE_HEIGHT,
  },
  noteButton: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  noteButtonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  noteButtonPressed: {
    backgroundColor: theme.colors.surface4,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 17,
  },
  statusDot: {
    width: COCKPIT_STATUS_DOT_SIZE,
    height: COCKPIT_STATUS_DOT_SIZE,
    marginTop: COCKPIT_STATUS_DOT_MARGIN_TOP,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
  },
  statusDotNeedsInput: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  statusDotFailed: {
    backgroundColor: theme.colors.statusDotDanger,
  },
  statusDotAttention: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  statusDotDone: {
    backgroundColor: theme.colors.border,
  },
  statusRingFrame: {
    width: COCKPIT_STATUS_RING_FRAME_SIZE,
    height: COCKPIT_STATUS_RING_FRAME_SIZE,
    marginTop: -1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  paneActions: {
    maxWidth: "100%",
    flexShrink: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  paneActionsStack: {
    maxWidth: "100%",
    flexShrink: 0,
    alignItems: "flex-end",
    gap: 1,
  },
  paneMoveActions: {
    maxWidth: "100%",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  metaRow: {
    minHeight: 18,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  projectName: {
    maxWidth: "100%",
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 17,
  },
  metaItem: {
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  metaText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 17,
  },
  activityBlock: {
    gap: theme.spacing[1],
  },
  activityRegion: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
  },
  repliesBlock: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[1],
  },
  repliesViewport: {
    flex: 1,
    minHeight: 0,
    flexDirection: "column-reverse",
    overflow: "hidden",
    gap: theme.spacing[2],
  },
  replyItem: {
    flexShrink: 0,
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  replyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 20,
  },
  replyTextLatest: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 20,
  },
  activityLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  activityLabelCurrent: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  activityText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 20,
  },
  activityTextEmpty: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 20,
  },
  quickReplyArea: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  quickReplyRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  quickReplyInput: {
    flex: 1,
    minWidth: 0,
    height: 32,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    fontSize: theme.fontSize.sm,
  },
  quickReplySendButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  quickReplySendButtonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  quickReplySendButtonPressed: {
    opacity: 0.72,
  },
  quickReplySendButtonDisabled: {
    opacity: 0.4,
  },
  quickReplyError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: 15,
  },
  emptyPane: {
    padding: theme.spacing[2],
  },
  emptyPaneToolbar: {
    minHeight: 28,
    alignItems: "flex-end",
  },
  emptyPaneContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[6],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
}));
