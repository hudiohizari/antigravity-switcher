import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { logger } from "@/shared/logging/logger";
import {
  type AntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityConversationsDir,
  getAntigravityConversationSummariesDbPath,
  getBackupsDir,
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import { configureDatabase } from "@/shared/persistence/database/dbConnection";
import {
  listBackupSnapshots,
  getBackupStats,
  type BackupSnapshot,
  type SnapshotChatItem,
} from "@/modules/antigravity-runtime/backup/chatBackup";
import { parseWorkspaceInfo, parseTimestamp } from "./workspaceInfo";
import { resolveConversationTitle } from "./conversationTitles";
import {
  type BrokenChatItem,
  type BrokenProjectGroup,
  type InvalidChatsStats,
  type ChatHealthReport,
  CONVERSATION_CLEANER_CONSTANTS,
} from "./types";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

/**
 * Returns a Set of valid conversation IDs that currently have a trajectory .db
 * file present in the live conversations store.
 */
export function getLiveTrajectoryCids(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): Set<string> {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );
  const cids = new Set<string>();
  if (!conversationsDir || !fs.existsSync(conversationsDir)) {
    return cids;
  }

  try {
    const entries = fs.readdirSync(conversationsDir);
    for (const entry of entries) {
      if (entry.endsWith(".db")) {
        cids.add(entry.slice(0, -3));
      }
    }
  } catch {
    // Suppress read errors and return collected entries
  }
  return cids;
}

/**
 * Cross-references conversation IDs against available backup snapshots for the target.
 * Returns a Map of conversationId -> matchingSnapshotId for the most recent snapshot
 * containing the trajectory database.
 */
export function matchBackupSnapshots(
  cids: string[],
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): Map<string, string> {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const matchMap = new Map<string, string>();
  if (cids.length === 0) {
    return matchMap;
  }

  const snapshots = listBackupSnapshots(canonicalTarget, options);
  if (snapshots.length === 0) {
    return matchMap;
  }

  const targetDir = path.join(getBackupsDir(options), canonicalTarget);

  for (const snap of snapshots) {
    const snapConvDir = path.join(targetDir, snap.id, "conversations");
    const diskTrajectorySet = new Set<string>();
    if (fs.existsSync(snapConvDir)) {
      try {
        const files = fs.readdirSync(snapConvDir);
        for (const file of files) {
          if (file.endsWith(".db")) {
            diskTrajectorySet.add(file.slice(0, -3));
          }
        }
      } catch {
        // Suppress read errors
      }
    }

    for (const chat of snap.chats ?? []) {
      if (chat.hasTrajectoryDb || diskTrajectorySet.has(chat.conversationId)) {
        if (!matchMap.has(chat.conversationId)) {
          matchMap.set(chat.conversationId, snap.id);
        }
      }
    }

    for (const cid of diskTrajectorySet) {
      if (!matchMap.has(cid)) {
        matchMap.set(cid, snap.id);
      }
    }
  }

  return matchMap;
}

/**
 * Tags broken chat items with hasBackup and matchingSnapshotId based on available
 * backup snapshots. Mutates and returns the input array.
 */
export function resolveBrokenChatBackups(
  brokenChats: BrokenChatItem[],
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): BrokenChatItem[] {
  if (brokenChats.length === 0) {
    return brokenChats;
  }

  const matchMap = matchBackupSnapshots(
    brokenChats.map((c) => c.conversationId),
    target,
    options,
  );

  for (const chat of brokenChats) {
    const matchingSnapshotId = matchMap.get(chat.conversationId);
    chat.hasBackup = Boolean(matchingSnapshotId);
    chat.matchingSnapshotId = matchingSnapshotId;
  }

  return brokenChats;
}

/**
 * Filters snapshot chats to only include stale/missing chats (those not present
 * in the live store).
 */
export function filterSnapshotChatsForStale(
  chats: SnapshotChatItem[],
  liveValidCids: Set<string>,
): SnapshotChatItem[] {
  return chats.filter((chat) => !liveValidCids.has(chat.conversationId));
}

/**
 * Filters backup snapshots so their chats contain only stale/missing items.
 */
export function filterSnapshotsForStale(
  snapshots: BackupSnapshot[],
  liveValidCids: Set<string>,
): BackupSnapshot[] {
  return snapshots.map((snap) => {
    const filteredChats = filterSnapshotChatsForStale(
      snap.chats ?? [],
      liveValidCids,
    );
    return {
      ...snap,
      chats: filteredChats,
      chatCount: filteredChats.length,
    };
  });
}

/**
 * Inspects live conversations and conversation_summaries.db, cross-references
 * against backup snapshots, and returns comprehensive diagnostic stats.
 */
export function resolveChatHealthStats(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): InvalidChatsStats {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const summariesDbPath = getAntigravityConversationSummariesDbPath(
    canonicalTarget,
    options,
  );
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );

  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    return {
      target: canonicalTarget,
      summariesDbPath: summariesDbPath || "",
      exists: false,
      totalChats: 0,
      invalidChats: 0,
      validChats: 0,
      projectGroups: [],
    };
  }

  let db: Database.Database | null = null;
  try {
    let trajectorySet = new Set<string>();
    if (conversationsDir && fs.existsSync(conversationsDir)) {
      const entries = fs.readdirSync(conversationsDir);
      trajectorySet = new Set(entries);
    }

    const activeDb: Database.Database = new DatabaseConstructor(
      summariesDbPath,
      { fileMustExist: true },
    );
    db = activeDb;
    configureDatabase(activeDb, {
      busyTimeoutMs:
        CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_WRITE,
      readOnly: true,
    });

    const hasTable = activeDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();

    if (!hasTable) {
      return {
        target: canonicalTarget,
        summariesDbPath,
        exists: true,
        totalChats: 0,
        invalidChats: 0,
        validChats: 0,
        projectGroups: [],
      };
    }

    let rows: Array<{
      conversation_id: string;
      title?: string | null;
      workspace_uris?: string | null;
      last_modified_time?: string | number | null;
      parent_conversation_id?: string | null;
      nesting_depth?: number | null;
      agent_name?: string | null;
      preview?: string | null;
    }> = [];

    try {
      rows = activeDb.prepare("SELECT conversation_id, title, workspace_uris, last_modified_time, parent_conversation_id, nesting_depth, agent_name, preview FROM conversation_summaries").all() as typeof rows;
    } catch {
      try {
        rows = activeDb.prepare("SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries").all() as typeof rows;
      } catch {
        rows = activeDb.prepare("SELECT conversation_id FROM conversation_summaries").all() as typeof rows;
      }
    }

    const titleMap = new Map<string, string>();
    const parentMap = new Map<string, string>();
    for (const r of rows) {
      if (r.title?.trim()) titleMap.set(r.conversation_id, r.title.trim());
      if (r.parent_conversation_id?.trim()) parentMap.set(r.conversation_id, r.parent_conversation_id.trim());
    }

    let validCount = 0;
    let invalidCount = 0;
    const groupMap = new Map<string, BrokenProjectGroup>();
    const allBrokenChats: BrokenChatItem[] = [];

    for (const row of rows) {
      const cid = row.conversation_id;
      if (trajectorySet.has(`${cid}.db`)) {
        validCount++;
      } else {
        invalidCount++;
        const { projectName, workspacePath } = parseWorkspaceInfo(row.workspace_uris);
        const groupKey = `${projectName}:::${workspacePath}`;

        let group = groupMap.get(groupKey);
        if (!group) {
          group = { projectName, workspacePath, brokenCount: 0, conversations: [] };
          groupMap.set(groupKey, group);
        }

        group.brokenCount++;
        const brokenItem: BrokenChatItem = {
          conversationId: cid,
          title: resolveConversationTitle(row, parentMap, titleMap),
          updatedAt: parseTimestamp(row.last_modified_time),
          hasBackup: false,
        };
        group.conversations.push(brokenItem);
        allBrokenChats.push(brokenItem);
      }
    }

    if (allBrokenChats.length > 0) {
      resolveBrokenChatBackups(allBrokenChats, canonicalTarget, options);
    }

    const projectGroups = Array.from(groupMap.values()).sort((a, b) => {
      const isAFallback = a.projectName === CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME;
      const isBFallback = b.projectName === CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME;
      if (isAFallback && !isBFallback) return 1;
      if (!isAFallback && isBFallback) return -1;
      const comp = a.projectName.localeCompare(b.projectName, undefined, { sensitivity: "base" });
      return comp !== 0 ? comp : a.workspacePath.localeCompare(b.workspacePath);
    });

    for (const group of projectGroups) {
      group.conversations.sort((a, b) => {
        const diff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        return diff !== 0 ? diff : a.conversationId.localeCompare(b.conversationId);
      });
    }

    return {
      target: canonicalTarget,
      summariesDbPath,
      exists: true,
      totalChats: rows.length,
      invalidChats: invalidCount,
      validChats: validCount,
      projectGroups,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to inspect conversation summaries: ${summariesDbPath}`,
      error,
    );
    return {
      target: canonicalTarget,
      summariesDbPath,
      exists: true,
      totalChats: 0,
      invalidChats: 0,
      validChats: 0,
      projectGroups: [],
      error: errorMsg,
    };
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Returns a unified health report combining live diagnostics, backup stats,
 * and filtered or full snapshot states.
 */
export function resolveChatHealth(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions & { staleOnly?: boolean },
): ChatHealthReport {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const cleanerStats = resolveChatHealthStats(canonicalTarget, options);
  const backupStats = getBackupStats(canonicalTarget, options);
  let snapshots = listBackupSnapshots(canonicalTarget, options);

  if (options?.staleOnly) {
    const liveCids = getLiveTrajectoryCids(canonicalTarget, options);
    snapshots = filterSnapshotsForStale(snapshots, liveCids);
  }

  return {
    target: canonicalTarget,
    cleanerStats,
    backupStats,
    snapshots,
  };
}
