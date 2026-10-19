import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouterClient } from "@orpc/server";
import * as pathsModule from "@/shared/platform/paths";
import {
  getLiveTrajectoryCids,
  matchBackupSnapshots,
  resolveBrokenChatBackups,
  filterSnapshotChatsForStale,
  filterSnapshotsForStale,
  resolveChatHealthStats,
  resolveChatHealth,
} from "@/modules/antigravity-runtime/conversation/chatHealthResolver";
import {
  parseWorkspaceInfo,
  parseTimestamp,
} from "@/modules/antigravity-runtime/conversation/workspaceInfo";
import { chatHealthRouter } from "@/modules/antigravity-runtime/ipc/chatHealthRouter";
import { getChatHealthReport } from "@/modules/antigravity-runtime/actions/chatHealth";
import { ipc } from "@/ipc/manager";
import type { BrokenChatItem } from "@/modules/antigravity-runtime/conversation/types";
import type { BackupSnapshot } from "@/modules/antigravity-runtime/backup/chatBackup";

interface MockSummaryRow {
  conversation_id: string;
  title?: string | null;
  workspace_uris?: string | null;
  last_modified_time?: string | number | null;
  parent_conversation_id?: string | null;
  nesting_depth?: number | null;
  agent_name?: string | null;
  preview?: string | null;
}

interface MockDbState {
  conversationSummaries: MockSummaryRow[];
  tableExists: boolean;
  configuredBusyTimeout?: number;
  readOnly?: boolean;
  shouldThrowOnPrepare?: boolean;
  failModernColumns?: boolean;
  failMidColumns?: boolean;
}

const mockDbState: MockDbState = {
  conversationSummaries: [],
  tableExists: true,
};

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      public dbPath: string;

      constructor(dbPath: string) {
        this.dbPath = dbPath;
      }

      pragma(cmd: string) {
        if (cmd.startsWith("busy_timeout")) {
          const match = cmd.match(/\d+/);
          if (match) mockDbState.configuredBusyTimeout = parseInt(match[0], 10);
        }
        return [];
      }

      prepare(sql: string) {
        if (mockDbState.shouldThrowOnPrepare) {
          throw new Error("database is locked");
        }

        if (sql.includes("sqlite_master")) {
          return {
            get: () =>
              mockDbState.tableExists
                ? { name: "conversation_summaries" }
                : undefined,
          };
        }

        if (mockDbState.failModernColumns && sql.includes("agent_name")) {
          throw new Error("no such column: agent_name");
        }

        if (mockDbState.failMidColumns && sql.includes("workspace_uris")) {
          throw new Error("no such column: workspace_uris");
        }

        if (sql.includes("FROM conversation_summaries")) {
          return {
            all: () =>
              mockDbState.conversationSummaries.map((item) => ({ ...item })),
          };
        }

        return {
          get: () => undefined,
          all: () => [],
          run: () => ({ changes: 0 }),
        };
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
      },
    },
  },
}));

describe("Chat Health Resolver", () => {
  let tempDir: string;
  let conversationsDir: string;
  let summariesDbPath: string;
  let backupsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-health-test-"));
    const appDir = path.join(tempDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    conversationsDir = path.join(appDir, "conversations");
    fs.mkdirSync(conversationsDir, { recursive: true });
    summariesDbPath = path.join(appDir, "conversation_summaries.db");
    backupsDir = path.join(tempDir, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });

    mockDbState.conversationSummaries = [];
    mockDbState.tableExists = true;
    mockDbState.configuredBusyTimeout = undefined;
    mockDbState.shouldThrowOnPrepare = false;
    mockDbState.failModernColumns = false;
    mockDbState.failMidColumns = false;

    vi.spyOn(pathsModule, "getAntigravityConversationsDir").mockImplementation(
      (target) => path.join(tempDir, target ?? "app", "conversations"),
    );
    vi.spyOn(
      pathsModule,
      "getAntigravityConversationSummariesDbPath",
    ).mockImplementation((target) =>
      path.join(tempDir, target ?? "app", "conversation_summaries.db"),
    );
    vi.spyOn(pathsModule, "getBackupsDir").mockReturnValue(backupsDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Live vs Stale Trajectory Resolution", () => {
    it("flags conversations missing trajectory files as broken and identifies healthy chats", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "chat-healthy-1",
          title: "Healthy Thread",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "chat-broken-1",
          title: "Broken Thread",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 2000,
        },
      ];

      fs.writeFileSync(
        path.join(conversationsDir, "chat-healthy-1.db"),
        "trajectory data",
      );

      const stats = resolveChatHealthStats("app");
      expect(stats.exists).toBe(true);
      expect(stats.totalChats).toBe(2);
      expect(stats.validChats).toBe(1);
      expect(stats.invalidChats).toBe(1);
      expect(stats.projectGroups.length).toBe(1);
      expect(stats.projectGroups[0].conversations[0].conversationId).toBe(
        "chat-broken-1",
      );
      expect(stats.projectGroups[0].conversations[0].hasBackup).toBe(false);
    });

    it("uses in-memory Set lookup from a single readdir call without probing files individually", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      const items: MockSummaryRow[] = [];
      for (let i = 0; i < 50; i++) {
        items.push({
          conversation_id: `cid-${i}`,
          title: `Title ${i}`,
          workspace_uris: "[]",
          last_modified_time: 1000 + i,
        });
      }
      mockDbState.conversationSummaries = items;

      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(path.join(conversationsDir, `cid-${i}.db`), "data");
      }

      const readdirSpy = vi.spyOn(fs, "readdirSync");
      const existsSpy = vi.spyOn(fs, "existsSync");

      const stats = resolveChatHealthStats("app");
      expect(stats.validChats).toBe(20);
      expect(stats.invalidChats).toBe(30);

      const convDirReads = readdirSpy.mock.calls.filter((call) =>
        String(call[0]).endsWith("conversations"),
      );
      expect(convDirReads.length).toBeGreaterThanOrEqual(1);

      const individualProbes = existsSpy.mock.calls.filter((call) =>
        String(call[0]).includes("cid-"),
      );
      expect(individualProbes.length).toBe(0);
    });

    it("handles readdirSync errors gracefully when resolving live trajectory IDs", () => {
      vi.spyOn(fs, "readdirSync").mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });
      const cids = getLiveTrajectoryCids("app");
      expect(cids.size).toBe(0);
    });

    it("returns empty set when conversations directory does not exist", () => {
      const cids = getLiveTrajectoryCids("ide");
      expect(cids.size).toBe(0);
    });
  });

  describe("Backup Snapshot Availability Matching", () => {
    it("tags broken chats with hasBackup true and matchingSnapshotId when trajectory exists in snapshot", () => {
      const snapTargetDir = path.join(backupsDir, "app");
      const olderSnapDir = path.join(snapTargetDir, "snapshot_100");
      const newerSnapDir = path.join(snapTargetDir, "snapshot_200");
      fs.mkdirSync(olderSnapDir, { recursive: true });
      fs.mkdirSync(newerSnapDir, { recursive: true });

      const olderManifest: BackupSnapshot = {
        id: "snapshot_100",
        target: "app",
        type: "pre_switch",
        createdAt: 100,
        sizeBytes: 1024,
        chatCount: 1,
        protectedFromPruning: false,
        chats: [
          {
            conversationId: "c-older",
            title: "Older Chat",
            hasTrajectoryDb: true,
          },
        ],
      };
      const newerManifest: BackupSnapshot = {
        id: "snapshot_200",
        target: "app",
        type: "pre_switch",
        createdAt: 200,
        sizeBytes: 2048,
        chatCount: 2,
        protectedFromPruning: false,
        chats: [
          {
            conversationId: "c-both",
            title: "Both Chat",
            hasTrajectoryDb: true,
          },
          {
            conversationId: "c-summary-only",
            title: "No Trajectory",
            hasTrajectoryDb: false,
          },
        ],
      };

      fs.writeFileSync(
        path.join(olderSnapDir, "manifest.json"),
        JSON.stringify(olderManifest),
      );
      fs.writeFileSync(
        path.join(newerSnapDir, "manifest.json"),
        JSON.stringify(newerManifest),
      );

      const brokenItems: BrokenChatItem[] = [
        { conversationId: "c-older", title: "Older" },
        { conversationId: "c-both", title: "Both" },
        { conversationId: "c-summary-only", title: "Summary Only" },
        { conversationId: "c-nowhere", title: "Nowhere" },
      ];

      const resolved = resolveBrokenChatBackups(brokenItems, "app");

      const olderResult = resolved.find((c) => c.conversationId === "c-older");
      expect(olderResult?.hasBackup).toBe(true);
      expect(olderResult?.matchingSnapshotId).toBe("snapshot_100");

      const bothResult = resolved.find((c) => c.conversationId === "c-both");
      expect(bothResult?.hasBackup).toBe(true);
      expect(bothResult?.matchingSnapshotId).toBe("snapshot_200");

      const summaryOnlyResult = resolved.find(
        (c) => c.conversationId === "c-summary-only",
      );
      expect(summaryOnlyResult?.hasBackup).toBe(false);
      expect(summaryOnlyResult?.matchingSnapshotId).toBeUndefined();

      const nowhereResult = resolved.find(
        (c) => c.conversationId === "c-nowhere",
      );
      expect(nowhereResult?.hasBackup).toBe(false);
      expect(nowhereResult?.matchingSnapshotId).toBeUndefined();
    });

    it("handles empty conversation id list and empty snapshots gracefully", () => {
      const matchMapEmptyCids = matchBackupSnapshots([], "app");
      expect(matchMapEmptyCids.size).toBe(0);

      const matchMapEmptySnaps = matchBackupSnapshots(["conv-x"], "ide");
      expect(matchMapEmptySnaps.size).toBe(0);

      const resolvedEmpty = resolveBrokenChatBackups([], "app");
      expect(resolvedEmpty).toEqual([]);
    });

    it("matches trajectory files located physically on disk in snapshot directory", () => {
      const snapTargetDir = path.join(backupsDir, "app");
      const snapDir = path.join(snapTargetDir, "snapshot_disk");
      const snapConvDir = path.join(snapDir, "conversations");
      fs.mkdirSync(snapConvDir, { recursive: true });

      fs.writeFileSync(
        path.join(snapDir, "manifest.json"),
        JSON.stringify({
          id: "snapshot_disk",
          target: "app",
          type: "pre_switch",
          createdAt: 300,
          sizeBytes: 512,
          chatCount: 0,
          protectedFromPruning: false,
          chats: [],
        }),
      );
      fs.writeFileSync(path.join(snapConvDir, "c-disk-file.db"), "data");

      const brokenItems: BrokenChatItem[] = [
        { conversationId: "c-disk-file", title: "Disk File Chat" },
      ];
      const resolved = resolveBrokenChatBackups(brokenItems, "app");
      expect(resolved[0].hasBackup).toBe(true);
      expect(resolved[0].matchingSnapshotId).toBe("snapshot_disk");
    });

    it("handles readdirSync error when scanning snapshot conversations dir gracefully", () => {
      const snapTargetDir = path.join(backupsDir, "app");
      const snapDir = path.join(snapTargetDir, "snapshot_err");
      const snapConv = path.join(snapDir, "conversations");
      fs.mkdirSync(snapConv, { recursive: true });
      fs.writeFileSync(
        path.join(snapDir, "manifest.json"),
        JSON.stringify({
          id: "snapshot_err",
          target: "app",
          type: "manual",
          createdAt: 50,
          sizeBytes: 100,
          chatCount: 0,
          protectedFromPruning: false,
          chats: [],
        }),
      );

      const origReaddir = fs.readdirSync;
      const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation(((targetPath: unknown, options?: unknown) => {
        if (String(targetPath) === snapConv) {
          throw new Error("EACCES: permission denied");
        }
        return origReaddir(targetPath as fs.PathLike, options as never);
      }) as never);

      const matchMap = matchBackupSnapshots(["conv-err"], "app");
      expect(matchMap.size).toBe(0);
      readdirSpy.mockRestore();
    });
  });

  describe("Stale-Only Filtering Pipeline", () => {
    it("excludes chats that exist in live store and returns only missing chats", () => {
      const liveCids = new Set(["chat-live-1", "chat-live-2"]);
      const snapshotChats = [
        {
          conversationId: "chat-live-1",
          title: "Live 1",
          hasTrajectoryDb: true,
        },
        {
          conversationId: "chat-stale-1",
          title: "Stale 1",
          hasTrajectoryDb: true,
        },
        {
          conversationId: "chat-live-2",
          title: "Live 2",
          hasTrajectoryDb: true,
        },
        {
          conversationId: "chat-stale-2",
          title: "Stale 2",
          hasTrajectoryDb: false,
        },
      ];

      const filtered = filterSnapshotChatsForStale(snapshotChats, liveCids);
      expect(filtered.map((c) => c.conversationId)).toEqual([
        "chat-stale-1",
        "chat-stale-2",
      ]);
    });

    it("filters backup snapshot chats and updates chatCount", () => {
      const liveCids = new Set(["c-live"]);
      const snapshots: BackupSnapshot[] = [
        {
          id: "snap-1",
          target: "app",
          type: "manual",
          createdAt: 500,
          sizeBytes: 100,
          chatCount: 2,
          protectedFromPruning: false,
          chats: [
            { conversationId: "c-live", title: "Live", hasTrajectoryDb: true },
            {
              conversationId: "c-stale",
              title: "Stale",
              hasTrajectoryDb: true,
            },
          ],
        },
      ];

      const result = filterSnapshotsForStale(snapshots, liveCids);
      expect(result[0].chats.length).toBe(1);
      expect(result[0].chats[0].conversationId).toBe("c-stale");
      expect(result[0].chatCount).toBe(1);
    });

    it("filters snapshot chats to stale-only when staleOnly is true on resolveChatHealth", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      fs.writeFileSync(
        path.join(conversationsDir, "chat-live-1.db"),
        "trajectory data",
      );

      const snapTargetDir = path.join(backupsDir, "app");
      const snapDir = path.join(snapTargetDir, "snapshot_test");
      fs.mkdirSync(snapDir, { recursive: true });

      const snapManifest: BackupSnapshot = {
        id: "snapshot_test",
        target: "app",
        type: "manual",
        createdAt: 1000,
        sizeBytes: 2048,
        chatCount: 2,
        protectedFromPruning: false,
        chats: [
          {
            conversationId: "chat-live-1",
            title: "Live Chat",
            hasTrajectoryDb: true,
          },
          {
            conversationId: "chat-stale-1",
            title: "Stale Chat",
            hasTrajectoryDb: true,
          },
        ],
      };
      fs.writeFileSync(
        path.join(snapDir, "manifest.json"),
        JSON.stringify(snapManifest),
      );

      const report = resolveChatHealth("app", { staleOnly: true });
      expect(report.target).toBe("app");
      expect(report.snapshots.length).toBe(1);
      expect(report.snapshots[0].chats.length).toBe(1);
      expect(report.snapshots[0].chats[0].conversationId).toBe("chat-stale-1");
      expect(report.snapshots[0].chatCount).toBe(1);
    });
  });

  describe("Multi-Target Isolation & Error Resilience", () => {
    it("isolates lookups strictly to the requested target directory", () => {
      const appConv = path.join(tempDir, "app", "conversations");
      const ideConv = path.join(tempDir, "ide", "conversations");
      fs.mkdirSync(appConv, { recursive: true });
      fs.mkdirSync(ideConv, { recursive: true });

      fs.writeFileSync(path.join(appConv, "chat-app.db"), "data");
      fs.writeFileSync(path.join(ideConv, "chat-ide.db"), "data");

      const appCids = getLiveTrajectoryCids("app");
      const ideCids = getLiveTrajectoryCids("ide");

      expect(appCids.has("chat-app")).toBe(true);
      expect(appCids.has("chat-ide")).toBe(false);

      expect(ideCids.has("chat-ide")).toBe(true);
      expect(ideCids.has("chat-app")).toBe(false);
    });

    it("applies 5000ms busy timeout on SQLite connection", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      resolveChatHealthStats("app");
      expect(mockDbState.configuredBusyTimeout).toBe(5000);
    });

    it("returns zero counts and exists false when database does not exist", () => {
      const stats = resolveChatHealthStats("cli");
      expect(stats.exists).toBe(false);
      expect(stats.totalChats).toBe(0);
      expect(stats.invalidChats).toBe(0);
      expect(stats.projectGroups).toEqual([]);
    });

    it("handles database missing conversation_summaries table gracefully", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.tableExists = false;

      const stats = resolveChatHealthStats("app");
      expect(stats.exists).toBe(true);
      expect(stats.totalChats).toBe(0);
      expect(stats.invalidChats).toBe(0);
      expect(stats.validChats).toBe(0);
      expect(stats.projectGroups).toEqual([]);
    });

    it("falls back to mid and minimal select queries when modern columns are missing", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "legacy-chat-1",
          title: "Legacy Chat",
          workspace_uris: JSON.stringify(["file:///Users/dev/legacy"]),
          last_modified_time: 1500,
        },
      ];

      mockDbState.failModernColumns = true;
      const statsMid = resolveChatHealthStats("app");
      expect(statsMid.totalChats).toBe(1);
      expect(statsMid.invalidChats).toBe(1);

      mockDbState.failMidColumns = true;
      const statsMin = resolveChatHealthStats("app");
      expect(statsMin.totalChats).toBe(1);
      expect(statsMin.invalidChats).toBe(1);
    });

    it("captures sqlite errors and returns error result structure", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.shouldThrowOnPrepare = true;

      const stats = resolveChatHealthStats("app");
      expect(stats.exists).toBe(true);
      expect(stats.error).toBe("database is locked");
      expect(stats.totalChats).toBe(0);
      expect(stats.projectGroups).toEqual([]);
    });

    it("sorts project groups with named projects alphabetical and fallback project last", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "c-fallback",
          title: "Scratchpad",
          workspace_uris: "[]",
          last_modified_time: 1000,
        },
        {
          conversation_id: "c-beta-1",
          title: "Beta Task 1",
          workspace_uris: JSON.stringify(["file:///Users/dev/beta-project"]),
          last_modified_time: 2000,
        },
        {
          conversation_id: "c-beta-2",
          title: "Beta Task 2",
          workspace_uris: JSON.stringify(["file:///Users/dev/beta-project"]),
          last_modified_time: 2000,
        },
        {
          conversation_id: "c-alpha-1",
          title: "Alpha Task",
          workspace_uris: JSON.stringify(["file:///Users/dev/alpha-project"]),
          last_modified_time: 1500,
        },
        {
          conversation_id: "c-alpha-2",
          title: "Alpha Task Secondary",
          workspace_uris: JSON.stringify(["file:///Users/dev/sub/alpha-project"]),
          last_modified_time: 1500,
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.invalidChats).toBe(5);
      expect(stats.projectGroups.length).toBe(4);
      expect(stats.projectGroups[0].projectName).toBe("alpha-project");
      expect(stats.projectGroups[1].projectName).toBe("alpha-project");
      expect(stats.projectGroups[2].projectName).toBe("beta-project");
      expect(stats.projectGroups[3].projectName).toBe("Global / No Workspace");

      const betaGroup = stats.projectGroups.find((g) => g.projectName === "beta-project");
      expect(betaGroup?.conversations[0].conversationId).toBe("c-beta-1");
      expect(betaGroup?.conversations[1].conversationId).toBe("c-beta-2");
    });
  });

  describe("Workspace Info & Timestamp Parsing Utilities", () => {
    it("parses valid ISO string and returns ms timestamp", () => {
      const isoStr = "2026-09-28T12:00:00.000Z";
      expect(parseTimestamp(isoStr)).toBe(Date.parse(isoStr));
    });

    it("returns undefined for malformed timestamp strings or empty input", () => {
      expect(parseTimestamp("invalid-date-format")).toBeUndefined();
      expect(parseTimestamp("")).toBeUndefined();
      expect(parseTimestamp(null)).toBeUndefined();
    });

    it("falls back to default project name for root drive or single dot path", () => {
      const rootDriveRes = parseWorkspaceInfo(JSON.stringify(["file:///C:/"]));
      expect(rootDriveRes.projectName).toBe("Global / No Workspace");

      const singleDotRes = parseWorkspaceInfo(JSON.stringify(["file:///Users/dev/."]));
      expect(singleDotRes.projectName).toBe("Global / No Workspace");
    });

    it("handles various edge cases in workspace URI parsing", () => {
      expect(parseWorkspaceInfo("").projectName).toBe("Global / No Workspace");
      expect(parseWorkspaceInfo(null).projectName).toBe("Global / No Workspace");
      expect(parseWorkspaceInfo("[]").projectName).toBe("Global / No Workspace");
      expect(parseWorkspaceInfo("null").projectName).toBe("Global / No Workspace");
      expect(parseWorkspaceInfo("[null]").projectName).toBe("Global / No Workspace");
      expect(parseWorkspaceInfo(JSON.stringify(["   "])).projectName).toBe("Global / No Workspace");

      const fileLocal = parseWorkspaceInfo("file://localhost/Users/dev/local-project");
      expect(fileLocal.projectName).toBe("local-project");

      const winLeadingSlash = parseWorkspaceInfo(JSON.stringify(["file:///c:/Users/dev/win-project"]));
      expect(winLeadingSlash.projectName).toBe("win-project");

      const malformedPercent = parseWorkspaceInfo(JSON.stringify(["file:///Users/dev/%E0%A4%A/escaped"]));
      expect(malformedPercent.projectName).toBe("escaped");

      const jsonStringRes = parseWorkspaceInfo(JSON.stringify("file:///Users/dev/json-string-project"));
      expect(jsonStringRes.projectName).toBe("json-string-project");
    });
  });

  describe("oRPC Procedure & Client Action", () => {
    it("executes getHealth procedure returning unified report", async () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      const client = createRouterClient(chatHealthRouter);
      const report = await client.getHealth({ target: "app" });

      expect(report.target).toBe("app");
      expect(report.cleanerStats).toBeDefined();
      expect(report.backupStats).toBeDefined();
      expect(report.snapshots).toBeDefined();
    });

    it("delegates getChatHealthReport action to ipc client", async () => {
      const mockReport = {
        target: "app",
        cleanerStats: {
          target: "app",
          summariesDbPath: "/dummy",
          exists: true,
          totalChats: 0,
          invalidChats: 0,
          validChats: 0,
          projectGroups: [],
        },
        backupStats: {
          target: "app",
          totalSizeBytes: 0,
          targetSizeBytes: 0,
          snapshotCount: 0,
          exceedsStorageLimit: false,
          snapshots: [],
        },
        snapshots: [],
      };
      vi.mocked(ipc.client.chatHealth.getHealth).mockResolvedValueOnce(
        mockReport as any,
      );

      const res = await getChatHealthReport("app", true);
      expect(ipc.client.chatHealth.getHealth).toHaveBeenCalledWith({
        target: "app",
        staleOnly: true,
      });
      expect(res).toEqual(mockReport);
    });
  });

  describe("Subagent Hierarchy & Tree Resolution", () => {
    it("nests broken subagents under broken parent within same project group", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "parent-1",
          title: "Root Cascade",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "sub-1",
          title: "Subagent Task 1",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "parent-1",
          nesting_depth: 1,
          agent_name: "teamwork_preview_coder",
        },
        {
          conversation_id: "sub-2",
          title: "Subagent Task 2",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1200,
          parent_conversation_id: "parent-1",
          nesting_depth: 1,
          agent_name: "teamwork_preview_reviewer",
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.invalidChats).toBe(3);
      expect(stats.projectGroups.length).toBe(1);

      const group = stats.projectGroups[0];
      expect(group.brokenCount).toBe(3);
      expect(group.topLevelCount).toBe(1);
      expect(group.conversations.length).toBe(1);

      const parent = group.conversations[0];
      expect(parent.conversationId).toBe("parent-1");
      expect(parent.subagents?.length).toBe(2);
      expect(parent.subagents?.[0].conversationId).toBe("sub-1");
      expect(parent.subagents?.[0].agentName).toBe("Coder");
      expect(parent.subagents?.[1].conversationId).toBe("sub-2");
      expect(parent.subagents?.[1].agentName).toBe("Reviewer");
    });

    it("sorts top-level descending by updatedAt and subagents ascending by updatedAt", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "parent-early",
          title: "Earlier Cascade",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "parent-late",
          title: "Later Cascade",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 2000,
        },
        {
          conversation_id: "sub-late-2",
          title: "Step Two",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 2500,
          parent_conversation_id: "parent-late",
          nesting_depth: 1,
          agent_name: "tester",
        },
        {
          conversation_id: "sub-late-1",
          title: "Step One",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 2100,
          parent_conversation_id: "parent-late",
          nesting_depth: 1,
          agent_name: "planner",
        },
      ];

      const stats = resolveChatHealthStats("app");
      const group = stats.projectGroups[0];
      expect(group.topLevelCount).toBe(2);
      expect(group.brokenCount).toBe(4);

      expect(group.conversations[0].conversationId).toBe("parent-late");
      expect(group.conversations[1].conversationId).toBe("parent-early");

      const lateParent = group.conversations[0];
      expect(lateParent.subagents?.length).toBe(2);
      expect(lateParent.subagents?.[0].conversationId).toBe("sub-late-1");
      expect(lateParent.subagents?.[1].conversationId).toBe("sub-late-2");
    });

    it("handles multi-depth subagent nesting correctly", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "root-tree",
          title: "Root Tree",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "child-tree",
          title: "Child Tree",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "root-tree",
          nesting_depth: 1,
          agent_name: "lead",
        },
        {
          conversation_id: "grandchild-tree",
          title: "Grandchild Tree",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1200,
          parent_conversation_id: "child-tree",
          nesting_depth: 2,
          agent_name: "worker",
        },
      ];

      const stats = resolveChatHealthStats("app");
      const group = stats.projectGroups[0];
      expect(group.topLevelCount).toBe(1);
      expect(group.brokenCount).toBe(3);
      expect(group.conversations[0].conversationId).toBe("root-tree");

      const child = group.conversations[0].subagents?.[0];
      expect(child?.conversationId).toBe("child-tree");
      expect(child?.nestingDepth).toBe(1);
      expect(child?.subagents?.length).toBe(1);

      const grandchild = child?.subagents?.[0];
      expect(grandchild?.conversationId).toBe("grandchild-tree");
      expect(grandchild?.nestingDepth).toBe(2);
      expect(grandchild?.parentConversationId).toBe("child-tree");
      expect(grandchild?.parentTitle).toBe("Child Tree");
    });

    it("groups broken subagent under intact parent container when parent trajectory is healthy on disk", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      fs.writeFileSync(
        path.join(conversationsDir, "healthy-parent.db"),
        "trajectory data",
      );

      mockDbState.conversationSummaries = [
        {
          conversation_id: "healthy-parent",
          title: "Healthy Parent Conversation",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "broken-sub",
          title: "Orphaned Subagent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "healthy-parent",
          nesting_depth: 1,
          agent_name: "teamwork_preview_document_researcher",
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.validChats).toBe(1);
      expect(stats.invalidChats).toBe(1);
      expect(stats.projectGroups.length).toBe(1);

      const group = stats.projectGroups[0];
      expect(group.topLevelCount).toBe(1);
      expect(group.brokenCount).toBe(1);

      const parentContainer = group.conversations[0];
      expect(parentContainer.conversationId).toBe("healthy-parent");
      expect(parentContainer.title).toBe("Healthy Parent Conversation");
      expect(parentContainer.isIntactParent).toBe(true);
      expect(parentContainer.hasBackup).toBe(false);
      expect(parentContainer.subagents?.length).toBe(1);

      const sub = parentContainer.subagents![0];
      expect(sub.conversationId).toBe("broken-sub");
      expect(sub.parentConversationId).toBe("healthy-parent");
      expect(sub.parentTitle).toBe("Healthy Parent Conversation");
      expect(sub.agentName).toBe("Researcher");
    });

    it("groups multiple broken subagents chronologically under an intact parent container", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      fs.writeFileSync(
        path.join(conversationsDir, "main-cascade.db"),
        "trajectory data",
      );

      mockDbState.conversationSummaries = [
        {
          conversation_id: "main-cascade",
          title: "Main Cascade Session",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "broken-sub-2",
          title: "Reviewer Subagent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1200,
          parent_conversation_id: "main-cascade",
          nesting_depth: 1,
          agent_name: "reviewer",
        },
        {
          conversation_id: "broken-sub-1",
          title: "Challenger Subagent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "main-cascade",
          nesting_depth: 1,
          agent_name: "challenger",
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.validChats).toBe(1);
      expect(stats.invalidChats).toBe(2);
      expect(stats.projectGroups.length).toBe(1);

      const group = stats.projectGroups[0];
      expect(group.topLevelCount).toBe(1);
      expect(group.brokenCount).toBe(2);

      const container = group.conversations[0];
      expect(container.conversationId).toBe("main-cascade");
      expect(container.isIntactParent).toBe(true);
      expect(container.hasBackup).toBe(false);
      expect(container.subagents?.map((s) => s.conversationId)).toEqual([
        "broken-sub-1",
        "broken-sub-2",
      ]);
    });

    it("groups broken subagent under synthesized deleted session container when parent is missing from summaries database", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "broken-orphan",
          title: "Standalone Orphan Subagent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
          parent_conversation_id: "non-existent-parent",
          nesting_depth: 1,
          agent_name: "architect",
        },
      ];

      const stats = resolveChatHealthStats("app");
      const group = stats.projectGroups[0];
      expect(group.topLevelCount).toBe(1);
      expect(group.brokenCount).toBe(1);

      const container = group.conversations[0];
      expect(container.conversationId).toBe("deleted-session-non-existent-parent");
      expect(container.title).toBe("Residual Subagents from Deleted Session");
      expect(container.isDeletedSessionContainer).toBe(true);
      expect(container.isIntactParent).toBeUndefined();
      expect(container.subagents?.length).toBe(1);

      const item = container.subagents![0];
      expect(item.conversationId).toBe("broken-orphan");
      expect(item.parentConversationId).toBe("non-existent-parent");
      expect(item.parentTitle).toBeUndefined();
      expect(item.agentName).toBe("Architect");
    });

    it("preserves all sessions when circular parent references exist", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "cycle-a",
          title: "Cycle A",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
          parent_conversation_id: "cycle-b",
        },
        {
          conversation_id: "cycle-b",
          title: "Cycle B",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "cycle-a",
        },
      ];

      const stats = resolveChatHealthStats("app");
      const group = stats.projectGroups[0];
      expect(group.brokenCount).toBe(2);
      expect(group.topLevelCount).toBeGreaterThanOrEqual(1);
    });

    it("keeps subagent at top level when parent belongs to another workspace", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      mockDbState.conversationSummaries = [
        {
          conversation_id: "workspace-a-parent",
          title: "Workspace A Parent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project-a"]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "workspace-b-sub",
          title: "Workspace B Subagent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project-b"]),
          last_modified_time: 1100,
          parent_conversation_id: "workspace-a-parent",
          nesting_depth: 1,
          agent_name: "coder",
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.projectGroups.length).toBe(2);

      const groupB = stats.projectGroups.find((g) => g.projectName === "project-b");
      expect(groupB).toBeDefined();
      expect(groupB?.topLevelCount).toBe(1);
      expect(groupB?.brokenCount).toBe(1);

      const subInB = groupB?.conversations[0];
      expect(subInB?.conversationId).toBe("workspace-b-sub");
      expect(subInB?.parentConversationId).toBe("workspace-a-parent");
      expect(subInB?.parentTitle).toBe("Workspace A Parent");
    });

    it("never labels an intact subagent with nesting_depth > 0 as Main Chat", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      fs.writeFileSync(
        path.join(conversationsDir, "orch-depth2.db"),
        "trajectory data",
      );

      mockDbState.conversationSummaries = [
        {
          conversation_id: "orch-depth2",
          title: "Orchestrator 27df8007",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
          parent_conversation_id: "preview-depth1",
          nesting_depth: 2,
          agent_name: "orchestrator",
        },
        {
          conversation_id: "broken-task",
          title: "Broken Task Subagent",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "orch-depth2",
          nesting_depth: 3,
          agent_name: "coder",
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.validChats).toBe(1);
      expect(stats.invalidChats).toBe(1);
      const group = stats.projectGroups[0];
      const container = group.conversations[0];
      expect(container.isIntactParent).toBeUndefined();
      expect(container.isDeletedSessionContainer).toBe(true);
      expect(container.conversationId).toBe("deleted-session-preview-depth1");
    });

    it("groups broken subagents under intact root main chat when intermediate subagents are intact", () => {
      fs.writeFileSync(summariesDbPath, "sqlite header");
      fs.writeFileSync(
        path.join(conversationsDir, "main-root.db"),
        "trajectory data",
      );
      fs.writeFileSync(
        path.join(conversationsDir, "orch-sub.db"),
        "trajectory data",
      );

      mockDbState.conversationSummaries = [
        {
          conversation_id: "main-root",
          title: "Intact Main Chat",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1000,
          nesting_depth: 0,
        },
        {
          conversation_id: "orch-sub",
          title: "Orchestrator Sub",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1050,
          parent_conversation_id: "main-root",
          nesting_depth: 1,
          agent_name: "orchestrator",
        },
        {
          conversation_id: "broken-leaf",
          title: "Broken Leaf",
          workspace_uris: JSON.stringify(["file:///Users/dev/project"]),
          last_modified_time: 1100,
          parent_conversation_id: "orch-sub",
          nesting_depth: 2,
          agent_name: "coder",
        },
      ];

      const stats = resolveChatHealthStats("app");
      expect(stats.validChats).toBe(2);
      expect(stats.invalidChats).toBe(1);
      const group = stats.projectGroups[0];
      expect(group.topLevelCount).toBe(1);
      const container = group.conversations[0];
      expect(container.conversationId).toBe("main-root");
      expect(container.isIntactParent).toBe(true);
      expect(container.isDeletedSessionContainer).toBeUndefined();
      expect(container.subagents?.length).toBe(1);
      expect(container.subagents![0].conversationId).toBe("broken-leaf");
    });
  });
});
