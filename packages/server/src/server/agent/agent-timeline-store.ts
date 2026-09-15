import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { AgentTimelineItemPayloadSchema } from "@getpaseo/protocol/messages";
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
  rows: AgentTimelineRow[];
  compressedRowChunks: CompressedTimelineRows[];
  nextSeq: number;
  toolCallSeqBounds: Map<string, ToolCallSeqBounds>;
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

export interface ToolCallSeqBounds {
  minSeq: number;
  maxSeq: number;
}

const DEFAULT_TIMELINE_FETCH_LIMIT = 200;
const IDLE_TIMELINE_COMPRESSION_LEVEL = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentTimelineRow(value: unknown): value is AgentTimelineRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.seq === "number" &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 0 &&
    typeof value.timestamp === "string" &&
    AgentTimelineItemPayloadSchema.safeParse(value.item).success &&
    (value.turnId === undefined || typeof value.turnId === "string") &&
    (value.providerMessageId === undefined || typeof value.providerMessageId === "string")
  );
}

function isAgentTimelineRows(value: unknown): value is AgentTimelineRow[] {
  return Array.isArray(value) && value.every(isAgentTimelineRow);
}

function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return { ...row };
}

function indexToolCallRow(
  boundsByCall: Map<string, ToolCallSeqBounds>,
  row: AgentTimelineRow,
): void {
  if (row.item.type !== "tool_call") {
    return;
  }
  const previous = boundsByCall.get(row.item.callId);
  boundsByCall.set(row.item.callId, {
    minSeq: previous ? Math.min(previous.minSeq, row.seq) : row.seq,
    maxSeq: previous ? Math.max(previous.maxSeq, row.seq) : row.seq,
  });
}

function rebuildToolCallIndex(state: AgentTimelineState): void {
  state.toolCallSeqBounds.clear();
  for (const row of state.rows) {
    indexToolCallRow(state.toolCallSeqBounds, row);
  }
}

function compressTimelineRows(rows: readonly AgentTimelineRow[]): CompressedTimelineRows {
  return {
    rowCount: rows.length,
    data: gzipSync(JSON.stringify(rows), { level: IDLE_TIMELINE_COMPRESSION_LEVEL }),
  };
}

function decompressTimelineRows(chunk: CompressedTimelineRows): AgentTimelineRow[] {
  const parsed: unknown = JSON.parse(gunzipSync(chunk.data).toString("utf8"));
  if (!isAgentTimelineRows(parsed)) {
    throw new Error("Compressed timeline contains invalid canonical rows");
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
  state.rows = [...restoredRows, ...state.rows];
  state.compressedRowChunks = [];
  rebuildToolCallIndex(state);
  return restoredRows.length;
}

interface FetchContext {
  state: AgentTimelineState;
  direction: NonNullable<AgentTimelineFetchOptions["direction"]>;
  limit: number;
  selectAll: boolean;
  cursor: AgentTimelineFetchOptions["cursor"];
  minSeq: number;
  maxSeq: number;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
}

function fetchTail(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, minSeq, window } = ctx;
  const selected =
    selectAll || limit >= state.rows.length
      ? state.rows
      : state.rows.slice(state.rows.length - limit);
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected.length > 0 && selected[0].seq > minSeq,
    hasNewer: false,
    rows: selected.map(cloneRow),
  };
}

function fetchAfter(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, cursor, minSeq, maxSeq, window } = ctx;
  const baseSeq = cursor?.seq ?? 0;
  const startIdx = state.rows.findIndex((row) => row.seq > baseSeq);
  if (startIdx < 0) {
    return {
      epoch: state.epoch,
      direction,
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder: baseSeq >= minSeq,
      hasNewer: false,
      rows: [],
    };
  }

  const selected = selectAll
    ? state.rows.slice(startIdx)
    : state.rows.slice(startIdx, startIdx + limit);
  const lastSelected = selected[selected.length - 1];
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected[0].seq > minSeq,
    hasNewer: lastSelected !== null && lastSelected !== undefined && lastSelected.seq < maxSeq,
    rows: selected.map(cloneRow),
  };
}

function fetchBefore(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, cursor, minSeq, window } = ctx;
  const beforeSeq = cursor?.seq ?? state.nextSeq;
  const endExclusive = state.rows.findIndex((row) => row.seq >= beforeSeq);
  const boundedLength = endExclusive < 0 ? state.rows.length : endExclusive;
  const startInclusive = selectAll ? 0 : Math.max(0, boundedLength - limit);
  const selected = state.rows.slice(startInclusive, boundedLength);
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected.length > 0 && selected[0].seq > minSeq,
    hasNewer: endExclusive >= 0,
    rows: selected.map(cloneRow),
  };
}

function fetchReset(
  ctx: FetchContext,
  flags: { staleCursor: boolean; gap: boolean },
): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, minSeq, window } = ctx;
  const rows =
    selectAll || limit >= state.rows.length
      ? state.rows.map(cloneRow)
      : state.rows.slice(state.rows.length - limit).map(cloneRow);
  return {
    epoch: state.epoch,
    direction,
    reset: true,
    staleCursor: flags.staleCursor,
    gap: flags.gap,
    window,
    hasOlder: rows.length > 0 && rows[0].seq > minSeq,
    hasNewer: false,
    rows,
  };
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
    const nextSeq = options?.nextSeq ?? (rows.length ? rows[rows.length - 1].seq + 1 : 1);
    const toolCallSeqBounds = new Map<string, ToolCallSeqBounds>();
    for (const row of rows) {
      indexToolCallRow(toolCallSeqBounds, row);
    }
    this.states.set(agentId, {
      epoch: options?.epoch ?? randomUUID(),
      rows,
      compressedRowChunks: [],
      nextSeq,
      toolCallSeqBounds,
    });
  }

  delete(agentId: string): void {
    this.states.delete(agentId);
  }

  retainTail(agentId: string, maxRows: number): number {
    const state = this.requireState(agentId);
    const retainedRowCount = Math.max(0, Math.floor(maxRows));
    const removedRowCount = Math.max(0, state.rows.length - retainedRowCount);
    if (removedRowCount === 0) {
      return 0;
    }

    const rowsToCompress = state.rows.slice(0, removedRowCount);
    state.compressedRowChunks.push(compressTimelineRows(rowsToCompress));
    state.rows = retainedRowCount === 0 ? [] : state.rows.slice(-retainedRowCount);
    rebuildToolCallIndex(state);
    return removedRowCount;
  }

  getResidency(agentId: string): AgentTimelineResidency {
    const state = this.requireState(agentId);
    return {
      residentRowCount: state.rows.length,
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
    return state.rows.map((row) => row.item);
  }

  getRows(agentId: string): AgentTimelineRow[] {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    return state.rows.map(cloneRow);
  }

  getSubmittedUserMessage(agentId: string, clientMessageId: string): AgentTimelineRow | null {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    const row = state.rows.find(
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
    const index = state.rows.findIndex(
      (candidate) =>
        candidate.item.type === "user_message" &&
        candidate.item.clientMessageId === clientMessageId,
    );
    const row = state.rows[index];
    if (!row || row.item.type !== "user_message") {
      return null;
    }
    const enriched: AgentTimelineRow = { ...row, providerMessageId };
    state.rows[index] = enriched;
    return cloneRow(enriched);
  }

  getEpoch(agentId: string): string {
    return this.requireState(agentId).epoch;
  }

  /**
   * Projected tool calls remain anchored at their first row while later lifecycle rows extend the
   * canonical span. Bounded consumers use this index to expand only pages that cross that span.
   */
  getToolCallSeqBounds(agentId: string, callId: string): ToolCallSeqBounds | null {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    const bounds = state.toolCallSeqBounds.get(callId);
    return bounds ? { ...bounds } : null;
  }

  fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    const state = this.requireState(agentId);
    restoreCompressedRows(state);
    const direction = options?.direction ?? "tail";
    const requestedLimit = options?.limit;
    const limit =
      requestedLimit === undefined
        ? DEFAULT_TIMELINE_FETCH_LIMIT
        : Math.max(0, Math.floor(requestedLimit));
    const cursor = options?.cursor;
    const minSeq = state.rows.length ? state.rows[0].seq : 0;
    const maxSeq = state.rows.length ? state.rows[state.rows.length - 1].seq : 0;
    const selectAll = limit === 0;

    const window = {
      minSeq,
      maxSeq,
      nextSeq: state.nextSeq,
    };

    const ctx: FetchContext = {
      state,
      direction,
      limit,
      selectAll,
      cursor,
      minSeq,
      maxSeq,
      window,
    };

    if (cursor && typeof cursor.epoch === "string" && cursor.epoch !== state.epoch) {
      return fetchReset(ctx, { staleCursor: true, gap: false });
    }

    if (direction === "after" && cursor && state.rows.length > 0 && cursor.seq < minSeq - 1) {
      return fetchReset(ctx, { staleCursor: false, gap: true });
    }

    if (state.rows.length === 0) {
      return {
        epoch: state.epoch,
        direction,
        reset: false,
        staleCursor: false,
        gap: false,
        window,
        hasOlder: false,
        hasNewer: false,
        rows: [],
      };
    }

    if (direction === "tail") {
      return fetchTail(ctx);
    }
    if (direction === "after") {
      return fetchAfter(ctx);
    }
    return fetchBefore(ctx);
  }

  append(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; providerMessageId?: string; turnId?: string },
  ): AgentTimelineRow {
    const state = this.requireState(agentId);
    const row: AgentTimelineRow = {
      seq: state.nextSeq,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
      ...(options?.turnId ? { turnId: options.turnId } : {}),
      ...(options?.providerMessageId ? { providerMessageId: options.providerMessageId } : {}),
    };
    state.nextSeq += 1;
    state.rows.push(row);
    indexToolCallRow(state.toolCallSeqBounds, row);
    return cloneRow(row);
  }

  getLastItem(agentId: string): AgentTimelineItem | null {
    const state = this.requireState(agentId);
    return state.rows[state.rows.length - 1]?.item ?? null;
  }

  getLastAssistantMessage(agentId: string): string | null {
    const state = this.requireState(agentId);
    const result = this.getLastAssistantMessageFromResidentRows(state.rows);
    if (
      state.compressedRowChunks.length > 0 &&
      (result === null || result.startsAtResidentBeginning)
    ) {
      restoreCompressedRows(state);
      return this.getLastAssistantMessageFromResidentRows(state.rows)?.text ?? null;
    }
    return result?.text ?? null;
  }

  private getLastAssistantMessageFromResidentRows(
    rows: readonly AgentTimelineRow[],
  ): { text: string; startsAtResidentBeginning: boolean } | null {
    const chunks: string[] = [];
    let earliestChunkIndex = -1;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const item = rows[i].item;
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
      earliestChunkIndex = i;
    }

    if (chunks.length === 0) {
      return null;
    }

    return {
      text: chunks.toReversed().join(""),
      startsAtResidentBeginning: earliestChunkIndex === 0,
    };
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
