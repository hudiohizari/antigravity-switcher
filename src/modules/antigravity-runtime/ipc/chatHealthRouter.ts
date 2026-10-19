import { os } from "@orpc/server";
import { z } from "zod";
import { AntigravityAppTargetSchema } from "@/shared/platform/antigravityAppTarget";
import type {
  ChatHealthReport,
  HealBrokenChatResult,
  HealAllBrokenChatsResult,
} from "../conversation/types";
import { InvalidChatsStatsSchema } from "./conversationCleanerRouter";
import { BackupStatsSchema, BackupSnapshotSchema } from "../backup/chatBackup";
import { resolveChatHealth } from "../conversation/chatHealthResolver";
import { healBrokenChat, healAllBrokenChats } from "../conversation/chatHealer";

export const HealBrokenChatResultSchema = z.object({
  success: z.boolean(),
  cid: z.string(),
  error: z.string().optional(),
}) satisfies z.ZodType<HealBrokenChatResult>;

export const HealAllBrokenChatsResultSchema = z.object({
  totalHealed: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  errors: z.array(z.string()),
}) satisfies z.ZodType<HealAllBrokenChatsResult>;

export const ChatHealthReportSchema = z.object({
  target: z.string(),
  cleanerStats: InvalidChatsStatsSchema,
  backupStats: BackupStatsSchema,
  snapshots: z.array(BackupSnapshotSchema),
}) satisfies z.ZodType<ChatHealthReport>;

export const chatHealthRouter = os.prefix("/chat-health").router({
  getHealth: os
    .input(
      z.object({
        target: AntigravityAppTargetSchema.optional(),
        staleOnly: z.boolean().optional(),
      }),
    )
    .output(ChatHealthReportSchema)
    .handler(({ input }) =>
      resolveChatHealth(input.target, { staleOnly: input.staleOnly }),
    ),

  healBrokenChat: os
    .input(
      z.object({
        target: AntigravityAppTargetSchema.optional(),
        cid: z.string(),
      }),
    )
    .output(HealBrokenChatResultSchema)
    .handler(({ input }) => healBrokenChat(input.target, input.cid)),

  healAllBrokenChats: os
    .input(z.object({ target: AntigravityAppTargetSchema.optional() }))
    .output(HealAllBrokenChatsResultSchema)
    .handler(({ input }) => healAllBrokenChats(input.target)),
});
