import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { UtilityTerminalInfo } from "@getpaseo/protocol/messages";
import type { TerminalExitInfo, TerminalSession } from "./terminal.js";
import type { TerminalManager } from "./terminal-manager.js";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "../server/private-files.js";

const UtilityTerminalRecordV1Schema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cwd: z.string().min(1),
  command: z.string().min(1).nullable(),
  args: z.array(z.string()),
  status: z.enum(["running", "stopped"]),
  terminalId: z.string().min(1).nullable(),
  exitCode: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const UtilityTerminalFileV1Schema = z.object({
  version: z.literal(1),
  terminals: z.array(UtilityTerminalRecordV1Schema),
});

const UtilityTerminalLastExitSchema = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.number().int().positive().nullable(),
  lastOutputLines: z.array(z.string()),
  reason: z.enum(["process-exit", "daemon-shutdown", "launch-failed", "legacy"]),
  message: z.string().nullable(),
  at: z.string().datetime(),
});

const UtilityTerminalRecordV2Schema = UtilityTerminalRecordV1Schema.extend({
  desiredState: z.enum(["running", "stopped"]),
  lastExit: UtilityTerminalLastExitSchema.nullable(),
});

const UtilityTerminalFileV2Schema = z.object({
  version: z.literal(2),
  terminals: z.array(UtilityTerminalRecordV2Schema),
});

const UtilityTerminalFileSchema = z.union([
  UtilityTerminalFileV2Schema,
  UtilityTerminalFileV1Schema,
]);

interface UtilityTerminalServiceOptions {
  paseoHome: string;
  terminalManager: TerminalManager;
  logger: Logger;
}

export interface CreateUtilityTerminalInput {
  name: string;
  cwd: string;
  command?: string | null;
  args?: string[];
}

export type UtilityTerminalListener = (terminals: UtilityTerminalInfo[]) => void;

export interface UtilityTerminalService {
  list(): UtilityTerminalInfo[];
  create(input: CreateUtilityTerminalInput): Promise<UtilityTerminalInfo>;
  start(id: string): Promise<UtilityTerminalInfo>;
  stop(id: string): Promise<UtilityTerminalInfo>;
  remove(id: string): Promise<boolean>;
  subscribe(listener: UtilityTerminalListener): () => void;
  restoreInterruptedTerminals(): Promise<void>;
  prepareForShutdown(): Promise<void>;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

function cloneRecord(record: UtilityTerminalInfo): UtilityTerminalInfo {
  return {
    ...record,
    args: [...record.args],
    lastExit: record.lastExit
      ? { ...record.lastExit, lastOutputLines: [...record.lastExit.lastOutputLines] }
      : null,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeCommand(command: string | null | undefined): string | null {
  if (command == null) {
    return null;
  }
  const normalized = command.trim();
  if (!normalized) {
    throw new Error("Utility terminal command must not be empty");
  }
  return normalized;
}

export function createUtilityTerminalService(
  options: UtilityTerminalServiceOptions,
): UtilityTerminalService {
  return new FileBackedUtilityTerminalService(options);
}

class FileBackedUtilityTerminalService implements UtilityTerminalService {
  private readonly terminalManager: TerminalManager;
  private readonly logger: Logger;
  private readonly filePath: string;
  private readonly records = new Map<string, UtilityTerminalInfo>();
  private readonly listeners = new Set<UtilityTerminalListener>();
  private readonly exitSubscriptions = new Map<string, () => void>();
  private mutationTail: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  constructor(options: UtilityTerminalServiceOptions) {
    this.terminalManager = options.terminalManager;
    this.logger = options.logger.child({ module: "utility-terminals" });
    this.filePath = join(options.paseoHome, "runtime", "utility-terminals.json");
    this.load();
  }

  list(): UtilityTerminalInfo[] {
    return Array.from(this.records.values(), cloneRecord);
  }

  create(input: CreateUtilityTerminalInput): Promise<UtilityTerminalInfo> {
    return this.enqueueMutation(async () => {
      const now = new Date().toISOString();
      const cwd = input.cwd.trim();
      if (!cwd) {
        throw new Error("Utility terminal working directory must not be empty");
      }
      const record: UtilityTerminalInfo = {
        id: randomUUID(),
        name: input.name.trim(),
        cwd,
        command: normalizeCommand(input.command),
        args: [...(input.args ?? [])],
        status: "stopped",
        desiredState: "running",
        terminalId: null,
        exitCode: null,
        lastExit: null,
        createdAt: now,
        updatedAt: now,
      };
      if (!record.name) {
        throw new Error("Utility terminal name must not be empty");
      }
      const running = await this.launch(record);
      this.records.set(running.id, running);
      this.persistAndEmit();
      return cloneRecord(running);
    });
  }

  start(id: string): Promise<UtilityTerminalInfo> {
    return this.enqueueMutation(async () => {
      this.assertNotShuttingDown();
      const record = this.requireRecord(id);
      if (record.status === "running") {
        return cloneRecord(record);
      }
      const running = await this.launch(record);
      this.records.set(id, running);
      this.persistAndEmit();
      return cloneRecord(running);
    });
  }

  stop(id: string): Promise<UtilityTerminalInfo> {
    return this.enqueueMutation(async () => {
      const record = this.requireRecord(id);
      if (record.status === "stopped" || !record.terminalId) {
        const stopped = this.toStoppedRecord(record, {
          desiredState: "stopped",
          exitCode: record.exitCode,
          lastExit: record.lastExit,
        });
        this.records.set(id, stopped);
        this.persistAndEmit();
        return cloneRecord(stopped);
      }
      const terminalId = record.terminalId;
      this.detachExitSubscription(terminalId);
      try {
        await this.terminalManager.killTerminalAndWait(terminalId);
      } catch (error) {
        const session = this.terminalManager.getTerminal(terminalId);
        if (session) {
          this.attachExitSubscription(record.id, session);
        }
        throw error;
      }
      const stopped = this.toStoppedRecord(record, {
        desiredState: "stopped",
        exitCode: null,
        lastExit: null,
      });
      this.records.set(id, stopped);
      this.persistAndEmit();
      return cloneRecord(stopped);
    });
  }

  remove(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const record = this.records.get(id);
      if (!record) {
        return false;
      }
      if (record.terminalId) {
        const terminalId = record.terminalId;
        this.detachExitSubscription(terminalId);
        try {
          await this.terminalManager.killTerminalAndWait(terminalId);
        } catch (error) {
          const session = this.terminalManager.getTerminal(terminalId);
          if (session) {
            this.attachExitSubscription(record.id, session);
          }
          throw error;
        }
      }
      this.records.delete(id);
      this.persistAndEmit();
      return true;
    });
  }

  subscribe(listener: UtilityTerminalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  restoreInterruptedTerminals(): Promise<void> {
    return this.enqueueMutation(async () => {
      this.assertNotShuttingDown();
      const interrupted = Array.from(this.records.values()).filter(
        (record) => record.desiredState === "running" && record.status === "stopped",
      );
      for (const record of interrupted) {
        try {
          const running = await this.launch(record);
          this.records.set(record.id, running);
          this.logger.info(
            { utilityTerminalId: record.id, terminalId: running.terminalId },
            "Restored utility terminal after daemon restart",
          );
        } catch (error) {
          const now = new Date().toISOString();
          this.records.set(
            record.id,
            this.toStoppedRecord(record, {
              desiredState: "stopped",
              exitCode: null,
              lastExit: {
                exitCode: null,
                signal: null,
                lastOutputLines: [],
                reason: "launch-failed",
                message: describeError(error),
                at: now,
              },
              updatedAt: now,
            }),
          );
          this.logger.error(
            { err: error, utilityTerminalId: record.id },
            "Failed to restore utility terminal after daemon restart",
          );
        }
      }
      if (interrupted.length > 0) {
        this.persistAndEmit();
      }
    });
  }

  prepareForShutdown(): Promise<void> {
    return this.enqueueMutation(async () => {
      this.shuttingDown = true;
      const now = new Date().toISOString();
      let interrupted = 0;
      for (const record of this.records.values()) {
        if (record.status !== "running" || !record.terminalId) {
          continue;
        }
        interrupted += 1;
        this.detachExitSubscription(record.terminalId);
        this.records.set(
          record.id,
          this.toStoppedRecord(record, {
            desiredState: "running",
            exitCode: null,
            lastExit: {
              exitCode: null,
              signal: null,
              lastOutputLines: [],
              reason: "daemon-shutdown",
              message: null,
              at: now,
            },
            updatedAt: now,
          }),
        );
      }
      if (interrupted > 0) {
        this.persistAndEmit();
        this.logger.info(
          { count: interrupted },
          "Saved running utility terminals for daemon restart",
        );
      }
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.mutationTail.then(operation);
    // Keep the sequencing tail usable after a failed caller operation. The
    // original promise still rejects to its caller; only the private tail is settled.
    this.mutationTail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  private async launch(record: UtilityTerminalInfo): Promise<UtilityTerminalInfo> {
    this.assertNotShuttingDown();
    const session = await this.terminalManager.createTerminal({
      cwd: record.cwd,
      name: record.name,
      title: record.name,
      ...(record.command ? { command: record.command, args: record.args } : {}),
    });
    this.attachExitSubscription(record.id, session);
    return {
      ...record,
      status: "running",
      desiredState: "running",
      terminalId: session.id,
      exitCode: null,
      lastExit: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private attachExitSubscription(recordId: string, session: TerminalSession): void {
    this.detachExitSubscription(session.id);
    const unsubscribe = session.onExit((info) => {
      void this.enqueueMutation(async () => {
        this.handleExit(recordId, session.id, info);
      });
    });
    this.exitSubscriptions.set(session.id, unsubscribe);
  }

  private handleExit(recordId: string, terminalId: string, info: TerminalExitInfo): void {
    this.detachExitSubscription(terminalId);
    const record = this.records.get(recordId);
    if (!record || record.terminalId !== terminalId) {
      return;
    }
    const now = new Date().toISOString();
    this.records.set(
      recordId,
      this.toStoppedRecord(record, {
        desiredState: "stopped",
        exitCode: info.exitCode,
        lastExit: {
          exitCode: info.exitCode,
          signal: info.signal,
          lastOutputLines: [...info.lastOutputLines],
          reason: "process-exit",
          message: null,
          at: now,
        },
        updatedAt: now,
      }),
    );
    this.persistAndEmit();
  }

  private toStoppedRecord(
    record: UtilityTerminalInfo,
    options: {
      desiredState: UtilityTerminalInfo["desiredState"];
      exitCode: number | null;
      lastExit: UtilityTerminalInfo["lastExit"];
      updatedAt?: string;
    },
  ): UtilityTerminalInfo {
    return {
      ...record,
      status: "stopped",
      desiredState: options.desiredState,
      terminalId: null,
      exitCode: options.exitCode,
      lastExit: options.lastExit,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
    };
  }

  private assertNotShuttingDown(): void {
    if (this.shuttingDown) {
      throw new Error("Utility terminal service is shutting down");
    }
  }

  private detachExitSubscription(terminalId: string): void {
    this.exitSubscriptions.get(terminalId)?.();
    this.exitSubscriptions.delete(terminalId);
  }

  private requireRecord(id: string): UtilityTerminalInfo {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Utility terminal not found: ${id}`);
    }
    return record;
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
      ensurePrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      throw error;
    }

    const parsedJson: unknown = JSON.parse(raw);
    const file = UtilityTerminalFileSchema.parse(parsedJson);
    let shouldPersist = file.version === 1;
    let interruptedRecords = 0;
    const records =
      file.version === 1
        ? file.terminals.map((persisted) => this.migrateV1Record(persisted))
        : file.terminals.map((persisted) => cloneRecord(persisted));
    for (const record of records) {
      if (record.desiredState === "running" || record.status === "running") {
        interruptedRecords += 1;
        shouldPersist = true;
        const now = new Date().toISOString();
        this.records.set(
          record.id,
          this.toStoppedRecord(record, {
            desiredState: "running",
            exitCode: null,
            lastExit: {
              exitCode: null,
              signal: null,
              lastOutputLines: [],
              reason: "daemon-shutdown",
              message: null,
              at: now,
            },
            updatedAt: now,
          }),
        );
      } else {
        this.records.set(record.id, record);
      }
    }
    if (shouldPersist) {
      this.persist();
    }
    if (interruptedRecords > 0) {
      this.logger.info(
        { count: interruptedRecords },
        "Loaded utility terminals interrupted by daemon restart",
      );
    }
  }

  private migrateV1Record(
    persisted: z.infer<typeof UtilityTerminalRecordV1Schema>,
  ): UtilityTerminalInfo {
    const wasRunning = persisted.status === "running" || persisted.terminalId !== null;
    return {
      ...persisted,
      status: wasRunning ? "stopped" : persisted.status,
      desiredState: wasRunning ? "running" : "stopped",
      terminalId: null,
      lastExit:
        !wasRunning && persisted.exitCode !== null
          ? {
              exitCode: persisted.exitCode,
              signal: null,
              lastOutputLines: [],
              reason: "legacy",
              message: null,
              at: persisted.updatedAt,
            }
          : null,
    };
  }

  private persistAndEmit(): void {
    this.persist();
    const snapshot = this.list();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private persist(): void {
    const file: z.infer<typeof UtilityTerminalFileV2Schema> = {
      version: 2,
      terminals: this.list(),
    };
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }
}
