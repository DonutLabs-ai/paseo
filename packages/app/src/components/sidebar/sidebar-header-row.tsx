import {
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { Shortcut } from "@/components/ui/shortcut";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ShortcutKey } from "@/utils/format-shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const loadingSpinnerColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

type SidebarHeaderRowVariant = "header" | "compact" | "inline";

export type SidebarRowIcon = ComponentType<{ size: number; color: string }>;

interface SidebarHeaderRowProps {
  icon: SidebarRowIcon | null;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  /**
   * "header" (default): a sidebar-height row with its own bottom separator —
   * the lone header at the top of a sidebar (settings "Back to workspace").
   * "compact": a row with no separator, for entries that
   * sit in a header group whose wrapper owns the single divider.
   * "inline": a full-width row with no inset, for a row inside a padded container such as the
   * sidebar footer.
   */
  variant?: SidebarHeaderRowVariant;
  /** Shown in the right slot while the row is hovered, when `trailing` is not set. */
  shortcutKeys?: ShortcutKey[][] | null;
  /**
   * The right slot. A sibling of the row's button, never inside it (web cannot nest buttons). A
   * press on the slot presses the row; a button inside it presses on its own.
   */
  trailing?: ReactNode;
  rowRef?: Ref<View>;
}

export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  disabled = false,
  loading = false,
  variant = "header",
  shortcutKeys = null,
  trailing,
  rowRef,
}: SidebarHeaderRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const isHighlighted = !disabled && (isHovered || isActive);
  const accessibilityState = useMemo(
    () => ({ selected: isActive, disabled, busy: loading }),
    [disabled, isActive, loading],
  );
  let right = trailing ?? null;
  if (right === null && shortcutKeys && isHovered && !disabled) {
    right = <Shortcut chord={shortcutKeys} />;
  }

  return (
    <View ref={rowRef} collapsable={false} style={getContainerStyle(variant)}>
      <View
        style={[styles.row, isHighlighted && styles.rowHighlighted, disabled && styles.rowDisabled]}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <Pressable
          onPress={onPress}
          testID={testID}
          nativeID={nativeID}
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={accessibilityState}
          aria-selected={isActive}
          disabled={disabled}
          style={variant === "inline" ? styles.buttonInline : styles.button}
        >
          <SidebarHeaderRowIcon
            icon={Icon}
            isHighlighted={isHighlighted}
            loading={loading}
            variant={variant}
          />
          <Text style={[styles.label, isHighlighted && styles.labelHighlighted]} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
        {right === null ? null : (
          <Pressable
            onPress={onPress}
            accessible={false}
            focusable={false}
            disabled={disabled}
            style={styles.trailing}
          >
            {right}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SidebarHeaderRowIcon({
  icon: Icon,
  isHighlighted,
  loading,
  variant,
}: {
  icon: SidebarRowIcon | null;
  isHighlighted: boolean;
  loading: boolean;
  variant: SidebarHeaderRowVariant;
}) {
  const ThemedIcon = useMemo(() => (Icon ? withUnistyles(Icon) : null), [Icon]);
  if (loading) {
    return <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={loadingSpinnerColorMapping} />;
  }
  if (ThemedIcon) {
    return (
      <ThemedIcon
        size={variant === "header" ? ICON_SIZE.md : ICON_SIZE.sm}
        uniProps={isHighlighted ? foregroundColorMapping : foregroundMutedColorMapping}
      />
    );
  }
  return <View style={variant === "header" ? styles.iconSpacer : styles.iconSpacerCompact} />;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    userSelect: "none",
  },
  containerCompact: {
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  containerInline: {
    width: "100%",
    justifyContent: "center",
    userSelect: "none",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Same row geometry as the settings sidebar items. Shorter than the header
    // strip so the hover highlight clears the strip's bottom separator.
    minHeight: 28,
    borderRadius: theme.borderRadius.lg,
  },
  rowHighlighted: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowDisabled: {
    opacity: theme.opacity[50],
  },
  button: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    // Match the project rows' inner padding so the icons align on one vertical
    // edge with the list below.
    paddingHorizontal: theme.spacing[2],
  },
  // Footer rows put their icon on the footer's rail: where a 16px icon sits in a 28px button.
  buttonInline: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
  },
  iconSpacer: { width: ICON_SIZE.md, height: ICON_SIZE.md },
  iconSpacerCompact: { width: ICON_SIZE.sm, height: ICON_SIZE.sm },
  label: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    color: theme.colors.foreground,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingRight: theme.spacing[2],
  },
}));

function getContainerStyle(variant: SidebarHeaderRowVariant) {
  switch (variant) {
    case "header":
      return styles.container;
    case "compact":
      return styles.containerCompact;
    case "inline":
      return styles.containerInline;
  }
}
