import { os } from "@orpc/server";
import { z } from "zod";
import {
  getInvalidChatsStats,
  cleanInvalidChats,
  cleanSingleInvalidChat,
  cleanBatchInvalidChats,
} from "../conversation/conversationCleaner";
import { AntigravityAppTargetSchema } from "@/shared/platform/antigravityAppTarget";
import {
  type BrokenChatItem,
  type BrokenProjectGroup,
  type InvalidChatsStats,
  type CleanInvalidChatsResult,
  CONVERSATION_CLEANER_CONSTANTS,
} from "../conversation/types";

export { CONVERSATION_CLEANER_CONSTANTS };
export type {
  BrokenChatItem,
  BrokenProjectGroup,
  InvalidChatsStats,
  CleanInvalidChatsResult,
};

export const BrokenChatItemSchema: z.ZodType<BrokenChatItem> = z.object({
  conversationId: z.string().min(1),
  title: z.string(),
  updatedAt: z.number().optional(),
  hasBackup: z.boolean().optional(),
  matchingSnapshotId: z.string().optional(),
  parentConversationId: z.string().optional(),
  parentTitle: z.string().optional(),
  agentName: z.string().optional(),
  nestingDepth: z.number().int().nonnegative().optional(),
  subagents: z.lazy(() => z.array(BrokenChatItemSchema)).optional(),
  isIntactParent: z.boolean().optional(),
  isDeletedSessionContainer: z.boolean().optional(),
});

export const BrokenProjectGroupSchema = z.object({
  projectName: z.string(),
  workspacePath: z.string(),
  brokenCount: z.number().int().nonnegative(),
  topLevelCount: z.number().int().nonnegative().optional(),
  conversations: z.array(BrokenChatItemSchema),
}) satisfies z.ZodType<BrokenProjectGroup>;

export const InvalidChatsStatsSchema = z.object({
  target: z.string(),
  summariesDbPath: z.string(),
  exists: z.boolean(),
  totalChats: z.number().int().nonnegative(),
  invalidChats: z.number().int().nonnegative(),
  validChats: z.number().int().nonnegative(),
  projectGroups: z.array(BrokenProjectGroupSchema),
  error: z.string().optional(),
}) satisfies z.ZodType<InvalidChatsStats>;

export const CleanInvalidChatsResultSchema = z.object({
  target: z.string(),
  summariesDbPath: z.string(),
  totalChecked: z.number().int().nonnegative(),
  prunedCount: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  success: z.boolean().optional(),
}) satisfies z.ZodType<CleanInvalidChatsResult>;

export const conversationCleanerRouter = os
  .prefix("/conversation-cleaner")
  .router({
    stats: os
      .input(
        z.object({
          target: AntigravityAppTargetSchema.optional(),
        }),
      )
      .output(InvalidChatsStatsSchema)
      .handler(({ input }) => getInvalidChatsStats(input.target)),

    clean: os
      .input(
        z.object({
          target: AntigravityAppTargetSchema.optional(),
        }),
      )
      .output(CleanInvalidChatsResultSchema)
      .handler(({ input }) => cleanInvalidChats(input.target)),

    cleanSingle: os
      .input(
        z.object({
          target: AntigravityAppTargetSchema.optional(),
          cid: z.string().min(1),
        }),
      )
      .output(CleanInvalidChatsResultSchema)
      .handler(({ input }) => cleanSingleInvalidChat(input.target, input.cid)),

    cleanBatch: os
      .input(
        z.object({
          target: AntigravityAppTargetSchema.optional(),
          cids: z.array(z.string().min(1)).min(1),
        }),
      )
      .output(CleanInvalidChatsResultSchema)
      .handler(({ input }) => cleanBatchInvalidChats(input.target, input.cids)),
  });
