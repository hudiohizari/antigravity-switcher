import { os } from "@orpc/server";
import { z } from "zod";
import { AntigravityAppTargetSchema } from "@/shared/platform/antigravityAppTarget";
import {
  BackupSnapshotSchema, BackupStatsSchema, PruneResultSchema, RestoreResultSchema,
  createPreSwitchBackup, getBackupStats, listBackupSnapshots, pruneBackups, restoreSingleChat, restoreSnapshot,
} from "../backup/chatBackup";

export const chatBackupRouter = os.prefix("/chat-backup").router({
  getStats: os.input(z.object({ target: AntigravityAppTargetSchema.optional(), staleOnly: z.boolean().optional() })).output(BackupStatsSchema).handler(({ input }) => input.staleOnly !== undefined ? getBackupStats(input.target, { staleOnly: input.staleOnly }) : getBackupStats(input.target)),
  listSnapshots: os.input(z.object({ target: AntigravityAppTargetSchema.optional(), staleOnly: z.boolean().optional() })).output(z.array(BackupSnapshotSchema)).handler(({ input }) => input.staleOnly !== undefined ? listBackupSnapshots(input.target, { staleOnly: input.staleOnly }) : listBackupSnapshots(input.target)),
  createBackup: os.input(z.object({ target: AntigravityAppTargetSchema.optional(), activeCid: z.string().optional() })).output(BackupSnapshotSchema.nullable()).handler(({ input }) => createPreSwitchBackup(input.target, input.activeCid)),
  restoreSnapshot: os.input(z.object({ target: AntigravityAppTargetSchema.optional(), snapshotId: z.string() })).output(RestoreResultSchema).handler(({ input }) => restoreSnapshot(input.target, input.snapshotId)),
  restoreChat: os.input(z.object({ target: AntigravityAppTargetSchema.optional(), snapshotId: z.string(), cid: z.string() })).output(RestoreResultSchema).handler(({ input }) => restoreSingleChat(input.target, input.snapshotId, input.cid)),
  pruneBackups: os.input(z.object({ target: AntigravityAppTargetSchema.optional() })).output(PruneResultSchema).handler(({ input }) => pruneBackups(input.target)),
});
