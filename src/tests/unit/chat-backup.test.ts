import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// In-memory mock SQLite state for better-sqlite3
const mockDatabases = new Map<string, Map<string, Record<string, unknown>>>();
const mockTableSchemas = new Map<string, Array<{ name: string }>>();

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      public dbPath: string;
      public store: Map<string, Record<string, unknown>>;

      constructor(dbPath: string) {
        this.dbPath = dbPath;
        let existing = mockDatabases.get(dbPath);
        if (!existing) {
          existing = new Map();
          for (const [p, s] of mockDatabases.entries()) {
            if (path.basename(p) === path.basename(dbPath)) {
              for (const [k, v] of s.entries()) {
                existing.set(k, { ...v });
              }
              break;
            }
          }
          mockDatabases.set(dbPath, existing);
        }
        this.store = existing;
      }

      pragma(cmd: string) {
        if (cmd.includes("table_info")) {
          if (mockTableSchemas.has(this.dbPath)) {
            return mockTableSchemas.get(this.dbPath);
          }
          if (this.dbPath.includes("no-cols")) {
            return [];
          }
          return [
            { name: "conversation_id" },
            { name: "title" },
            { name: "last_modified_time" },
          ];
        }
        return [];
      }

      exec(_sql: string) {
        return this;
      }

      prepare(sql: string) {
        const store = this.store;
        if (sql.includes("sqlite_master")) {
          return {
            get: () => ({ sql: "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, last_modified_time INTEGER);" }),
          };
        }
        if (sql.includes("not_fully_idle")) {
          return {
            all: () => [],
          };
        }
        if (sql.includes("ORDER BY last_modified_time DESC LIMIT 1")) {
          return {
            get: () => {
              const rows = Array.from(store.values());
              rows.sort((a, b) => Number(b.last_modified_time ?? 0) - Number(a.last_modified_time ?? 0));
              return rows[0];
            },
          };
        }
        if (sql.includes("WHERE conversation_id = ?")) {
          return {
            get: (cid: string) => store.get(cid),
            all: (cid: string) => [store.get(cid)].filter(Boolean),
          };
        }
        if (sql.includes("WHERE conversation_id IN")) {
          return {
            all: (...ids: string[]) => ids.map((id) => store.get(id)).filter(Boolean),
          };
        }
        if (sql.startsWith("SELECT")) {
          return {
            all: () => Array.from(store.values()),
          };
        }
        if (sql.includes("INSERT OR REPLACE")) {
          const match = sql.match(/INSERT OR REPLACE INTO conversation_summaries \(([^)]+)\)/);
          const colNames = match
            ? match[1].split(",").map((s) => s.trim())
            : ["conversation_id", "title", "last_modified_time"];
          return {
            run: (...vals: unknown[]) => {
              const cid = String(vals[0]);
              if (cid === "fail-tx") {
                throw new Error("Simulated SQLite write error");
              }
              const row: Record<string, unknown> = {};
              colNames.forEach((col, idx) => {
                row[col] = vals[idx];
              });
              store.set(cid, row);
            },
          };
        }
        return {
          run: () => {},
          get: () => undefined,
          all: () => [],
        };
      }

      transaction(fn: (...args: unknown[]) => unknown) {
        return (...args: unknown[]) => fn(...args);
      }

      close() {}
    },
  };
});

import {
  createPreSwitchBackup,
  createPreCleanRollback,
  restoreSnapshot,
  restoreSingleChat,
  getBackupStats,
  listBackupSnapshots,
  pruneBackups,
  enforcePreSwitchFifo,
} from "@/modules/antigravity-runtime/backup/chatBackup";
import * as pathsModule from "@/shared/platform/paths";

describe("Chat Auto-Backup and Restore Core Engine", () => {
  let tempBaseDir: string;
  let fakeBackupsDir: string;
  let fakeConversationsDir: string;
  let fakeAnnotationsDir: string;
  let fakeSummariesDbPath: string;

  beforeEach(() => {
    mockDatabases.clear();
    mockTableSchemas.clear();
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-backup-test-"));
    fakeBackupsDir = path.join(tempBaseDir, "backups");
    fakeConversationsDir = path.join(tempBaseDir, "conversations");
    fakeAnnotationsDir = path.join(tempBaseDir, "annotations");
    fakeSummariesDbPath = path.join(tempBaseDir, "conversation_summaries.db");

    fs.mkdirSync(fakeBackupsDir, { recursive: true });
    fs.mkdirSync(fakeConversationsDir, { recursive: true });
    fs.mkdirSync(fakeAnnotationsDir, { recursive: true });

    vi.spyOn(pathsModule, "getBackupsDir").mockReturnValue(fakeBackupsDir);
    vi.spyOn(pathsModule, "getAntigravityConversationsDir").mockReturnValue(fakeConversationsDir);
    vi.spyOn(pathsModule, "getAntigravityAnnotationsDir").mockReturnValue(fakeAnnotationsDir);
    vi.spyOn(pathsModule, "getAntigravityConversationSummariesDbPath").mockReturnValue(fakeSummariesDbPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  function createTestDb(dbPath: string, rows: Array<{ conversation_id: string; title: string; last_modified_time?: number }>) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "sqlite-binary-stub");
    const store = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      store.set(r.conversation_id, {
        conversation_id: r.conversation_id,
        title: r.title,
        last_modified_time: r.last_modified_time ?? Date.now(),
      });
    }
    mockDatabases.set(dbPath, store);
  }

  describe("createPreSwitchBackup", () => {
    it("returns null if summaries database does not exist", async () => {
      const result = await createPreSwitchBackup("app");
      expect(result).toBeNull();
    });

    it("creates Tier 1 snapshot with summaries db and active cid trajectory and annotations", async () => {
      const cid = "test-active-cid";
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: cid, title: "Active Turn Session", last_modified_time: 1000 },
        { conversation_id: "other-cid", title: "Previous Chat", last_modified_time: 500 },
      ]);

      const trajPath = path.join(fakeConversationsDir, `${cid}.db`);
      fs.writeFileSync(trajPath, "mock trajectory binary data");
      const annPath = path.join(fakeAnnotationsDir, `${cid}.pbtxt`);
      fs.writeFileSync(annPath, "mock annotations pbtxt");

      const snapshot = await createPreSwitchBackup("app", cid);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.target).toBe("app");
      expect(snapshot?.type).toBe("pre_switch");
      expect(snapshot?.protectedFromPruning).toBe(false);
      expect(snapshot?.activeConversationId).toBe(cid);
      expect(snapshot?.chatCount).toBe(2);

      const targetBackupsDir = path.join(fakeBackupsDir, "app", snapshot!.id);
      expect(fs.existsSync(path.join(targetBackupsDir, "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(targetBackupsDir, "conversation_summaries.db"))).toBe(true);
      expect(fs.existsSync(path.join(targetBackupsDir, "conversations", `${cid}.db`))).toBe(true);
      expect(fs.existsSync(path.join(targetBackupsDir, "annotations", `${cid}.pbtxt`))).toBe(true);
    });

    it("falls back to most recently updated chat if activeCid not explicitly passed", async () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "older-cid", title: "Older Chat", last_modified_time: 100 },
        { conversation_id: "latest-cid", title: "Latest Chat", last_modified_time: 900 },
      ]);

      const snapshot = await createPreSwitchBackup("app");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.activeConversationId).toBe("latest-cid");
    });
  });

  describe("createPreCleanRollback", () => {
    it("creates protected Tier 3 rollback snapshot containing orphaned chat metadata", () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "orphan-1", title: "Broken Chat 1" },
        { conversation_id: "orphan-2", title: "Broken Chat 2" },
        { conversation_id: "valid-chat", title: "Valid Chat" },
      ]);

      const snapshot = createPreCleanRollback("app", ["orphan-1", "orphan-2"]);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.type).toBe("pre_clean");
      expect(snapshot?.protectedFromPruning).toBe(true);
      expect(snapshot?.chatCount).toBe(2);
      expect(snapshot?.chats.map((c) => c.conversationId)).toEqual(["orphan-1", "orphan-2"]);
    });

    it("returns null if summaries database does not exist or invalidCids is empty", () => {
      expect(createPreCleanRollback("app", [])).toBeNull();
      expect(createPreCleanRollback("app", ["any-id"])).toBeNull();
    });
  });

  describe("restoreSnapshot", () => {
    it("executes full snapshot restore, unlinks proto mirrors, and updates conversation_summaries", async () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "chat-1", title: "Chat 1" },
      ]);
      fs.writeFileSync(path.join(fakeConversationsDir, "chat-1.db"), "chat 1 content");

      const snapshot = await createPreSwitchBackup("app", "chat-1");
      expect(snapshot).not.toBeNull();

      // Clear live database store and remove live trajectory
      mockDatabases.get(fakeSummariesDbPath)?.clear();
      fs.rmSync(path.join(fakeConversationsDir, "chat-1.db"));

      const protoPath = path.join(path.dirname(fakeSummariesDbPath), "agyhub_summaries_proto.pb");
      fs.writeFileSync(protoPath, "stale proto binary");
      expect(fs.existsSync(protoPath)).toBe(true);

      const restoreResult = await restoreSnapshot("app", snapshot!.id);
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.restoredChatCount).toBe(1);
      expect(restoreResult.restoredConversationIds).toContain("chat-1");

      // Verify trajectory restored
      expect(fs.existsSync(path.join(fakeConversationsDir, "chat-1.db"))).toBe(true);

      // Verify sqlite row restored in live store
      const liveStore = mockDatabases.get(fakeSummariesDbPath);
      expect(liveStore?.get("chat-1")).toBeDefined();

      // Verify stale proto mirror unlinked
      expect(fs.existsSync(protoPath)).toBe(false);
    });

    it("returns error result if snapshot does not exist", async () => {
      const res = await restoreSnapshot("app", "non-existent-snapshot");
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.errors).toBeDefined();
    });

    it("returns error result if snapshotId is missing", async () => {
      const res = await restoreSnapshot("app", "");
      expect(res.success).toBe(false);
      expect(res.error).toBe("Missing snapshot ID");
      expect(res.errors).toEqual(["Missing snapshot ID"]);
    });

    it("returns error result if snapshot database is missing inside snapshot directory", async () => {
      const snapDir = path.join(fakeBackupsDir, "app", "snap-missing-db");
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify({ id: "snap-missing-db", target: "app" }));
      const res = await restoreSnapshot("app", "snap-missing-db");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Snapshot database not found");
      expect(res.errors).toBeDefined();
    });

    it("returns error result if conversation_summaries table has no columns", async () => {
      const snapDir = path.join(fakeBackupsDir, "app", "no-cols-snap");
      fs.mkdirSync(snapDir, { recursive: true });
      createTestDb(path.join(snapDir, "conversation_summaries.db"), [
        { conversation_id: "chat-x", title: "Chat X" },
      ]);
      const res = await restoreSnapshot("app", "no-cols-snap");
      expect(res.success).toBe(false);
      expect(res.error).toBe("No matching columns found in conversation_summaries");
      expect(res.errors).toEqual(["No matching columns found in conversation_summaries"]);
    });

    it("restores successfully despite schema drift (missing or extra columns between snapDb and liveDb)", async () => {
      const cid = "chat-drift-1";
      createTestDb(fakeSummariesDbPath, []);
      mockTableSchemas.set(fakeSummariesDbPath, [
        { name: "conversation_id" },
        { name: "title" },
        { name: "modern_only_col" },
      ]);

      const snapDir = path.join(fakeBackupsDir, "app", "snap-drift");
      fs.mkdirSync(snapDir, { recursive: true });
      const snapDbPath = path.join(snapDir, "conversation_summaries.db");
      createTestDb(snapDbPath, [
        { conversation_id: cid, title: "Drifted Chat Title" },
      ]);
      mockTableSchemas.set(snapDbPath, [
        { name: "conversation_id" },
        { name: "title" },
        { name: "last_modified_time" },
        { name: "legacy_only_col" },
      ]);

      const snapConvDir = path.join(snapDir, "conversations");
      fs.mkdirSync(snapConvDir, { recursive: true });
      fs.writeFileSync(path.join(snapConvDir, `${cid}.db`), "snap trajectory data");

      fs.writeFileSync(
        path.join(snapDir, "manifest.json"),
        JSON.stringify({
          id: "snap-drift",
          target: "app",
          type: "manual",
          createdAt: Date.now(),
          sizeBytes: 1024,
          chatCount: 1,
          protectedFromPruning: false,
          chats: [{ conversationId: cid, title: "Drifted Chat Title", hasTrajectoryDb: true }],
        }),
      );

      const restoreResult = await restoreSnapshot("app", "snap-drift");
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.restoredChatCount).toBe(1);
      expect(restoreResult.restoredConversationIds).toContain(cid);

      const liveStore = mockDatabases.get(fakeSummariesDbPath);
      const restoredRow = liveStore?.get(cid);
      expect(restoredRow).toBeDefined();
      expect(restoredRow?.conversation_id).toBe(cid);
      expect(restoredRow?.title).toBe("Drifted Chat Title");
      expect(restoredRow?.legacy_only_col).toBeUndefined();
    });

    it("returns error result if snapDb and liveDb have disjoint column sets", async () => {
      createTestDb(fakeSummariesDbPath, []);
      mockTableSchemas.set(fakeSummariesDbPath, [
        { name: "live_col_a" },
        { name: "live_col_b" },
      ]);

      const snapDir = path.join(fakeBackupsDir, "app", "snap-disjoint");
      fs.mkdirSync(snapDir, { recursive: true });
      const snapDbPath = path.join(snapDir, "conversation_summaries.db");
      createTestDb(snapDbPath, [{ conversation_id: "c1", title: "C1" }]);
      mockTableSchemas.set(snapDbPath, [
        { name: "snap_col_x" },
        { name: "snap_col_y" },
      ]);

      fs.writeFileSync(
        path.join(snapDir, "manifest.json"),
        JSON.stringify({ id: "snap-disjoint", target: "app" }),
      );

      const res = await restoreSnapshot("app", "snap-disjoint");
      expect(res.success).toBe(false);
      expect(res.error).toBe("No matching columns found in conversation_summaries");
      expect(res.errors).toEqual(["No matching columns found in conversation_summaries"]);
    });

    it("returns error result if database transaction fails during restoration", async () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "fail-tx", title: "Failing Chat" },
      ]);
      const snapshot = await createPreSwitchBackup("app", "fail-tx");
      expect(snapshot).not.toBeNull();

      const res = await restoreSnapshot("app", snapshot!.id);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Simulated SQLite write error");
      expect(res.errors).toEqual([expect.stringContaining("Simulated SQLite write error")]);
    });

    it("handles rows without conversation_id during restoration", async () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "", title: "Empty CID Chat" },
      ]);
      const snapshot = await createPreSwitchBackup("app");
      expect(snapshot).not.toBeNull();

      const res = await restoreSnapshot("app", snapshot!.id);
      expect(res.success).toBe(true);
      expect(res.restoredChatCount).toBe(0);
      expect(res.restoredConversationIds).toEqual([]);
    });
  });

  describe("restoreSingleChat", () => {
    it("restores only targeted chat trajectory and summary row without overwriting other chats", async () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "target-cid", title: "Targeted Chat" },
        { conversation_id: "unrelated-cid", title: "Unrelated Chat" },
      ]);
      fs.writeFileSync(path.join(fakeConversationsDir, "target-cid.db"), "target traj");
      fs.writeFileSync(path.join(fakeAnnotationsDir, "target-cid.pbtxt"), "target ann");

      const snapshot = await createPreSwitchBackup("app", "target-cid");
      expect(snapshot).not.toBeNull();

      // Remove target trajectory from live directory
      fs.rmSync(path.join(fakeConversationsDir, "target-cid.db"));
      fs.rmSync(path.join(fakeAnnotationsDir, "target-cid.pbtxt"));

      const protoPath = path.join(path.dirname(fakeSummariesDbPath), "agyhub_summaries.pb");
      fs.writeFileSync(protoPath, "stale proto mirror");

      const res = await restoreSingleChat("app", snapshot!.id, "target-cid");
      expect(res.success).toBe(true);
      expect(res.restoredChatCount).toBe(1);
      expect(res.restoredConversationIds).toEqual(["target-cid"]);

      expect(fs.existsSync(path.join(fakeConversationsDir, "target-cid.db"))).toBe(true);
      expect(fs.existsSync(path.join(fakeAnnotationsDir, "target-cid.pbtxt"))).toBe(true);
      expect(fs.existsSync(protoPath)).toBe(false);
    });

    it("returns error result if snapshotId or cid is missing", async () => {
      const res1 = await restoreSingleChat("app", "", "target-cid");
      expect(res1.success).toBe(false);
      expect(res1.error).toBe("Missing snapshot ID or conversation ID");
      expect(res1.errors).toEqual(["Missing snapshot ID or conversation ID"]);

      const res2 = await restoreSingleChat("app", "snapshot-id", "");
      expect(res2.success).toBe(false);
      expect(res2.error).toBe("Missing snapshot ID or conversation ID");
      expect(res2.errors).toEqual(["Missing snapshot ID or conversation ID"]);
    });
  });

  describe("getBackupStats & pruneBackups", () => {
    it("accurately reports backup statistics and flags exceedsStorageLimit when > 1.0 GB", () => {
      const initialStats = getBackupStats("app");
      expect(initialStats.snapshotCount).toBe(0);
      expect(initialStats.totalSizeBytes).toBe(0);
      expect(initialStats.exceedsStorageLimit).toBe(false);

      const appBackupDir = path.join(fakeBackupsDir, "app", "snapshot_1_test");
      fs.mkdirSync(appBackupDir, { recursive: true });
      fs.writeFileSync(path.join(appBackupDir, "manifest.json"), JSON.stringify({
        id: "snapshot_1_test",
        target: "app",
        type: "pre_switch",
        createdAt: 1000,
        sizeBytes: 500,
        chatCount: 1,
        protectedFromPruning: false,
        chats: [],
      }));

      const stats = getBackupStats("app");
      expect(stats.snapshotCount).toBe(1);
      expect(stats.snapshots[0].id).toBe("snapshot_1_test");
    });

    it("prunes older unprotected snapshots while strictly protecting pre-clean snapshots and keeping latest", () => {
      const appDir = path.join(fakeBackupsDir, "app");
      fs.mkdirSync(appDir, { recursive: true });

      const snaps = [
        { id: "snap-newest-switch", type: "pre_switch", createdAt: 3000, protectedFromPruning: false },
        { id: "snap-older-switch", type: "pre_switch", createdAt: 2000, protectedFromPruning: false },
        { id: "snap-protected-clean", type: "pre_clean", createdAt: 1000, protectedFromPruning: true },
      ];

      for (const s of snaps) {
        const dir = path.join(appDir, s.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
          ...s,
          target: "app",
          sizeBytes: 100,
          chatCount: 1,
          chats: [],
        }));
      }

      const pruneRes = pruneBackups("app");
      expect(pruneRes.prunedCount).toBe(1);
      expect(pruneRes.remainingCount).toBe(2);

      expect(fs.existsSync(path.join(appDir, "snap-older-switch"))).toBe(false);
      expect(fs.existsSync(path.join(appDir, "snap-newest-switch"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "snap-protected-clean"))).toBe(true);
    });

    it("records errors when fs.rmSync fails during pruning", () => {
      const appDir = path.join(fakeBackupsDir, "app");
      fs.mkdirSync(appDir, { recursive: true });

      const snaps = [
        { id: "snap-1", type: "pre_switch", createdAt: 3000, protectedFromPruning: false },
        { id: "snap-2", type: "pre_switch", createdAt: 2000, protectedFromPruning: false },
      ];

      for (const s of snaps) {
        const dir = path.join(appDir, s.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
          ...s,
          target: "app",
          sizeBytes: 100,
          chatCount: 1,
          chats: [],
        }));
      }

      vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });

      const pruneRes = pruneBackups("app");
      expect(pruneRes.prunedCount).toBe(0);
      expect(pruneRes.errors.length).toBe(1);
      expect(pruneRes.errors[0]).toContain("EACCES: permission denied");
    });
  });

  describe("FIFO Retention (enforcePreSwitchFifo)", () => {
    it("prunes oldest pre_switch snapshots beyond 5 while permanently protecting pre_clean rollbacks", () => {
      const appDir = path.join(fakeBackupsDir, "app");
      fs.mkdirSync(appDir, { recursive: true });

      // Create 2 protected pre_clean snapshots
      for (let i = 1; i <= 2; i++) {
        const id = `snap-clean-${i}`;
        const dir = path.join(appDir, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "manifest.json"),
          JSON.stringify({
            id,
            target: "app",
            type: "pre_clean",
            createdAt: 100 * i,
            sizeBytes: 1024,
            chatCount: 1,
            protectedFromPruning: true,
            chats: [],
          }),
        );
      }

      // Create 7 unprotected pre_switch snapshots with increasing createdAt
      for (let i = 1; i <= 7; i++) {
        const id = `snap-switch-${i}`;
        const dir = path.join(appDir, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "manifest.json"),
          JSON.stringify({
            id,
            target: "app",
            type: "pre_switch",
            createdAt: 1000 * i,
            sizeBytes: 2048,
            chatCount: 1,
            protectedFromPruning: false,
            chats: [],
          }),
        );
      }

      const initialSnaps = listBackupSnapshots("app");
      expect(initialSnaps.length).toBe(9);

      // Execute FIFO retention
      enforcePreSwitchFifo("app");

      const remainingSnaps = listBackupSnapshots("app");
      expect(remainingSnaps.length).toBe(7);

      // 2 protected pre_clean snapshots must remain intact
      expect(fs.existsSync(path.join(appDir, "snap-clean-1"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "snap-clean-2"))).toBe(true);

      // 2 oldest pre_switch snapshots (1 and 2) must be pruned
      expect(fs.existsSync(path.join(appDir, "snap-switch-1"))).toBe(false);
      expect(fs.existsSync(path.join(appDir, "snap-switch-2"))).toBe(false);

      // 5 newest pre_switch snapshots (3, 4, 5, 6, 7) must be retained
      expect(fs.existsSync(path.join(appDir, "snap-switch-3"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "snap-switch-4"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "snap-switch-5"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "snap-switch-6"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "snap-switch-7"))).toBe(true);
    });

    it("automatically triggers FIFO enforcement on createPreSwitchBackup", async () => {
      createTestDb(fakeSummariesDbPath, [
        { conversation_id: "active-cid", title: "Active Chat", last_modified_time: 100 },
      ]);
      const appDir = path.join(fakeBackupsDir, "app");

      // Seed 5 existing pre_switch snapshots
      for (let i = 1; i <= 5; i++) {
        const id = `snap-seed-${i}`;
        const dir = path.join(appDir, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "manifest.json"),
          JSON.stringify({
            id,
            target: "app",
            type: "pre_switch",
            createdAt: 1000 + i,
            sizeBytes: 100,
            chatCount: 1,
            protectedFromPruning: false,
            chats: [],
          }),
        );
      }

      expect(listBackupSnapshots("app").length).toBe(5);

      // Create new pre-switch backup making 6 pre-switch snapshots
      const newSnap = await createPreSwitchBackup("app", "active-cid");
      expect(newSnap).not.toBeNull();

      // FIFO should have run and pruned the oldest seed snapshot (snap-seed-1)
      const afterSnaps = listBackupSnapshots("app");
      expect(afterSnaps.length).toBe(5);
      expect(fs.existsSync(path.join(appDir, "snap-seed-1"))).toBe(false);
      expect(fs.existsSync(path.join(appDir, newSnap!.id))).toBe(true);
    });
  });
});
