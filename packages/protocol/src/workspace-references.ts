import { z } from "zod";

export const WorkspaceReferenceProviderSchema = z.enum(["linear", "slack"]);
export type WorkspaceReferenceProvider = z.infer<typeof WorkspaceReferenceProviderSchema>;

export const WorkspaceIntegrationStatusSchema = z.object({
  provider: WorkspaceReferenceProviderSchema,
  configured: z.boolean(),
  accountLabel: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});
export type WorkspaceIntegrationStatus = z.infer<typeof WorkspaceIntegrationStatusSchema>;

export const WorkspaceReferenceSchema = z.object({
  key: z.string(),
  provider: WorkspaceReferenceProviderSchema,
  url: z.string().url(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  state: z.enum(["ready", "error"]),
  error: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});
export type WorkspaceReference = z.infer<typeof WorkspaceReferenceSchema>;

export const WorkspaceReferencesSnapshotSchema = z.object({
  workspaceId: z.string(),
  references: z.array(WorkspaceReferenceSchema),
  scannedAt: z.string().nullable(),
});
export type WorkspaceReferencesSnapshot = z.infer<typeof WorkspaceReferencesSnapshotSchema>;

export const WorkspaceIntegrationStatusRequestSchema = z.object({
  type: z.literal("workspace.integrations.get_status.request"),
  requestId: z.string(),
});

export const WorkspaceIntegrationStatusResponseSchema = z.object({
  type: z.literal("workspace.integrations.get_status.response"),
  payload: z.object({
    requestId: z.string(),
    integrations: z.array(WorkspaceIntegrationStatusSchema),
  }),
});

export const WorkspaceIntegrationSetCredentialRequestSchema = z.object({
  type: z.literal("workspace.integrations.set_credential.request"),
  requestId: z.string(),
  provider: WorkspaceReferenceProviderSchema,
  credential: z.string().min(1),
});

export const WorkspaceIntegrationSetCredentialResponseSchema = z.object({
  type: z.literal("workspace.integrations.set_credential.response"),
  payload: z.object({
    requestId: z.string(),
    integration: WorkspaceIntegrationStatusSchema,
  }),
});

export const WorkspaceIntegrationRemoveCredentialRequestSchema = z.object({
  type: z.literal("workspace.integrations.remove_credential.request"),
  requestId: z.string(),
  provider: WorkspaceReferenceProviderSchema,
});

export const WorkspaceIntegrationRemoveCredentialResponseSchema = z.object({
  type: z.literal("workspace.integrations.remove_credential.response"),
  payload: z.object({
    requestId: z.string(),
    integration: WorkspaceIntegrationStatusSchema,
  }),
});

export const WorkspaceReferencesGetRequestSchema = z.object({
  type: z.literal("workspace.references.get.request"),
  requestId: z.string(),
  workspaceId: z.string().min(1),
});

export const WorkspaceReferencesGetResponseSchema = z.object({
  type: z.literal("workspace.references.get.response"),
  payload: WorkspaceReferencesSnapshotSchema.extend({ requestId: z.string() }),
});

export const WorkspaceReferencesRefreshRequestSchema = z.object({
  type: z.literal("workspace.references.refresh.request"),
  requestId: z.string(),
  workspaceId: z.string().min(1),
});

export const WorkspaceReferencesRefreshResponseSchema = z.object({
  type: z.literal("workspace.references.refresh.response"),
  payload: WorkspaceReferencesSnapshotSchema.extend({ requestId: z.string() }),
});
