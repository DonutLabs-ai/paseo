import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export interface UtilityTrayTarget {
  serverId: string;
  utilityTerminalId: string;
}

interface UtilityTrayState {
  isOpen: boolean;
  target: UtilityTrayTarget | null;
  close: () => void;
  selectTarget: (target: UtilityTrayTarget) => void;
  toggle: () => void;
}

const UtilityTrayTargetSchema = z.strictObject({
  serverId: z.string().trim().min(1),
  utilityTerminalId: z.string().trim().min(1),
});

const UtilityTrayPersistedStateSchema = z.strictObject({
  target: UtilityTrayTargetSchema.nullable(),
});

export function createUtilityTrayStore(storage: StateStorage) {
  return create<UtilityTrayState>()(
    persist<UtilityTrayState, [], [], z.infer<typeof UtilityTrayPersistedStateSchema>>(
      (set) => ({
        isOpen: false,
        target: null,
        close: () => set({ isOpen: false }),
        selectTarget: (target) => set({ isOpen: true, target }),
        toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      }),
      {
        name: "utility-tray-state",
        version: 1,
        storage: createValidatedPersistStorage(storage, UtilityTrayPersistedStateSchema),
        partialize: (state) => ({ target: state.target }),
        merge: (persistedState, currentState) => {
          const result = UtilityTrayPersistedStateSchema.safeParse(persistedState);
          return { ...currentState, target: result.success ? result.data.target : null };
        },
      },
    ),
  );
}

export const useUtilityTrayStore = createUtilityTrayStore(AsyncStorage);
