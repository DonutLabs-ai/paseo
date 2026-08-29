import { router, usePathname } from "expo-router";
import {
  CalendarClock,
  History,
  PanelLeft,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ActivityBarButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  selected: boolean;
  testID: string;
}

function ActivityBarButton({
  icon: Icon,
  label,
  onPress,
  selected,
  testID,
}: ActivityBarButtonProps) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const buttonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (hovered || pressed) && styles.buttonHovered,
    ],
    [],
  );
  const renderChildren = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => {
      const emphasized = selected || hovered || pressed;
      return (
        <>
          {selected ? <View pointerEvents="none" style={styles.activeIndicator} /> : null}
          <ThemedIcon
            size={ICON_SIZE.lg}
            strokeWidth={selected ? 2 : 1.75}
            uniProps={emphasized ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        </>
      );
    },
    [ThemedIcon, selected],
  );

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          onPress={onPress}
          style={buttonStyle}
          testID={testID}
        >
          {renderChildren}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="right" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarActivityBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);

  const isNewWorkspaceActive = pathname === "/new";
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const isSettingsActive = pathname.startsWith("/settings");
  const isWorkspacesActive =
    !isNewWorkspaceActive && !isSessionsActive && !isSchedulesActive && !isSettingsActive;

  const handleWorkspaces = useCallback(() => {
    openDesktopAgentList();
  }, [openDesktopAgentList]);
  const handleNewWorkspace = useCallback(() => {
    openDesktopAgentList();
    router.push(buildNewWorkspaceRoute());
  }, [openDesktopAgentList]);
  const handleSessions = useCallback(() => {
    openDesktopAgentList();
    router.push(buildSessionsRoute());
  }, [openDesktopAgentList]);
  const handleSchedules = useCallback(() => {
    openDesktopAgentList();
    router.push(buildSchedulesRoute());
  }, [openDesktopAgentList]);
  const handleSettings = useCallback(() => {
    openDesktopAgentList();
    router.push(buildSettingsRoute());
  }, [openDesktopAgentList]);

  const rootStyle = useMemo(() => [styles.root, { paddingTop: insets.top }], [insets.top]);

  return (
    <View style={rootStyle} testID="sidebar-activity-bar">
      <View style={styles.chromeSpacer}>
        <TitlebarDragRegion />
      </View>
      <View style={styles.primaryItems}>
        <ActivityBarButton
          icon={PanelLeft}
          label="Workspaces"
          onPress={handleWorkspaces}
          selected={isWorkspacesActive}
          testID="sidebar-activity-workspaces"
        />
        <ActivityBarButton
          icon={Plus}
          label="New workspace"
          onPress={handleNewWorkspace}
          selected={isNewWorkspaceActive}
          testID="sidebar-activity-new-workspace"
        />
        <ActivityBarButton
          icon={History}
          label="History"
          onPress={handleSessions}
          selected={isSessionsActive}
          testID="sidebar-activity-sessions"
        />
        <ActivityBarButton
          icon={CalendarClock}
          label="Schedules"
          onPress={handleSchedules}
          selected={isSchedulesActive}
          testID="sidebar-activity-schedules"
        />
      </View>
      <View style={styles.secondaryItems}>
        <ActivityBarButton
          icon={Settings}
          label="Settings"
          onPress={handleSettings}
          selected={isSettingsActive}
          testID="sidebar-activity-settings"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    width: 48,
    minWidth: 48,
    flexShrink: 0,
    alignSelf: "stretch",
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  chromeSpacer: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
  },
  primaryItems: {
    alignItems: "center",
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
  secondaryItems: {
    marginTop: "auto",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  button: {
    position: "relative",
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  activeIndicator: {
    position: "absolute",
    left: -4,
    top: 8,
    bottom: 8,
    width: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accentForeground,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
  },
}));
