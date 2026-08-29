import type { UtilityTerminalInfo } from "@getpaseo/protocol/messages";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { List, Plus, Square, SquareTerminal, Trash2, X } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { TerminalPane } from "@/components/terminal-pane";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { useUtilityTrayStore, type UtilityTrayTarget } from "@/stores/utility-tray-store";
import { WindowChromeRegion, WindowChromeSafeArea } from "@/utils/desktop-window";
import type { Theme } from "@/styles/theme";

const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedList = withUnistyles(List);
const ThemedPlus = withUnistyles(Plus);
const ThemedSquare = withUnistyles(Square);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedX = withUnistyles(X);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface HostUtilityTerminal {
  hostLabel: string;
  serverId: string;
  terminal: UtilityTerminalInfo;
}

interface UtilityTerminalDraft {
  serverId: string;
  name: string;
  cwd: string;
  command: string;
  args: string;
}

function targetMatchesEntry(target: UtilityTrayTarget, entry: HostUtilityTerminal): boolean {
  return target.serverId === entry.serverId && target.utilityTerminalId === entry.terminal.id;
}

function noOp(): void {}

function replaceUtilityTerminal(
  terminals: UtilityTerminalInfo[],
  replacement: UtilityTerminalInfo,
): UtilityTerminalInfo[] {
  return [...terminals.filter((terminal) => terminal.id !== replacement.id), replacement];
}

function removeUtilityTerminal(
  terminals: UtilityTerminalInfo[],
  terminalId: string,
): UtilityTerminalInfo[] {
  return terminals.filter((terminal) => terminal.id !== terminalId);
}

export function UtilityTrayTrigger() {
  const isCompact = useIsCompactFormFactor();
  const isOpen = useUtilityTrayStore((state) => state.isOpen);
  const toggle = useUtilityTrayStore((state) => state.toggle);
  if (isCompact) return null;
  return (
    <ToolbarButton
      label="Utility terminals"
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
  const isCompact = useIsCompactFormFactor();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const hosts = useHosts();
  const isOpen = useUtilityTrayStore((state) => state.isOpen);
  const target = useUtilityTrayStore((state) => state.target);
  const close = useUtilityTrayStore((state) => state.close);
  const selectTarget = useUtilityTrayStore((state) => state.selectTarget);
  const [terminalsByServer, setTerminalsByServer] = useState<Record<string, UtilityTerminalInfo[]>>(
    {},
  );
  const [hostErrors, setHostErrors] = useState<Record<string, string | null>>({});
  const [showPicker, setShowPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      hosts.flatMap((host) =>
        (terminalsByServer[host.serverId] ?? []).map((terminal) => ({
          serverId: host.serverId,
          hostLabel: host.label,
          terminal,
        })),
      ),
    [hosts, terminalsByServer],
  );
  const selectedEntry = useMemo(
    () => (target ? (entries.find((entry) => targetMatchesEntry(target, entry)) ?? null) : null),
    [entries, target],
  );
  const selectedClient = useHostRuntimeClient(selectedEntry?.serverId ?? "");

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

  const handleHostUpdate = useCallback((serverId: string, terminals: UtilityTerminalInfo[]) => {
    setTerminalsByServer((current) => ({ ...current, [serverId]: terminals }));
    setHostErrors((current) => ({ ...current, [serverId]: null }));
  }, []);
  const handleHostError = useCallback((serverId: string, error: string) => {
    setHostErrors((current) => ({ ...current, [serverId]: error }));
  }, []);
  const handleSelect = useCallback(
    (entry: HostUtilityTerminal) => {
      selectTarget({
        serverId: entry.serverId,
        utilityTerminalId: entry.terminal.id,
      });
      setShowPicker(false);
      setShowCreate(false);
      setMutationError(null);
    },
    [selectTarget],
  );
  const handleTogglePicker = useCallback(() => {
    setShowPicker((current) => !current);
    setShowCreate(false);
  }, []);
  const handleShowCreate = useCallback(() => {
    setShowCreate(true);
    setShowPicker(false);
    setMutationError(null);
  }, []);

  const runSelectedMutation = useCallback(
    async (operation: "start" | "stop") => {
      if (!selectedEntry || !selectedClient || isMutating) return;
      setIsMutating(true);
      setMutationError(null);
      try {
        const result =
          operation === "start"
            ? await selectedClient.startUtilityTerminal(selectedEntry.terminal.id)
            : await selectedClient.stopUtilityTerminal(selectedEntry.terminal.id);
        if (result.error || !result.terminal) {
          throw new Error(result.error ?? `Failed to ${operation} utility terminal`);
        }
        handleHostUpdate(
          selectedEntry.serverId,
          replaceUtilityTerminal(terminalsByServer[selectedEntry.serverId] ?? [], result.terminal),
        );
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsMutating(false);
      }
    },
    [handleHostUpdate, isMutating, selectedClient, selectedEntry, terminalsByServer],
  );
  const handleStart = useCallback(() => {
    void runSelectedMutation("start");
  }, [runSelectedMutation]);
  const handleStop = useCallback(() => {
    void runSelectedMutation("stop");
  }, [runSelectedMutation]);
  const handleConfirmedRemove = useCallback(async () => {
    if (!selectedEntry || !selectedClient || isMutating) return;
    setIsMutating(true);
    setMutationError(null);
    try {
      const result = await selectedClient.removeUtilityTerminal(selectedEntry.terminal.id);
      if (result.error || !result.removed) {
        throw new Error(result.error ?? "Failed to remove utility terminal");
      }
      setTerminalsByServer((current) => ({
        ...current,
        [selectedEntry.serverId]: removeUtilityTerminal(
          current[selectedEntry.serverId] ?? [],
          selectedEntry.terminal.id,
        ),
      }));
      setShowPicker(true);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  }, [isMutating, selectedClient, selectedEntry]);
  const handleRemove = useCallback(() => {
    if (!selectedEntry || !selectedClient || isMutating) return;
    Alert.alert(
      "Remove utility terminal?",
      `Remove “${selectedEntry.terminal.name}”? Its process will be stopped first.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void handleConfirmedRemove();
          },
        },
      ],
    );
  }, [handleConfirmedRemove, isMutating, selectedClient, selectedEntry]);

  if (isCompact || !isOpen) return null;

  const panelFrame = {
    width: Math.min(820, Math.max(460, viewportWidth - 32)),
    height: Math.min(580, Math.max(340, viewportHeight - HEADER_INNER_HEIGHT - 32)),
  };
  const selectedTitle = selectedEntry?.terminal.name ?? "Utility terminals";

  return (
    <View pointerEvents="box-none" style={styles.overlay} testID="utility-tray-overlay">
      {hosts.map((host) => (
        <UtilityTerminalHostSync
          key={host.serverId}
          serverId={host.serverId}
          active={isOpen}
          onUpdate={handleHostUpdate}
          onError={handleHostError}
        />
      ))}
      <View style={[styles.panel, panelFrame]}>
        <View style={styles.header}>
          <ThemedSquareTerminal size={15} uniProps={mutedIconMapping} />
          <Text style={styles.title} numberOfLines={1}>
            {showCreate ? "New utility terminal" : selectedTitle}
          </Text>
          {!showCreate ? (
            <ToolbarButton
              label="New utility terminal"
              testID="utility-tray-create"
              onPress={handleShowCreate}
            >
              <ThemedPlus size={15} uniProps={mutedIconMapping} />
            </ToolbarButton>
          ) : null}
          {selectedEntry && !showCreate ? (
            <ToolbarButton
              label="Utility terminals"
              selected={showPicker}
              testID="utility-tray-picker-toggle"
              onPress={handleTogglePicker}
            >
              <ThemedList size={15} uniProps={mutedIconMapping} />
            </ToolbarButton>
          ) : null}
          {selectedEntry && !showPicker && !showCreate ? (
            <>
              {selectedEntry.terminal.status === "running" ? (
                <ToolbarButton
                  label="Stop utility terminal"
                  testID="utility-tray-stop"
                  onPress={handleStop}
                >
                  <ThemedSquare size={14} uniProps={mutedIconMapping} />
                </ToolbarButton>
              ) : null}
              <ToolbarButton
                label="Remove utility terminal"
                testID="utility-tray-remove"
                onPress={handleRemove}
              >
                <ThemedTrash2 size={14} uniProps={mutedIconMapping} />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton label="Close" testID="utility-tray-close" onPress={close}>
            <ThemedX size={15} uniProps={mutedIconMapping} />
          </ToolbarButton>
        </View>
        <View style={styles.content}>
          <UtilityTrayContent
            entries={entries}
            hostErrors={hostErrors}
            hosts={hosts}
            isMutating={isMutating}
            mutationError={mutationError}
            selectedEntry={selectedEntry}
            showCreate={showCreate}
            showPicker={showPicker}
            onCancelCreate={handleTogglePicker}
            onCreate={handleShowCreate}
            onCreated={handleSelect}
            onSelect={handleSelect}
            onStart={handleStart}
          />
        </View>
      </View>
    </View>
  );
}

function UtilityTrayContent({
  entries,
  hostErrors,
  hosts,
  isMutating,
  mutationError,
  selectedEntry,
  showCreate,
  showPicker,
  onCancelCreate,
  onCreate,
  onCreated,
  onSelect,
  onStart,
}: {
  entries: HostUtilityTerminal[];
  hostErrors: Record<string, string | null>;
  hosts: ReturnType<typeof useHosts>;
  isMutating: boolean;
  mutationError: string | null;
  selectedEntry: HostUtilityTerminal | null;
  showCreate: boolean;
  showPicker: boolean;
  onCancelCreate: () => void;
  onCreate: () => void;
  onCreated: (entry: HostUtilityTerminal) => void;
  onSelect: (entry: HostUtilityTerminal) => void;
  onStart: () => void;
}) {
  if (showCreate) {
    return (
      <UtilityTerminalCreateForm hosts={hosts} onCancel={onCancelCreate} onCreated={onCreated} />
    );
  }
  if (showPicker || !selectedEntry) {
    return (
      <UtilityTerminalPicker
        entries={entries}
        hostErrors={hostErrors}
        onSelect={onSelect}
        onCreate={onCreate}
      />
    );
  }
  if (selectedEntry.terminal.status === "running" && selectedEntry.terminal.terminalId) {
    return (
      <TerminalPane
        serverId={selectedEntry.serverId}
        cwd={selectedEntry.terminal.cwd}
        terminalId={selectedEntry.terminal.terminalId}
        isWorkspaceFocused
        isPaneFocused
        onOpenFileExplorer={noOp}
        onOpenWorkspaceFile={noOp}
      />
    );
  }
  return (
    <View style={styles.centerState}>
      <Text style={styles.stateTitle}>{selectedEntry.terminal.name}</Text>
      <Text style={styles.stateText}>{selectedEntry.terminal.cwd}</Text>
      {selectedEntry.terminal.exitCode !== null ? (
        <Text style={styles.stateText}>Exited with code {selectedEntry.terminal.exitCode}</Text>
      ) : null}
      {mutationError ? <Text style={styles.errorText}>{mutationError}</Text> : null}
      <Button size="sm" loading={isMutating} testID="utility-tray-start" onPress={onStart}>
        Start
      </Button>
    </View>
  );
}

function UtilityTerminalHostSync({
  serverId,
  active,
  onUpdate,
  onError,
}: {
  serverId: string;
  active: boolean;
  onUpdate: (serverId: string, terminals: UtilityTerminalInfo[]) => void;
  onError: (serverId: string, error: string) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  useEffect(() => {
    if (!active || !client) return;
    let cancelled = false;
    const unsubscribe = client.on("utility_terminals.changed", (message) => {
      if (!cancelled) onUpdate(serverId, message.payload.terminals);
    });
    const syncTerminals = async () => {
      try {
        const result = await client.listUtilityTerminals();
        if (cancelled) return;
        if (result.error) {
          throw new Error(result.error);
        }
        onUpdate(serverId, result.terminals);
      } catch (error) {
        if (!cancelled) onError(serverId, error instanceof Error ? error.message : String(error));
      }
    };
    void syncTerminals();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active, client, onError, onUpdate, serverId]);
  return null;
}

function UtilityTerminalPicker({
  entries,
  hostErrors,
  onSelect,
  onCreate,
}: {
  entries: HostUtilityTerminal[];
  hostErrors: Record<string, string | null>;
  onSelect: (entry: HostUtilityTerminal) => void;
  onCreate: () => void;
}) {
  const errors = Object.values(hostErrors).filter((error): error is string => Boolean(error));
  if (entries.length === 0) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>No global utility terminals yet.</Text>
        {errors.map((error) => (
          <Text key={error} style={styles.errorText}>
            {error}
          </Text>
        ))}
        <Button size="sm" onPress={onCreate}>
          New utility terminal
        </Button>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.terminalList}>
      {entries.map((entry) => (
        <UtilityTerminalPickerRow
          key={`${entry.serverId}:${entry.terminal.id}`}
          entry={entry}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
}

function terminalRowStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.terminalRow, (Boolean(hovered) || pressed) && styles.terminalRowHovered];
}

function UtilityTerminalPickerRow({
  entry,
  onSelect,
}: {
  entry: HostUtilityTerminal;
  onSelect: (entry: HostUtilityTerminal) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry), [entry, onSelect]);
  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={terminalRowStyle}>
      <View
        style={[
          styles.statusDot,
          entry.terminal.status === "running" ? styles.statusDotRunning : styles.statusDotStopped,
        ]}
      />
      <View style={styles.terminalLabels}>
        <Text style={styles.terminalName} numberOfLines={1}>
          {entry.terminal.name}
        </Text>
        <Text style={styles.terminalMeta} numberOfLines={1}>
          {entry.hostLabel} · {entry.terminal.cwd}
        </Text>
      </View>
    </Pressable>
  );
}

function UtilityTerminalCreateForm({
  hosts,
  onCancel,
  onCreated,
}: {
  hosts: ReturnType<typeof useHosts>;
  onCancel: () => void;
  onCreated: (entry: HostUtilityTerminal) => void;
}) {
  const initialServerId = hosts[0]?.serverId ?? "";
  const [draft, setDraft] = useState<UtilityTerminalDraft>({
    serverId: initialServerId,
    name: "",
    cwd: "",
    command: "",
    args: "",
  });
  const client = useHostRuntimeClient(draft.serverId);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedHost = hosts.find((host) => host.serverId === draft.serverId) ?? null;

  const updateDraft = useCallback(
    (key: keyof UtilityTerminalDraft): Dispatch<SetStateAction<string>> =>
      (value) => {
        setDraft((current) => ({
          ...current,
          [key]: typeof value === "function" ? value(current[key]) : value,
        }));
      },
    [],
  );
  const handleSelectHost = useCallback((serverId: string) => {
    setDraft((current) => ({ ...current, serverId }));
  }, []);
  const handleCreate = useCallback(async () => {
    if (!client || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const result = await client.createUtilityTerminal({
        name: draft.name,
        cwd: draft.cwd,
        command: draft.command.trim() || null,
        args: draft.args
          .split("\n")
          .map((arg) => arg.trim())
          .filter(Boolean),
      });
      if (result.error || !result.terminal) {
        throw new Error(result.error ?? "Failed to create utility terminal");
      }
      onCreated({
        serverId: draft.serverId,
        hostLabel: selectedHost?.label ?? draft.serverId,
        terminal: result.terminal,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsCreating(false);
    }
  }, [client, draft, isCreating, onCreated, selectedHost?.label]);

  return (
    <ScrollView contentContainerStyle={styles.form}>
      {hosts.length > 1 ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Host</Text>
          <View style={styles.hostOptions}>
            {hosts.map((host) => (
              <UtilityHostOption
                key={host.serverId}
                host={host}
                selected={draft.serverId === host.serverId}
                onSelect={handleSelectHost}
              />
            ))}
          </View>
        </View>
      ) : null}
      <UtilityTextField
        label="Name"
        value={draft.name}
        placeholder="Process Compose"
        onChangeText={updateDraft("name")}
      />
      <UtilityTextField
        label="Working directory"
        value={draft.cwd}
        placeholder="/path/to/project"
        onChangeText={updateDraft("cwd")}
      />
      <UtilityTextField
        label="Command (leave blank for a shell)"
        value={draft.command}
        placeholder="process-compose"
        onChangeText={updateDraft("command")}
      />
      <UtilityTextField
        label="Arguments (one per line)"
        value={draft.args}
        placeholder="-f\nprocess-compose.yaml"
        multiline
        onChangeText={updateDraft("args")}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.formActions}>
        <Button size="sm" variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          loading={isCreating}
          disabled={!client || !draft.name.trim() || !draft.cwd.trim()}
          onPress={handleCreate}
        >
          Create and start
        </Button>
      </View>
    </ScrollView>
  );
}

function UtilityHostOption({
  host,
  selected,
  onSelect,
}: {
  host: ReturnType<typeof useHosts>[number];
  selected: boolean;
  onSelect: (serverId: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(host.serverId), [host.serverId, onSelect]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={[styles.hostOption, selected && styles.hostOptionSelected]}
    >
      <Text style={styles.hostOptionText}>{host.label}</Text>
    </Pressable>
  );
}

function UtilityTextField({
  label,
  value,
  placeholder,
  multiline = false,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onChangeText: Dispatch<SetStateAction<string>>;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <AdaptiveTextInput
        initialValue={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
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
    borderColor: theme.colors.borderAccent,
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
    fontWeight: theme.fontWeight.semibold,
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
  stateTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  terminalList: {
    padding: theme.spacing[2],
    gap: theme.spacing[1],
  },
  terminalRow: {
    minHeight: 52,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  terminalRowHovered: {
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
  terminalLabels: {
    flex: 1,
    minWidth: 0,
  },
  terminalName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  terminalMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  field: {
    gap: theme.spacing[1],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  input: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    fontSize: theme.fontSize.base,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  hostOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  hostOption: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  hostOptionSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  hostOptionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
}));
