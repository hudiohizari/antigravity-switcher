import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouterClient } from "@orpc/server";
import {
  conversationCleanerRouter,
  BrokenChatItemSchema,
  BrokenProjectGroupSchema,
  InvalidChatsStatsSchema,
  CleanInvalidChatsResultSchema,
} from "@/modules/antigravity-runtime/ipc/conversationCleanerRouter";
import * as conversationCleanerService from "@/modules/antigravity-runtime/conversation/conversationCleaner";
import {
  getInvalidChatsStats as getInvalidChatsStatsAction,
  cleanInvalidChats as cleanInvalidChatsAction,
  cleanSingleInvalidChat as cleanSingleInvalidChatAction,
  cleanBatchInvalidChats as cleanBatchInvalidChatsAction,
} from "@/modules/antigravity-runtime/actions/conversationCleaner";
import { ipc } from "@/ipc/manager";
import type {
  InvalidChatsStats,
  CleanInvalidChatsResult,
} from "@/modules/antigravity-runtime/conversation/conversationCleaner";

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      conversationCleaner: {
        stats: vi.fn(),
        clean: vi.fn(),
        cleanSingle: vi.fn(),
        cleanBatch: vi.fn(),
      },
    },
  },
}));

describe("conversationCleanerRouter & conversationCleaner Actions", () => {
  const routerClient = createRouterClient(conversationCleanerRouter);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Zod Contract Schemas", () => {
    describe("BrokenChatItemSchema", () => {
      it("validates well-formed broken chat item with timestamp", () => {
        const item = {
          conversationId: "conv-101",
          title: "Feature Branch Refactor",
          updatedAt: 1727481600000,
        };
        const parsed = BrokenChatItemSchema.parse(item);
        expect(parsed).toEqual(item);
      });

      it("validates well-formed broken chat item without optional timestamp", () => {
        const item = {
          conversationId: "conv-102",
          title: "Untitled Conversation",
        };
        const parsed = BrokenChatItemSchema.parse(item);
        expect(parsed).toEqual(item);
        expect(parsed.updatedAt).toBeUndefined();
      });

      it("rejects item missing conversationId", () => {
        expect(() =>
          BrokenChatItemSchema.parse({
            title: "Missing ID",
          }),
        ).toThrow();
      });

      it("rejects item with non-string title", () => {
        expect(() =>
          BrokenChatItemSchema.parse({
            conversationId: "conv-103",
            title: 12345,
          }),
        ).toThrow();
      });

      it("rejects item with non-number updatedAt", () => {
        expect(() =>
          BrokenChatItemSchema.parse({
            conversationId: "conv-104",
            title: "Invalid Timestamp",
            updatedAt: "2026-09-28T00:00:00Z",
          }),
        ).toThrow();
      });

      it("validates item with hierarchical subagents and metadata", () => {
        const item = {
          conversationId: "conv-root",
          title: "Root Cascade",
          updatedAt: 1727481600000,
          parentConversationId: "conv-grandparent",
          parentTitle: "Grandparent Cascade",
          agentName: "Architect",
          nestingDepth: 1,
          subagents: [
            {
              conversationId: "conv-child",
              title: "Child Subagent",
              parentConversationId: "conv-root",
              parentTitle: "Root Cascade",
              agentName: "Coder",
              nestingDepth: 2,
              subagents: [
                {
                  conversationId: "conv-grandchild",
                  title: "Grandchild Subagent",
                  nestingDepth: 3,
                },
              ],
            },
          ],
        };
        const parsed = BrokenChatItemSchema.parse(item);
        expect(parsed).toEqual(item);
        expect(parsed.subagents?.[0].subagents?.length).toBe(1);
      });

      it("validates intact parent container item with subagents", () => {
        const item = {
          conversationId: "intact-parent-root",
          title: "Intact Main Cascade",
          updatedAt: 1727481600000,
          isIntactParent: true,
          hasBackup: false,
          subagents: [
            {
              conversationId: "sub-1",
              title: "Broken Worker",
              parentConversationId: "intact-parent-root",
              agentName: "Worker",
            },
          ],
        };
        const parsed = BrokenChatItemSchema.parse(item);
        expect(parsed.isIntactParent).toBe(true);
        expect(parsed.subagents?.length).toBe(1);
      });

      it("rejects empty conversationId string", () => {
        expect(() =>
          BrokenChatItemSchema.parse({
            conversationId: "",
            title: "Empty ID",
          }),
        ).toThrow();
      });

      it("rejects negative nestingDepth", () => {
        expect(() =>
          BrokenChatItemSchema.parse({
            conversationId: "conv-invalid-depth",
            title: "Invalid Depth",
            nestingDepth: -1,
          }),
        ).toThrow();
      });
    });

    describe("BrokenProjectGroupSchema", () => {
      it("validates well-formed broken project group", () => {
        const group = {
          projectName: "relay-service",
          workspacePath: "/Users/***/WebProjects/relay-service",
          brokenCount: 2,
          conversations: [
            {
              conversationId: "conv-a",
              title: "Task A",
              updatedAt: 1000,
            },
            {
              conversationId: "conv-b",
              title: "Task B",
            },
          ],
        };
        const parsed = BrokenProjectGroupSchema.parse(group);
        expect(parsed).toEqual(group);
      });

      it("validates broken project group with optional topLevelCount", () => {
        const group = {
          projectName: "relay-service",
          workspacePath: "/Users/***/WebProjects/relay-service",
          brokenCount: 3,
          topLevelCount: 1,
          conversations: [
            {
              conversationId: "conv-root",
              title: "Root",
              subagents: [
                { conversationId: "conv-sub-1", title: "Sub 1" },
                { conversationId: "conv-sub-2", title: "Sub 2" },
              ],
            },
          ],
        };
        const parsed = BrokenProjectGroupSchema.parse(group);
        expect(parsed).toEqual(group);
        expect(parsed.topLevelCount).toBe(1);
      });

      it("rejects negative topLevelCount", () => {
        expect(() =>
          BrokenProjectGroupSchema.parse({
            projectName: "relay-service",
            workspacePath: "/path",
            brokenCount: 2,
            topLevelCount: -1,
            conversations: [],
          }),
        ).toThrow();
      });

      it("rejects negative brokenCount", () => {
        expect(() =>
          BrokenProjectGroupSchema.parse({
            projectName: "relay-service",
            workspacePath: "/path",
            brokenCount: -1,
            conversations: [],
          }),
        ).toThrow();
      });

      it("rejects non-integer brokenCount", () => {
        expect(() =>
          BrokenProjectGroupSchema.parse({
            projectName: "relay-service",
            workspacePath: "/path",
            brokenCount: 1.5,
            conversations: [],
          }),
        ).toThrow();
      });

      it("rejects invalid conversations list", () => {
        expect(() =>
          BrokenProjectGroupSchema.parse({
            projectName: "relay-service",
            workspacePath: "/path",
            brokenCount: 1,
            conversations: [{ invalidKey: true }],
          }),
        ).toThrow();
      });
    });

    describe("InvalidChatsStatsSchema", () => {
      it("validates complete stats payload with optional error", () => {
        const stats: InvalidChatsStats = {
          target: "app",
          summariesDbPath: "/Users/***/.gemini/antigravity/conversation_summaries.db",
          exists: true,
          totalChats: 20,
          invalidChats: 5,
          validChats: 15,
          projectGroups: [
            {
              projectName: "backend-core",
              workspacePath: "/Users/***/WebProjects/backend-core",
              brokenCount: 5,
              conversations: [
                {
                  conversationId: "c-1",
                  title: "Fix Worker Pool",
                  updatedAt: 2000,
                },
              ],
            },
          ],
          error: "SQLITE_BUSY: database is locked",
        };
        const parsed = InvalidChatsStatsSchema.parse(stats);
        expect(parsed).toEqual(stats);
      });

      it("validates complete stats payload without optional error", () => {
        const stats: InvalidChatsStats = {
          target: "ide",
          summariesDbPath: "/Users/***/.gemini/antigravity-ide/conversation_summaries.db",
          exists: true,
          totalChats: 0,
          invalidChats: 0,
          validChats: 0,
          projectGroups: [],
        };
        const parsed = InvalidChatsStatsSchema.parse(stats);
        expect(parsed).toEqual(stats);
        expect(parsed.error).toBeUndefined();
      });

      it("rejects stats with negative chat counts", () => {
        expect(() =>
          InvalidChatsStatsSchema.parse({
            target: "app",
            summariesDbPath: "/path",
            exists: true,
            totalChats: -1,
            invalidChats: 0,
            validChats: 0,
            projectGroups: [],
          }),
        ).toThrow();
      });

      it("rejects stats with missing summariesDbPath", () => {
        expect(() =>
          InvalidChatsStatsSchema.parse({
            target: "app",
            exists: true,
            totalChats: 0,
            invalidChats: 0,
            validChats: 0,
            projectGroups: [],
          }),
        ).toThrow();
      });
    });

    describe("CleanInvalidChatsResultSchema", () => {
      it("validates successful clean result with zero errors", () => {
        const result: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/to/db",
          totalChecked: 10,
          prunedCount: 3,
          errors: [],
        };
        const parsed = CleanInvalidChatsResultSchema.parse(result);
        expect(parsed).toEqual(result);
      });

      it("validates clean result with captured errors", () => {
        const result: CleanInvalidChatsResult = {
          target: "cli",
          summariesDbPath: "/path/to/cli/db",
          totalChecked: 0,
          prunedCount: 0,
          errors: ["Conversation database not found: /path/to/cli/db"],
        };
        const parsed = CleanInvalidChatsResultSchema.parse(result);
        expect(parsed).toEqual(result);
      });

      it("rejects negative prunedCount", () => {
        expect(() =>
          CleanInvalidChatsResultSchema.parse({
            target: "app",
            summariesDbPath: "/path",
            totalChecked: 5,
            prunedCount: -1,
            errors: [],
          }),
        ).toThrow();
      });

      it("rejects non-array errors field", () => {
        expect(() =>
          CleanInvalidChatsResultSchema.parse({
            target: "app",
            summariesDbPath: "/path",
            totalChecked: 0,
            prunedCount: 0,
            errors: "single error string",
          }),
        ).toThrow();
      });
    });
  });

  describe("oRPC Procedure Execution (routerClient)", () => {
    describe("stats procedure", () => {
      it("invokes getInvalidChatsStats and returns schema-compliant stats", async () => {
        const mockStats: InvalidChatsStats = {
          target: "app",
          summariesDbPath: "/path/conversation_summaries.db",
          exists: true,
          totalChats: 8,
          invalidChats: 2,
          validChats: 6,
          projectGroups: [
            {
              projectName: "core-api",
              workspacePath: "/Users/***/WebProjects/core-api",
              brokenCount: 2,
              conversations: [
                {
                  conversationId: "conv-99",
                  title: "Fix Token Handler",
                  updatedAt: 1727400000000,
                },
              ],
            },
          ],
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "getInvalidChatsStats")
          .mockReturnValue(mockStats);

        const response = await routerClient.stats({ target: "app" });

        expect(serviceSpy).toHaveBeenCalledWith("app");
        expect(response).toEqual(mockStats);
        expect(InvalidChatsStatsSchema.parse(response)).toEqual(response);
      });

      it("handles stats procedure invocation with undefined target", async () => {
        const mockStats: InvalidChatsStats = {
          target: "app",
          summariesDbPath: "/path/db",
          exists: false,
          totalChats: 0,
          invalidChats: 0,
          validChats: 0,
          projectGroups: [],
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "getInvalidChatsStats")
          .mockReturnValue(mockStats);

        const response = await routerClient.stats({});

        expect(serviceSpy).toHaveBeenCalledWith(undefined);
        expect(response).toEqual(mockStats);
      });

      it("handles stats procedure invocation for ide and cli targets", async () => {
        const mockStats: InvalidChatsStats = {
          target: "cli",
          summariesDbPath: "/path/cli/db",
          exists: true,
          totalChats: 1,
          invalidChats: 1,
          validChats: 0,
          projectGroups: [],
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "getInvalidChatsStats")
          .mockReturnValue(mockStats);

        const response = await routerClient.stats({ target: "cli" });

        expect(serviceSpy).toHaveBeenCalledWith("cli");
        expect(response.target).toBe("cli");
      });

      it("rejects invalid target via Zod input validation", async () => {
        await expect(
          routerClient.stats({
            target: "unsupported_environment" as unknown as "app",
          }),
        ).rejects.toThrow();
      });
    });

    describe("clean procedure", () => {
      it("invokes cleanInvalidChats and returns schema-compliant clean result", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/conversation_summaries.db",
          totalChecked: 12,
          prunedCount: 4,
          errors: [],
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "cleanInvalidChats")
          .mockReturnValue(mockResult);

        const response = await routerClient.clean({ target: "app" });

        expect(serviceSpy).toHaveBeenCalledWith("app");
        expect(response).toEqual(mockResult);
        expect(CleanInvalidChatsResultSchema.parse(response)).toEqual(response);
      });

      it("handles clean procedure invocation with undefined target", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/db",
          totalChecked: 0,
          prunedCount: 0,
          errors: ["Conversation database not found: /path/db"],
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "cleanInvalidChats")
          .mockReturnValue(mockResult);

        const response = await routerClient.clean({});

        expect(serviceSpy).toHaveBeenCalledWith(undefined);
        expect(response).toEqual(mockResult);
      });

      it("rejects invalid target via Zod input validation", async () => {
        await expect(
          routerClient.clean({
            target: "invalid_target" as unknown as "ide",
          }),
        ).rejects.toThrow();
      });
    });

    describe("cleanSingle procedure", () => {
      it("invokes cleanSingleInvalidChat and returns schema-compliant clean result", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/conversation_summaries.db",
          totalChecked: 1,
          prunedCount: 1,
          errors: [],
          success: true,
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "cleanSingleInvalidChat")
          .mockReturnValue(mockResult);

        const response = await routerClient.cleanSingle({
          target: "app",
          cid: "conv-target-1",
        });

        expect(serviceSpy).toHaveBeenCalledWith("app", "conv-target-1");
        expect(response).toEqual(mockResult);
        expect(CleanInvalidChatsResultSchema.parse(response)).toEqual(response);
      });

      it("handles cleanSingle procedure invocation with undefined target", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/db",
          totalChecked: 1,
          prunedCount: 1,
          errors: [],
          success: true,
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "cleanSingleInvalidChat")
          .mockReturnValue(mockResult);

        const response = await routerClient.cleanSingle({
          cid: "conv-target-2",
        });

        expect(serviceSpy).toHaveBeenCalledWith(undefined, "conv-target-2");
        expect(response).toEqual(mockResult);
      });

      it("rejects empty cid string via Zod input validation", async () => {
        await expect(
          routerClient.cleanSingle({
            target: "app",
            cid: "",
          }),
        ).rejects.toThrow();
      });

      it("rejects invalid target via Zod input validation", async () => {
        await expect(
          routerClient.cleanSingle({
            target: "unsupported" as unknown as "app",
            cid: "conv-valid",
          }),
        ).rejects.toThrow();
      });
    });

    describe("cleanBatch procedure", () => {
      it("invokes cleanBatchInvalidChats and returns schema-compliant clean result", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/conversation_summaries.db",
          totalChecked: 2,
          prunedCount: 2,
          errors: [],
          success: true,
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "cleanBatchInvalidChats")
          .mockReturnValue(mockResult);

        const response = await routerClient.cleanBatch({
          target: "app",
          cids: ["conv-sub-1", "conv-sub-2"],
        });

        expect(serviceSpy).toHaveBeenCalledWith("app", [
          "conv-sub-1",
          "conv-sub-2",
        ]);
        expect(response).toEqual(mockResult);
        expect(CleanInvalidChatsResultSchema.parse(response)).toEqual(response);
      });

      it("handles cleanBatch procedure invocation with undefined target", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/db",
          totalChecked: 1,
          prunedCount: 1,
          errors: [],
          success: true,
        };

        const serviceSpy = vi
          .spyOn(conversationCleanerService, "cleanBatchInvalidChats")
          .mockReturnValue(mockResult);

        const response = await routerClient.cleanBatch({
          cids: ["conv-sub-3"],
        });

        expect(serviceSpy).toHaveBeenCalledWith(undefined, ["conv-sub-3"]);
        expect(response).toEqual(mockResult);
      });

      it("rejects empty cids array via Zod input validation", async () => {
        await expect(
          routerClient.cleanBatch({
            target: "app",
            cids: [],
          }),
        ).rejects.toThrow();
      });

      it("rejects cids array containing empty strings via Zod input validation", async () => {
        await expect(
          routerClient.cleanBatch({
            target: "app",
            cids: [""],
          }),
        ).rejects.toThrow();
      });

      it("rejects invalid target via Zod input validation", async () => {
        await expect(
          routerClient.cleanBatch({
            target: "unsupported" as unknown as "app",
            cids: ["conv-valid"],
          }),
        ).rejects.toThrow();
      });
    });
  });

  describe("Client Action Wrappers", () => {
    describe("conversationCleaner actions", () => {
      it("getInvalidChatsStats action delegates to ipc.client.conversationCleaner.stats", async () => {
        const mockStats: InvalidChatsStats = {
          target: "ide",
          summariesDbPath: "/path/ide/db",
          exists: true,
          totalChats: 5,
          invalidChats: 1,
          validChats: 4,
          projectGroups: [],
        };

        vi.mocked(ipc.client.conversationCleaner.stats).mockResolvedValueOnce(
          mockStats as unknown as never,
        );

        const result = await getInvalidChatsStatsAction("ide");

        expect(ipc.client.conversationCleaner.stats).toHaveBeenCalledTimes(1);
        expect(ipc.client.conversationCleaner.stats).toHaveBeenCalledWith({
          target: "ide",
        });
        expect(result).toEqual(mockStats);
      });

      it("getInvalidChatsStats action forwards undefined target when omitted", async () => {
        vi.mocked(ipc.client.conversationCleaner.stats).mockResolvedValueOnce({
          target: "app",
        } as unknown as never);

        await getInvalidChatsStatsAction();

        expect(ipc.client.conversationCleaner.stats).toHaveBeenCalledWith({
          target: undefined,
        });
      });

      it("cleanInvalidChats action delegates to ipc.client.conversationCleaner.clean", async () => {
        const mockCleanResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/app/db",
          totalChecked: 8,
          prunedCount: 2,
          errors: [],
        };

        vi.mocked(ipc.client.conversationCleaner.clean).mockResolvedValueOnce(
          mockCleanResult as unknown as never,
        );

        const result = await cleanInvalidChatsAction("app");

        expect(ipc.client.conversationCleaner.clean).toHaveBeenCalledTimes(1);
        expect(ipc.client.conversationCleaner.clean).toHaveBeenCalledWith({
          target: "app",
        });
        expect(result).toEqual(mockCleanResult);
      });

      it("cleanInvalidChats action forwards undefined target when omitted", async () => {
        vi.mocked(ipc.client.conversationCleaner.clean).mockResolvedValueOnce({
          target: "app",
        } as unknown as never);

        await cleanInvalidChatsAction();

        expect(ipc.client.conversationCleaner.clean).toHaveBeenCalledWith({
          target: undefined,
        });
      });

      it("cleanSingleInvalidChat action delegates to ipc.client.conversationCleaner.cleanSingle", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/app/db",
          totalChecked: 1,
          prunedCount: 1,
          errors: [],
          success: true,
        };

        vi.mocked(ipc.client.conversationCleaner.cleanSingle).mockResolvedValueOnce(
          mockResult as unknown as never,
        );

        const result = await cleanSingleInvalidChatAction("app", "conv-xyz");

        expect(ipc.client.conversationCleaner.cleanSingle).toHaveBeenCalledTimes(1);
        expect(ipc.client.conversationCleaner.cleanSingle).toHaveBeenCalledWith({
          target: "app",
          cid: "conv-xyz",
        });
        expect(result).toEqual(mockResult);
      });

      it("cleanSingleInvalidChat action forwards fallback empty string when cid is omitted", async () => {
        vi.mocked(ipc.client.conversationCleaner.cleanSingle).mockResolvedValueOnce({
          target: "app",
        } as unknown as never);

        await cleanSingleInvalidChatAction("app");

        expect(ipc.client.conversationCleaner.cleanSingle).toHaveBeenCalledWith({
          target: "app",
          cid: "",
        });
      });

      it("cleanBatchInvalidChats action delegates to ipc.client.conversationCleaner.cleanBatch", async () => {
        const mockResult: CleanInvalidChatsResult = {
          target: "app",
          summariesDbPath: "/path/app/db",
          totalChecked: 2,
          prunedCount: 2,
          errors: [],
          success: true,
        };

        vi.mocked(ipc.client.conversationCleaner.cleanBatch).mockResolvedValueOnce(
          mockResult as unknown as never,
        );

        const result = await cleanBatchInvalidChatsAction("app", [
          "conv-1",
          "conv-2",
        ]);

        expect(ipc.client.conversationCleaner.cleanBatch).toHaveBeenCalledTimes(1);
        expect(ipc.client.conversationCleaner.cleanBatch).toHaveBeenCalledWith({
          target: "app",
          cids: ["conv-1", "conv-2"],
        });
        expect(result).toEqual(mockResult);
      });

      it("cleanBatchInvalidChats action forwards fallback empty array when cids is omitted", async () => {
        vi.mocked(ipc.client.conversationCleaner.cleanBatch).mockResolvedValueOnce({
          target: "app",
        } as unknown as never);

        await cleanBatchInvalidChatsAction("app");

        expect(ipc.client.conversationCleaner.cleanBatch).toHaveBeenCalledWith({
          target: "app",
          cids: [],
        });
      });
    });
  });
});

