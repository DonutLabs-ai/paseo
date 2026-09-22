import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { z } from "zod";
import type pino from "pino";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type {
  WorkspaceIntegrationStatus,
  WorkspaceReference,
  WorkspaceReferenceProvider,
  WorkspaceReferencesSnapshot,
} from "@getpaseo/protocol/messages";
import { writePrivateFileAtomicSync } from "../private-files.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import { WorkspaceIntegrationCredentialStore } from "./credential-store.js";
import {
  extractWorkspaceReferenceTargets,
  fetchLinearReference,
  fetchSlackReference,
  verifyLinearCredential,
  verifySlackCredential,
  type WorkspaceReferenceTarget,
} from "./providers.js";

const AgentScanStateSchema = z.object({
  epoch: z.string(),
  lastSeq: z.number().int().nonnegative(),
  referenceKeys: z.array(z.string()),
});

const WorkspaceReferenceStateFields = {
  workspaceId: z.string(),
  credentialRevisions: z.object({
    linear: z.string().uuid().nullable(),
    slack: z.string().uuid().nullable(),
  }),
  agents: z.record(z.string(), AgentScanStateSchema),
  targets: z.record(
    z.string(),
    z.object({
      key: z.string(),
      provider: z.enum(["linear", "slack"]),
      url: z.string(),
      identifier: z.string(),
      channelId: z.string().optional(),
      threadTs: z.string().optional(),
    }),
  ),
  references: z.array(
    z.object({
      key: z.string(),
      provider: z.enum(["linear", "slack"]),
      url: z.string().url(),
      title: z.string().nullable(),
      summary: z.string().nullable(),
      state: z.enum(["ready", "error"]),
      error: z.string().nullable(),
      fetchedAt: z.string().nullable(),
    }),
  ),
  scannedAt: z.string().nullable(),
};

const WorkspaceReferenceStateV1Schema = z.object({
  version: z.literal(1),
  ...WorkspaceReferenceStateFields,
});

const WorkspaceReferenceStateV2Schema = z.object({
  version: z.literal(2),
  ...WorkspaceReferenceStateFields,
});

const WorkspaceReferenceStateSchema = z.object({
  version: z.literal(3),
  ...WorkspaceReferenceStateFields,
});

const StoredWorkspaceReferenceStateSchema = z.discriminatedUnion("version", [
  WorkspaceReferenceStateV1Schema,
  WorkspaceReferenceStateV2Schema,
  WorkspaceReferenceStateSchema,
]);

type WorkspaceReferenceState = z.infer<typeof WorkspaceReferenceStateSchema>;
type CredentialRevisions = WorkspaceReferenceState["credentialRevisions"];

interface TimelineScanOptions {
  workspaceId: string;
  state: WorkspaceReferenceState;
  force: boolean;
}

interface TimelineScanResult {
  agents: WorkspaceReferenceState["agents"];
  targets: WorkspaceReferenceState["targets"];
}

interface ReferenceLoadOptions {
  targets: WorkspaceReferenceState["targets"];
  previousReferences: WorkspaceReferenceState["references"];
  credentialRevisions: CredentialRevisions;
  previousCredentialRevisions: CredentialRevisions;
  force: boolean;
  onReference: (reference: WorkspaceReference) => void;
}

const REFERENCE_REFRESH_CONCURRENCY = 3;

interface WorkspaceReferenceServiceOptions {
  paseoHome: string;
  agentManager: WorkspaceReferenceTimelineSource;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  logger: pino.Logger;
}

interface WorkspaceReferenceTimelineSource {
  listAgents(): Array<{ id: string; workspaceId?: string; internal?: boolean }>;
  fetchTimeline(
    agentId: string,
    options:
      | { direction: "tail"; limit: 1 }
      | {
          direction: "after";
          cursor: { epoch: string; seq: number };
          limit: 0;
        },
  ): {
    epoch: string;
    reset: boolean;
    window: { maxSeq: number };
    rows: Array<{ item: AgentTimelineItem }>;
  };
  getTimelineRows(agentId: string): Promise<Array<{ item: AgentTimelineItem }>>;
}

type WorkspaceReferenceProgressHandler = (snapshot: WorkspaceReferencesSnapshot) => void;

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function emptyState(workspaceId: string): WorkspaceReferenceState {
  return {
    version: 3,
    workspaceId,
    credentialRevisions: { linear: null, slack: null },
    agents: {},
    targets: {},
    references: [],
    scannedAt: null,
  };
}

function referenceError(
  target: WorkspaceReferenceTarget,
  previous: WorkspaceReference | undefined,
  error: string,
): WorkspaceReference {
  return {
    key: target.key,
    provider: target.provider,
    url: target.url,
    title: previous?.title ?? null,
    summary: previous?.summary ?? null,
    state: "error",
    error,
    fetchedAt: previous?.fetchedAt ?? null,
  };
}

function uniqueReferences(references: readonly WorkspaceReference[]): WorkspaceReference[] {
  const byKey = new Map<string, WorkspaceReference>();
  for (const reference of references) byKey.set(reference.key, reference);
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function snapshot(state: WorkspaceReferenceState): WorkspaceReferencesSnapshot {
  return {
    workspaceId: state.workspaceId,
    references: uniqueReferences(state.references),
    scannedAt: state.scannedAt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WorkspaceReferenceService {
  private readonly root: string;
  private readonly credentials: WorkspaceIntegrationCredentialStore;
  private readonly agentManager: WorkspaceReferenceTimelineSource;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  private readonly logger: pino.Logger;
  private readonly workspaceTails = new Map<string, Promise<WorkspaceReferencesSnapshot>>();

  constructor(options: WorkspaceReferenceServiceOptions) {
    this.root = path.join(options.paseoHome, "workspace-references");
    this.credentials = new WorkspaceIntegrationCredentialStore(options.paseoHome);
    this.agentManager = options.agentManager;
    this.workspaceRegistry = options.workspaceRegistry;
    this.logger = options.logger.child({ module: "workspace-references" });
  }

  integrationStatuses(): WorkspaceIntegrationStatus[] {
    return this.credentials.statuses();
  }

  async setCredential(
    provider: WorkspaceReferenceProvider,
    credential: string,
  ): Promise<WorkspaceIntegrationStatus> {
    const token = credential.trim();
    if (!token) throw new Error(`${provider} credential cannot be empty`);
    const accountLabel =
      provider === "linear"
        ? await verifyLinearCredential(token)
        : await verifySlackCredential(token);
    return this.credentials.set(provider, {
      token,
      accountLabel,
      verifiedAt: new Date().toISOString(),
    });
  }

  removeCredential(provider: WorkspaceReferenceProvider): WorkspaceIntegrationStatus {
    return this.credentials.remove(provider);
  }

  get(
    workspaceId: string,
    onProgress?: WorkspaceReferenceProgressHandler,
  ): Promise<WorkspaceReferencesSnapshot> {
    return this.enqueue(workspaceId, async () => {
      const state = this.read(workspaceId);
      if (state.scannedAt !== null && !this.needsScan(workspaceId, state)) return snapshot(state);
      return this.scan(workspaceId, state, false, onProgress);
    });
  }

  refresh(
    workspaceId: string,
    onProgress?: WorkspaceReferenceProgressHandler,
  ): Promise<WorkspaceReferencesSnapshot> {
    return this.enqueue(workspaceId, () =>
      this.scan(workspaceId, this.read(workspaceId), true, onProgress),
    );
  }

  private enqueue(
    workspaceId: string,
    work: () => Promise<WorkspaceReferencesSnapshot>,
  ): Promise<WorkspaceReferencesSnapshot> {
    const previous =
      this.workspaceTails.get(workspaceId) ?? Promise.resolve(snapshot(emptyState(workspaceId)));
    const next = previous.catch(() => snapshot(emptyState(workspaceId))).then(work);
    this.workspaceTails.set(workspaceId, next);
    const cleanup = () => {
      if (this.workspaceTails.get(workspaceId) === next) this.workspaceTails.delete(workspaceId);
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  private async scan(
    workspaceId: string,
    state: WorkspaceReferenceState,
    force: boolean,
    onProgress?: WorkspaceReferenceProgressHandler,
  ): Promise<WorkspaceReferencesSnapshot> {
    const workspace = await this.workspaceRegistry.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} was not found`);
    const timeline = await this.scanTimelineTargets({ workspaceId, state, force });
    const credentialRevisions = this.credentialRevisions();
    const progressByKey = new Map(
      state.references
        .filter((reference) => timeline.targets[reference.key] !== undefined)
        .map((reference) => [reference.key, reference]),
    );
    const publishProgress = (): void => {
      const progressState: WorkspaceReferenceState = {
        version: 3,
        workspaceId,
        credentialRevisions,
        agents: timeline.agents,
        targets: timeline.targets,
        references: uniqueReferences([...progressByKey.values()]),
        scannedAt: null,
      };
      this.write(progressState);
      onProgress?.(snapshot(progressState));
    };
    const writeProgress = (reference: WorkspaceReference): void => {
      progressByKey.set(reference.key, reference);
      publishProgress();
    };
    publishProgress();
    const references = await this.loadReferences({
      targets: timeline.targets,
      previousReferences: state.references,
      credentialRevisions,
      previousCredentialRevisions: state.credentialRevisions,
      force,
      onReference: writeProgress,
    });
    const nextState: WorkspaceReferenceState = {
      version: 3,
      workspaceId,
      credentialRevisions,
      agents: timeline.agents,
      targets: timeline.targets,
      references: uniqueReferences(references),
      scannedAt: new Date().toISOString(),
    };
    this.write(nextState);
    return snapshot(nextState);
  }

  private async scanTimelineTargets(options: TimelineScanOptions): Promise<TimelineScanResult> {
    const agents = this.agentManager
      .listAgents()
      .filter((agent) => agent.workspaceId === options.workspaceId && !agent.internal);
    const nextAgents: WorkspaceReferenceState["agents"] = {};
    const nextTargets: WorkspaceReferenceState["targets"] = { ...options.state.targets };

    for (const agent of agents) {
      const timelineWindow = this.agentManager.fetchTimeline(agent.id, {
        direction: "tail",
        limit: 1,
      });
      const previous = options.state.agents[agent.id];
      let rescanAll = options.force || !previous || previous.epoch !== timelineWindow.epoch;
      if (!rescanAll && previous.lastSeq === timelineWindow.window.maxSeq) {
        nextAgents[agent.id] = previous;
        continue;
      }
      const delta =
        !rescanAll && previous
          ? this.agentManager.fetchTimeline(agent.id, {
              direction: "after",
              cursor: { epoch: previous.epoch, seq: previous.lastSeq },
              limit: 0,
            })
          : null;
      rescanAll = rescanAll || delta?.reset === true;
      let rowsToScan: Array<{ item: AgentTimelineItem }>;
      if (rescanAll) {
        rowsToScan = await this.agentManager.getTimelineRows(agent.id);
      } else {
        if (delta === null) throw new Error("Incremental timeline cursor is missing");
        rowsToScan = delta.rows;
      }
      const keys = new Set(rescanAll ? [] : previous.referenceKeys);
      for (const row of rowsToScan) {
        for (const target of extractWorkspaceReferenceTargets(row.item)) {
          keys.add(target.key);
          nextTargets[target.key] = target;
        }
      }
      nextAgents[agent.id] = {
        epoch: timelineWindow.epoch,
        lastSeq: timelineWindow.window.maxSeq,
        referenceKeys: [...keys].sort(),
      };
    }

    const activeKeys = new Set(Object.values(nextAgents).flatMap((agent) => agent.referenceKeys));
    for (const key of Object.keys(nextTargets)) {
      if (!activeKeys.has(key)) delete nextTargets[key];
    }
    return { agents: nextAgents, targets: nextTargets };
  }

  private credentialRevisions(): CredentialRevisions {
    return {
      linear: this.credentials.revision("linear"),
      slack: this.credentials.revision("slack"),
    };
  }

  private async loadReferences(options: ReferenceLoadOptions): Promise<WorkspaceReference[]> {
    const previousReferences = new Map(
      options.previousReferences.map((reference) => [reference.key, reference]),
    );
    const refreshedProviders = new Set<WorkspaceReferenceProvider>();
    for (const provider of ["linear", "slack"] as const) {
      if (
        options.credentialRevisions[provider] !== null &&
        options.credentialRevisions[provider] !== options.previousCredentialRevisions[provider]
      ) {
        refreshedProviders.add(provider);
      }
    }
    const targets = Object.values(options.targets).sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    const limit = pLimit(REFERENCE_REFRESH_CONCURRENCY);
    return Promise.all(
      targets.map((target) =>
        limit(async () => {
          const previous = previousReferences.get(target.key);
          if (
            !options.force &&
            !refreshedProviders.has(target.provider) &&
            previous !== undefined
          ) {
            return previous;
          }
          const reference = await this.fetchReference(target, previous);
          options.onReference(reference);
          return reference;
        }),
      ),
    );
  }

  private needsScan(workspaceId: string, state: WorkspaceReferenceState): boolean {
    const credentialRevisions = this.credentialRevisions();
    for (const provider of ["linear", "slack"] as const) {
      const revision = credentialRevisions[provider];
      if (revision !== null && revision !== state.credentialRevisions[provider]) return true;
    }
    const agents = this.agentManager
      .listAgents()
      .filter((agent) => agent.workspaceId === workspaceId && !agent.internal);
    if (agents.length !== Object.keys(state.agents).length) return true;
    for (const agent of agents) {
      const previous = state.agents[agent.id];
      if (!previous) return true;
      const timelineWindow = this.agentManager.fetchTimeline(agent.id, {
        direction: "tail",
        limit: 1,
      });
      if (
        previous.epoch !== timelineWindow.epoch ||
        previous.lastSeq !== timelineWindow.window.maxSeq
      ) {
        return true;
      }
    }
    return false;
  }

  private async fetchReference(
    target: WorkspaceReferenceTarget,
    previous: WorkspaceReference | undefined,
  ): Promise<WorkspaceReference> {
    try {
      const credential = this.credentials.get(target.provider);
      if (!credential) {
        throw new Error(
          `Connect ${target.provider === "linear" ? "Linear" : "Slack"} in host settings`,
        );
      }
      const source =
        target.provider === "linear"
          ? await fetchLinearReference(target, credential.token)
          : await fetchSlackReference(target, credential.token);
      return {
        key: target.key,
        provider: target.provider,
        url: target.url,
        title: source.title,
        summary: source.excerpt,
        state: "ready",
        error: null,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = errorMessage(error);
      this.logger.warn({ err: error, key: target.key }, "Failed to refresh workspace reference");
      return referenceError(target, previous, message);
    }
  }

  private pathFor(workspaceId: string): string {
    const digest = createHash("sha256").update(workspaceId).digest("hex");
    return path.join(this.root, `${digest}.json`);
  }

  private read(workspaceId: string): WorkspaceReferenceState {
    let raw: string;
    try {
      raw = readFileSync(this.pathFor(workspaceId), "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return emptyState(workspaceId);
      throw error;
    }
    const parsed = StoredWorkspaceReferenceStateSchema.parse(JSON.parse(raw));
    if (parsed.workspaceId !== workspaceId)
      throw new Error("Workspace reference index identity mismatch");
    if (parsed.version !== 3) return emptyState(workspaceId);
    return parsed;
  }

  private write(state: WorkspaceReferenceState): void {
    const parsed = WorkspaceReferenceStateSchema.parse(state);
    writePrivateFileAtomicSync(
      this.pathFor(state.workspaceId),
      `${JSON.stringify(parsed, null, 2)}\n`,
    );
  }
}
