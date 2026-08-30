import { cpus, freemem, loadavg, totalmem } from "node:os";
import type { DaemonSystemUsage } from "../../messages.js";

export function collectDaemonSystemUsage(): DaemonSystemUsage {
  const cpuCount = cpus().length;
  const [loadAverage1m] = loadavg();
  const memoryTotalBytes = totalmem();
  const memoryFreeBytes = freemem();
  if (cpuCount < 1) {
    throw new Error("Operating system reported no logical CPUs");
  }
  if (loadAverage1m === undefined || loadAverage1m < 0) {
    throw new Error("Operating system reported an invalid one-minute load average");
  }
  if (memoryTotalBytes <= 0 || memoryFreeBytes < 0 || memoryFreeBytes > memoryTotalBytes) {
    throw new Error("Operating system reported invalid memory totals");
  }
  return {
    collectedAt: new Date().toISOString(),
    cpuCount,
    loadAverage1m,
    memoryUsedBytes: memoryTotalBytes - memoryFreeBytes,
    memoryTotalBytes,
  };
}
