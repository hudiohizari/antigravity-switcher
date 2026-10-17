import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouterClient } from "@orpc/server";
import { chatBackupRouter } from "@/modules/antigravity-runtime/ipc/chatBackupRouter";
import * as chatBackupModule from "@/modules/antigravity-runtime/backup/chatBackup";

describe("Chat Backup IPC Router", () => {
  const routerClient = createRouterClient(chatBackupRouter);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles getStats endpoint with target resolution", async () => {
    const mockStats: chatBackupModule.BackupStats = {
      target: "app",
      totalSizeBytes: 1024,
      targetSizeBytes: 512,
      snapshotCount: 1,
      exceedsStorageLimit: false,
      snapshots: [],
    };
    vi.spyOn(chatBackupModule, "getBackupStats").mockReturnValue(mockStats);

    const res = await routerClient.getStats({ target: "classic" });
    expect(res).toEqual(mockStats);
    expect(chatBackupModule.getBackupStats).toHaveBeenCalledWith("app");
  });

  it("handles listSnapshots endpoint", async () => {
    const mockSnapshots: chatBackupModule.BackupSnapshot[] = [
      {
        id: "snap-1",
        target: "ide",
        type: "pre_switch",
        createdAt: 1234567,
        sizeBytes: 100,
        chatCount: 1,
        protectedFromPruning: false,
        chats: [],
      },
    ];
    vi.spyOn(chatBackupModule, "listBackupSnapshots").mockReturnValue(mockSnapshots);

    const res = await routerClient.listSnapshots({ target: "ide" });
    expect(res).toEqual(mockSnapshots);
    expect(chatBackupModule.listBackupSnapshots).toHaveBeenCalledWith("ide");
  });

  it("handles createBackup endpoint with activeCid parameter", async () => {
    const mockSnap: chatBackupModule.BackupSnapshot = {
      id: "snap-create",
      target: "cli",
      type: "pre_switch",
      createdAt: 55555,
      sizeBytes: 200,
      chatCount: 1,
      protectedFromPruning: false,
      activeConversationId: "cid-123",
      chats: [],
    };
    vi.spyOn(chatBackupModule, "createPreSwitchBackup").mockResolvedValue(mockSnap);

    const res = await routerClient.createBackup({ target: "cli", activeCid: "cid-123" });
    expect(res).toEqual(mockSnap);
    expect(chatBackupModule.createPreSwitchBackup).toHaveBeenCalledWith("cli", "cid-123");
  });

  it("handles restoreSnapshot endpoint", async () => {
    const mockRestore: chatBackupModule.RestoreResult = {
      success: true,
      target: "app",
      restoredChatCount: 2,
      restoredConversationIds: ["c1", "c2"],
    };
    vi.spyOn(chatBackupModule, "restoreSnapshot").mockResolvedValue(mockRestore);

    const res = await routerClient.restoreSnapshot({ target: "app", snapshotId: "snap-123" });
    expect(res).toEqual(mockRestore);
    expect(chatBackupModule.restoreSnapshot).toHaveBeenCalledWith("app", "snap-123");
  });

  it("handles restoreChat endpoint for granular restoration", async () => {
    const mockRestore: chatBackupModule.RestoreResult = {
      success: true,
      target: "app",
      restoredChatCount: 1,
      restoredConversationIds: ["chat-xyz"],
    };
    vi.spyOn(chatBackupModule, "restoreSingleChat").mockResolvedValue(mockRestore);

    const res = await routerClient.restoreChat({ target: "app", snapshotId: "snap-123", cid: "chat-xyz" });
    expect(res).toEqual(mockRestore);
    expect(chatBackupModule.restoreSingleChat).toHaveBeenCalledWith("app", "snap-123", "chat-xyz");
  });

  it("handles pruneBackups endpoint", async () => {
    const mockPrune: chatBackupModule.PruneResult = {
      target: "app",
      prunedCount: 3,
      freedBytes: 1048576,
      remainingCount: 1,
      remainingSizeBytes: 2048,
      errors: [],
    };
    vi.spyOn(chatBackupModule, "pruneBackups").mockReturnValue(mockPrune);

    const res = await routerClient.pruneBackups({ target: "app" });
    expect(res).toEqual(mockPrune);
    expect(chatBackupModule.pruneBackups).toHaveBeenCalledWith("app");
  });
});
