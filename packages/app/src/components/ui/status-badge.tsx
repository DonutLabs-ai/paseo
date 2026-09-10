import React, { useMemo, type ReactNode } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type StatusBadgeVariant = "success" | "warning" | "error" | "info" | "muted";
export type StatusBadgeSize = "sm" | "md";

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  size?: StatusBadgeSize;
  leading?: ReactNode;
  testID?: string;
}

export function StatusBadge({
  label,
  variant = "muted",
  size = "sm",
  leading,
  testID,
}: StatusBadgeProps) {
  const textStyle = useMemo(
    () => [
      styles.pillText,
      size === "md" && styles.pillTextMedium,
      variant === "success" && styles.pillTextSuccess,
      variant === "warning" && styles.pillTextWarning,
      variant === "error" && styles.pillTextError,
      variant === "info" && styles.pillTextInfo,
    ],
    [size, variant],
  );

  return (
    <View
      accessibilityLabel={label}
      role="status"
      style={[styles.pill, size === "md" && styles.pillMedium]}
      testID={testID}
    >
      {leading}
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  pillMedium: {
    minHeight: 22,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  pillTextMedium: {
    fontSize: theme.fontSize.base,
    lineHeight: 16,
  },
  pillTextSuccess: {
    color: theme.colors.statusSuccess,
  },
  pillTextWarning: {
    color: theme.colors.statusWarning,
  },
  pillTextError: {
    color: theme.colors.statusDanger,
  },
  pillTextInfo: {
    color: theme.colors.statusDotRunning,
  },
}));
