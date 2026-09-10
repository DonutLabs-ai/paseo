import React, { useMemo } from "react";
import { Activity, Check, CircleAlert, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

const STATUS_ICON_SIZE = 13;
const ThemedActivity = withUnistyles(Activity);
const ThemedCheck = withUnistyles(Check);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedX = withUnistyles(X);

const dangerIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const runningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotRunning });
const successIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const warningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

type VisibleStatusBucket = Exclude<SidebarStateBucket, "done">;

interface StatusFlagPresentation {
  bucket: VisibleStatusBucket;
  labelKey:
    | "cockpit.status.needsInput"
    | "cockpit.status.failed"
    | "cockpit.status.running"
    | "cockpit.status.attention";
  variant: StatusBadgeVariant;
}

export function getSidebarWorkspaceStatusFlagPresentation(
  bucket: SidebarStateBucket,
): StatusFlagPresentation | null {
  switch (bucket) {
    case "needs_input":
      return { bucket, labelKey: "cockpit.status.needsInput", variant: "warning" };
    case "failed":
      return { bucket, labelKey: "cockpit.status.failed", variant: "error" };
    case "running":
      return { bucket, labelKey: "cockpit.status.running", variant: "info" };
    case "attention":
      return { bucket, labelKey: "cockpit.status.attention", variant: "success" };
    case "done":
      return null;
  }
}

export function SidebarWorkspaceStatusFlag({
  bucket,
  loading,
}: {
  bucket: SidebarStateBucket;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const presentation = loading ? null : getSidebarWorkspaceStatusFlagPresentation(bucket);
  const statusBucket = presentation?.bucket;
  const leading = useMemo(
    () => (statusBucket ? <StatusFlagIcon bucket={statusBucket} /> : null),
    [statusBucket],
  );

  if (!presentation) return null;

  const label = t(presentation.labelKey);

  return (
    <StatusBadge
      label={label}
      leading={leading}
      size="md"
      testID={`sidebar-workspace-status-${bucket}`}
      variant={presentation.variant}
    />
  );
}

function StatusFlagIcon({ bucket }: { bucket: VisibleStatusBucket }) {
  switch (bucket) {
    case "needs_input":
      return (
        <ThemedCircleAlert
          size={STATUS_ICON_SIZE}
          strokeWidth={2.5}
          uniProps={warningIconColorMapping}
        />
      );
    case "failed":
      return (
        <ThemedX size={STATUS_ICON_SIZE} strokeWidth={2.5} uniProps={dangerIconColorMapping} />
      );
    case "running":
      return (
        <ThemedActivity
          size={STATUS_ICON_SIZE}
          strokeWidth={2.5}
          uniProps={runningIconColorMapping}
        />
      );
    case "attention":
      return (
        <ThemedCheck size={STATUS_ICON_SIZE} strokeWidth={2.5} uniProps={successIconColorMapping} />
      );
  }
}
