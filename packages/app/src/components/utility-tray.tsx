import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { List, SquareTerminal, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { TerminalPane } from "@/components/terminal-pane";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useUtilityTrayStore, type UtilityTrayTarget } from "@/stores/utility-tray-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useWorkspaceScriptEntries, type WorkspaceScriptEntry } from "@/stores/session-store-hooks";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { createWorkspaceFileTabTarget, type WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { WindowChromeRegion, WindowChromeSafeArea } from "@/utils/desktop-window";
import type { Theme } from "@/styles/theme";

const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedList = withUnistyles(List);
const ThemedX = withUnistyles(X);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function targetMatchesEntry(target: UtilityTrayTarget, entry: WorkspaceScriptEntry): boolean {
  return (
    target.serverId === entry.serverId &&
    target.workspaceId === entry.workspaceId &&
    target.scriptName === entry.script.scriptName
  );
}

export function UtilityTrayTrigger() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const isOpen = useUtilityTrayStore((state) => state.isOpen);
  const toggle = useUtilityTrayStore((state) => state.toggle);
  if (isCompact) return null;
  return (
    <ToolbarButton
      label={t("workspace.scripts.accessibility.trigger")}
      selected={isOpen}
      testID="utility-tray-trigger"
      onPress={toggle}
    >
      <ThemedSquareTerminal size={15} uniProps={mutedIconMapping} />
    </ToolbarButton>
  );
}

export function UtilityTrayTriggerHost() {
  const isCompact = useIsCompactFormFactor();
  if (isCompact) return null;
  return (
    <WindowChromeRegion corners="top-right">
      <WindowChromeSafeArea placement="inline" pointerEvents="box-none" style={styles.triggerHost}>
        <View style={styles.triggerPadding}>
          <UtilityTrayTrigger />
        </View>
      </WindowChromeSafeArea>
    </WindowChromeRegion>
  );
}

export function UtilityTrayHost() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const entries = useWorkspaceScriptEntries(serverIds);
  const isOpen = useUtilityTrayStore((state) => state.isOpen);
  const target = useUtilityTrayStore((state) => state.target);
  const close = useUtilityTrayStore((state) => state.close);
  const selectTarget = useUtilityTrayStore((state) => state.selectTarget);
  const selectedEntry = useMemo(
    () => (target ? (entries.find((entry) => targetMatchesEntry(target, entry)) ?? null) : null),
    [entries, target],
  );
  const client = useHostRuntimeClient(selectedEntry?.serverId ?? "");
  const [showPicker, setShowPicker] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setShowPicker(target === null || selectedEntry === null);
  }, [isOpen, selectedEntry, target]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen]);

  const handleSelect = useCallback(
    (entry: WorkspaceScriptEntry) => {
      selectTarget({
        serverId: entry.serverId,
        workspaceId: entry.workspaceId,
        scriptName: entry.script.scriptName,
      });
      setShowPicker(false);
      setStartError(null);
    },
    [selectTarget],
  );

  const handleStart = useCallback(async () => {
    if (!client || !selectedEntry || isStarting) return;
    setIsStarting(true);
    setStartError(null);
    try {
      const result = await client.startWorkspaceScript(
        selectedEntry.workspaceId,
        selectedEntry.script.scriptName,
      );
      if (result.error) throw new Error(result.error);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStarting(false);
    }
  }, [client, isStarting, selectedEntry]);
  const handleStartPress = useCallback(() => {
    void handleStart();
  }, [handleStart]);
  const handleTogglePicker = useCallback(() => {
    setShowPicker((current) => !current);
  }, []);

  const handleOpenFileExplorer = useCallback(() => {
    if (!selectedEntry) return;
    close();
    navigateToWorkspace({
      serverId: selectedEntry.serverId,
      workspaceId: selectedEntry.workspaceId,
    });
    useWorkspaceLayoutStore
      .getState()
      .showExplorerSidebar(`${selectedEntry.serverId}:${selectedEntry.workspaceId}`);
  }, [close, selectedEntry]);

  const handleOpenWorkspaceFile = useCallback(
    (request: WorkspaceFileOpenRequest) => {
      if (!selectedEntry) return;
      close();
      navigateToWorkspace({
        serverId: selectedEntry.serverId,
        workspaceId: selectedEntry.workspaceId,
      });
      useWorkspaceLayoutStore.getState().openTab({
        workspaceKey: `${selectedEntry.serverId}:${selectedEntry.workspaceId}`,
        target: createWorkspaceFileTabTarget(request.location),
        intent: "reveal",
      });
    },
    [close, selectedEntry],
  );

  if (isCompact || !isOpen) return null;

  const panelFrame = {
    width: Math.min(760, Math.max(420, viewportWidth - 32)),
    height: Math.min(520, Math.max(300, viewportHeight - HEADER_INNER_HEIGHT - 32)),
  };
  const terminalId = selectedEntry?.script.terminalId ?? null;
  const isSelectedScriptRunning = selectedEntry?.script.lifecycle === "running";
  const selectedTitle = selectedEntry
    ? `${selectedEntry.script.scriptName} · ${selectedEntry.workspaceName}`
    : t("workspace.scripts.title");
  let trayContent: ReactNode;
  if (showPicker || !selectedEntry) {
    trayContent = <ScriptPicker entries={entries} onSelect={handleSelect} />;
  } else if (isSelectedScriptRunning && terminalId) {
    trayContent = (
      <TerminalPane
        serverId={selectedEntry.serverId}
        cwd={selectedEntry.workspaceDirectory}
        terminalId={terminalId}
        isWorkspaceFocused
        isPaneFocused
        onOpenFileExplorer={handleOpenFileExplorer}
        onOpenWorkspaceFile={handleOpenWorkspaceFile}
      />
    );
  } else if (isSelectedScriptRunning) {
    trayContent = (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{t("workspace.setup.status.running")}</Text>
      </View>
    );
  } else {
    trayContent = (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{selectedTitle}</Text>
        {startError ? <Text style={styles.errorText}>{startError}</Text> : null}
        <Button
          size="sm"
          loading={isStarting}
          testID="utility-tray-start"
          onPress={handleStartPress}
        >
          {t("workspace.scripts.actions.run")}
        </Button>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.overlay} testID="utility-tray-overlay">
      <View style={[styles.panel, panelFrame]}>
        <View style={styles.header}>
          <ThemedSquareTerminal size={15} uniProps={mutedIconMapping} />
          <Text style={styles.title} numberOfLines={1}>
            {showPicker ? t("workspace.scripts.title") : selectedTitle}
          </Text>
          {selectedEntry ? (
            <ToolbarButton
              label={t("workspace.scripts.accessibility.trigger")}
              selected={showPicker}
              testID="utility-tray-picker-toggle"
              onPress={handleTogglePicker}
            >
              <ThemedList size={15} uniProps={mutedIconMapping} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            label={t("common.actions.close")}
            testID="utility-tray-close"
            onPress={close}
          >
            <ThemedX size={15} uniProps={mutedIconMapping} />
          </ToolbarButton>
        </View>
        <View style={styles.content}>{trayContent}</View>
      </View>
    </View>
  );
}

function ScriptPicker({
  entries,
  onSelect,
}: {
  entries: WorkspaceScriptEntry[];
  onSelect: (entry: WorkspaceScriptEntry) => void;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{t("settings.project.scripts.empty")}</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.scriptList}>
      {entries.map((entry) => (
        <ScriptPickerRow
          key={`${entry.serverId}:${entry.workspaceId}:${entry.script.scriptName}`}
          entry={entry}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
}

function scriptRowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.scriptRow, (Boolean(hovered) || pressed) && styles.scriptRowHovered];
}

function ScriptPickerRow({
  entry,
  onSelect,
}: {
  entry: WorkspaceScriptEntry;
  onSelect: (entry: WorkspaceScriptEntry) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);
  const key = `${entry.serverId}:${entry.workspaceId}:${entry.script.scriptName}`;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={scriptRowStyle}
      testID={`utility-tray-script-${key}`}
    >
      <View
        style={[
          styles.statusDot,
          entry.script.lifecycle === "running" ? styles.statusDotRunning : styles.statusDotStopped,
        ]}
      />
      <View style={styles.scriptLabels}>
        <Text style={styles.scriptName} numberOfLines={1}>
          {entry.script.scriptName}
        </Text>
        <Text style={styles.scriptMeta} numberOfLines={1}>
          {entry.projectName} · {entry.workspaceName}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  triggerHost: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 500,
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
  },
  triggerPadding: {
    paddingRight: theme.spacing[3],
  },
  overlay: {
    position: "absolute",
    inset: 0,
    zIndex: 400,
    alignItems: "flex-end",
    paddingTop: HEADER_INNER_HEIGHT + theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  panel: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.35)",
  },
  header: {
    height: 38,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  scriptList: {
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  scriptRow: {
    minHeight: 52,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  scriptRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  statusDotRunning: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  statusDotStopped: {
    backgroundColor: theme.colors.border,
  },
  scriptLabels: {
    flex: 1,
    minWidth: 0,
  },
  scriptName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  scriptMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
