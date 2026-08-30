import { describe, expect, test } from "vitest";
import { startWebSocketRuntime } from "./websocket-startup.js";

describe("startWebSocketRuntime", () => {
  test("restores utility terminals only after the daemon accepts connections", async () => {
    const events: string[] = [];
    const server = {
      beginAcceptingConnections() {
        events.push("accepting");
      },
      async restoreUtilityTerminals() {
        events.push("restore-utilities");
      },
    };

    await startWebSocketRuntime({
      server,
      pluginRuntime: {
        bindPaseoSessionHost(boundServer) {
          expect(boundServer).toBe(server);
          events.push("bind-plugins");
        },
        async start() {
          events.push("start-plugins");
        },
      },
    });

    expect(events).toEqual(["bind-plugins", "start-plugins", "accepting", "restore-utilities"]);
  });
});
