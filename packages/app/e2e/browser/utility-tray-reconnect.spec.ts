import { randomUUID } from "node:crypto";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedSavedSettingsHosts } from "../support/helpers/settings";

type UtilityClient = Pick<
  DaemonClient,
  "connect" | "close" | "createUtilityTerminal" | "listUtilityTerminals" | "removeUtilityTerminal"
>;

test("reattaches an open utility terminal after its daemon restores it with a new terminal ID", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const serverId = `srv_utility_reconnect_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  const observedSubscriptions: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).port !== String(daemon.port)) return;
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const envelope: unknown = JSON.parse(payload);
      if (
        typeof envelope === "object" &&
        envelope !== null &&
        "type" in envelope &&
        envelope.type === "session" &&
        "message" in envelope &&
        typeof envelope.message === "object" &&
        envelope.message !== null &&
        "type" in envelope.message &&
        envelope.message.type === "subscribe_terminal_request" &&
        "terminalId" in envelope.message &&
        typeof envelope.message.terminalId === "string"
      ) {
        observedSubscriptions.push(envelope.message.terminalId);
      }
    });
  });
  let client: UtilityClient | null = null;
  let restoredClient: UtilityClient | null = null;
  let utilityTerminalId: string | null = null;

  try {
    client = await connectDaemonClient<UtilityClient>({
      clientIdPrefix: "utility-reconnect-seed",
      port: daemon.port,
    });
    const created = await client.createUtilityTerminal({
      name: "Reconnect watcher",
      cwd: process.cwd(),
      command: process.execPath,
      args: ["-e", "console.log('watcher ready'); setInterval(() => {}, 1000)"],
    });
    if (!created.terminal?.terminalId) {
      throw new Error(created.error ?? "Utility terminal did not start");
    }
    utilityTerminalId = created.terminal.id;
    const originalTerminalId = created.terminal.terminalId;

    await seedSavedSettingsHosts(page, [
      { serverId, label: "Utility reconnect", endpoint: `127.0.0.1:${daemon.port}` },
    ]);
    await page.goto(`/settings/hosts/${serverId}/host`);
    await expect(page.getByText("Online", { exact: true })).toBeVisible();
    await page.getByTestId("utility-tray-trigger").click();
    await page.getByTestId(`utility-terminal-row-${utilityTerminalId}`).click();
    await expect.poll(() => observedSubscriptions.includes(originalTerminalId)).toBe(true);
    const originalSubscriptionCount = observedSubscriptions.filter(
      (terminalId) => terminalId === originalTerminalId,
    ).length;

    await daemon.restart();
    restoredClient = await connectDaemonClient<UtilityClient>({
      clientIdPrefix: "utility-reconnect-verify",
      port: daemon.port,
    });
    const currentClient = restoredClient;
    let replacementTerminalId: string | null = null;
    await expect
      .poll(async () => {
        const listed = await currentClient.listUtilityTerminals();
        const terminal = listed.terminals.find((entry) => entry.id === utilityTerminalId);
        replacementTerminalId = terminal?.terminalId ?? null;
        return terminal?.status === "running" && replacementTerminalId !== originalTerminalId;
      })
      .toBe(true);
    if (!replacementTerminalId) {
      throw new Error("Utility terminal did not receive a replacement terminal ID");
    }

    const restoredTerminalId = replacementTerminalId;
    await expect.poll(() => observedSubscriptions.includes(restoredTerminalId)).toBe(true);
    expect(
      observedSubscriptions.filter((terminalId) => terminalId === originalTerminalId),
    ).toHaveLength(originalSubscriptionCount);
    await expect(page.locator(".xterm-screen")).toBeVisible();
  } finally {
    if (utilityTerminalId && restoredClient) {
      await restoredClient.removeUtilityTerminal(utilityTerminalId);
    }
    await restoredClient?.close();
    await client?.close();
    await daemon.close();
  }
});
