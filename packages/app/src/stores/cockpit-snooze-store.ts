import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface CockpitSnoozeState {
  snoozedAtByWorkspace: Record<string, string>;
  setSnoozed: (workspaceKey: string, snoozed: boolean) => void;
  wakeForAttention: (workspaceKey: string, reason: AgentAttentionReason) => void;
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

function withoutWorkspace(
  snoozedAtByWorkspace: Readonly<Record<string, string>>,
  workspaceKey: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(snoozedAtByWorkspace).filter(([key]) => key !== workspaceKey),
  );
}

export function createCockpitSnoozeStore(storage: StateStorage) {
  return create<CockpitSnoozeState>()(
    persist<CockpitSnoozeState, [], [], z.infer<typeof CockpitSnoozePersistedStateSchema>>(
      (set) => ({
        snoozedAtByWorkspace: {},
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
            snoozedAtByWorkspace: result.success ? result.data.snoozedAtByWorkspace : {},
          };
        },
      },
    ),
  );
}

export const useCockpitSnoozeStore = createCockpitSnoozeStore(AsyncStorage);
