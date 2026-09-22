import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { WorkspaceReference, WorkspaceReferencesSnapshot } from "@getpaseo/protocol/messages";
import { Link2, RefreshCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { openExternalUrl } from "@/utils/open-external-url";

const ThemedLink2 = withUnistyles(Link2, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const referencesPanelPresentation = {
  label: (t) => t("panels.references.label"),
  subtitle: (t) => t("panels.references.subtitle"),
  tooltip: (t) => t("panels.references.tooltip"),
  icon: ThemedLink2,
} satisfies PanelPresentation;

function providerLabel(reference: WorkspaceReference): string {
  return reference.provider === "linear" ? "Linear" : "Slack";
}

function ReferenceCard({ reference }: { reference: WorkspaceReference }) {
  const open = useCallback(() => {
    void openExternalUrl(reference.url);
  }, [reference.url]);
  return (
    <Pressable onPress={open} style={styles.card} accessibilityRole="link">
      <View style={styles.cardHeader}>
        <Text style={styles.provider}>{providerLabel(reference)}</Text>
        <ThemedLink2 size={14} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {reference.title ?? reference.url}
      </Text>
      {reference.summary ? <Text style={styles.summary}>{reference.summary}</Text> : null}
      {reference.error ? <Text style={styles.error}>{reference.error}</Text> : null}
      {reference.fetchedAt ? (
        <Text style={styles.timestamp}>{new Date(reference.fetchedAt).toLocaleString()}</Text>
      ) : null}
    </Pressable>
  );
}

function ReferencesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "references", "ReferencesPanel requires references target");
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [snapshot, setSnapshot] = useState<WorkspaceReferencesSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (force: boolean) => {
      if (!client || !connected || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      const request = force
        ? client.refreshWorkspaceReferences(workspaceId)
        : client.getWorkspaceReferences(workspaceId);
      void request
        .then((result) => {
          setSnapshot({
            workspaceId: result.workspaceId,
            references: result.references,
            scannedAt: result.scannedAt,
          });
          return undefined;
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
        });
    },
    [client, connected, workspaceId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  if (!connected || !client) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.muted}>{t("panels.references.disconnected")}</Text>
      </View>
    );
  }

  if (loading && !snapshot) {
    return (
      <View style={styles.centerState}>
        <ThemedLoadingSpinner size="large" />
        <Text style={styles.muted}>{t("panels.references.scanning")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarText}>
          <Text style={styles.heading}>{t("panels.references.label")}</Text>
          <Text style={styles.muted}>
            {snapshot?.scannedAt
              ? t("panels.references.updated", {
                  timestamp: new Date(snapshot.scannedAt).toLocaleString(),
                })
              : t("panels.references.notScanned")}
          </Text>
        </View>
        <Button variant="ghost" size="sm" disabled={loading} onPress={refresh} leftIcon={RefreshCw}>
          {t("panels.references.refresh")}
        </Button>
      </View>
      {error ? <Text style={styles.pageError}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.list}>
        {snapshot?.references.length ? (
          snapshot.references.map((reference) => (
            <ReferenceCard key={reference.key} reference={reference} />
          ))
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("panels.references.emptyTitle")}</Text>
            <Text style={styles.muted}>{t("panels.references.emptyDescription")}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export const referencesPanelRegistration = definePanel("references", {
  component: ReferencesPanel,
  presentation: referencesPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  toolbar: {
    alignItems: "center",
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  toolbarText: { flex: 1, minWidth: 0 },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  list: { gap: theme.spacing[2], padding: theme.spacing[3] },
  card: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  cardHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  provider: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textTransform: "uppercase",
  },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  summary: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  pageError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  timestamp: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  centerState: {
    alignItems: "center",
    flex: 1,
    gap: theme.spacing[3],
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  empty: { alignItems: "center", gap: theme.spacing[2], padding: theme.spacing[6] },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
}));
