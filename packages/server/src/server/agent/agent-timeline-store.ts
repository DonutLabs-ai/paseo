import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { AgentTimelineItemPayloadSchema } from "@getpaseo/protocol/messages";
import {
  TimelineProjection,
  selectProjectedTimelinePage,
  type ProjectedTimelineRow,
} from "./timeline-projection.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "./agent-timeline-store-types.js";

export interface SeedAgentTimelineOptions {
  items?: readonly AgentTimelineItem[];
  rows?: readonly AgentTimelineRow[];
  epoch?: string;
  nextSeq?: number;
  timestamp?: string;
}

interface AgentTimelineState {
  epoch: string;
  projection: TimelineProjection;
  compressedRowChunks: CompressedTimelineRows[];
  minSeq: number;
  nextSeq: number;
}

interface CompressedTimelineRows {
  rowCount: number;
  data: Buffer;
}

export interface AgentTimelineResidency {
  residentRowCount: number;
  compressedRowCount: number;
  compressedBytes: number;
}

const DEFAULT_TIMELINE_FETCH_LIMIT = 200;
const IDLE_TIMELINE_COMPRESSION_LEVEL = 1;
const TIMELINE_PROJECTION_KINDS = new Set([
  "assistant_merge",
  "reasoning_merge",
  "tool_lifecycle",
  "identity",
]);

function cloneRow<T extends AgentTimelineRow>(row: T): T {
  return { ...row };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isProjectedTimelineRow(value: unknown): value is ProjectedTimelineRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafeSequence(value.seq) &&
    isSafeSequence(value.seqStart) &&
    isSafeSequence(value.seqEnd) &&
    value.seqStart <= value.seqEnd &&
    value.seq === value.seqEnd &&
    typeof value.timestamp === "string" &&
    AgentTimelineItemPayloadSchema.safeParse(value.item).success &&
    (value.turnId === undefined || typeof value.turnId === "string") &&
    (value.providerMessageId === undefined || typeof value.providerMessageId === "string") &&
    Array.isArray(value.sourceSeqRanges) &&
    value.sourceSeqRanges.every(
      (range) =>
        isRecord(range) &&
        isSafeSequence(range.startSeq) &&
        isSafeSequence(range.endSeq) &&
        range.startSeq <= range.endSeq,
    ) &&
    Array.isArray(value.collapsed) &&
    value.collapsed.every((kind) => typeof kind === "string" && TIMELINE_PROJECTION_KINDS.has(kind))
  );
}

function isProjectedTimelineRows(value: unknown): value is ProjectedTimelineRow[] {
  return Array.isArray(value) && value.every(isProjectedTimelineRow);
}

function buildProjection(rows: readonly AgentTimelineRow[]): TimelineProjection {
  const projection = new TimelineProjection();
  for (const row of rows) {
    projection.append(row);
  }
  return projection;
}

function compressTimelineRows(rows: readonly ProjectedTimelineRow[]): CompressedTimelineRows {
  return {
    rowCount: rows.length,
    data: gzipSync(JSON.stringify(rows), { level: IDLE_TIMELINE_COMPRESSION_LEVEL }),
  };
}

function decompressTimelineRows(chunk: CompressedTimelineRows): ProjectedTimelineRow[] {
  const parsed: unknown = JSON.parse(gunzipSync(chunk.data).toString("utf8"));
  if (!isProjectedTimelineRows(parsed)) {
    throw new Error("Compressed timeline contains invalid projected rows");
  }
  if (parsed.length !== chunk.rowCount) {
    throw new Error(
      `Compressed timeline row count mismatch: expected ${chunk.rowCount}, received ${parsed.length}`,
    );
  }
  return parsed;
}

function restoreCompressedRows(state: AgentTimelineState): number {
  if (state.compressedRowChunks.length === 0) {
    return 0;
  }
  const restoredRows = state.compressedRowChunks.flatMap(decompressTimelineRows);
  state.projection = buildProjection([...restoredRows, ...state.projection.getRows()]);
  state.compressedRowChunks = [];
  return restoredRows.length;
}

export class InMemoryAgentTimelineStore {
  private readonly states = new Map<string, AgentTimelineState>();

  has(agentId: string): boolean {
    return this.states.has(agentId);
  }

  initialize(agentId: string, options?: SeedAgentTimelineOptions): void {
    const timestamp = options?.timestamp ?? new Date().toISOString();
    const rows = options?.rows?.length
      ? options.rows.map(cloneRow)
      : this.buildRowsFromItems(options?.items ?? [], options?.nextSeq ?? 1, timestamp);
    const nextSeq = rows.reduce((next, row) => Math.max(next, row.seq + 1), options?.nextSeq ?? 1);
    const projection = buildProjection(rows);
    this.states.set(agentId, {
      epoch: options?.epoch ?? randomUUID(),
      projection,
      compressedRowChunks: [],
      minSeq: projection.getRows()[0]?.seqStart ?? 0,
      nextSeq,
    });
  }

  delete(agentId: string): void {
    this.states.delete(agentId);
  }

  retainTail(agentId: string, maxRows: number): number {
    const state = this.requireState(agentId);
    const rows = state.projection.getRows();
    const retainedRowCount = Math.max(0, Math.floor(maxRows));
    const removedRowCount = Math.max(0, rows.length - retainedRowCount);
    if (removedRowCount === 0) {
      return 0;
    }

    state.compressedRowChunks.push(compressTimelineRows(rows.slice(0, removedRowCount)));
    state.projection = buildProjection(retainedRowCount === 0 ? [] : rows.slice(-retainedRowCount));
    return removedRowCount;
  }

  getResidency(agentId: string): AgentTimelineResidency {
    const state = this.requireState(agentId);
    return {
      residentRowCount: state.projection.getRows().length,
      compressedRowCount: state.compressedRowChunks.reduce(
        (total, chunk) => total + chunk.rowCount,
        0,
      ),
      compressedBytes: state.compressedRowChunks.reduce(
        (total, chunk) => total + chunk.data.byteLength,
        0,
      ),
    };
  }

  getItems(agentId: string): AgentTimelineItem[] {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    return state.projection.getRows().map((row) => row.item);
  }

  getRows(agentId: string): ProjectedTimelineRow[] {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    return state.projection.getRows().map(cloneRow);
  }

  getSubmittedUserMessage(agentId: string, clientMessageId: string): AgentTimelineRow | null {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    const row = state.projection
      .getRows()
      .find(
        (candidate) =>
          candidate.item.type === "user_message" &&
          candidate.item.clientMessageId === clientMessageId,
      );
    return row ? cloneRow(row) : null;
  }

  enrichSubmittedUserMessage(
    agentId: string,
    clientMessageId: string,
    providerMessageId: string,
  ): AgentTimelineRow | null {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    return state.projection.enrichSubmittedUserMessage(clientMessageId, providerMessageId);
  }

  getEpoch(agentId: string): string {
    return this.requireState(agentId).epoch;
  }

  fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    const direction = options?.direction ?? "tail";
    const cursor = options?.cursor;
    const rows = state.projection.getRows();
    const window = { minSeq: state.minSeq, maxSeq: state.nextSeq - 1, nextSeq: state.nextSeq };
    const staleCursor = cursor !== undefined && cursor.epoch !== state.epoch;
    const gap =
      !staleCursor &&
      direction === "after" &&
      cursor !== undefined &&
      rows.length > 0 &&
      cursor.seq < state.minSeq - 1;
    const reset = staleCursor || gap;
    const page = selectProjectedTimelinePage({
      rows,
      bounds: window,
      direction: reset ? "tail" : direction,
      cursorSeq: cursor?.seq,
      limit: options?.limit ?? DEFAULT_TIMELINE_FETCH_LIMIT,
    });
    return {
      epoch: state.epoch,
      direction,
      reset,
      staleCursor,
      gap,
      window,
      hasOlder: page.hasOlder,
      hasNewer: page.hasNewer,
      startSeq: page.startSeq,
      endSeq: page.endSeq,
      rows: page.entries.map((entry) => Object.assign({ seq: entry.seqEnd }, entry)),
    };
  }

  append(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; providerMessageId?: string; turnId?: string },
  ): AgentTimelineRow {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    const row: AgentTimelineRow = {
      seq: state.nextSeq,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
      ...(options?.turnId ? { turnId: options.turnId } : {}),
      ...(options?.providerMessageId ? { providerMessageId: options.providerMessageId } : {}),
    };
    state.nextSeq += 1;
    if (state.minSeq === 0) state.minSeq = row.seq;
    state.projection.append(row);
    return cloneRow(row);
  }

  getLastItem(agentId: string): AgentTimelineItem | null {
    const state = this.requireState(agentId);
    let row = state.projection
      .getRows()
      .find((candidate) => candidate.seqEnd === state.nextSeq - 1);
    if (!row && state.compressedRowChunks.length > 0) {
      restoreCompressedRows(state);
      row = state.projection.getRows().find((candidate) => candidate.seqEnd === state.nextSeq - 1);
    }
    return row?.item ?? null;
  }

  getLastAssistantMessage(agentId: string): string | null {
    const state = this.requireState(agentId);
    let row = state.projection
      .getRows()
      .findLast((candidate) => candidate.item.type === "assistant_message");
    if (!row && state.compressedRowChunks.length > 0) {
      restoreCompressedRows(state);
      row = state.projection
        .getRows()
        .findLast((candidate) => candidate.item.type === "assistant_message");
    }
    return row?.item.type === "assistant_message" ? row.item.text : null;
  }

  private requireState(agentId: string): AgentTimelineState {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Unknown agent '${agentId}'`);
    }
    return state;
  }

  private buildRowsFromItems(
    items: readonly AgentTimelineItem[],
    startSeq: number,
    timestamp: string,
  ): AgentTimelineRow[] {
    let nextSeq = startSeq;
    return items.map((item) => {
      const row: AgentTimelineRow = {
        seq: nextSeq,
        timestamp,
        item,
      };
      nextSeq += 1;
      return row;
    });
  }
}
