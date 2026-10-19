import Database from "better-sqlite3";
import fs from "fs";
import { logger } from "@/shared/logging/logger";
import {
  type AntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityConversationsDir,
  getAntigravityConversationSummariesDbPath,
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import { configureDatabase } from "@/shared/persistence/database/dbConnection";
import {
  listBackupSnapshots,
  getBackupStats,
} from "@/modules/antigravity-runtime/backup/chatBackup";
import { parseWorkspaceInfo, parseTimestamp } from "./workspaceInfo";
import { resolveConversationTitle, humanizeAgentName } from "./conversationTitles";
import { buildSubagentTree } from "./subagentTree";
import {
  getLiveTrajectoryCids,
  filterSnapshotsForStale,
  resolveBrokenChatBackups,
} from "./chatHealthBackupMatch";
import {
  type BrokenChatItem,
  type BrokenProjectGroup,
  type InvalidChatsStats,
  type ChatHealthReport,
  type IntactParentInfo,
  CONVERSATION_CLEANER_CONSTANTS,
} from "./types";

export {
  getLiveTrajectoryCids,
  matchBackupSnapshots,
  resolveBrokenChatBackups,
  filterSnapshotChatsForStale,
  filterSnapshotsForStale,
} from "./chatHealthBackupMatch";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

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
    const allSummaryCids = new Set<string>();
    for (const r of rows) {
      allSummaryCids.add(r.conversation_id);
      if (r.title?.trim()) titleMap.set(r.conversation_id, r.title.trim());
      if (r.parent_conversation_id?.trim()) parentMap.set(r.conversation_id, r.parent_conversation_id.trim());
    }

    let validCount = 0;
    let invalidCount = 0;
    const groupMap = new Map<string, BrokenProjectGroup>();
    const allBrokenChats: BrokenChatItem[] = [];
    const intactParents = new Map<string, IntactParentInfo>();

    for (const row of rows) {
      const cid = row.conversation_id;
      if (trajectorySet.has(`${cid}.db`)) {
        validCount++;
        const isMain =
          row.nesting_depth === 0 ||
          (!row.nesting_depth && !row.parent_conversation_id?.trim());
        if (isMain) {
          intactParents.set(cid, {
            title: resolveConversationTitle(row, parentMap, titleMap),
            updatedAt: parseTimestamp(row.last_modified_time),
            workspaceUris: row.workspace_uris,
            nestingDepth: row.nesting_depth ?? 0,
            agentName: row.agent_name?.trim() ? humanizeAgentName(row.agent_name) : undefined,
          });
        }
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
        const parentCid = row.parent_conversation_id?.trim() || undefined;
        const parentTitle = parentCid
          ? titleMap.get(parentCid)?.trim() || undefined
          : undefined;
        const agentName = row.agent_name?.trim()
          ? humanizeAgentName(row.agent_name)
          : undefined;
        const nestingDepth =
          row.nesting_depth != null && row.nesting_depth >= 0
            ? row.nesting_depth
            : undefined;

        const brokenItem: BrokenChatItem = {
          conversationId: cid,
          title: resolveConversationTitle(row, parentMap, titleMap),
          updatedAt: parseTimestamp(row.last_modified_time),
          hasBackup: false,
          parentConversationId: parentCid,
          parentTitle,
          agentName,
          nestingDepth,
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
      const tree = buildSubagentTree(group.conversations, intactParents, parentMap, allSummaryCids);
      group.conversations = tree.conversations;
      group.topLevelCount = tree.topLevelCount;
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
