import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRouterClient } from "@orpc/server";
import * as pathsModule from "@/shared/platform/paths";
import {
  extractTrajectoryId,
  healBrokenChat,
  healAllBrokenChats,
} from "@/modules/antigravity-runtime/conversation/chatHealer";
import {
  chatHealthRouter,
  HealBrokenChatResultSchema,
  HealAllBrokenChatsResultSchema,
} from "@/modules/antigravity-runtime/ipc/chatHealthRouter";
import {
  healBrokenChat as healBrokenChatAction,
  healAllBrokenChats as healAllBrokenChatsAction,
} from "@/modules/antigravity-runtime/actions/chatHealth";
import * as chatHealthResolverModule from "@/modules/antigravity-runtime/conversation/chatHealthResolver";
import { ipc } from "@/ipc/manager";
import Database from "better-sqlite3";
import type { InvalidChatsStats } from "@/modules/antigravity-runtime/conversation/types";

const mockSummariesStore = new Map<string, { conversation_id: string; raw_summary?: Buffer | Uint8Array | null }>();
const mockTrajCreatedFiles = new Map<string, { meta?: Record<string, unknown>; blob?: Record<string, unknown> }>();
let mockDbShouldThrowSqlError = false;

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      public dbPath: string;

      constructor(dbPath: string, options?: { fileMustExist?: boolean }) {
        this.dbPath = dbPath;
        if (!options?.fileMustExist) {
          try {
            fs.writeFileSync(dbPath, "mock sqlite db");
          } catch {
            /* ignore if directory does not exist yet */
          }
        }
      }

      pragma() {
        return [];
      }

      exec() {
        if (mockDbShouldThrowSqlError) {
          throw new Error("SQLITE_ERROR: syntax error or disk I/O error");
        }
        return this;
      }

      prepare(sql: string) {
        if (mockDbShouldThrowSqlError) {
          throw new Error("SQLITE_ERROR: syntax error or disk I/O error");
        }
        const dbPath = this.dbPath;
        if (sql.includes("SELECT raw_summary FROM conversation_summaries")) {
          return {
            get: (cid: string) => mockSummariesStore.get(cid),
          };
        }
        if (sql.includes("trajectory_metadata_blob")) {
          return {
            run: (...args: unknown[]) => {
              const data = args[0] as Buffer;
              const existing = mockTrajCreatedFiles.get(dbPath) || {};
              existing.blob = { id: "main", data };
              mockTrajCreatedFiles.set(dbPath, existing);
            },
          };
        }
        if (sql.includes("trajectory_meta (")) {
          return {
            run: (...args: unknown[]) => {
              const [trajectory_id, cascade_id] = args as [string, string];
              const existing = mockTrajCreatedFiles.get(dbPath) || {};
              existing.meta = { trajectory_id, cascade_id, trajectory_type: 0, source: 0 };
              mockTrajCreatedFiles.set(dbPath, existing);
            },
          };
        }
        return {
          run: () => {},
          get: () => undefined,
          all: () => [],
        };
      }

      transaction(fn: Function) {
        return (...args: unknown[]) => fn(...args);
      }

      close() {}
    },
  };
});

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      chatHealth: {
        getHealth: vi.fn(),
        healBrokenChat: vi.fn(),
        healAllBrokenChats: vi.fn(),
      },
    },
  },
}));

describe("Chat Healer Engine", () => {
  let tmpDir: string;
  let summariesDbPath: string;
  let conversationsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSummariesStore.clear();
    mockTrajCreatedFiles.clear();
    mockDbShouldThrowSqlError = false;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-healer-test-"));
    summariesDbPath = path.join(tmpDir, "conversation_summaries.db");
    conversationsDir = path.join(tmpDir, "conversations");
    fs.mkdirSync(conversationsDir, { recursive: true });
    fs.writeFileSync(summariesDbPath, "mock summaries db");

    vi.spyOn(pathsModule, "getAntigravityConversationSummariesDbPath").mockReturnValue(summariesDbPath);
    vi.spyOn(pathsModule, "getAntigravityConversationsDir").mockReturnValue(conversationsDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* suppress */
    }
  });

  describe("extractTrajectoryId", () => {
    it("extracts trajectory ID from protobuf wire tag 0x22 0x24", () => {
      const targetTrajectoryId = "dea615e4-255d-46ef-9092-1d0fa41b1fb8";
      const cid = "006dbe45-0ada-4537-bd98-1a6d10f3a9ef";

      const header = Buffer.from([0x0a, 0x1f, 0x43, 0x6c, 0x6f, 0x6e, 0x65]);
      const tag = Buffer.from([0x22, 0x24]);
      const uuidBytes = Buffer.from(targetTrajectoryId, "ascii");
      const footer = Buffer.from([0x28, 0x01, 0x3a, 0x0c]);

      const rawSummary = Buffer.concat([header, tag, uuidBytes, footer]);
      const result = extractTrajectoryId(rawSummary, cid);

      expect(result).toBe(targetTrajectoryId);
    });

    it("extracts trajectory ID via string regex scanning when tag differs but non-cid UUID present", () => {
      const targetTrajectoryId = "9a59f961-2602-490a-a738-605a6ae31dc0";
      const cid = "target-cid-001";
      const rawSummary = Buffer.from(`preview summary text ${targetTrajectoryId} additional info`);

      const result = extractTrajectoryId(rawSummary, cid);
      expect(result).toBe(targetTrajectoryId);
    });

    it("falls back to generating UUID v4 when rawSummary is null or empty", () => {
      const result = extractTrajectoryId(null, "cid-1");
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("falls back to generating UUID v4 when rawSummary contains only cid", () => {
      const cid = "11111111-2222-3333-4444-555555555555";
      const rawSummary = Buffer.from(`summary with ${cid} only`);
      const result = extractTrajectoryId(rawSummary, cid);
      expect(result).not.toBe(cid);
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("falls back to UUID v4 when protobuf tag has malformed non-UUID content", () => {
      const cid = "my-test-cid";
      const malformed = Buffer.concat([
        Buffer.from([0x22, 0x24]),
        Buffer.from("not-a-valid-uuid-with-36-chars-xx!!", "ascii"),
      ]);
      const result = extractTrajectoryId(malformed, cid);
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(result).not.toBe(cid);
    });

    it("extracts trajectory ID when located at exact buffer boundary", () => {
      const targetTrajectoryId = "e58ed763-928c-4155-bee9-fdbaaadc15f3";
      const cid = "cid-boundary-test";
      const exactBoundaryBuf = Buffer.concat([
        Buffer.from([0x22, 0x24]),
        Buffer.from(targetTrajectoryId, "ascii"),
      ]);
      const result = extractTrajectoryId(exactBoundaryBuf, cid);
      expect(result).toBe(targetTrajectoryId);
    });
  });

  describe("healBrokenChat", () => {
    it("returns error when cid is missing", () => {
      const result = healBrokenChat("app", "");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing conversation ID");
    });

    it("returns error when conversation summaries database is missing", () => {
      vi.spyOn(pathsModule, "getAntigravityConversationSummariesDbPath").mockReturnValue("/non/existent/path.db");
      const result = healBrokenChat("app", "cid-99");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Summaries db not found");
    });

    it("returns error when summariesDbPath resolves to empty or null", () => {
      vi.spyOn(pathsModule, "getAntigravityConversationSummariesDbPath").mockReturnValue("");
      const result = healBrokenChat("app", "cid-empty-path");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Summaries db not found");
    });

    it("returns error when conversations directory cannot be resolved", () => {
      vi.spyOn(pathsModule, "getAntigravityConversationsDir").mockReturnValue("");
      const cid = "cid-no-convdir";
      mockSummariesStore.set(cid, { conversation_id: cid });
      const result = healBrokenChat("app", cid);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Conversations dir not resolved");
    });

    it("returns error when conversation row is not found in summaries database", () => {
      const result = healBrokenChat("app", "cid-not-in-db");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Conversation not found");
    });

    it("returns error when SQL execution fails during healing", () => {
      const cid = "broken-sql-fail";
      mockSummariesStore.set(cid, { conversation_id: cid });
      mockDbShouldThrowSqlError = true;
      const result = healBrokenChat("app", cid);
      expect(result.success).toBe(false);
      expect(result.error).toContain("SQLITE_ERROR");
    });

    it("synthesizes trajectory database shell with authentic trajectory ID and sets permissions", () => {
      const cid = "target-broken-cid";
      const authenticTrajectoryId = "550e8400-e29b-41d4-a716-446655440000";
      const rawSummary = Buffer.concat([
        Buffer.from([0x22, 0x24]),
        Buffer.from(authenticTrajectoryId, "ascii"),
      ]);

      mockSummariesStore.set(cid, { conversation_id: cid, raw_summary: rawSummary });

      const result = healBrokenChat("app", cid);
      expect(result.success).toBe(true);
      expect(result.cid).toBe(cid);

      const expectedDbPath = path.join(conversationsDir, `${cid}.db`);
      const createdData = mockTrajCreatedFiles.get(expectedDbPath);
      expect(createdData).toBeDefined();
      expect(createdData?.meta).toEqual({
        trajectory_id: authenticTrajectoryId,
        cascade_id: cid,
        trajectory_type: 0,
        source: 0,
      });
      expect(createdData?.blob).toEqual({
        id: "main",
        data: Buffer.alloc(0),
      });

      expect(fs.statSync(expectedDbPath).mode & 0o777).toBe(0o600);
    });

    it("refuses to touch a conversation whose trajectory already exists", () => {
      const cid = "intact-main-chat";
      mockSummariesStore.set(cid, { conversation_id: cid });
      const trajPath = path.join(conversationsDir, `${cid}.db`);
      fs.writeFileSync(trajPath, "real chat history");

      const result = healBrokenChat("app", cid);

      expect(result.success).toBe(false);
      expect(result.error).toContain("already has a trajectory");
      expect(fs.readFileSync(trajPath, "utf8")).toBe("real chat history");
      expect(mockTrajCreatedFiles.has(trajPath)).toBe(false);
    });

    it.each(["../escape", "a/b", "dots.db", "with space"])(
      "rejects conversation ID %j that is not a plain ID",
      (cid) => {
        mockSummariesStore.set(cid, { conversation_id: cid });
        const result = healBrokenChat("app", cid);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid conversation ID");
        expect(fs.readdirSync(conversationsDir)).toEqual([]);
      },
    );

    it("removes the half-created trajectory when writing it fails", () => {
      const cid = "fails-midway";
      mockSummariesStore.set(cid, { conversation_id: cid });
      const mockPrototype = (Database as unknown as { prototype: { exec: (sql: string) => unknown } }).prototype;
      const realExec = mockPrototype.exec;
      const execSpy = vi.spyOn(mockPrototype, "exec").mockImplementation(function (this: unknown, sql: string) {
        if (sql.includes("CREATE TABLE")) throw new Error("SQLITE_FULL: database or disk is full");
        return realExec.call(this, sql);
      });

      const result = healBrokenChat("app", cid);

      expect(execSpy).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("SQLITE_FULL");
      expect(fs.existsSync(path.join(conversationsDir, `${cid}.db`))).toBe(false);
    });

    it("handles database exceptions gracefully and returns error result", () => {
      const cid = "broken-cid-error";
      mockSummariesStore.set(cid, { conversation_id: cid, raw_summary: null });
      vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => {
        throw new Error("Disk full or I/O error");
      });

      const result = healBrokenChat("app", cid);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Disk full or I/O error");
    });
  });

  describe("healAllBrokenChats", () => {
    it("discovers and heals all broken conversations across project groups", () => {
      const cid1 = "broken-1";
      const cid2 = "broken-2";

      mockSummariesStore.set(cid1, { conversation_id: cid1 });
      mockSummariesStore.set(cid2, { conversation_id: cid2 });

      vi.spyOn(chatHealthResolverModule, "resolveChatHealthStats").mockReturnValue({
        target: "app",
        summariesDbPath,
        exists: true,
        totalChats: 2,
        invalidChats: 2,
        validChats: 0,
        projectGroups: [
          {
            projectName: "project-a",
            workspacePath: "/path/a",
            brokenCount: 1,
            conversations: [{ conversationId: cid1, title: "Chat 1" }],
          },
          {
            projectName: "project-b",
            workspacePath: "/path/b",
            brokenCount: 1,
            conversations: [{ conversationId: cid2, title: "Chat 2" }],
          },
        ],
      });

      const result = healAllBrokenChats("app");
      expect(result.totalHealed).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("aggregates errors when partial failures occur during healing", () => {
      const cid1 = "broken-ok";
      const cid2 = "broken-fail";

      mockSummariesStore.set(cid1, { conversation_id: cid1 });
      // cid2 not added to mockSummariesStore, so healBrokenChat will fail

      vi.spyOn(chatHealthResolverModule, "resolveChatHealthStats").mockReturnValue({
        target: "app",
        summariesDbPath,
        exists: true,
        totalChats: 2,
        invalidChats: 2,
        validChats: 0,
        projectGroups: [
          {
            projectName: "project-a",
            workspacePath: "/path/a",
            brokenCount: 2,
            conversations: [
              { conversationId: cid1, title: "Chat 1" },
              { conversationId: cid2, title: "Chat 2" },
            ],
          },
        ],
      });

      const result = healAllBrokenChats("app");
      expect(result.totalHealed).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("healAllBrokenChats with a subagent tree", () => {
    const statsWith = (conversations: InvalidChatsStats["projectGroups"][number]["conversations"]): InvalidChatsStats => ({
      target: "app",
      summariesDbPath,
      exists: true,
      totalChats: 5,
      invalidChats: 4,
      validChats: 1,
      projectGroups: [{ projectName: "p", workspacePath: "/p", brokenCount: 4, conversations }],
    });

    it("heals nested broken subagents, never an intact parent or a container row, and skips chats with a backup", () => {
      for (const cid of ["broken-main", "nested-sub", "orphan-sub", "under-intact", "has-backup", "intact-main"]) {
        mockSummariesStore.set(cid, { conversation_id: cid });
      }
      const intactPath = path.join(conversationsDir, "intact-main.db");
      fs.writeFileSync(intactPath, "real chat history");

      vi.spyOn(chatHealthResolverModule, "resolveChatHealthStats").mockReturnValue(
        statsWith([
          {
            conversationId: "broken-main",
            title: "Broken main",
            subagents: [{ conversationId: "nested-sub", title: "Nested", parentConversationId: "broken-main" }],
          },
          {
            conversationId: "intact-main",
            title: "Intact main",
            isIntactParent: true,
            subagents: [{ conversationId: "under-intact", title: "Sub", parentConversationId: "intact-main" }],
          },
          {
            conversationId: "deleted-session-gone",
            title: "Residual",
            isDeletedSessionContainer: true,
            subagents: [{ conversationId: "orphan-sub", title: "Orphan", parentConversationId: "gone" }],
          },
          { conversationId: "has-backup", title: "Backed up", hasBackup: true, matchingSnapshotId: "snap-1" },
        ]),
      );

      const result = healAllBrokenChats("app");

      expect(result).toEqual({ totalHealed: 4, failedCount: 0, errors: [] });
      for (const cid of ["broken-main", "nested-sub", "under-intact", "orphan-sub"]) {
        expect(fs.existsSync(path.join(conversationsDir, `${cid}.db`))).toBe(true);
      }
      expect(fs.existsSync(path.join(conversationsDir, "has-backup.db"))).toBe(false);
      expect(fs.existsSync(path.join(conversationsDir, "deleted-session-gone.db"))).toBe(false);
      expect(fs.readFileSync(intactPath, "utf8")).toBe("real chat history");
    });
  });

  describe("Router & Client Actions", () => {
    it("validates Zod schemas for HealBrokenChatResult and HealAllBrokenChatsResult", () => {
      const single = { success: true, cid: "c-100" };
      expect(HealBrokenChatResultSchema.parse(single)).toEqual(single);

      const bulk = { totalHealed: 5, failedCount: 0, errors: [] };
      expect(HealAllBrokenChatsResultSchema.parse(bulk)).toEqual(bulk);
    });

    it("executes healBrokenChat via router client", async () => {
      const cid = "router-cid";
      mockSummariesStore.set(cid, { conversation_id: cid });

      const client = createRouterClient(chatHealthRouter);
      const res = await client.healBrokenChat({ target: "app", cid });
      expect(res.success).toBe(true);
      expect(res.cid).toBe(cid);
    });

    it("executes healAllBrokenChats via router client", async () => {
      vi.spyOn(chatHealthResolverModule, "resolveChatHealthStats").mockReturnValue({
        target: "app",
        summariesDbPath,
        exists: true,
        totalChats: 0,
        invalidChats: 0,
        validChats: 0,
        projectGroups: [],
      });

      const client = createRouterClient(chatHealthRouter);
      const res = await client.healAllBrokenChats({ target: "app" });
      expect(res.totalHealed).toBe(0);
      expect(res.failedCount).toBe(0);
    });

    it("delegates heal actions to IPC client", async () => {
      const mockSingle = { success: true, cid: "c-123" };
      const mockAll = { totalHealed: 3, failedCount: 0, errors: [] };

      vi.mocked(ipc.client.chatHealth.healBrokenChat).mockResolvedValueOnce(mockSingle as any);
      vi.mocked(ipc.client.chatHealth.healAllBrokenChats).mockResolvedValueOnce(mockAll as any);

      const r1 = await healBrokenChatAction("app", "c-123");
      expect(ipc.client.chatHealth.healBrokenChat).toHaveBeenCalledWith({ target: "app", cid: "c-123" });
      expect(r1).toEqual(mockSingle);

      const r2 = await healAllBrokenChatsAction("app");
      expect(ipc.client.chatHealth.healAllBrokenChats).toHaveBeenCalledWith({ target: "app" });
      expect(r2).toEqual(mockAll);
    });
  });
});
