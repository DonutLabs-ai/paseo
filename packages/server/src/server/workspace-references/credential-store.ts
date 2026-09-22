import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  WorkspaceIntegrationStatus,
  WorkspaceReferenceProvider,
} from "@getpaseo/protocol/messages";
import { writePrivateFileAtomicSync } from "../private-files.js";

const StoredCredentialSchema = z.object({
  token: z.string().min(1),
  accountLabel: z.string().min(1),
  verifiedAt: z.string().datetime(),
  revision: z.string().uuid(),
});

const CredentialFileSchema = z.object({
  version: z.literal(1),
  credentials: z.object({
    linear: StoredCredentialSchema.optional(),
    slack: StoredCredentialSchema.optional(),
  }),
});

type StoredCredential = z.infer<typeof StoredCredentialSchema>;
type CredentialFile = z.infer<typeof CredentialFileSchema>;

function emptyCredentialFile(): CredentialFile {
  return { version: 1, credentials: {} };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class WorkspaceIntegrationCredentialStore {
  private readonly filePath: string;

  constructor(paseoHome: string) {
    this.filePath = path.join(paseoHome, "workspace-integrations", "credentials.json");
  }

  get(provider: WorkspaceReferenceProvider): StoredCredential | null {
    return this.read().credentials[provider] ?? null;
  }

  revision(provider: WorkspaceReferenceProvider): string | null {
    return this.read().credentials[provider]?.revision ?? null;
  }

  statuses(): WorkspaceIntegrationStatus[] {
    const credentials = this.read().credentials;
    return (["linear", "slack"] as const).map((provider) => {
      const credential = credentials[provider];
      return {
        provider,
        configured: credential !== undefined,
        accountLabel: credential?.accountLabel ?? null,
        verifiedAt: credential?.verifiedAt ?? null,
      };
    });
  }

  set(
    provider: WorkspaceReferenceProvider,
    input: { token: string; accountLabel: string; verifiedAt: string },
  ): WorkspaceIntegrationStatus {
    const current = this.read();
    const credential = StoredCredentialSchema.parse({
      token: input.token.trim(),
      accountLabel: input.accountLabel.trim(),
      verifiedAt: input.verifiedAt,
      revision: randomUUID(),
    });
    this.write({
      ...current,
      credentials: { ...current.credentials, [provider]: credential },
    });
    return {
      provider,
      configured: true,
      accountLabel: credential.accountLabel,
      verifiedAt: credential.verifiedAt,
    };
  }

  remove(provider: WorkspaceReferenceProvider): WorkspaceIntegrationStatus {
    const current = this.read();
    const credentials = { ...current.credentials };
    delete credentials[provider];
    this.write({ ...current, credentials });
    return { provider, configured: false, accountLabel: null, verifiedAt: null };
  }

  private read(): CredentialFile {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return emptyCredentialFile();
      throw error;
    }
    return CredentialFileSchema.parse(JSON.parse(raw));
  }

  private write(file: CredentialFile): void {
    const parsed = CredentialFileSchema.parse(file);
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  }
}
