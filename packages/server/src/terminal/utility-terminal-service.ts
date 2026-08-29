import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { UtilityTerminalInfo } from "@getpaseo/protocol/messages";
import type { TerminalExitInfo, TerminalSession } from "./terminal.js";
import type { TerminalManager } from "./terminal-manager.js";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "../server/private-files.js";

const UtilityTerminalRecordSchema = z.object({
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

const UtilityTerminalFileSchema = z.object({
  version: z.literal(1),
  terminals: z.array(UtilityTerminalRecordSchema),
});

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
  return { ...record, args: [...record.args] };
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
        terminalId: null,
        exitCode: null,
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
        return cloneRecord(record);
      }
      const terminalId = record.terminalId;
      await this.terminalManager.killTerminalAndWait(terminalId);
      this.detachExitSubscription(terminalId);
      const stopped = this.toStoppedRecord(record, null);
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
        await this.terminalManager.killTerminalAndWait(record.terminalId);
        this.detachExitSubscription(record.terminalId);
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
      terminalId: session.id,
      exitCode: null,
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
    this.records.set(recordId, this.toStoppedRecord(record, info.exitCode));
    this.persistAndEmit();
  }

  private toStoppedRecord(
    record: UtilityTerminalInfo,
    exitCode: number | null,
  ): UtilityTerminalInfo {
    return {
      ...record,
      status: "stopped",
      terminalId: null,
      exitCode,
      updatedAt: new Date().toISOString(),
    };
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
    let normalizedRunningRecords = 0;
    for (const persisted of file.terminals) {
      const record = cloneRecord(persisted);
      if (record.status === "running" || record.terminalId !== null) {
        normalizedRunningRecords += 1;
        this.records.set(record.id, this.toStoppedRecord(record, null));
      } else {
        this.records.set(record.id, record);
      }
    }
    if (normalizedRunningRecords > 0) {
      this.persist();
      this.logger.info(
        { count: normalizedRunningRecords },
        "Marked utility terminals stopped after daemon restart",
      );
    }
  }

  private persistAndEmit(): void {
    this.persist();
    const snapshot = this.list();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private persist(): void {
    const file: z.infer<typeof UtilityTerminalFileSchema> = {
      version: 1,
      terminals: this.list(),
    };
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }
}
