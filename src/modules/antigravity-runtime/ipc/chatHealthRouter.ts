import { os } from "@orpc/server";
import { z } from "zod";
import { AntigravityAppTargetSchema } from "@/shared/platform/antigravityAppTarget";
import type { ChatHealthReport } from "../conversation/types";
import { InvalidChatsStatsSchema } from "./conversationCleanerRouter";
import {
  BackupStatsSchema,
  BackupSnapshotSchema,
} from "../backup/chatBackup";
import { resolveChatHealth } from "../conversation/chatHealthResolver";

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
});
