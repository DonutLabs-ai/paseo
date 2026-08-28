import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { GitBranch, GitPullRequest } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { router } from "expo-router";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { DiffStat } from "@/components/diff-stat";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SidebarModelProvider, useSidebarModel } from "@/components/sidebar/sidebar-model";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import {
  navigateToLastWorkspace,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { CockpitToggleButton } from "./cockpit-toggle-button";
import {
  COCKPIT_CARD_GAP,
  COCKPIT_HORIZONTAL_PADDING,
  resolveCockpitCardWidth,
} from "./cockpit-layout";

interface CockpitSection {
  project: SidebarProjectEntry;
  workspaces: SidebarWorkspaceEntry[];
}

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

function buildCockpitSections(input: {
  projects: readonly SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): CockpitSection[] {
  return input.projects.flatMap((project) => {
    const workspaces = project.workspaces.flatMap((placement) => {
      const workspace = input.workspaceEntriesByKey.get(placement.workspaceKey);
      return workspace ? [workspace] : [];
    });
    return workspaces.length > 0 ? [{ project, workspaces }] : [];
  });
}

export function CockpitScreen() {
  return (
    <SidebarModelProvider active>
      <CockpitScreenContent />
    </SidebarModelProvider>
  );
}

function CockpitScreenContent() {
  const { t } = useTranslation();
  const { projects, workspaceEntriesByKey, isInitialLoad } = useSidebarModel();
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const [contentWidth, setContentWidth] = useState(0);
  const sections = useMemo(
    () => buildCockpitSections({ projects, workspaceEntriesByKey }),
    [projects, workspaceEntriesByKey],
  );
  const cardWidth = resolveCockpitCardWidth(
    Math.max(0, contentWidth - COCKPIT_HORIZONTAL_PADDING * 2),
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContentWidth(event.nativeEvent.layout.width);
  }, []);
  const handleReturnToWorkspace = useCallback(() => {
    if (!navigateToLastWorkspace()) {
      router.replace(buildOpenProjectRoute());
    }
  }, []);
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
    () => <CockpitToggleButton active onPress={handleReturnToWorkspace} />,
    [handleReturnToWorkspace],
  );

  let content = (
    <View style={styles.centerState}>
      <LoadingSpinner color={styles.spinner.color} />
    </View>
  );
  if (!isInitialLoad && sections.length === 0) {
    content = (
      <View style={styles.centerState}>
        <Text style={styles.emptyTitle}>{t("cockpit.empty.title")}</Text>
        <Text style={styles.emptyDescription}>{t("cockpit.empty.description")}</Text>
      </View>
    );
  } else if (!isInitialLoad) {
    content = (
      <View style={styles.contentFrame} onLayout={handleLayout}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {sections.map((section) => (
            <View key={section.project.viewKey} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.project.projectName}</Text>
              <View style={styles.cardGrid}>
                {section.workspaces.map((workspace) => (
                  <CockpitWorkspaceCard
                    key={workspace.workspaceKey}
                    workspace={workspace}
                    title={resolveSidebarWorkspacePrimaryLabel({
                      workspace,
                      workspaceTitleSource,
                    })}
                    width={cardWidth}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="cockpit-screen">
      <ScreenHeader left={headerLeft} right={headerRight} />
      {content}
    </View>
  );
}

function CockpitWorkspaceCard({
  workspace,
  title,
  width,
}: {
  workspace: SidebarWorkspaceEntry;
  title: string;
  width: number | null;
}) {
  const { t } = useTranslation();
  const cardSizeStyle = useMemo<ViewStyle>(
    () => inlineUnistylesStyle(width === null ? { width: "100%" } : { width }),
    [width],
  );
  const accessibilityLabel = `${title}, ${t(STATUS_LABEL_KEYS[workspace.statusBucket])}`;
  const handlePress = useCallback(() => {
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
  }, [workspace.agentId, workspace.serverId, workspace.workspaceId]);
  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      cockpitCardStyle(state, cardSizeStyle),
    [cardSizeStyle],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      style={pressableStyle}
      testID={`cockpit-workspace-card-${workspace.workspaceKey}`}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.statusDot, resolveStatusDotStyle(workspace.statusBucket)]} />
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
      </View>

      <View style={styles.metaRow}>
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
  size: ViewStyle,
): ViewStyle[] {
  const result = [styles.card, size];
  if (state.hovered) result.push(styles.cardHovered);
  if (state.pressed) result.push(styles.cardPressed);
  return result;
}

function resolveStatusDotStyle(bucket: SidebarWorkspaceEntry["statusBucket"]): ViewStyle {
  if (bucket === "needs_input") return styles.statusDotNeedsInput;
  if (bucket === "failed") return styles.statusDotFailed;
  if (bucket === "running") return styles.statusDotRunning;
  if (bucket === "attention") return styles.statusDotAttention;
  return styles.statusDotDone;
}

const ThemedGitBranch = withUnistyles(GitBranch, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedGitPullRequest = withUnistyles(GitPullRequest, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  contentFrame: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: COCKPIT_HORIZONTAL_PADDING,
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[6],
  },
  section: {
    gap: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: COCKPIT_CARD_GAP,
  },
  card: {
    minHeight: 210,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    userSelect: "none",
  },
  cardHovered: {
    borderColor: theme.colors.borderAccent,
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
  statusDotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  statusDotAttention: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  statusDotDone: {
    backgroundColor: theme.colors.border,
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
  metaRow: {
    minHeight: 18,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
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
