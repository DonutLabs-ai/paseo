import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

import { describe, expect, test } from "vitest";

import {
  createDshSessionHistorySource,
  decodeDshZstdFrames,
  dshProjectKey,
  encodeDshSegment,
  mapDshRecordsToAcpUpdates,
  parseDshSessionRecords,
  resolveDshSessionLogPath,
} from "./dsh-session-history.js";

/**
 * DeepSeek Harness writes one independent Zstandard frame per durable append,
 * so a session log is a concatenation of frames.
 */
function zstdFrame(plaintext: string): Buffer {
  return zstdCompressSync(Buffer.from(plaintext, "utf8"));
}

describe("dshProjectKey", () => {
  test("matches the directory name DeepSeek Harness writes for a real project", () => {
    expect(dshProjectKey("/home/dev/projects/example-app")).toBe(
      "--home-dev-projects-example-app--",
    );
  });

  test("collapses separator runs and keeps dots and dashes readable", () => {
    expect(dshProjectKey("/a//b///c")).toBe("--a-b-c--");
    expect(dshProjectKey("/name.with.dots_and-dashes")).toBe("--name.with.dots_and-dashes--");
  });

  test("escapes characters outside the readable alphabet as code units", () => {
    expect(dshProjectKey("/tmp/a b")).toBe("--tmp-a~0020b--");
    expect(dshProjectKey("/tmp/a~b")).toBe("--tmp-a~007Eb--");
    expect(dshProjectKey("/tmp/é")).toBe("--tmp-~00E9--");
    expect(encodeDshSegment("..")).toBe("~002E~002E");
  });

  test("truncates the readable body to the filesystem-safe limit", () => {
    expect(dshProjectKey(`/${"x".repeat(400)}`)).toBe(`--${"x".repeat(251)}--`);
  });

  test("rejects an empty project path", () => {
    expect(() => dshProjectKey("")).toThrow(/empty DeepSeek Harness project path/);
  });
});

describe("decodeDshZstdFrames", () => {
  test("decodes every frame, not only the first", () => {
    const log = Buffer.concat([
      zstdFrame('{"type":"session"}\n'),
      zstdFrame('{"type":"turn/start"}\n'),
      zstdFrame('{"type":"turn/end"}\n'),
    ]);

    expect(decodeDshZstdFrames(log).toString("utf8")).toBe(
      '{"type":"session"}\n{"type":"turn/start"}\n{"type":"turn/end"}\n',
    );
    // Node's one-shot decoder stops at the first frame, which is why the reader
    // walks frame headers instead of calling it once.
    expect(decodeDshZstdFrames(log).length).toBeGreaterThan(zstdDecompressSync(log).length);
  });

  test("drops a torn final frame from an interrupted append", () => {
    const torn = Buffer.concat([
      zstdFrame('{"type":"session"}\n'),
      zstdFrame('{"type":"user/message"}\n'),
      zstdCompressSync(Buffer.from("x".repeat(500))).subarray(0, 12),
    ]);

    expect(decodeDshZstdFrames(torn).toString("utf8")).toBe(
      '{"type":"session"}\n{"type":"user/message"}\n',
    );
  });
});

describe("mapDshRecordsToAcpUpdates", () => {
  test("translates messages, tool calls and results into ACP updates", () => {
    const records = parseDshSessionRecords(
      [
        '{"type":"system/message","seq":1,"data":{"message":{"role":"system"}}}',
        '{"type":"user/message","seq":2,"data":{"id":"msg-1","content":[{"type":"text","text":"review this"}]}}',
        '{"type":"assistant/message","seq":3,"data":{"message":{"role":"assistant","content":[{"type":"reasoning","text":"thinking"},{"type":"text","text":"on it"},{"type":"tool-call","id":"call-1","name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}]}}}',
        '{"type":"tool/call","seq":4,"data":{"callId":"call-1","name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}}',
        '{"type":"tool/result","seq":5,"data":{"message":{"role":"tool","content":[{"type":"tool-result","toolCallId":"call-1","content":[{"type":"text","text":"a.ts"}],"isError":false}]}}}',
        '{"type":"tool/call","seq":6,"data":{"callId":"call-2","name":"read","arguments":"{\\"file_path\\":\\"/tmp/a.ts\\"}"}}',
        '{"type":"tool/result","seq":7,"data":{"message":{"role":"tool","content":[{"type":"tool-result","toolCallId":"call-2","content":[{"type":"text","text":"boom"}],"isError":true}]}}}',
        '{"type":"todo/write","seq":8,"data":{"todos":[{"content":"step one","status":"completed"},{"content":"step two","status":"in_progress"}]}}',
        '{"type":"llm/retry","seq":9,"data":{"retry":1}}',
      ].join("\n"),
    );

    expect(mapDshRecordsToAcpUpdates(records)).toEqual([
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "review this" },
        messageId: "msg-1",
      },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "on it" },
        messageId: "dsh-2",
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "bash",
        status: "in_progress",
        rawInput: { command: "ls" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        rawOutput: "a.ts",
        content: [{ type: "content", content: { type: "text", text: "a.ts" } }],
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "read",
        status: "in_progress",
        rawInput: { file_path: "/tmp/a.ts" },
        locations: [{ path: "/tmp/a.ts" }],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        status: "failed",
        rawOutput: "boom",
        content: [{ type: "content", content: { type: "text", text: "boom" } }],
      },
      {
        sessionUpdate: "plan",
        entries: [
          { content: "step one", priority: "medium", status: "completed" },
          { content: "step two", priority: "medium", status: "in_progress" },
        ],
      },
    ]);
  });

  test("gives each assistant message one identity so chunks coalesce", () => {
    const records = parseDshSessionRecords(
      [
        '{"type":"assistant/message","seq":1,"data":{"message":{"content":[{"type":"text","text":"a"}]}}}',
        '{"type":"assistant/message","seq":2,"data":{"message":{"content":[{"type":"text","text":"b"}]}}}',
      ].join("\n"),
    );

    const updates = mapDshRecordsToAcpUpdates(records);
    const messageIds = updates.map((update) =>
      update.sessionUpdate === "agent_message_chunk" ? update.messageId : null,
    );
    expect(messageIds).toEqual(["dsh-0", "dsh-1"]);
  });

  test("ignores records that carry no conversation", () => {
    const records = parseDshSessionRecords(
      [
        '{"type":"permission/preset","seq":0,"data":{"preset":"workspace-write"}}',
        '{"type":"assistant/attempt","seq":1,"data":{"stream":[{"type":"chunk"}]}}',
        '{"type":"compaction/summary","seq":2,"data":{"summary":[{"type":"text","text":"history"}]}}',
        '{"type":"system/message","seq":3,"data":{"message":{"content":[{"type":"text","text":"prompt"}]}}}',
        "not json",
        "",
      ].join("\n"),
    );

    expect(mapDshRecordsToAcpUpdates(records)).toEqual([]);
  });
});

describe("createDshSessionHistorySource", () => {
  test("reads the session log for a cwd and replays its conversation", async () => {
    const dshHome = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-history-"));
    const cwd = "/home/dev/projects/example-app";
    const sessionId = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
    const previousHome = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = dshHome;
      const directory = path.join(dshHome, "sessions", dshProjectKey(cwd), sessionId);
      await fs.mkdir(directory, { recursive: true });
      const log = Buffer.concat([
        zstdFrame(`{"type":"session","version":3,"cwd":"${cwd}"}\n`),
        zstdFrame(
          '{"type":"user/message","seq":1,"data":{"id":"m1","content":[{"type":"text","text":"hi"}]}}\n',
        ),
        zstdFrame(
          '{"type":"assistant/message","seq":2,"data":{"message":{"content":[{"type":"text","text":"hello"}]}}}\n',
        ),
      ]);
      await fs.writeFile(path.join(directory, "session.v3.jsonl.zstd"), log);

      const logPath = path.join(directory, "session.v3.jsonl.zstd");
      expect(await resolveDshSessionLogPath({ cwd, sessionId })).toBe(logPath);
      expect(await createDshSessionHistorySource().collect({ cwd, sessionId })).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "hi" },
          messageId: "m1",
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
          messageId: "dsh-2",
        },
      ]);
    } finally {
      restoreDshHome(previousHome);
      await fs.rm(dshHome, { recursive: true, force: true });
    }
  });

  test("returns no updates when the session has no local log", async () => {
    const dshHome = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-history-"));
    const previousHome = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = dshHome;
      expect(
        await resolveDshSessionLogPath({ cwd: "/tmp/elsewhere", sessionId: "missing" }),
      ).toBeNull();
      expect(
        await createDshSessionHistorySource().collect({
          cwd: "/tmp/elsewhere",
          sessionId: "missing",
        }),
      ).toEqual([]);
    } finally {
      restoreDshHome(previousHome);
      await fs.rm(dshHome, { recursive: true, force: true });
    }
  });
});

function restoreDshHome(previousHome: string | undefined): void {
  if (previousHome === undefined) {
    delete process.env.DSH_HOME;
    return;
  }
  process.env.DSH_HOME = previousHome;
}
