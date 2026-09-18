import * as zlib from "node:zlib";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ContentBlock, SessionUpdate, ToolCallLocation } from "@agentclientprotocol/sdk";

import type { ACPLocalHistorySource } from "./acp-agent.js";

/**
 * Reads DeepSeek Harness session logs and replays them as ACP session updates.
 *
 * DeepSeek Harness advertises `session/resume` but not `session/load`, so an ACP
 * client cannot ask it to replay past conversation. Its sessions are nonetheless
 * durable on disk, so this module reconstructs the updates an agent would have
 * streamed and hands them to the ACP session for normal translation.
 */

type ZstdDecompressor = (input: Uint8Array) => Buffer;

function isZstdDecompressor(value: unknown): value is ZstdDecompressor {
  return typeof value === "function";
}

/**
 * Resolve Node's synchronous Zstandard decoder.
 *
 * `node:zlib` gained Zstandard in Node 22.15, after the `@types/node` version this
 * workspace pins, so the lookup is a runtime capability probe rather than a typed
 * import. Reading a session log is the only consumer, so an unsupported runtime
 * fails on that read instead of at import time.
 */
function requireZstdDecompressor(): ZstdDecompressor {
  const candidate: unknown = Reflect.get(zlib, "zstdDecompressSync");
  if (!isZstdDecompressor(candidate)) {
    throw new Error(
      `DeepSeek Harness session logs are Zstandard-compressed and require Node 22.15 or newer (running ${process.version})`,
    );
  }
  return candidate;
}

/** Default DeepSeek Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`. */
function resolveDshHome(): string {
  const configured = process.env.DSH_HOME;
  if (configured !== undefined && configured.trim().length > 0) {
    return path.resolve(configured);
  }
  return path.join(homedir(), ".dsh");
}

/**
 * Encode one path segment the way DeepSeek Harness names session directories.
 *
 * Mirrors `@deepseek-ai/dsh-session-persistence-jsonl`: characters outside
 * `[A-Za-z0-9._-]` (and `~` itself) become `~XXXX` uppercase code-unit escapes,
 * while the separators `.` and `..` use the same encoding.
 */
export function encodeDshSegment(raw: string): string {
  if (raw.length === 0) {
    throw new Error("cannot encode an empty DeepSeek Harness path segment");
  }
  if (raw === ".") {
    return "~002E";
  }
  if (raw === "..") {
    return "~002E~002E";
  }
  let encoded = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    encoded +=
      character !== "~" && /^[A-Za-z0-9._-]$/.test(character)
        ? character
        : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return encoded;
}

/**
 * Build the readable project directory key for a working directory.
 *
 * Separators (`/`, `\`, `:`) collapse into a single `-`; every other unsafe code
 * unit uses the `~XXXX` escape. The result is truncated to 251 characters inside
 * a `--`-delimited envelope so it stays a valid filesystem name.
 */
export function dshProjectKey(cwd: string): string {
  if (cwd.length === 0) {
    throw new Error("cannot encode an empty DeepSeek Harness project path");
  }
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === "/" || character === "\\" || character === ":") {
      if (!separatorRun) {
        readable += "-";
      }
      separatorRun = true;
    } else if (character !== "~" && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const trimmed = readable.replace(/^-+/, "") || "root";
  return `--${trimmed.slice(0, 251)}--`;
}

/** Candidate log filenames, compressed first, in the order Harness prefers them. */
const SESSION_LOG_FILENAMES = ["session.v3.jsonl.zstd", "session.v3.jsonl"] as const;

/**
 * Resolve the newest on-disk session log for one working directory and session.
 * @returns the absolute log path, or null when this session has no local log.
 */
export async function resolveDshSessionLogPath(params: {
  cwd: string;
  sessionId: string;
  dshHome?: string;
}): Promise<string | null> {
  const root = params.dshHome ?? resolveDshHome();
  const sessionDirectory = path.join(
    root,
    "sessions",
    dshProjectKey(params.cwd),
    encodeDshSegment(params.sessionId),
  );
  for (const filename of SESSION_LOG_FILENAMES) {
    const candidate = path.join(sessionDirectory, filename);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && stat.size > 0) {
        return candidate;
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
  return null;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

const ZSTD_MAGIC = 0xfd2fb528;
/** Refuse pathological logs rather than materializing unbounded output. */
const MAX_DECODED_BYTES = 256 * 1024 * 1024;

/**
 * Measure one complete Zstandard frame without decoding it.
 *
 * DeepSeek Harness appends one independent frame per durable write, so a log is a
 * concatenation of frames and Node's one-shot decoder stops after the first.
 * Walking RFC 8878 framing lets every frame be decoded individually.
 * @returns the frame length in bytes.
 * @throws when the frame header, a block header, or the checksum is torn.
 */
function measureZstdFrame(frame: Buffer, start: number): number {
  const requireBytes = (end: number): void => {
    if (end > frame.length) {
      throw new Error("Truncated Zstandard frame in DeepSeek Harness session log");
    }
  };
  requireBytes(start + 5);
  if (frame.readUInt32LE(start) !== ZSTD_MAGIC) {
    throw new Error(
      `Corrupt DeepSeek Harness session log: invalid Zstandard frame magic at byte ${start}`,
    );
  }
  const descriptor = frame.readUInt8(start + 4);
  if ((descriptor & 0x18) !== 0) {
    throw new Error(
      `Corrupt DeepSeek Harness session log: reserved frame-header bit at byte ${start}`,
    );
  }
  const singleSegment = (descriptor & 0x20) !== 0;
  const sizeFlag = descriptor >>> 6;
  let contentSizeBytes: number;
  if (sizeFlag === 0) {
    contentSizeBytes = singleSegment ? 1 : 0;
  } else {
    contentSizeBytes = 1 << sizeFlag;
  }
  const dictionaryFlag = descriptor & 3;
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
  let offset = start + 5 + (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
  requireBytes(offset);
  for (;;) {
    requireBytes(offset + 3);
    const blockHeader = frame.readUIntLE(offset, 3);
    offset += 3;
    const lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 3;
    if (blockType === 3) {
      throw new Error(
        `Corrupt DeepSeek Harness session log: reserved block type at byte ${offset - 3}`,
      );
    }
    const payloadBytes = blockType === 1 ? 1 : blockHeader >>> 3;
    requireBytes(offset + payloadBytes);
    offset += payloadBytes;
    if (lastBlock) {
      break;
    }
  }
  if ((descriptor & 0x04) !== 0) {
    requireBytes(offset + 4);
    offset += 4;
  }
  return offset - start;
}

/**
 * Decode a concatenated-frame Zstandard log.
 *
 * A torn final frame (crash mid-append) is dropped rather than failing the read,
 * because every complete frame before it is still valid.
 * @param input - raw file bytes.
 * @returns the decoded plaintext bytes.
 */
export function decodeDshZstdFrames(input: Buffer): Buffer {
  const zstdDecompressSync = requireZstdDecompressor();
  const chunks: Buffer[] = [];
  let offset = 0;
  let length = 0;
  while (offset < input.length) {
    let frameLength: number;
    try {
      frameLength = measureZstdFrame(input, offset);
    } catch (error) {
      if (offset > 0 && error instanceof Error && error.message.startsWith("Truncated")) {
        break;
      }
      throw error;
    }
    const decoded = zstdDecompressSync(input.subarray(offset, offset + frameLength));
    length += decoded.length;
    if (length > MAX_DECODED_BYTES) {
      throw new Error("DeepSeek Harness session log exceeds the readable size limit");
    }
    chunks.push(decoded);
    offset += frameLength;
  }
  return Buffer.concat(chunks, length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Concatenate the text blocks of one DeepSeek Harness content array. */
function joinTextBlocks(value: unknown): string {
  const parts: string[] = [];
  for (const block of readArray(value)) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

/** Paths named by a tool call, so clients can offer follow-along navigation. */
function inferToolLocations(
  name: string,
  args: Record<string, unknown>,
): ToolCallLocation[] | undefined {
  if (!["read", "read_image", "write", "edit"].includes(name.toLowerCase())) {
    return undefined;
  }
  const filePath =
    readString(args, "file_path") ?? readString(args, "filePath") ?? readString(args, "path");
  return filePath === undefined ? undefined : [{ path: filePath }];
}

/** Parse a tool call's arguments, which Harness records as a JSON string. */
function parseToolArguments(raw: unknown): Record<string, unknown> | undefined {
  if (isRecord(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

interface DshToolResultContent {
  toolCallId: string;
  text: string;
  isError: boolean;
}

function readToolResult(data: Record<string, unknown>): DshToolResultContent | null {
  const message = data.message;
  if (!isRecord(message)) {
    return null;
  }
  for (const block of readArray(message.content)) {
    if (!isRecord(block) || block.type !== "tool-result") {
      continue;
    }
    const toolCallId = readString(block, "toolCallId");
    if (toolCallId === undefined) {
      continue;
    }
    return {
      toolCallId,
      text: joinTextBlocks(block.content),
      isError: block.isError === true,
    };
  }
  return null;
}

/** Convert one `todo/write` payload into an ACP plan update. */
function toPlanUpdate(data: Record<string, unknown>): SessionUpdate | null {
  const entries: Array<{
    content: string;
    priority: "medium";
    status: "pending" | "in_progress" | "completed";
  }> = [];
  for (const todo of readArray(data.todos)) {
    if (!isRecord(todo)) {
      continue;
    }
    const content = readString(todo, "content");
    const status = todo.status;
    if (content === undefined) {
      continue;
    }
    entries.push({
      content,
      priority: "medium",
      status:
        status === "completed" || status === "in_progress" || status === "pending"
          ? status
          : "pending",
    });
  }
  return entries.length === 0 ? null : { sessionUpdate: "plan", entries };
}

function toTextBlock(text: string): ContentBlock {
  return { type: "text", text };
}

function translateUserMessage(data: Record<string, unknown>): SessionUpdate | null {
  const text = joinTextBlocks(data.content);
  if (text.length === 0) {
    return null;
  }
  const messageId = readString(data, "id");
  return {
    sessionUpdate: "user_message_chunk",
    content: toTextBlock(text),
    ...(messageId === undefined ? {} : { messageId }),
  };
}

function translateAssistantMessage(data: Record<string, unknown>, index: number): SessionUpdate[] {
  const message = data.message;
  if (!isRecord(message)) {
    return [];
  }
  // One identity per Harness message: consecutive chunks then coalesce into a
  // single timeline item instead of one item per content block.
  const messageId = `dsh-${String(index)}`;
  const updates: SessionUpdate[] = [];
  for (const block of readArray(message.content)) {
    if (!isRecord(block) || typeof block.text !== "string" || block.text.length === 0) {
      continue;
    }
    if (block.type === "reasoning") {
      updates.push({ sessionUpdate: "agent_thought_chunk", content: toTextBlock(block.text) });
    } else if (block.type === "text") {
      updates.push({
        sessionUpdate: "agent_message_chunk",
        content: toTextBlock(block.text),
        messageId,
      });
    }
  }
  return updates;
}

function translateToolCall(data: Record<string, unknown>): SessionUpdate | null {
  const toolCallId = readString(data, "callId");
  const name = readString(data, "name");
  if (toolCallId === undefined || name === undefined) {
    return null;
  }
  const args = parseToolArguments(data.arguments);
  const locations = inferToolLocations(name, args ?? {});
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: name,
    status: "in_progress",
    // Clients read structured `rawInput`; only an unparseable payload keeps the
    // raw string, so nothing is dropped.
    rawInput: args ?? data.arguments,
    ...(locations === undefined ? {} : { locations }),
  };
}

function translateToolResult(data: Record<string, unknown>): SessionUpdate | null {
  const result = readToolResult(data);
  if (result === null) {
    return null;
  }
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: result.toolCallId,
    status: result.isError ? "failed" : "completed",
    rawOutput: result.text,
    content:
      result.text.length === 0 ? [] : [{ type: "content", content: toTextBlock(result.text) }],
  };
}

function translateDshRecord(record: unknown, index: number): SessionUpdate[] {
  if (!isRecord(record)) {
    return [];
  }
  const type = record.type;
  const data = record.data;
  if (typeof type !== "string" || !isRecord(data)) {
    return [];
  }
  switch (type) {
    case "user/message": {
      const update = translateUserMessage(data);
      return update === null ? [] : [update];
    }
    case "assistant/message":
      return translateAssistantMessage(data, index);
    case "tool/call": {
      const update = translateToolCall(data);
      return update === null ? [] : [update];
    }
    case "tool/result": {
      const update = translateToolResult(data);
      return update === null ? [] : [update];
    }
    case "todo/write": {
      const update = toPlanUpdate(data);
      return update === null ? [] : [update];
    }
    default:
      return [];
  }
}

/**
 * Translate DeepSeek Harness session records into ACP session updates.
 *
 * Only conversation-bearing records are translated: user and assistant messages,
 * tool calls and their results, and todo plans. Harness-internal records
 * (system prompts, HTTP request headers, retry bookkeeping, streaming attempts,
 * compaction summaries) are skipped so they never reach the client timeline.
 * @param records - one JSON value per JSONL line, in file order.
 * @returns ACP session updates in the order the agent originally produced them.
 */
export function mapDshRecordsToAcpUpdates(records: readonly unknown[]): SessionUpdate[] {
  return records.flatMap((record, index) => translateDshRecord(record, index));
}

/** Parse a decoded JSONL log, tolerating a torn final line. */
export function parseDshSessionRecords(plaintext: string): unknown[] {
  const records: unknown[] = [];
  for (const line of plaintext.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      records.push(parsed);
    } catch {
      continue;
    }
  }
  return records;
}

/**
 * Build a history source backed by DeepSeek Harness session logs.
 *
 * Intended for ACP providers whose agent advertises no `session/load`, where
 * resume would otherwise restore a conversation with an empty timeline.
 * @returns a source that replays the on-disk log as ACP updates.
 */
export function createDshSessionHistorySource(): ACPLocalHistorySource {
  return {
    async collect(params) {
      const logPath = await resolveDshSessionLogPath(params);
      if (logPath === null) {
        return [];
      }
      const bytes = await fs.readFile(logPath);
      const plaintext = logPath.endsWith(".zstd")
        ? decodeDshZstdFrames(bytes).toString("utf8")
        : bytes.toString("utf8");
      return mapDshRecordsToAcpUpdates(parseDshSessionRecords(plaintext));
    },
  };
}
