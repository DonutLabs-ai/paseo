import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildCockpitAttentionEntries } from "./cockpit-attention-model";

function AttentionLeading({ bucket }: { bucket: SidebarWorkspaceEntry["statusBucket"] }) {
  const dotStyle = useMemo(
    () => [
      styles.statusDot,
      bucket === "needs_input" ? styles.statusDotNeedsInput : null,
      bucket === "failed" ? styles.statusDotFailed : null,
      bucket === "attention" ? styles.statusDotAttention : null,
    ],
    [bucket],
  );
  return <View style={dotStyle} />;
}

function attentionStatusKey(
  bucket: SidebarWorkspaceEntry["statusBucket"],
): "cockpit.status.needsInput" | "cockpit.status.failed" | "cockpit.status.attention" {
  if (bucket === "needs_input") return "cockpit.status.needsInput";
  if (bucket === "failed") return "cockpit.status.failed";
  return "cockpit.status.attention";
}

function CockpitAttentionMenuItem({
  workspace,
  workspaceTitleSource,
  onSelect,
}: {
  workspace: SidebarWorkspaceEntry;
  workspaceTitleSource: "title" | "branch";
  onSelect: (workspace: SidebarWorkspaceEntry) => void;
}) {
  const { t } = useTranslation();
  const title = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  const status = t(attentionStatusKey(workspace.statusBucket));
  const description = workspace.latestReply
    ? `${status} · ${workspace.projectName} · ${workspace.latestReply}`
    : `${status} · ${workspace.projectName}`;
  const leading = useMemo(
    () => <AttentionLeading bucket={workspace.statusBucket} />,
    [workspace.statusBucket],
  );
  const handleSelect = useCallback(() => onSelect(workspace), [onSelect, workspace]);

  return (
    <DropdownMenuItem
      description={description}
      leading={leading}
      onSelect={handleSelect}
      testID={`cockpit-attention-${workspace.workspaceKey}`}
    >
      {title}
    </DropdownMenuItem>
  );
}

export function CockpitAttentionMenu({
  workspaces,
  snoozedAtByWorkspace,
  workspaceTitleSource,
  onSelect,
}: {
  workspaces: readonly SidebarWorkspaceEntry[];
  snoozedAtByWorkspace: Readonly<Record<string, string>>;
  workspaceTitleSource: "title" | "branch";
  onSelect: (workspace: SidebarWorkspaceEntry) => void;
}) {
  const { t } = useTranslation();
  const entries = useMemo(
    () => buildCockpitAttentionEntries({ workspaces, snoozedAtByWorkspace }),
    [snoozedAtByWorkspace, workspaces],
  );
  const label = t("cockpit.attention.trigger", { count: entries.length });

  return (
    <DropdownMenu compactMode="sheet">
      <ToolbarButton kind="menu" label={label} testID="cockpit-attention-trigger">
        <View style={styles.triggerIcon}>
          <ThemedBell size={15} />
          {entries.length > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{entries.length > 99 ? "99+" : entries.length}</Text>
            </View>
          ) : null}
        </View>
      </ToolbarButton>
      <DropdownMenuContent
        align="end"
        width={360}
        maxHeight={460}
        scrollable
        sheetTitle={t("cockpit.attention.title")}
        testID="cockpit-attention-menu"
      >
        <DropdownMenuLabel>{t("cockpit.attention.title")}</DropdownMenuLabel>
        {entries.length === 0 ? (
          <DropdownMenuHint>{t("cockpit.attention.empty")}</DropdownMenuHint>
        ) : (
          entries.map(({ workspace }) => (
            <CockpitAttentionMenuItem
              key={workspace.workspaceKey}
              workspace={workspace}
              workspaceTitleSource={workspaceTitleSource}
              onSelect={onSelect}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ThemedBell = withUnistyles(Bell, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  triggerIcon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -9,
    minWidth: 14,
    height: 14,
    paddingHorizontal: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.statusDanger,
  },
  badgeText: {
    color: theme.colors.surface0,
    fontSize: 9,
    lineHeight: 11,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
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
}));
