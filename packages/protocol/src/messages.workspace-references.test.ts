import { describe, expect, it } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

describe("workspace references protocol", () => {
  it("parses credential and scan requests", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "workspace.integrations.set_credential.request",
        requestId: "request-1",
        provider: "linear",
        credential: "lin_api_secret",
      }).success,
    ).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "workspace.references.refresh.request",
        requestId: "request-2",
        workspaceId: "workspace-1",
      }).success,
    ).toBe(true);
  });

  it("returns only integration status and summarized references", () => {
    const status = SessionOutboundMessageSchema.parse({
      type: "workspace.integrations.get_status.response",
      payload: {
        requestId: "request-3",
        integrations: [
          {
            provider: "slack",
            configured: true,
            accountLabel: "Acme · Paseo",
            verifiedAt: "2026-09-22T00:00:00.000Z",
          },
        ],
      },
    });
    expect(JSON.stringify(status)).not.toContain("credential");

    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "workspace.references.get.response",
        payload: {
          requestId: "request-4",
          workspaceId: "workspace-1",
          scannedAt: "2026-09-22T00:00:00.000Z",
          references: [
            {
              key: "linear:ENG-42",
              provider: "linear",
              url: "https://linear.app/acme/issue/ENG-42",
              title: "ENG-42 Example",
              summary: "Example summary.",
              state: "ready",
              error: null,
              fetchedAt: "2026-09-22T00:00:00.000Z",
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("parses incremental scan progress snapshots", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "workspace.references.progress",
        payload: {
          requestId: "request-progress",
          workspaceId: "workspace-1",
          scannedAt: null,
          references: [
            {
              key: "linear:ENG-42",
              provider: "linear",
              url: "https://linear.app/acme/issue/ENG-42",
              title: "ENG-42 Example",
              summary: "Example excerpt.",
              state: "ready",
              error: null,
              fetchedAt: "2026-09-22T00:00:00.000Z",
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("keeps the daemon capability optional for compatibility", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-daemon",
        features: {},
      }).features.workspaceReferences,
    ).toBeUndefined();
  });
});
