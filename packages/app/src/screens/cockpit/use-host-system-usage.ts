import { useCallback, useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DaemonSystemUsage } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const HOST_SYSTEM_USAGE_REFRESH_INTERVAL_MS = 15_000;

type HostSystemUsageClient = Pick<DaemonClient, "getDaemonStatus">;

export type HostSystemUsageView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; usage: DaemonSystemUsage };

async function fetchHostSystemUsage(client: HostSystemUsageClient): Promise<DaemonSystemUsage> {
  const status = await client.getDaemonStatus();
  if (!status.systemUsage) {
    throw new Error("Host advertised system usage without returning a snapshot");
  }
  return status.systemUsage;
}

export function hostSystemUsageQueryKey(serverId: string) {
  return ["hostSystemUsage", serverId] as const;
}

export function useHostSystemUsage(serverId: string): HostSystemUsageView {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsSystemUsage = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.daemonSystemUsage === true,
  );
  const enabled = Boolean(client && isConnected && supportsSystemUsage);
  const queryKey = useMemo(() => hostSystemUsageQueryKey(serverId), [serverId]);
  const queryFn = useCallback(async () => {
    if (!client) throw new Error("Host connection is not ready");
    return fetchHostSystemUsage(client);
  }, [client]);
  const query = useFetchQuery({
    queryKey,
    queryFn,
    enabled,
    dataShape: "value",
    staleTimeMs: HOST_SYSTEM_USAGE_REFRESH_INTERVAL_MS,
    refetchInterval: enabled ? HOST_SYSTEM_USAGE_REFRESH_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
  });

  if (!isConnected || !supportsSystemUsage) return { kind: "unavailable" };
  if (!client) return { kind: "error" };
  if (query.data) return { kind: "ready", usage: query.data };
  if (query.isError) return { kind: "error" };
  return { kind: "loading" };
}
