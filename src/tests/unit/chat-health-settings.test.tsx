// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AntigravityChatHealthSettings } from "@/modules/antigravity-runtime/components/AntigravityChatHealthSettings";
import { ChatHealthTelemetryBar } from "@/modules/antigravity-runtime/components/ChatHealthTelemetryBar";
import { ChatHealthOrphanRow } from "@/modules/antigravity-runtime/components/ChatHealthOrphanRow";
import { ChatHealthOrphanList } from "@/modules/antigravity-runtime/components/ChatHealthOrphanList";
import { ChatHealthSnapshotRow } from "@/modules/antigravity-runtime/components/ChatHealthSnapshotRow";
import { ChatHealthSnapshotList } from "@/modules/antigravity-runtime/components/ChatHealthSnapshotList";
import { ChatHealthStorageWarningBanner } from "@/modules/antigravity-runtime/components/ChatHealthStorageWarningBanner";
import { AntigravityChatHealthConfirmDialog } from "@/modules/antigravity-runtime/components/AntigravityChatHealthConfirmDialog";
import * as chatHealthActions from "@/modules/antigravity-runtime/actions/chatHealth";
import * as chatBackupActions from "@/modules/antigravity-runtime/actions/chatBackup";
import * as cleanerActions from "@/modules/antigravity-runtime/actions/conversationCleaner";
import type { ChatHealthReport } from "@/modules/antigravity-runtime/conversation/types";
import type { BackupSnapshot } from "@/modules/antigravity-runtime/backup/chatBackup";

const mockToast = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "settings.chatHealth.title": "Chat Health & Recovery",
        "settings.chatHealth.description":
          "Audit session integrity, prune broken chat references, and restore previous chat backups.",
        "settings.chatHealth.statusHealthy": "All healthy",
        "settings.chatHealth.statusBroken": `${options?.count ?? 0} broken sessions`,
        "settings.chatHealth.statusBackups": `${options?.count ?? 0} backups (${options?.size ?? ""})`,
        "settings.chatHealth.filterShowAll": "Show all backed-up chats",
        "settings.chatHealth.filterStaleOnly":
          "Only showing stale or missing chats",
        "settings.chatHealth.pruneAllBroken": "Prune All Broken",
        "settings.chatHealth.restoreSnapshot": "Restore Full Snapshot",
        "settings.chatHealth.restoreChat": "Restore Chat",
        "settings.chatHealth.pruneChat": "Prune",
        "settings.chatHealth.confirmPruneAllTitle": "Prune All Broken Chats?",
        "settings.chatHealth.confirmPruneAllDesc":
          "Permanently removes broken chat records whose trajectory files were deleted.",
        "settings.chatHealth.confirmRestoreTitle": "Restore Full Snapshot?",
        "settings.chatHealth.confirmRestoreDesc":
          "Replaces current chats with this snapshot. Restart Antigravity after restore to reload history.",
        "settings.chatHealth.confirmRestoreChatTitle": "Restore Single Chat?",
        "settings.chatHealth.confirmRestoreChatDesc":
          "Restores this chat into your conversation list without changing other chats.",
        "settings.chatHealth.loading": "Scanning session health...",
        "settings.chatHealth.emptyTitle": "No issues detected",
        "settings.chatHealth.emptyDesc":
          "All chats are healthy and no restorable backups are pending.",
        "settings.chatHealth.errorTitle": "Database temporarily busy",
        "settings.chatHealth.errorDesc":
          "The conversation store is in use by another process. Please wait a moment and try again.",
        "settings.chatHealth.retry": "Retry Scan",
        "settings.chatHealth.storageWarning": `Backup storage is ${options?.size ?? ""} (exceeds 1.0 GB limit). Prune older snapshots to free disk space.`,
        "settings.chatHealth.pruneBackups": "Prune Old Backups",
        "settings.chatHealth.restoreSuccess":
          "Chat restored successfully. Restart Antigravity to refresh.",
        "settings.chatHealth.pruneSuccess": `Successfully pruned ${options?.count ?? 0} broken sessions.`,
        "settings.chatHealth.allSyncedTitle": "All Backups in Sync",
        "settings.chatHealth.allSyncedDesc":
          "All backed-up sessions currently exist in Antigravity.",
        "settings.chatHealth.inspectFullHistory": "Inspect Full History",
        "settings.chatHealth.showOlderSnapshots": `Show ${options?.count ?? 0} older snapshots`,
        "settings.chatHealth.showFewerSnapshots": "Show fewer snapshots",
        "settings.chatHealth.cancel": "Cancel",
        "settings.conversationCleaner.totalLabel": "Total",
        "settings.conversationCleaner.validLabel": "Valid",
        "settings.conversationCleaner.invalidLabel": "Broken",
        "settings.conversationCleaner.targetApp": "App (Antigravity 2.0)",
        "settings.conversationCleaner.targetIde": "IDE (Antigravity IDE)",
        "settings.conversationCleaner.targetCli": "CLI (agy)",
      };
      return translations[key] || key;
    },
  }),
}));

const mockSnapshot: BackupSnapshot = {
  id: "snap-2026-10-16-01",
  target: "app",
  type: "pre_switch",
  createdAt: 1729080000000,
  sizeBytes: 15 * 1024 * 1024,
  chatCount: 2,
  protectedFromPruning: false,
  chats: [
    {
      conversationId: "conv-uuid-1111-2222",
      title: "Broken Alpha Chat",
      hasTrajectoryDb: false,
    },
    {
      conversationId: "conv-uuid-3333-4444",
      title: "Intact Beta Chat",
      hasTrajectoryDb: true,
    },
  ],
};

const mockHealthyReport: ChatHealthReport = {
  target: "app",
  cleanerStats: {
    target: "app",
    summariesDbPath: "/path/to/summaries.db",
    exists: true,
    totalChats: 20,
    invalidChats: 0,
    validChats: 20,
    projectGroups: [],
  },
  backupStats: {
    target: "app",
    totalSizeBytes: 50 * 1024 * 1024,
    targetSizeBytes: 50 * 1024 * 1024,
    snapshotCount: 1,
    exceedsStorageLimit: false,
    snapshots: [mockSnapshot],
  },
  snapshots: [mockSnapshot],
};

const mockEmptyReport: ChatHealthReport = {
  target: "app",
  cleanerStats: {
    target: "app",
    summariesDbPath: "/path/to/summaries.db",
    exists: true,
    totalChats: 10,
    invalidChats: 0,
    validChats: 10,
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

const mockDegradedReport: ChatHealthReport = {
  target: "app",
  cleanerStats: {
    target: "app",
    summariesDbPath: "/path/to/summaries.db",
    exists: true,
    totalChats: 20,
    invalidChats: 1,
    validChats: 19,
    projectGroups: [
      {
        projectName: "Main Workspace",
        workspacePath: "/users/test/workspace",
        brokenCount: 1,
        conversations: [
          {
            conversationId: "conv-uuid-1111-2222",
            title: "Broken Alpha Chat",
            hasBackup: true,
            matchingSnapshotId: "snap-2026-10-16-01",
          },
        ],
      },
    ],
  },
  backupStats: {
    target: "app",
    totalSizeBytes: 1.5 * 1024 * 1024 * 1024,
    targetSizeBytes: 1.5 * 1024 * 1024 * 1024,
    snapshotCount: 2,
    exceedsStorageLimit: true,
    snapshots: [mockSnapshot],
  },
  snapshots: [mockSnapshot],
};

describe("AntigravityChatHealthSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("4-state resolution spectrum", () => {
    it("renders loading skeleton state initially while report resolves", async () => {
      let resolveReport: (val: ChatHealthReport) => void;
      const pendingPromise = new Promise<ChatHealthReport>((resolve) => {
        resolveReport = resolve;
      });

      vi.spyOn(chatHealthActions, "getChatHealthReport").mockReturnValue(
        pendingPromise as any,
      );

      render(<AntigravityChatHealthSettings />);

      expect(screen.getByTestId("chat-health-loading")).toBeDefined();
      expect(screen.getByText("Scanning session health...")).toBeDefined();

      resolveReport!(mockHealthyReport);
      await waitFor(() => {
        expect(screen.queryByTestId("chat-health-loading")).toBeNull();
      });
    });

    it("renders recoverable error state when fetch rejects, and retries on click", async () => {
      const getReportSpy = vi
        .spyOn(chatHealthActions, "getChatHealthReport")
        .mockRejectedValueOnce(new Error("Database locked"))
        .mockResolvedValueOnce(mockHealthyReport as any);

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-health-error")).toBeDefined();
      });
      expect(screen.getByText("Database temporarily busy")).toBeDefined();

      const retryBtn = screen.getByText("Retry Scan");
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByTestId("chat-health-error")).toBeNull();
      });
      expect(getReportSpy).toHaveBeenCalledTimes(2);
    });

    it("renders recoverable error state when cleanerStats contains error string", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue({
        ...mockHealthyReport,
        cleanerStats: {
          ...mockHealthyReport.cleanerStats,
          error: "Sqlite database is corrupted",
        },
      } as any);

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-health-error")).toBeDefined();
      });
    });

    it("renders empty state when all chats are healthy and no backups exist", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockEmptyReport as any,
      );

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-health-empty")).toBeDefined();
      });
      expect(screen.getByText("No issues detected")).toBeDefined();
    });

    it("renders populated healthy state when 0 broken chats but backups exist", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockHealthyReport as any,
      );

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByText("All healthy")).toBeDefined();
      });
      expect(
        screen.getByRole("heading", { name: "Chat Health & Recovery" }),
      ).toBeDefined();
      expect(
        screen.getByTestId("snapshot-row-snap-2026-10-16-01"),
      ).toBeDefined();
    });

    it("renders populated degraded state with orphan list and broken badge", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getAllByText("1 broken sessions").length).toBeGreaterThan(
          0,
        );
      });
      expect(screen.getByTestId("chat-health-orphan-list")).toBeDefined();
      expect(
        screen.getByTestId("orphan-row-conv-uuid-1111-2222"),
      ).toBeDefined();
    });
  });

  describe("Target environment switcher", () => {
    it("switches target between App, IDE, and CLI and loads corresponding target", async () => {
      const getReportSpy = vi
        .spyOn(chatHealthActions, "getChatHealthReport")
        .mockResolvedValue(mockHealthyReport as any);

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(getReportSpy).toHaveBeenCalledWith("app", true);
      });

      const ideTab = screen.getByRole("tab", { name: "IDE (Antigravity IDE)" });
      fireEvent.click(ideTab);

      await waitFor(() => {
        expect(getReportSpy).toHaveBeenCalledWith("ide", true);
      });

      const cliTab = screen.getByRole("tab", { name: "CLI (agy)" });
      fireEvent.click(cliTab);

      await waitFor(() => {
        expect(getReportSpy).toHaveBeenCalledWith("cli", true);
      });
    });
  });

  describe("Stale-only filter toggle", () => {
    it("defaults to staleOnly=true with disclaimer text, and toggles to showAll=true", async () => {
      const getReportSpy = vi
        .spyOn(chatHealthActions, "getChatHealthReport")
        .mockResolvedValue(mockDegradedReport as any);

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(
          screen.getByText("Only showing stale or missing chats"),
        ).toBeDefined();
      });

      const toggle = screen.getByRole("switch");
      expect(toggle.getAttribute("aria-checked")).toBe("false");

      fireEvent.click(toggle);

      await waitFor(() => {
        expect(getReportSpy).toHaveBeenCalledWith("app", false);
      });
      expect(
        screen.queryByText("Only showing stale or missing chats"),
      ).toBeNull();
    });
  });

  describe("1.0 GB storage warning banner", () => {
    it("renders storage warning banner when size exceeds 1.0 GB, and prunes old backups", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );
      const pruneSpy = vi
        .spyOn(chatBackupActions, "pruneChatBackups")
        .mockResolvedValue({
          target: "app",
          prunedCount: 3,
          freedBytes: 500 * 1024 * 1024,
          remainingCount: 2,
          remainingSizeBytes: 800 * 1024 * 1024,
          errors: [],
        });

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByText("Prune Old Backups")).toBeDefined();
      });

      const pruneBtn = screen.getByText("Prune Old Backups");
      fireEvent.click(pruneBtn);

      await waitFor(() => {
        expect(pruneSpy).toHaveBeenCalledWith("app");
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Successfully pruned 3 broken sessions.",
        }),
      );
    });

    it("handles error when pruneChatBackups fails", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );
      vi.spyOn(chatBackupActions, "pruneChatBackups").mockRejectedValue(
        new Error("Disk locked"),
      );

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByText("Prune Old Backups")).toBeDefined();
      });

      const pruneBtn = screen.getByText("Prune Old Backups");
      fireEvent.click(pruneBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Database temporarily busy",
            variant: "destructive",
          }),
        );
      });
    });
  });

  describe("Remediation actions and confirmation gates", () => {
    it("triggers single chat restore via confirmation dialog", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );
      const restoreSingleSpy = vi
        .spyOn(chatBackupActions, "restoreSingleChatBackup")
        .mockResolvedValue({
          success: true,
          target: "app",
          restoredChatCount: 1,
          restoredConversationIds: ["conv-uuid-1111-2222"],
          errors: [],
        });

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(
          screen.getByTestId("orphan-row-conv-uuid-1111-2222"),
        ).toBeDefined();
      });

      const orphanRow = screen.getByTestId("orphan-row-conv-uuid-1111-2222");
      const restoreBtn = orphanRow.querySelector("button")!;
      fireEvent.click(restoreBtn);

      await waitFor(() => {
        expect(screen.getByText("Restore Single Chat?")).toBeDefined();
      });

      const confirmBtn = screen.getByRole("button", { name: "Restore Chat" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(restoreSingleSpy).toHaveBeenCalledWith(
          "app",
          "snap-2026-10-16-01",
          "conv-uuid-1111-2222",
        );
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description:
            "Chat restored successfully. Restart Antigravity to refresh.",
        }),
      );
    });

    it("triggers single prune via confirmation dialog", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );
      const pruneSpy = vi
        .spyOn(cleanerActions, "cleanInvalidChats")
        .mockResolvedValue({
          target: "app",
          summariesDbPath: "/path/db",
          totalChecked: 10,
          prunedCount: 1,
          errors: [],
        });

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(
          screen.getByTestId("orphan-row-conv-uuid-1111-2222"),
        ).toBeDefined();
      });

      const orphanRow = screen.getByTestId("orphan-row-conv-uuid-1111-2222");
      const pruneBtn = orphanRow.querySelectorAll("button")[1];
      fireEvent.click(pruneBtn);

      await waitFor(() => {
        expect(screen.getByText("Prune All Broken Chats?")).toBeDefined();
      });

      const confirmBtn = screen.getByRole("button", { name: "Prune" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(pruneSpy).toHaveBeenCalledWith("app");
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Successfully pruned 1 broken sessions.",
        }),
      );
    });

    it("triggers batch prune all broken sessions", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );
      const pruneSpy = vi
        .spyOn(cleanerActions, "cleanInvalidChats")
        .mockResolvedValue({
          target: "app",
          summariesDbPath: "/path/db",
          totalChecked: 10,
          prunedCount: 1,
          errors: [],
        });

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByText("Prune All Broken")).toBeDefined();
      });

      const pruneAllBtn = screen.getByText("Prune All Broken");
      fireEvent.click(pruneAllBtn);

      await waitFor(() => {
        expect(screen.getByText("Prune All Broken Chats?")).toBeDefined();
      });

      const confirmBtn = screen.getByRole("button", { name: "Prune" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(pruneSpy).toHaveBeenCalledWith("app");
      });
    });

    it("triggers full snapshot restore via confirmation dialog", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockHealthyReport as any,
      );
      const restoreFullSpy = vi
        .spyOn(chatBackupActions, "restoreChatBackupSnapshot")
        .mockResolvedValue({
          success: true,
          target: "app",
          restoredChatCount: 2,
          restoredConversationIds: [
            "conv-uuid-1111-2222",
            "conv-uuid-3333-4444",
          ],
          errors: [],
        });

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByText("Restore Full Snapshot")).toBeDefined();
      });

      const restoreFullBtn = screen.getByText("Restore Full Snapshot");
      fireEvent.click(restoreFullBtn);

      await waitFor(() => {
        expect(screen.getByText("Restore Full Snapshot?")).toBeDefined();
      });

      const confirmBtn = screen.getByRole("button", { name: "Restore Chat" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(restoreFullSpy).toHaveBeenCalledWith(
          "app",
          "snap-2026-10-16-01",
        );
      });
    });

    it("handles error during action confirmation", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockHealthyReport as any,
      );
      vi.spyOn(
        chatBackupActions,
        "restoreChatBackupSnapshot",
      ).mockRejectedValue(new Error("Failed to restore"));

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(screen.getByText("Restore Full Snapshot")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Restore Full Snapshot"));

      await waitFor(() => {
        expect(screen.getByText("Restore Full Snapshot?")).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Restore Chat" }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Database temporarily busy",
            variant: "destructive",
          }),
        );
      });
    });
  });

  describe("Snapshot accordion and hidden chats counter", () => {
    it("expands snapshot accordion and displays hidden healthy chats counter when staleOnly=true", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(
          screen.getByTestId("snapshot-row-snap-2026-10-16-01"),
        ).toBeDefined();
      });

      const expandBtn = screen.getByRole("button", { name: "Expand snapshot" });
      fireEvent.click(expandBtn);

      await waitFor(() => {
        expect(
          screen.getByTestId("hidden-indicator-snap-2026-10-16-01"),
        ).toBeDefined();
      });
      expect(
        screen.getByText("1 healthy conversations hidden by filter"),
      ).toBeDefined();
      expect(screen.getByText("1 / 2 shown")).toBeDefined();

      // Click again to collapse
      const collapseBtn = screen.getByRole("button", {
        name: "Collapse snapshot",
      });
      fireEvent.click(collapseBtn);

      expect(
        screen.queryByTestId("hidden-indicator-snap-2026-10-16-01"),
      ).toBeNull();
    });

    it("triggers single restore and prune from within snapshot accordion rows, and supports cancel", async () => {
      vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
        mockDegradedReport as any,
      );

      render(<AntigravityChatHealthSettings />);

      await waitFor(() => {
        expect(
          screen.getByTestId("snapshot-row-snap-2026-10-16-01"),
        ).toBeDefined();
      });

      // Expand snapshot
      fireEvent.click(screen.getByRole("button", { name: "Expand snapshot" }));

      await waitFor(() => {
        expect(
          screen.getByTestId("chat-row-conv-uuid-1111-2222"),
        ).toBeDefined();
      });

      const chatRow = screen.getByTestId("chat-row-conv-uuid-1111-2222");
      const restoreBtn = chatRow.querySelectorAll("button")[0];
      const pruneBtn = chatRow.querySelectorAll("button")[1];

      // Test restore dialog & cancel
      fireEvent.click(restoreBtn);
      await waitFor(() => {
        expect(screen.getByText("Restore Single Chat?")).toBeDefined();
      });
      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);
      await waitFor(() => {
        expect(screen.queryByText("Restore Single Chat?")).toBeNull();
      });

      // Test prune dialog from snapshot row
      fireEvent.click(pruneBtn);
      await waitFor(() => {
        expect(screen.getByText("Prune All Broken Chats?")).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByText("Prune All Broken Chats?")).toBeNull();
      });
    });
  });
});

describe("Modular Sub-components Direct Isolation", () => {
  it("ChatHealthTelemetryBar renders empty / fallback metrics gracefully", () => {
    render(<ChatHealthTelemetryBar cleanerStats={null} backupStats={null} />);
    expect(screen.getByText("Total")).toBeDefined();
    expect(screen.getByText("Valid")).toBeDefined();
    expect(screen.getByText("Broken")).toBeDefined();
    expect(screen.getByTestId("telemetry-storage-size")).toBeDefined();
    expect(screen.getByText("0 B")).toBeDefined();
  });

  it("ChatHealthOrphanRow handles short conversation ID and without backup badge", () => {
    const onRestore = vi.fn();
    const onPrune = vi.fn();
    render(
      <ChatHealthOrphanRow
        chat={{
          conversationId: "short-id",
          title: "Short Title",
          hasBackup: false,
        }}
        onRestore={onRestore}
        onPrune={onPrune}
      />,
    );

    expect(screen.getByText("Short Title")).toBeDefined();
    expect(screen.getByText("short-id")).toBeDefined();
    expect(screen.queryByText("Restorable")).toBeNull();

    const pruneBtn = screen.getByRole("button", { name: "Prune" });
    fireEvent.click(pruneBtn);
    expect(onPrune).toHaveBeenCalledWith("short-id");
  });

  it("ChatHealthOrphanList renders empty null when projectGroups is empty", () => {
    const { container } = render(
      <ChatHealthOrphanList
        projectGroups={[]}
        onRestore={vi.fn()}
        onPruneSingle={vi.fn()}
        onPruneAll={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("ChatHealthSnapshotList renders null when snapshots array is empty", () => {
    const { container } = render(
      <ChatHealthSnapshotList
        snapshots={[]}
        expandedIds={new Set()}
        onToggleAccordion={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={vi.fn()}
        brokenCids={new Set()}
        showAll={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("ChatHealthSnapshotRow displays filter notice when visibleChats is empty", () => {
    render(
      <ChatHealthSnapshotRow
        snapshot={mockSnapshot}
        isExpanded={true}
        onToggle={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={vi.fn()}
        brokenCids={new Set()}
        showAll={false}
      />,
    );

    expect(
      screen.getByText("Only showing stale or missing chats"),
    ).toBeDefined();
  });

  it("ChatHealthSnapshotRow handles short CID and invokes onRestoreSingle / onPruneSingle", () => {
    const onRestoreSingle = vi.fn();
    const onPruneSingle = vi.fn();
    const shortCidSnapshot: BackupSnapshot = {
      ...mockSnapshot,
      chats: [
        {
          conversationId: "short",
          title: "Short CID Chat",
          hasTrajectoryDb: false,
        },
      ],
    };

    render(
      <ChatHealthSnapshotRow
        snapshot={shortCidSnapshot}
        isExpanded={true}
        onToggle={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={onRestoreSingle}
        onPruneSingle={onPruneSingle}
        brokenCids={new Set(["short"])}
        showAll={true}
      />,
    );

    expect(screen.getByText("short")).toBeDefined();
    const restoreBtn = screen.getByRole("button", { name: "Restore Chat" });
    fireEvent.click(restoreBtn);
    expect(onRestoreSingle).toHaveBeenCalledWith("short");

    const pruneBtn = screen.getByRole("button", { name: "Prune" });
    fireEvent.click(pruneBtn);
    expect(onPruneSingle).toHaveBeenCalledWith("short");
  });

  it("ChatHealthStorageWarningBanner disables prune button when disabled=true", () => {
    const onPrune = vi.fn();
    render(
      <ChatHealthStorageWarningBanner
        totalSizeBytes={2 * 1024 * 1024 * 1024}
        onPruneBackups={onPrune}
        disabled={true}
      />,
    );

    const btn = screen.getByRole("button", { name: "Prune Old Backups" });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("AntigravityChatHealthConfirmDialog returns null when action is null", () => {
    const { container } = render(
      <AntigravityChatHealthConfirmDialog
        action={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        isProcessing={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("ChatHealthTelemetryBar formats KB storage size correctly", () => {
    render(
      <ChatHealthTelemetryBar
        cleanerStats={null}
        backupStats={{
          target: "app",
          totalSizeBytes: 500 * 1024,
          targetSizeBytes: 500 * 1024,
          snapshotCount: 1,
          exceedsStorageLimit: false,
          snapshots: [],
        }}
      />,
    );
    expect(screen.getByText("500.0 KB")).toBeDefined();
  });

  it("handles empty prunedCount and superseded race during target switch", async () => {
    let rejectFirst: (err: Error) => void;
    const firstPromise = new Promise<ChatHealthReport>((_, reject) => {
      rejectFirst = reject;
    });

    const getReportSpy = vi
      .spyOn(chatHealthActions, "getChatHealthReport")
      .mockReturnValueOnce(firstPromise as any)
      .mockResolvedValue(mockHealthyReport as any);

    render(<AntigravityChatHealthSettings />);

    // Quickly switch target while first request is pending
    const ideTab = screen.getByRole("tab", { name: "IDE (Antigravity IDE)" });
    fireEvent.click(ideTab);

    // Reject superseded request
    rejectFirst!(new Error("Superseded abort"));

    await waitFor(() => {
      expect(screen.getByText("All healthy")).toBeDefined();
    });
    expect(getReportSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ChatHealthSnapshotList suppresses zero-chat snapshots when showAll is false", () => {
    const zeroChatSnap: BackupSnapshot = {
      ...mockSnapshot,
      id: "zero-chat-snap",
      chatCount: undefined as any,
      chats: [],
    };
    const activeChatSnap: BackupSnapshot = {
      ...mockSnapshot,
      id: "active-chat-snap",
      chatCount: 2,
    };

    const { rerender } = render(
      <ChatHealthSnapshotList
        snapshots={[zeroChatSnap, activeChatSnap]}
        expandedIds={new Set()}
        onToggleAccordion={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={vi.fn()}
        brokenCids={new Set()}
        showAll={false}
      />,
    );

    // Default mode: zero-chat snapshot is omitted
    expect(screen.getByText("1 snapshots")).toBeDefined();
    expect(screen.queryByText("zero-chat-snap")).toBeNull();

    // Show all mode: zero-chat snapshot is included
    rerender(
      <ChatHealthSnapshotList
        snapshots={[zeroChatSnap, activeChatSnap]}
        expandedIds={new Set()}
        onToggleAccordion={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={vi.fn()}
        brokenCids={new Set()}
        showAll={true}
      />,
    );

    expect(screen.getByText("2 snapshots")).toBeDefined();
  });

  it("ChatHealthSnapshotList renders All Backups in Sync card when all snapshots have 0 stale chats in default mode", () => {
    const zeroChatSnap1: BackupSnapshot = {
      ...mockSnapshot,
      id: "zero-chat-1",
      chatCount: 0,
      chats: [],
    };
    const zeroChatSnap2: BackupSnapshot = {
      ...mockSnapshot,
      id: "zero-chat-2",
      chatCount: 0,
      chats: [],
    };

    const onToggleShowAll = vi.fn();

    render(
      <ChatHealthSnapshotList
        snapshots={[zeroChatSnap1, zeroChatSnap2]}
        expandedIds={new Set()}
        onToggleAccordion={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={vi.fn()}
        brokenCids={new Set()}
        showAll={false}
        onToggleShowAll={onToggleShowAll}
      />,
    );

    expect(screen.getByTestId("chat-health-synced-card")).toBeDefined();
    expect(screen.getByText("All Backups in Sync")).toBeDefined();
    expect(
      screen.getByText(
        "All backed-up sessions currently exist in Antigravity.",
      ),
    ).toBeDefined();

    const inspectBtn = screen.getByRole("button", {
      name: "Inspect Full History",
    });
    fireEvent.click(inspectBtn);
    expect(onToggleShowAll).toHaveBeenCalledTimes(1);
  });

  it("ChatHealthSnapshotList progressively discloses snapshots capped at 5 and toggles expansion", () => {
    const manySnapshots: BackupSnapshot[] = Array.from(
      { length: 8 },
      (_, i) => ({
        ...mockSnapshot,
        id: `snap-index-${i}`,
        chatCount: 1,
        chats: [
          {
            conversationId: `conv-id-${i}`,
            title: `Chat Session ${i}`,
            hasTrajectoryDb: true,
          },
        ],
      }),
    );

    render(
      <ChatHealthSnapshotList
        snapshots={manySnapshots}
        expandedIds={new Set()}
        onToggleAccordion={vi.fn()}
        onRestoreFull={vi.fn()}
        onRestoreSingle={vi.fn()}
        brokenCids={new Set()}
        showAll={true}
      />,
    );

    expect(screen.getByText("8 snapshots")).toBeDefined();

    // 5 items visible by default, 3 hidden
    expect(screen.getByTestId("snapshot-row-snap-index-0")).toBeDefined();
    expect(screen.getByTestId("snapshot-row-snap-index-4")).toBeDefined();
    expect(screen.queryByTestId("snapshot-row-snap-index-5")).toBeNull();

    const toggleBtn = screen.getByRole("button", {
      name: /Show 3 older snapshots/i,
    });
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

    // Expand
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("snapshot-row-snap-index-5")).toBeDefined();
    expect(screen.getByTestId("snapshot-row-snap-index-7")).toBeDefined();
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Show fewer snapshots")).toBeDefined();

    // Collapse back
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("snapshot-row-snap-index-5")).toBeNull();
    expect(screen.getByText(/Show 3 older snapshots/i)).toBeDefined();
  });

  it("AntigravityChatHealthSettings clicking Inspect Full History toggles showAll and reveals snapshots", async () => {
    const testSnaps = [
      {
        ...mockSnapshot,
        id: "zero-snap-1",
        chatCount: 0,
        chats: [],
      },
      {
        ...mockSnapshot,
        id: "zero-snap-2",
        chatCount: 0,
        chats: [],
      },
    ];

    const reportWithSyncedBackups: ChatHealthReport = {
      ...mockHealthyReport,
      snapshots: testSnaps,
      backupStats: {
        target: "app",
        totalSizeBytes: 10 * 1024 * 1024,
        targetSizeBytes: 10 * 1024 * 1024,
        snapshotCount: 2,
        exceedsStorageLimit: false,
        snapshots: testSnaps,
      },
    };

    vi.spyOn(chatHealthActions, "getChatHealthReport").mockResolvedValue(
      reportWithSyncedBackups as any,
    );

    render(<AntigravityChatHealthSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-health-synced-card")).toBeDefined();
    });

    const inspectBtn = screen.getByRole("button", {
      name: "Inspect Full History",
    });
    fireEvent.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByText("2 snapshots")).toBeDefined();
    });
  });
});
