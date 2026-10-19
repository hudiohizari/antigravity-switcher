import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import { resolveChatHealthStats } from "./chatHealthResolver";
import { flattenBrokenChats } from "./subagentTree";
import {
  CONVERSATION_CLEANER_CONSTANTS,
  type HealBrokenChatResult,
  type HealAllBrokenChatsResult,
} from "./types";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

// Conversation IDs become file names, so only plain ID characters are allowed.
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const UUID_SCAN_PATTERN = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi;
// Protobuf field 4 (wire type 2) with a 36-byte payload: the trajectory ID.
const TRAJECTORY_ID_TAG = [0x22, 0x24] as const;
const UUID_LENGTH = 36;

const TRAJECTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS trajectory_meta (
    trajectory_id TEXT PRIMARY KEY, cascade_id TEXT, trajectory_type INTEGER, source INTEGER
  );
  CREATE TABLE IF NOT EXISTS steps (
    idx INTEGER PRIMARY KEY,
    step_type INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0,
    has_subtrajectory NUMERIC NOT NULL DEFAULT 0,
    metadata BLOB, error_details BLOB, permissions BLOB, task_details BLOB,
    render_info BLOB, step_payload BLOB,
    step_format INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(status);
  CREATE INDEX IF NOT EXISTS idx_steps_step_type ON steps(step_type);
  CREATE TABLE IF NOT EXISTS gen_metadata (
    idx INTEGER PRIMARY KEY, data BLOB, size INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS executor_metadata (idx INTEGER PRIMARY KEY, data BLOB);
  CREATE TABLE IF NOT EXISTS parent_references (idx INTEGER PRIMARY KEY, data BLOB);
  CREATE TABLE IF NOT EXISTS trajectory_metadata_blob (
    id TEXT PRIMARY KEY DEFAULT 'main', data BLOB
  );
  CREATE TABLE IF NOT EXISTS battle_mode_infos (idx INTEGER PRIMARY KEY, data BLOB);
`;

/**
 * Finds the trajectory ID inside a conversation's raw protobuf summary, first by
 * its field tag, then by scanning for any UUID other than the conversation ID.
 * Falls back to a fresh UUID when none is present.
 */
export function extractTrajectoryId(raw: unknown, cid: string): string {
  if (raw && (Buffer.isBuffer(raw) || raw instanceof Uint8Array)) {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const ownId = cid.toLowerCase();

    for (let i = 0; i <= bytes.length - (UUID_LENGTH + 2); i++) {
      if (bytes[i] !== TRAJECTORY_ID_TAG[0] || bytes[i + 1] !== TRAJECTORY_ID_TAG[1]) {
        continue;
      }
      const candidate = bytes.subarray(i + 2, i + 2 + UUID_LENGTH).toString("ascii");
      if (UUID_PATTERN.test(candidate) && candidate.toLowerCase() !== ownId) {
        return candidate;
      }
    }

    const scanned = bytes.toString("latin1").match(UUID_SCAN_PATTERN) ?? [];
    const other = scanned.find((id) => id.toLowerCase() !== ownId);
    if (other) return other;
  }
  return randomUUID();
}

function removeTrajectoryFiles(trajPath: string): void {
  for (const file of [trajPath, `${trajPath}-wal`, `${trajPath}-shm`]) {
    try {
      fs.rmSync(file, { force: true });
    } catch (err) {
      logger.warn(`Failed to remove partial trajectory file ${file}`, err);
    }
  }
}

/**
 * Creates an empty trajectory database for a conversation whose trajectory file is
 * missing, so Antigravity can open it again. Never touches an existing trajectory:
 * the file is created exclusively, and an existing one is reported as an error.
 */
export function healBrokenChat(
  target?: AntigravityAppTarget | null,
  cid?: string,
  options?: PathResolutionOptions,
): HealBrokenChatResult {
  if (!cid) return { success: false, cid: "", error: "Missing conversation ID" };
  if (!SAFE_CONVERSATION_ID.test(cid)) {
    return { success: false, cid, error: `Invalid conversation ID: ${cid}` };
  }

  const canonical = resolveAntigravityAppTarget(target);
  const dbPath = getAntigravityConversationSummariesDbPath(canonical, options);
  const convDir = getAntigravityConversationsDir(canonical, options);
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { success: false, cid, error: `Summaries db not found: ${dbPath}` };
  }
  if (!convDir) {
    return { success: false, cid, error: "Conversations dir not resolved" };
  }

  const trajPath = path.join(convDir, `${cid}.db`);
  let summariesDb: Database.Database | null = null;
  let trajDb: Database.Database | null = null;
  let createdTrajectory = false;

  try {
    summariesDb = new DatabaseConstructor(dbPath, { fileMustExist: true }) as Database.Database;
    configureDatabase(summariesDb, {
      busyTimeoutMs: CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_READ,
      readOnly: true,
    });
    const row = summariesDb
      .prepare("SELECT raw_summary FROM conversation_summaries WHERE conversation_id = ?")
      .get(cid) as { raw_summary?: Buffer | Uint8Array | null } | undefined;
    if (!row) return { success: false, cid, error: `Conversation not found: ${cid}` };

    fs.mkdirSync(convDir, { recursive: true });
    try {
      fs.closeSync(fs.openSync(trajPath, "wx", 0o600));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return { success: false, cid, error: `Conversation already has a trajectory: ${cid}` };
      }
      throw err;
    }
    createdTrajectory = true;

    const trajectoryId = extractTrajectoryId(row.raw_summary, cid);
    trajDb = new DatabaseConstructor(trajPath) as Database.Database;
    configureDatabase(trajDb, {
      busyTimeoutMs: CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_WRITE,
      readOnly: false,
    });
    trajDb.exec(TRAJECTORY_SCHEMA);
    const insertMeta = trajDb.prepare(
      "INSERT INTO trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) VALUES (?, ?, 0, 0)",
    );
    const insertBlob = trajDb.prepare(
      "INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)",
    );
    trajDb.transaction(() => {
      insertMeta.run(trajectoryId, cid);
      insertBlob.run(Buffer.alloc(0));
    })();

    logger.info(`Healed broken chat trajectory: ${cid}`);
    return { success: true, cid };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to heal broken chat ${cid}`, err);
    if (createdTrajectory) {
      try {
        trajDb?.close();
      } catch (closeErr) {
        logger.warn("Failed to close trajectory db", closeErr);
      }
      trajDb = null;
      removeTrajectoryFiles(trajPath);
    }
    return { success: false, cid, error };
  } finally {
    try {
      summariesDb?.close();
    } catch (err) {
      logger.warn("Failed to close summaries db", err);
    }
    try {
      trajDb?.close();
    } catch (err) {
      logger.warn("Failed to close trajectory db", err);
    }
  }
}

/**
 * Heals every broken chat that has no backup, nested subagents included.
 * Chats with a backup are left for Restore, which recovers their full history.
 */
export function healAllBrokenChats(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): HealAllBrokenChatsResult {
  const stats = resolveChatHealthStats(target, options);
  const errors: string[] = stats.error ? [stats.error] : [];
  const healable = stats.projectGroups
    .flatMap((group) => flattenBrokenChats(group.conversations))
    .filter((chat) => !chat.hasBackup);

  let totalHealed = 0;
  let failedCount = 0;
  for (const chat of healable) {
    const result = healBrokenChat(target, chat.conversationId, options);
    if (result.success) {
      totalHealed++;
    } else {
      failedCount++;
      if (result.error) errors.push(result.error);
    }
  }
  return { totalHealed, failedCount, errors };
}
