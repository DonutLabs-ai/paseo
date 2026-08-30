interface PausedWebSocketServer {
  beginAcceptingConnections(): void;
  restoreUtilityTerminals(): Promise<void>;
}

interface WebSocketPluginRuntime<Server extends PausedWebSocketServer> {
  bindPaseoSessionHost(server: Server): void;
  start(): Promise<void>;
}

export async function startWebSocketRuntime<Server extends PausedWebSocketServer>(input: {
  server: Server;
  pluginRuntime: WebSocketPluginRuntime<Server>;
}): Promise<void> {
  input.pluginRuntime.bindPaseoSessionHost(input.server);
  await input.pluginRuntime.start();
  input.server.beginAcceptingConnections();
  // Utility processes validate daemon reachability during startup. Restore
  // them only after the paused WebSocket server is ready to accept clients.
  await input.server.restoreUtilityTerminals();
}
