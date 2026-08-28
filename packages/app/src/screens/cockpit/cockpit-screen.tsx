import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { Columns2, GitBranch, GitPullRequest, Plus, Rows2, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { router } from "expo-router";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { DiffStat } from "@/components/diff-stat";
import { StatusRing } from "@/components/status-ring";
import { STATUS_RING_FRAME_SIZE } from "@/components/status-ring/geometry";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { ToolbarButton, ToolbarControls } from "@/components/ui/pane-content-toolbar";
import { SidebarModelProvider, useSidebarModel } from "@/components/sidebar/sidebar-model";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
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
import { buildNewWorkspaceRoute, buildOpenProjectRoute } from "@/utils/host-routes";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { findAdjacentPane } from "@/utils/split-navigation";
import type { SplitNode, SplitPane } from "@/stores/workspace-layout-store";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import { CockpitToggleButton } from "./cockpit-toggle-button";
import {
  COCKPIT_CARD_GAP,
  COCKPIT_HORIZONTAL_PADDING,
  filterCockpitLayout,
  findCockpitPane,
  getCockpitLayoutMinimumHeight,
  getCockpitPaneWorkspaceKey,
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

function collectWorkspaceKeys(projects: readonly SidebarProjectEntry[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    for (const placement of project.workspaces) {
      if (seen.has(placement.workspaceKey)) continue;
      seen.add(placement.workspaceKey);
      keys.push(placement.workspaceKey);
    }
  }
  return keys;
}

function buildProjectNamesByWorkspace(
  projects: readonly SidebarProjectEntry[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const project of projects) {
    for (const placement of project.workspaces) {
      if (!result.has(placement.workspaceKey)) {
        result.set(placement.workspaceKey, project.projectName);
      }
    }
  }
  return result;
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
  const { allProjects, workspaceEntriesByKey, isInitialLoad } = useSidebarModel();
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const layout = useCockpitLayoutStore((state) => state.layout);
  const reconcileWorkspaces = useCockpitLayoutStore((state) => state.reconcileWorkspaces);
  const splitPane = useCockpitLayoutStore((state) => state.splitPane);
  const addEmptyPane = useCockpitLayoutStore((state) => state.addEmptyPane);
  const closePane = useCockpitLayoutStore((state) => state.closePane);
  const focusPane = useCockpitLayoutStore((state) => state.focusPane);
  const layoutHydrated = useCockpitLayoutStoreHydrated();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const allWorkspaceKeys = useMemo(() => collectWorkspaceKeys(allProjects), [allProjects]);
  const preferredWorkspaceKey = lastWorkspaceSelection
    ? `${lastWorkspaceSelection.serverId}:${lastWorkspaceSelection.workspaceId}`
    : null;
  const visibleWorkspaceKeys = useMemo(
    () => new Set(workspaceEntriesByKey.keys()),
    [workspaceEntriesByKey],
  );
  const projectNamesByWorkspace = useMemo(
    () => buildProjectNamesByWorkspace(allProjects),
    [allProjects],
  );

  useEffect(() => {
    if (!isRouteFocused || !layoutHydrated || isInitialLoad) return;
    reconcileWorkspaces({
      workspaceKeys: allWorkspaceKeys,
      preferredWorkspaceKey,
    });
  }, [
    allWorkspaceKeys,
    isInitialLoad,
    isRouteFocused,
    layoutHydrated,
    preferredWorkspaceKey,
    reconcileWorkspaces,
  ]);

  const visibleLayout = useMemo(
    () => filterCockpitLayout(layout, visibleWorkspaceKeys),
    [layout, visibleWorkspaceKeys],
  );
  const focusedWorkspace = useMemo(() => {
    if (!visibleLayout?.focusedPaneId) return null;
    const pane = findCockpitPane(visibleLayout.root, visibleLayout.focusedPaneId);
    const workspaceKey = pane ? getCockpitPaneWorkspaceKey(pane) : null;
    return workspaceKey ? (workspaceEntriesByKey.get(workspaceKey) ?? null) : null;
  }, [visibleLayout, workspaceEntriesByKey]);
  useEffect(() => {
    if (!isRouteFocused || !focusedWorkspace) return;
    rememberLastWorkspaceSelection({
      serverId: focusedWorkspace.serverId,
      workspaceId: focusedWorkspace.workspaceId,
    });
  }, [focusedWorkspace, isRouteFocused]);
  const handleReturnToWorkspace = useCallback(() => {
    if (focusedWorkspace) {
      navigateToCockpitWorkspace(focusedWorkspace);
      return;
    }
    if (!navigateToLastWorkspace()) {
      router.replace(buildOpenProjectRoute());
    }
  }, [focusedWorkspace]);
  const handleAddPane = useCallback(() => addEmptyPane(), [addEmptyPane]);
  const handleSplitPane = useCallback(
    (paneId: string, position: "right" | "down") => splitPane(paneId, position),
    [splitPane],
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
    [handleAddPane, handleReturnToWorkspace, splitRightKeys, t],
  );

  const handlePaneKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id === "workspace.pane.split.right") {
        if (visibleLayout?.focusedPaneId) {
          splitPane(visibleLayout.focusedPaneId, "right");
        } else {
          addEmptyPane();
        }
        return true;
      }
      if (action.id === "workspace.pane.split.down") {
        if (visibleLayout?.focusedPaneId) {
          splitPane(visibleLayout.focusedPaneId, "down");
        } else {
          addEmptyPane();
        }
        return true;
      }

      let direction: "left" | "right" | "up" | "down" | null = null;
      if (action.id === "workspace.pane.focus.left") direction = "left";
      if (action.id === "workspace.pane.focus.right") direction = "right";
      if (action.id === "workspace.pane.focus.up") direction = "up";
      if (action.id === "workspace.pane.focus.down") direction = "down";
      if (!direction || !visibleLayout?.focusedPaneId) return false;
      const adjacentPaneId = findAdjacentPane(
        visibleLayout.root,
        visibleLayout.focusedPaneId,
        direction,
      );
      if (adjacentPaneId) focusPane(adjacentPaneId);
      return true;
    },
    [addEmptyPane, focusPane, splitPane, visibleLayout],
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
            workspaceEntriesByKey={workspaceEntriesByKey}
            projectNamesByWorkspace={projectNamesByWorkspace}
            workspaceTitleSource={workspaceTitleSource}
            onFocusPane={focusPane}
            onSplitPane={handleSplitPane}
            onClosePane={closePane}
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen} testID="cockpit-screen">
      <ScreenHeader left={headerLeft} right={headerRight} />
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
  onFocusPane,
  onSplitPane,
  onClosePane,
}: {
  node: SplitNode;
  focusedPaneId: string | null;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByWorkspace: ReadonlyMap<string, string>;
  workspaceTitleSource: "title" | "branch";
  onFocusPane: (paneId: string) => void;
  onSplitPane: (paneId: string, position: "right" | "down") => void;
  onClosePane: (paneId: string) => void;
}): ReactElement | null {
  if (node.kind === "pane") {
    const workspaceKey = getCockpitPaneWorkspaceKey(node.pane);
    if (!workspaceKey) {
      return (
        <CockpitEmptyPane
          pane={node.pane}
          isFocused={node.pane.id === focusedPaneId}
          onFocus={onFocusPane}
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
        title={resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource })}
        isFocused={node.pane.id === focusedPaneId}
        onFocus={onFocusPane}
        onSplit={onSplitPane}
        onClose={onClosePane}
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
            onFocusPane={onFocusPane}
            onSplitPane={onSplitPane}
            onClosePane={onClosePane}
          />
        </View>
      ))}
    </View>
  );
}

function CockpitWorkspaceCard({
  pane,
  workspace,
  projectName,
  title,
  isFocused,
  onFocus,
  onSplit,
  onClose,
}: {
  pane: SplitPane;
  workspace: SidebarWorkspaceEntry;
  projectName: string | null;
  title: string;
  isFocused: boolean;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, position: "right" | "down") => void;
  onClose: (paneId: string) => void;
}) {
  const { t } = useTranslation();
  const [isArchiving, setIsArchiving] = useState(false);
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
  const handlePress = useCallback(() => {
    handleFocus();
    navigateToCockpitWorkspace(workspace);
  }, [handleFocus, workspace]);
  const handleArchive = useCallback(() => {
    if (isArchiving) return;
    handleFocus();
    archiveController.archive();
  }, [archiveController, handleFocus, isArchiving]);

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

  const accessibilityLabel = `${title}, ${t(STATUS_LABEL_KEYS[workspace.statusBucket])}`;
  const cardStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      cockpitCardStyle(state, isFocused),
    [isFocused],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onFocus={handleFocus}
      onPressIn={handleFocus}
      onPress={handlePress}
      style={cardStyle}
      testID={`cockpit-workspace-card-${workspace.workspaceKey}`}
    >
      <View style={styles.cardHeader}>
        <CockpitStatusIndicator bucket={workspace.statusBucket} />
        <View style={styles.cardTitleGroup}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.statusText} numberOfLines={1}>
            {t(STATUS_LABEL_KEYS[workspace.statusBucket])}
          </Text>
        </View>
        {workspace.diffStat ? (
          <DiffStat
            additions={workspace.diffStat.additions}
            deletions={workspace.diffStat.deletions}
          />
        ) : null}
        <CockpitPaneActions
          paneId={pane.id}
          closeLabel={t("sidebar.workspace.actions.archiveWorkspace")}
          closeDisabled={isArchiving}
          onFocus={onFocus}
          onSplit={onSplit}
          onClose={handleArchive}
        />
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

      <ActivityBlock
        label={t("cockpit.labels.latestReply")}
        text={workspace.latestReply}
        emptyText={
          workspace.latestPrompt
            ? t("cockpit.empty.waitingForReply")
            : t("cockpit.empty.noActivity")
        }
        emphasized={workspace.activityPreviewKind === "reply"}
        lines={3}
      />
      {workspace.latestPrompt ? (
        <ActivityBlock
          label={t("cockpit.labels.prompt")}
          text={workspace.latestPrompt}
          emptyText={t("cockpit.empty.noPrompt")}
          emphasized={workspace.activityPreviewKind === "prompt"}
          lines={2}
        />
      ) : null}
    </Pressable>
  );
}

function CockpitEmptyPane({
  pane,
  isFocused,
  onFocus,
  onSplit,
  onClose,
}: {
  pane: SplitPane;
  isFocused: boolean;
  onFocus: (paneId: string) => void;
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
          onFocus={onFocus}
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
    </View>
  );
}

function CockpitPaneActions({
  paneId,
  closeLabel,
  closeDisabled = false,
  onFocus,
  onSplit,
  onClose,
}: {
  paneId: string;
  closeLabel: string;
  closeDisabled?: boolean;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, position: "right" | "down") => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const closeKeys = useShortcutKeys("workspace-pane-close");
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

  return (
    <ToolbarControls style={styles.paneActions}>
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
  );
}

function CockpitStatusIndicator({ bucket }: { bucket: SidebarWorkspaceEntry["statusBucket"] }) {
  if (bucket === "running") {
    return (
      <View style={styles.statusRingFrame} testID="cockpit-running-spinner">
        <StatusRing />
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

function cockpitCardStyle(
  state: PressableStateCallbackType & { hovered?: boolean },
  focused: boolean,
): ViewStyle[] {
  const result: ViewStyle[] = [styles.card];
  if (state.hovered) result.push(styles.cardHovered);
  if (state.pressed) result.push(styles.cardPressed);
  if (focused) result.push(styles.cardFocused);
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
  },
  splitGroup: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    gap: COCKPIT_CARD_GAP,
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
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    userSelect: "none",
  },
  cardFocused: {
    borderColor: theme.colors.accent,
  },
  cardHovered: {
    borderColor: theme.colors.surface3,
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
  cardTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 20,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 17,
  },
  statusDot: {
    width: 8,
    height: 8,
    marginTop: 6,
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
    width: STATUS_RING_FRAME_SIZE,
    height: STATUS_RING_FRAME_SIZE,
    marginTop: 3,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  paneActions: {
    flexShrink: 0,
    gap: 0,
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
