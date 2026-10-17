import { z } from "zod";
import {
  type AntigravityAppTarget,
  type CanonicalAntigravityAppTarget,
  CanonicalAntigravityAppTargetSchema,
} from "@/shared/platform/antigravityAppTarget";
import type { PathResolutionOptions } from "@/shared/platform/paths";

export const CHAT_BACKUP_CONSTANTS = {
  STORAGE_LIMIT_BYTES: 1024 * 1024 * 1024,
  SQLITE_BUSY_TIMEOUT_MS: 5000,
  PROTO_MIRROR_CANDIDATES: [
    "agyhub_summaries_proto.pb",
    "agyhub_summaries.pb",
    "jetbox_summaries.pb",
  ] as const,
  FALLBACK_CHAT_TITLE: "Untitled Conversation",
} as const;

export const BackupSnapshotTypeSchema = z.enum([
  "pre_switch",
  "pre_clean",
  "manual",
]);
export type BackupSnapshotType = z.infer<typeof BackupSnapshotTypeSchema>;

export const SnapshotChatItemSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  updatedAt: z.number().optional(),
  hasTrajectoryDb: z.boolean(),
});
export type SnapshotChatItem = z.infer<typeof SnapshotChatItemSchema>;

export const BackupSnapshotSchema = z.object({
  id: z.string(),
  target: CanonicalAntigravityAppTargetSchema,
  type: BackupSnapshotTypeSchema,
  createdAt: z.number(),
  sizeBytes: z.number(),
  chatCount: z.number(),
  protectedFromPruning: z.boolean(),
  activeConversationId: z.string().optional(),
  chats: z.array(SnapshotChatItemSchema),
});
export type BackupSnapshot = z.infer<typeof BackupSnapshotSchema>;

export const BackupStatsSchema = z.object({
  target: CanonicalAntigravityAppTargetSchema,
  totalSizeBytes: z.number(),
  targetSizeBytes: z.number(),
  snapshotCount: z.number(),
  exceedsStorageLimit: z.boolean(),
  snapshots: z.array(BackupSnapshotSchema),
});
export type BackupStats = z.infer<typeof BackupStatsSchema>;

export const RestoreResultSchema = z.object({
  success: z.boolean(),
  target: CanonicalAntigravityAppTargetSchema,
  restoredChatCount: z.number(),
  restoredConversationIds: z.array(z.string()),
  error: z.string().optional(),
  errors: z.array(z.string()).optional(),
});
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

export const PruneResultSchema = z.object({
  target: CanonicalAntigravityAppTargetSchema,
  prunedCount: z.number(),
  freedBytes: z.number(),
  remainingCount: z.number(),
  remainingSizeBytes: z.number(),
  errors: z.array(z.string()),
});
export type PruneResult = z.infer<typeof PruneResultSchema>;

export interface ListBackupSnapshotsOptions extends PathResolutionOptions {
  staleOnly?: boolean;
}
