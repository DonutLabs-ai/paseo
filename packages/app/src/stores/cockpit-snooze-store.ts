import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface CockpitSnoozeState {
  snoozedAtByWorkspace: Record<string, string>;
  latestScheduleRunStartedAtByWorkspace: Record<string, string>;
  setSnoozed: (workspaceKey: string, snoozed: boolean) => void;
  wakeForAttention: (workspaceKey: string, reason: AgentAttentionReason) => void;
  wakeForScheduleRun: (workspaceKey: string, scheduleRunStartedAt: string) => void;
}

const CockpitSnoozePersistedStateSchema = z.strictObject({
  snoozedAtByWorkspace: z.record(z.string().min(1), z.string().datetime()),
});

export function shouldWakeSnoozedWorkspace(reason: AgentAttentionReason): boolean {
  return reason === "permission" || reason === "error";
}

export function shouldSuppressSnoozedAttentionNotification(
  reason: AgentAttentionReason,
  isSnoozed: boolean,
): boolean {
  return reason === "finished" && isSnoozed;
}

export function shouldWakeForScheduleRun(
  snoozedAt: string | undefined,
  scheduleRunStartedAt: string,
): boolean {
  if (!snoozedAt) return false;
  const snoozedAtMs = Date.parse(snoozedAt);
  const scheduleRunStartedAtMs = Date.parse(scheduleRunStartedAt);
  return (
    Number.isFinite(snoozedAtMs) &&
    Number.isFinite(scheduleRunStartedAtMs) &&
    scheduleRunStartedAtMs > snoozedAtMs
  );
}

function withoutWorkspace(
  snoozedAtByWorkspace: Readonly<Record<string, string>>,
  workspaceKey: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(snoozedAtByWorkspace).filter(([key]) => key !== workspaceKey),
  );
}

function latestTimestamp(current: string | undefined, candidate: string): string | null {
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) return null;
  if (!current) return candidate;
  return candidateMs > Date.parse(current) ? candidate : current;
}

function reconcileSnoozedWorkspaces(
  snoozedAtByWorkspace: Readonly<Record<string, string>>,
  latestScheduleRunStartedAtByWorkspace: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(snoozedAtByWorkspace).filter(
      ([workspaceKey, snoozedAt]) =>
        !shouldWakeForScheduleRun(
          snoozedAt,
          latestScheduleRunStartedAtByWorkspace[workspaceKey] ?? "",
        ),
    ),
  );
}

export function createCockpitSnoozeStore(storage: StateStorage) {
  return create<CockpitSnoozeState>()(
    persist<CockpitSnoozeState, [], [], z.infer<typeof CockpitSnoozePersistedStateSchema>>(
      (set) => ({
        snoozedAtByWorkspace: {},
        latestScheduleRunStartedAtByWorkspace: {},
        setSnoozed: (workspaceKey, snoozed) =>
          set((state) => {
            const current = state.snoozedAtByWorkspace[workspaceKey];
            if (snoozed) {
              if (current) return state;
              return {
                snoozedAtByWorkspace: {
                  ...state.snoozedAtByWorkspace,
                  [workspaceKey]: new Date().toISOString(),
                },
              };
            }
            if (!current) return state;
            return {
              snoozedAtByWorkspace: withoutWorkspace(state.snoozedAtByWorkspace, workspaceKey),
            };
          }),
        wakeForAttention: (workspaceKey, reason) =>
          set((state) => {
            if (!shouldWakeSnoozedWorkspace(reason)) return state;
            if (!state.snoozedAtByWorkspace[workspaceKey]) return state;
            return {
              snoozedAtByWorkspace: withoutWorkspace(state.snoozedAtByWorkspace, workspaceKey),
            };
          }),
        wakeForScheduleRun: (workspaceKey, scheduleRunStartedAt) =>
          set((state) => {
            const latest = latestTimestamp(
              state.latestScheduleRunStartedAtByWorkspace[workspaceKey],
              scheduleRunStartedAt,
            );
            if (!latest) return state;
            const scheduleChanged =
              latest !== state.latestScheduleRunStartedAtByWorkspace[workspaceKey];
            const shouldWake = shouldWakeForScheduleRun(
              state.snoozedAtByWorkspace[workspaceKey],
              latest,
            );
            if (!scheduleChanged && !shouldWake) return state;
            return {
              latestScheduleRunStartedAtByWorkspace: scheduleChanged
                ? {
                    ...state.latestScheduleRunStartedAtByWorkspace,
                    [workspaceKey]: latest,
                  }
                : state.latestScheduleRunStartedAtByWorkspace,
              snoozedAtByWorkspace: shouldWake
                ? withoutWorkspace(state.snoozedAtByWorkspace, workspaceKey)
                : state.snoozedAtByWorkspace,
            };
          }),
      }),
      {
        name: "cockpit-snooze-state",
        version: 1,
        storage: createValidatedPersistStorage(storage, CockpitSnoozePersistedStateSchema),
        partialize: (state) => ({ snoozedAtByWorkspace: state.snoozedAtByWorkspace }),
        merge: (persistedState, currentState) => {
          const result = CockpitSnoozePersistedStateSchema.safeParse(persistedState);
          return {
            ...currentState,
            snoozedAtByWorkspace: result.success
              ? reconcileSnoozedWorkspaces(
                  result.data.snoozedAtByWorkspace,
                  currentState.latestScheduleRunStartedAtByWorkspace,
                )
              : {},
          };
        },
      },
    ),
  );
}

export const useCockpitSnoozeStore = createCockpitSnoozeStore(AsyncStorage);
