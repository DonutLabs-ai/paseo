import { useCallback, useState, type ReactElement } from "react";
import { Alert, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScheduleRow, type ScheduleRowPending } from "@/components/schedules/schedule-row";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import type { AggregatedSchedule } from "@/hooks/use-schedules";
import type { ScheduleDerivedState } from "@/schedules/schedule-derivation";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveScheduleTitle, scheduleProductName } from "@/utils/schedule-format";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/** A schedule plus the client-derived fields the row renders. */
export interface ScheduleRowView {
  schedule: AggregatedSchedule;
  targetLabel: string;
  provider: string | null;
  state: ScheduleDerivedState;
  serverName: string;
  /** True when only one host exists, so the host name is redundant in rows. */
  singleHost: boolean;
}

interface SchedulesTableProps {
  rows: ScheduleRowView[];
  /**
   * The form sheet is owned by the screen (it serves both create and edit and
   * shares the screen's "New schedule" button), so the table delegates edit
   * upward rather than mounting a second sheet here.
   */
  onEditSchedule: (schedule: AggregatedSchedule) => void;
}

/**
 * The schedules list: a single settings-style card of rows across every
 * connected host, in a full-width list matching the History screen. Rows own
 * their host-scoped mutations (pause/resume/run/delete via the mutations hook +
 * a destructive confirm) and delegate editing upward.
 */
export function SchedulesTable({ rows, onEditSchedule }: SchedulesTableProps): ReactElement {
  return (
    <View style={styles.listContent} testID="schedules-table">
      <View style={settingsStyles.card}>
        {rows.map((row, index) => (
          <SchedulesTableRow
            key={`${row.schedule.serverId}:${row.schedule.id}`}
            row={row}
            isFirst={index === 0}
            onEditSchedule={onEditSchedule}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-row wrapper owns local in-flight state and binds mutations to this
// schedule's host. Local state keeps pending precise to the acting row even
// when several rows are acted on at once (the mutations hook exposes only a
// single global pending flag per action).
// ---------------------------------------------------------------------------

const NO_PENDING: ScheduleRowPending = {};

function SchedulesTableRow({
  row,
  isFirst,
  onEditSchedule,
}: {
  row: ScheduleRowView;
  isFirst: boolean;
  onEditSchedule: (schedule: AggregatedSchedule) => void;
}): ReactElement {
  const { schedule } = row;
  const { id, serverId } = schedule;
  const mutations = useScheduleMutations({ serverId });
  const client = useHostRuntimeClient(serverId);
  const [pending, setPending] = useState<ScheduleRowPending>(NO_PENDING);

  const runAction = useCallback(
    async (key: keyof ScheduleRowPending, action: () => Promise<void>): Promise<void> => {
      setPending((current) => ({ ...current, [key]: true }));
      try {
        await action();
      } catch {
        // Mutations roll back their own optimistic cache writes on error and
        // re-fetch on settle; surfacing per-row toasts here is out of scope.
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [],
  );

  const handleEdit = useCallback(() => {
    onEditSchedule(schedule);
  }, [onEditSchedule, schedule]);

  const handleOpenTarget = useCallback(() => {
    if (schedule.target.type !== "agent") {
      return;
    }
    const agentId = schedule.target.agentId;
    void (async () => {
      setPending((current) => ({ ...current, openTarget: true }));
      try {
        const isEnded = row.state !== "active" && row.state !== "paused";
        if (!isEnded) {
          navigateToAgent({ serverId, agentId });
          return;
        }
        if (!client) {
          throw new Error("The daemon is not connected");
        }
        const payload = await client.scheduleInspect({ id });
        if (payload.error) {
          throw new Error(payload.error);
        }
        if (!payload.schedule) {
          throw new Error(`Schedule ${id} was not found`);
        }
        const promptCandidates = payload.schedule.runs
          .toReversed()
          .filter((run) => run.status !== "running")
          .map((run) =>
            run.promptMessageId
              ? { scheduleRunId: run.id, messageId: run.promptMessageId }
              : { scheduleRunId: run.id },
          );
        navigateToAgent({
          serverId,
          agentId,
          ...(promptCandidates.length > 0
            ? {
                timelinePrompt: {
                  scheduleId: id,
                  candidates: promptCandidates,
                },
              }
            : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to open the session";
        Alert.alert("Couldn’t open associated session", message);
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next.openTarget;
          return next;
        });
      }
    })();
  }, [client, id, row.state, schedule.target, serverId]);

  const handlePause = useCallback(() => {
    void runAction("pause", () => mutations.pauseSchedule(id));
  }, [runAction, mutations, id]);

  const handleResume = useCallback(() => {
    void runAction("resume", () => mutations.resumeSchedule(id));
  }, [runAction, mutations, id]);

  const handleRunNow = useCallback(() => {
    void runAction("runNow", () => mutations.runScheduleNow(id));
  }, [runAction, mutations, id]);

  const handleDelete = useCallback(() => {
    void (async () => {
      const productName = scheduleProductName(schedule);
      const confirmed = await confirmDialog({
        title: `Delete ${productName.toLowerCase()}`,
        message: `Delete "${resolveScheduleTitle(schedule)}"? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      await runAction("delete", () => mutations.deleteSchedule(id));
    })();
  }, [runAction, mutations, id, schedule]);

  return (
    <ScheduleRow
      schedule={schedule}
      targetLabel={row.targetLabel}
      provider={row.provider}
      state={row.state}
      serverName={row.serverName}
      singleHost={row.singleHost}
      isFirst={isFirst}
      pending={pending}
      onOpenTarget={handleOpenTarget}
      onEdit={handleEdit}
      onPause={handlePause}
      onResume={handleResume}
      onRunNow={handleRunNow}
      onDelete={handleDelete}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  // Full-width list padding matching the History screen.
  listContent: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
}));
