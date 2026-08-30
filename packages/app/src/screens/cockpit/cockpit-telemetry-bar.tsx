import { useMemo } from "react";
import { ScrollView, Text, View, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderUsage, ProviderUsageWindow, ProviderUsageView } from "@/provider-usage/types";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { useHosts } from "@/runtime/host-runtime";
import { useHostSystemUsage, type HostSystemUsageView } from "./use-host-system-usage";

interface CodexWindowSummary {
  id: string;
  label: string;
  usedPct: number;
}

interface SystemUsageSummary {
  cpuCount: number;
  loadAverage1m: number;
  memoryUsedPct: number;
}

function resolveUsedPct(window: ProviderUsageWindow): number | null {
  if (window.usedPct != null) return window.usedPct;
  if (window.remainingPct != null) return 100 - window.remainingPct;
  return null;
}

function resolveCodexUsage(view: ProviderUsageView): ProviderUsage | null {
  if (view.kind !== "ready") return null;
  return view.payload.providers.find((provider) => provider.providerId === "codex") ?? null;
}

function summarizeCodexWindows(usage: ProviderUsage | null): CodexWindowSummary[] {
  if (!usage || usage.status !== "available") return [];
  return usage.windows.flatMap((window) => {
    if (window.id !== "session" && window.id !== "weekly") return [];
    const usedPct = resolveUsedPct(window);
    if (usedPct === null) return [];
    return [
      {
        id: window.id,
        label: window.id === "session" ? "5h" : "7d",
        usedPct: Math.max(0, Math.min(100, usedPct)),
      },
    ];
  });
}

function usageValueStyle(usedPct: number): TextStyle {
  if (usedPct >= 90) return styles.valueDanger;
  if (usedPct >= 70) return styles.valueWarning;
  return styles.value;
}

function summarizeSystemUsage(view: HostSystemUsageView): SystemUsageSummary | null {
  if (view.kind !== "ready") return null;
  return {
    cpuCount: view.usage.cpuCount,
    loadAverage1m: view.usage.loadAverage1m,
    memoryUsedPct: Math.round((view.usage.memoryUsedBytes / view.usage.memoryTotalBytes) * 100),
  };
}

function HostTelemetryItem({ serverId, label }: { serverId: string; label: string }) {
  const { t } = useTranslation();
  const { view: providerUsage } = useProviderUsage(serverId);
  const systemUsage = useHostSystemUsage(serverId);
  const codexWindows = useMemo(
    () => summarizeCodexWindows(resolveCodexUsage(providerUsage)),
    [providerUsage],
  );
  const systemSummary = summarizeSystemUsage(systemUsage);
  const hasUsage = codexWindows.length > 0;
  const isLoading = providerUsage.kind === "loading" || systemUsage.kind === "loading";

  return (
    <View style={styles.hostItem} testID={`cockpit-host-telemetry-${serverId}`}>
      <Text style={styles.hostLabel} numberOfLines={1}>
        {label}
      </Text>
      {hasUsage ? (
        <View style={styles.metricGroup}>
          <Text style={styles.metricLabel}>Codex</Text>
          {codexWindows.map((window) => (
            <Text key={window.id} style={usageValueStyle(window.usedPct)}>
              {`${window.label} ${Math.round(window.usedPct)}%`}
            </Text>
          ))}
        </View>
      ) : null}
      {systemSummary ? (
        <View style={styles.metricGroup}>
          <Text style={styles.metricLabel}>{t("cockpit.telemetry.load")}</Text>
          <Text style={styles.value}>
            {`${systemSummary.loadAverage1m.toFixed(1)}/${systemSummary.cpuCount}`}
          </Text>
          <Text style={styles.metricLabel}>{t("cockpit.telemetry.memory")}</Text>
          <Text style={styles.value}>{`${systemSummary.memoryUsedPct}%`}</Text>
        </View>
      ) : null}
      {!hasUsage && !systemSummary ? (
        <Text style={styles.pending}>
          {isLoading ? t("cockpit.telemetry.loading") : t("cockpit.telemetry.unavailable")}
        </Text>
      ) : null}
    </View>
  );
}

export function CockpitTelemetryBar({ serverIds }: { serverIds: readonly string[] }) {
  const hosts = useHosts();
  const labelsByServerId = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label] as const)),
    [hosts],
  );
  if (serverIds.length === 0) return null;

  return (
    <ScrollView
      horizontal
      style={styles.frame}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
      testID="cockpit-telemetry-bar"
    >
      {serverIds.map((serverId) => (
        <HostTelemetryItem
          key={serverId}
          serverId={serverId}
          label={labelsByServerId.get(serverId) ?? serverId}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    flexGrow: 0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  content: {
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
    alignItems: "center",
  },
  hostItem: {
    minHeight: 20,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  hostLabel: {
    maxWidth: 140,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  metricGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  metricLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  valueWarning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  valueDanger: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  pending: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
}));
