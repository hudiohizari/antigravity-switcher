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
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import { configureDatabase } from "@/shared/persistence/database/dbConnection";
import { createPreCleanRollback } from "@/modules/antigravity-runtime/backup/chatBackup";

export * from "./types";
import {
  type CleanInvalidChatsResult,
  CONVERSATION_CLEANER_CONSTANTS,
} from "./types";

export { parseWorkspaceInfo, parseTimestamp } from "./workspaceInfo";
export { resolveChatHealthStats as getInvalidChatsStats } from "./chatHealthResolver";
export { healBrokenChat, healAllBrokenChats } from "./chatHealer";

export function cleanInvalidChats(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): CleanInvalidChatsResult {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const summariesDbPath = getAntigravityConversationSummariesDbPath(
    canonicalTarget,
    options,
  );
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );

  const result: CleanInvalidChatsResult = {
    target: canonicalTarget,
    summariesDbPath: summariesDbPath || "",
    totalChecked: 0,
    prunedCount: 0,
    errors: [],
  };

  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    result.errors.push(`Conversation database not found: ${summariesDbPath}`);
    return result;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(summariesDbPath, { fileMustExist: true });
    configureDatabase(db, {
      busyTimeoutMs:
        CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_WRITE,
      readOnly: false,
    });

    const hasTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();

    if (!hasTable) {
      result.errors.push("Table conversation_summaries does not exist.");
      return result;
    }

    // Fresh directory read to prevent TOCTOU race conditions
    let trajectorySet = new Set<string>();
    if (conversationsDir && fs.existsSync(conversationsDir)) {
      const entries = fs.readdirSync(conversationsDir);
      trajectorySet = new Set(entries);
    }

    const rows = db
      .prepare("SELECT conversation_id FROM conversation_summaries")
      .all() as Array<{ conversation_id: string }>;

    result.totalChecked = rows.length;

    const invalidIds: string[] = [];
    for (const row of rows) {
      const cid = row.conversation_id;
      if (!trajectorySet.has(`${cid}.db`)) {
        invalidIds.push(cid);
      }
    }

    if (invalidIds.length > 0) {
      try {
        createPreCleanRollback(canonicalTarget, invalidIds, options);
      } catch (rollbackErr) {
        logger.warn("Pre-clean rollback backup encountered an error", rollbackErr);
      }

      const deleteStmt = db.prepare(
        "DELETE FROM conversation_summaries WHERE conversation_id = ?",
      );

      const deleteTransaction = db.transaction((ids: string[]) => {
        for (const id of ids) {
          deleteStmt.run(id);
        }
      });

      deleteTransaction(invalidIds);
      result.prunedCount = invalidIds.length;
      logger.info(
        `Pruned ${invalidIds.length} invalid chat entries from ${summariesDbPath}`,
      );

      invalidateProtobufMirrors(summariesDbPath);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to clean conversation summaries: ${errorMsg}`);
    logger.error("Error during invalid chat cleanup", error);
  } finally {
    if (db) {
      db.close();
    }
  }

  return result;
}

function invalidateProtobufMirrors(summariesDbPath: string): void {
  const parentDir = path.dirname(summariesDbPath);
  for (const protoName of CONVERSATION_CLEANER_CONSTANTS.PROTO_MIRROR_CANDIDATES) {
    const protoPath = path.join(parentDir, protoName);
    if (fs.existsSync(protoPath)) {
      try {
        fs.unlinkSync(protoPath);
        logger.info(`Removed stale summary proto mirror: ${protoPath}`);
      } catch (unlinkErr) {
        logger.warn(
          `Failed to remove stale summary proto: ${protoPath}`,
          unlinkErr,
        );
      }
    }
  }
}

export function cleanSingleInvalidChat(
  target?: AntigravityAppTarget | null,
  cid?: string,
  options?: PathResolutionOptions,
): CleanInvalidChatsResult {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const summariesDbPath = getAntigravityConversationSummariesDbPath(
    canonicalTarget,
    options,
  );
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );

  const result: CleanInvalidChatsResult = {
    target: canonicalTarget,
    summariesDbPath: summariesDbPath || "",
    totalChecked: 0,
    prunedCount: 0,
    errors: [],
    success: false,
  };

  if (!cid || typeof cid !== "string" || !cid.trim()) {
    result.errors.push("Invalid conversation ID: must not be empty");
    return result;
  }

  const trimmedCid = cid.trim();

  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    result.errors.push(`Conversation database not found: ${summariesDbPath}`);
    return result;
  }

  if (
    conversationsDir &&
    fs.existsSync(path.join(conversationsDir, `${trimmedCid}.db`))
  ) {
    result.totalChecked = 1;
    result.errors.push("Cannot prune an intact conversation trajectory");
    return result;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(summariesDbPath, { fileMustExist: true });
    configureDatabase(db, {
      busyTimeoutMs:
        CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_WRITE,
      readOnly: false,
    });

    const hasTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();

    if (!hasTable) {
      result.errors.push("Table conversation_summaries does not exist.");
      return result;
    }

    try {
      createPreCleanRollback(canonicalTarget, [trimmedCid], options);
    } catch (rollbackErr) {
      logger.warn("Pre-clean rollback backup encountered an error", rollbackErr);
    }

    const deleteStmt = db.prepare(
      "DELETE FROM conversation_summaries WHERE conversation_id = ?",
    );

    const deleteTransaction = db.transaction((id: string) => {
      return deleteStmt.run(id);
    });

    const runResult = deleteTransaction(trimmedCid) as
      | Database.RunResult
      | { changes?: number }
      | undefined;

    const changes = runResult?.changes ?? 0;
    result.totalChecked = 1;
    result.prunedCount = changes;
    result.success = changes > 0;

    if (changes > 0) {
      logger.info(
        `Pruned single invalid chat entry ${trimmedCid} from ${summariesDbPath}`,
      );
      invalidateProtobufMirrors(summariesDbPath);
    } else {
      result.errors.push(`Conversation not found: ${trimmedCid}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to clean conversation summaries: ${errorMsg}`);
    logger.error("Error during single invalid chat cleanup", error);
  } finally {
    if (db) {
      db.close();
    }
  }

  return result;
}

export function cleanBatchInvalidChats(
  target?: AntigravityAppTarget | null,
  cids: string[] = [],
  options?: PathResolutionOptions,
): CleanInvalidChatsResult {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const summariesDbPath = getAntigravityConversationSummariesDbPath(
    canonicalTarget,
    options,
  );
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );

  const result: CleanInvalidChatsResult = {
    target: canonicalTarget,
    summariesDbPath: summariesDbPath || "",
    totalChecked: 0,
    prunedCount: 0,
    errors: [],
    success: false,
  };

  if (!Array.isArray(cids) || cids.length === 0) {
    result.errors.push("Invalid conversation IDs: must not be empty");
    return result;
  }

  const uniqueCids = Array.from(
    new Set(
      cids
        .map((cid) => (typeof cid === "string" ? cid.trim() : ""))
        .filter((cid) => cid.length > 0),
    ),
  );

  if (uniqueCids.length === 0) {
    result.errors.push("Invalid conversation IDs: must not be empty");
    return result;
  }

  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    result.errors.push(`Conversation database not found: ${summariesDbPath}`);
    return result;
  }

  const targetCids: string[] = [];
  for (const cid of uniqueCids) {
    if (
      conversationsDir &&
      fs.existsSync(path.join(conversationsDir, `${cid}.db`))
    ) {
      logger.warn(
        `Skipping intact conversation trajectory from batch clean: ${cid}`,
      );
      continue;
    }
    targetCids.push(cid);
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(summariesDbPath, { fileMustExist: true });
    configureDatabase(db, {
      busyTimeoutMs:
        CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_WRITE,
      readOnly: false,
    });

    const hasTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();

    if (!hasTable) {
      result.errors.push("Table conversation_summaries does not exist.");
      return result;
    }

    result.totalChecked = targetCids.length;

    if (targetCids.length > 0) {
      try {
        createPreCleanRollback(canonicalTarget, targetCids, options);
      } catch (rollbackErr) {
        logger.warn(
          "Pre-clean rollback backup encountered an error",
          rollbackErr,
        );
      }

      const deleteStmt = db.prepare(
        "DELETE FROM conversation_summaries WHERE conversation_id = ?",
      );

      const deleteTransaction = db.transaction((ids: string[]) => {
        let count = 0;
        for (const id of ids) {
          const runResult = deleteStmt.run(id) as
            | Database.RunResult
            | { changes?: number }
            | undefined;
          count += runResult?.changes ?? 0;
        }
        return count;
      });

      const deletedCount = deleteTransaction(targetCids);
      result.prunedCount = deletedCount;

      if (deletedCount > 0) {
        logger.info(
          `Pruned ${deletedCount} invalid chat entries in batch from ${summariesDbPath}`,
        );
        invalidateProtobufMirrors(summariesDbPath);
      }
    }

    result.success = true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to clean conversation summaries: ${errorMsg}`);
    logger.error("Error during batch invalid chat cleanup", error);
  } finally {
    if (db) {
      db.close();
    }
  }

  return result;
}
