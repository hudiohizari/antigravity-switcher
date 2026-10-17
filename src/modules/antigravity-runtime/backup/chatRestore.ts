import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { withTimingTrace } from "@/shared/observability/timingTrace";
import {
  type AntigravityAppTarget,
  type CanonicalAntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityAnnotationsDir,
  getAntigravityConversationsDir,
  getAntigravityConversationSummariesDbPath,
  getBackupsDir,
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import { configureDatabase } from "@/shared/persistence/database/dbConnection";
import { CHAT_BACKUP_CONSTANTS, type RestoreResult } from "./types";

import { getTargetDir, copyIfExists } from "./backupFs";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

export function unlinkProtoMirrors(summariesDbPath: string): void {
  const parent = path.dirname(summariesDbPath);
  for (const name of CHAT_BACKUP_CONSTANTS.PROTO_MIRROR_CANDIDATES) {
    const p = path.join(parent, name);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* suppress */
      }
    }
  }
}

async function restoreChats(
  canonical: CanonicalAntigravityAppTarget,
  snapshotId: string,
  cid?: string,
  opt?: PathResolutionOptions,
): Promise<RestoreResult> {
  const snapDir = path.join(getTargetDir(canonical, opt), snapshotId);
  if (!fs.existsSync(snapDir)) {
    return {
      success: false,
      target: canonical,
      restoredChatCount: 0,
      restoredConversationIds: [],
      error: "Snapshot directory not found",
      errors: ["Snapshot directory not found"],
    };
  }

  const convDir = getAntigravityConversationsDir(canonical, opt);
  const annDir = getAntigravityAnnotationsDir(canonical, opt);
  const dbPath = getAntigravityConversationSummariesDbPath(canonical, opt);
  const snapDbPath = path.join(snapDir, "conversation_summaries.db");

  if (!fs.existsSync(snapDbPath)) {
    return {
      success: false,
      target: canonical,
      restoredChatCount: 0,
      restoredConversationIds: [],
      error: "Snapshot database not found",
      errors: ["Snapshot database not found"],
    };
  }
  if (!dbPath) {
    return {
      success: false,
      target: canonical,
      restoredChatCount: 0,
      restoredConversationIds: [],
      error: "Target summaries database path not resolved",
      errors: ["Target summaries database path not resolved"],
    };
  }

  const snapConv = path.join(snapDir, "conversations");
  const snapAnn = path.join(snapDir, "annotations");

  if (fs.existsSync(snapConv) && convDir) {
    const convFiles = cid
      ? [`${cid}.db`]
      : fs.readdirSync(snapConv).filter((x) => x.endsWith(".db"));
    for (const f of convFiles) {
      copyIfExists(path.join(snapConv, f), convDir);
    }
  }

  if (fs.existsSync(snapAnn) && annDir) {
    const annFiles = cid
      ? [`${cid}.pbtxt`]
      : fs.readdirSync(snapAnn).filter((x) => x.endsWith(".pbtxt"));
    for (const f of annFiles) {
      copyIfExists(path.join(snapAnn, f), annDir);
    }
  }

  const restoredIds: string[] = [];
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const liveDb: Database.Database = new DatabaseConstructor(
      dbPath,
    ) as Database.Database;
    configureDatabase(liveDb, {
      busyTimeoutMs: CHAT_BACKUP_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS,
      readOnly: false,
    });
    const snapDb: Database.Database = new DatabaseConstructor(snapDbPath, {
      readonly: true,
      fileMustExist: true,
    }) as Database.Database;
    configureDatabase(snapDb, {
      busyTimeoutMs: CHAT_BACKUP_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS,
      readOnly: true,
    });

    try {
      const tableExists = liveDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
        )
        .get();
      if (!tableExists) {
        const schema = snapDb
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
          )
          .get() as { sql: string } | undefined;
        if (schema?.sql) {
          liveDb.exec(
            schema.sql.replace(
              /^CREATE TABLE\b/i,
              "CREATE TABLE IF NOT EXISTS",
            ),
          );
        }
      }

      const snapCols = (
        snapDb.pragma("table_info(conversation_summaries)") as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      const liveCols = new Set(
        (
          liveDb.pragma("table_info(conversation_summaries)") as Array<{
            name: string;
          }>
        ).map((c) => c.name),
      );
      const cols = snapCols.filter((c) => liveCols.has(c));
      if (cols.length === 0) {
        return {
          success: false,
          target: canonical,
          restoredChatCount: 0,
          restoredConversationIds: [],
          error: "No matching columns found in conversation_summaries",
          errors: ["No matching columns found in conversation_summaries"],
        };
      }

      const colList = cols.join(", ");
      const placeholders = cols.map(() => "?").join(", ");
      const insert = liveDb.prepare(
        `INSERT OR REPLACE INTO conversation_summaries (${colList}) VALUES (${placeholders})`,
      );
      const query = `SELECT ${colList} FROM conversation_summaries${cid ? " WHERE conversation_id = ?" : ""}`;
      const rows = (
        cid ? snapDb.prepare(query).all(cid) : snapDb.prepare(query).all()
      ) as Array<Record<string, unknown>>;

      liveDb.transaction((records: Array<Record<string, unknown>>) => {
        for (const r of records) {
          insert.run(...cols.map((c) => r[c]));
          if (r.conversation_id) restoredIds.push(String(r.conversation_id));
        }
      })(rows);
    } finally {
      snapDb.close();
      liveDb.close();
    }
    unlinkProtoMirrors(dbPath);
  } catch (err) {
    const msg = String(err);
    return {
      success: false,
      target: canonical,
      restoredChatCount: 0,
      restoredConversationIds: [],
      error: msg,
      errors: [msg],
    };
  }

  return {
    success: true,
    target: canonical,
    restoredChatCount: restoredIds.length,
    restoredConversationIds: restoredIds,
  };
}

export async function restoreSnapshot(
  target?: AntigravityAppTarget | null,
  snapshotId?: string,
  opt?: PathResolutionOptions,
): Promise<RestoreResult> {
  const canonical = resolveAntigravityAppTarget(target);
  if (!snapshotId) {
    return {
      success: false,
      target: canonical,
      restoredChatCount: 0,
      restoredConversationIds: [],
      error: "Missing snapshot ID",
      errors: ["Missing snapshot ID"],
    };
  }
  return withTimingTrace(
    "backup.restore",
    { target: canonical, snapshotId, mode: "full" },
    () => restoreChats(canonical, snapshotId, undefined, opt),
  );
}

export async function restoreSingleChat(
  target?: AntigravityAppTarget | null,
  snapshotId?: string,
  cid?: string,
  opt?: PathResolutionOptions,
): Promise<RestoreResult> {
  const canonical = resolveAntigravityAppTarget(target);
  if (!snapshotId || !cid) {
    return {
      success: false,
      target: canonical,
      restoredChatCount: 0,
      restoredConversationIds: [],
      error: "Missing snapshot ID or conversation ID",
      errors: ["Missing snapshot ID or conversation ID"],
    };
  }
  return withTimingTrace(
    "backup.restore",
    { target: canonical, snapshotId, cid, mode: "single" },
    () => restoreChats(canonical, snapshotId, cid, opt),
  );
}
