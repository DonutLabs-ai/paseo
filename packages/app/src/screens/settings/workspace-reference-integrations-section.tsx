import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { WorkspaceIntegrationStatus } from "@getpaseo/protocol/messages";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

type Provider = "linear" | "slack";

const PROVIDER_GUIDE_URLS: Record<Provider, string> = {
  linear: "https://linear.app/docs/api-and-webhooks",
  slack: "https://api.slack.com/apps",
};

function providerName(provider: Provider): string {
  return provider === "linear" ? "Linear" : "Slack";
}

function IntegrationCredentialRow({
  client,
  provider,
  status,
  disabled,
  onSaved,
  onRemoved,
}: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>> | null;
  provider: Provider;
  status: WorkspaceIntegrationStatus;
  disabled: boolean;
  onSaved: (status: WorkspaceIntegrationStatus) => void;
  onRemoved: (status: WorkspaceIntegrationStatus) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [credential, setCredential] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = providerName(provider);

  const save = useCallback(() => {
    if (!client || !credential.trim() || pending) return;
    setPending(true);
    setError(null);
    void client
      .setWorkspaceIntegrationCredential(provider, credential)
      .then(({ integration }) => {
        onSaved(integration);
        setCredential("");
        inputRef.current?.replaceText("");
        return undefined;
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => setPending(false));
  }, [client, credential, onSaved, pending, provider]);

  const remove = useCallback(() => {
    if (!client || pending) return;
    setPending(true);
    setError(null);
    void client
      .removeWorkspaceIntegrationCredential(provider)
      .then(({ integration }) => onRemoved(integration))
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => setPending(false));
  }, [client, onRemoved, pending, provider]);

  const statusText = status.configured
    ? t("settings.host.workspaceReferences.connectedAs", {
        account: status.accountLabel ?? name,
      })
    : t("settings.host.workspaceReferences.notConnected");
  const hintText = t(
    provider === "linear"
      ? "settings.host.workspaceReferences.linearHint"
      : "settings.host.workspaceReferences.slackHint",
  );
  const guideText = t(
    provider === "linear"
      ? "settings.host.workspaceReferences.linearGuide"
      : "settings.host.workspaceReferences.slackGuide",
  );
  const guideLinkLabel = t(
    provider === "linear"
      ? "settings.host.workspaceReferences.linearGuideLink"
      : "settings.host.workspaceReferences.slackGuideLink",
  );
  let actionLabel = t("settings.host.workspaceReferences.connect");
  if (status.configured) actionLabel = t("settings.host.workspaceReferences.replace");
  if (pending) actionLabel = t("settings.host.workspaceReferences.saving");
  const hint = useMemo(
    () => (
      <View>
        <Text style={styles.status}>{statusText}</Text>
        <Text style={styles.hint}>{hintText}</Text>
        <View style={styles.guide}>
          <Text style={styles.guideTitle}>{t("settings.host.workspaceReferences.setupGuide")}</Text>
          <Text style={styles.hint}>{guideText}</Text>
          <ExternalLink
            href={PROVIDER_GUIDE_URLS[provider]}
            label={guideLinkLabel}
            accessibilityLabel={guideLinkLabel}
          />
        </View>
      </View>
    ),
    [guideLinkLabel, guideText, hintText, provider, statusText, t],
  );

  return (
    <SettingsRow label={name} hint={hint} error={error ?? undefined}>
      <View style={styles.controls}>
        <FormTextInput
          ref={inputRef}
          initialValue=""
          onChangeText={setCredential}
          placeholder={
            status.configured
              ? t("settings.host.workspaceReferences.replaceCredential")
              : t("settings.host.workspaceReferences.tokenPlaceholder", { provider: name })
          }
          secureTextEntry
          editable={!disabled && !pending}
          size="sm"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || pending || !credential.trim()}
          onPress={save}
        >
          {actionLabel}
        </Button>
        {status.configured ? (
          <Button size="sm" variant="ghost" disabled={disabled || pending} onPress={remove}>
            {t("settings.host.workspaceReferences.remove")}
          </Button>
        ) : null}
      </View>
    </SettingsRow>
  );
}

export function WorkspaceReferenceIntegrationsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [statuses, setStatuses] = useState<WorkspaceIntegrationStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateStatus = useCallback((next: WorkspaceIntegrationStatus) => {
    setStatuses((current) =>
      (current ?? []).map((status) => (status.provider === next.provider ? next : status)),
    );
  }, []);

  useEffect(() => {
    if (!client || !connected) {
      setStatuses(null);
      return;
    }
    let active = true;
    setError(null);
    void client
      .getWorkspaceIntegrationStatuses()
      .then(({ integrations }) => {
        if (active) setStatuses(integrations);
        return undefined;
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, [client, connected]);

  const resolved = statuses ?? [
    { provider: "linear" as const, configured: false, accountLabel: null, verifiedAt: null },
    { provider: "slack" as const, configured: false, accountLabel: null, verifiedAt: null },
  ];

  return (
    <SettingsSection
      title={t("settings.host.workspaceReferences.title")}
      info={t("settings.host.workspaceReferences.info")}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SettingsCard>
        {resolved.map((status) => (
          <IntegrationCredentialRow
            key={status.provider}
            client={client}
            provider={status.provider}
            status={status}
            disabled={!connected || !client || statuses === null}
            onSaved={updateStatus}
            onRemoved={updateStatus}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    justifyContent: "flex-end",
  },
  input: { minWidth: 220 },
  status: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, marginTop: 4 },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, marginTop: 4 },
  guide: { gap: theme.spacing[1], marginTop: theme.spacing[2] },
  guideTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  error: { color: theme.colors.statusDanger, marginBottom: theme.spacing[2] },
}));
