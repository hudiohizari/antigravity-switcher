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
import { getActiveConversationsFromSummaries } from "@/modules/chat-resume/activeTurnDetector";
import { parseWorkspaceInfo } from "@/modules/antigravity-runtime/conversation/workspaceInfo";
import { resolveConversationTitle } from "@/modules/antigravity-runtime/conversation/conversationTitles";
import {
  CHAT_BACKUP_CONSTANTS,
  type BackupSnapshot,
  type BackupSnapshotType,
  type BackupStats,
  type ListBackupSnapshotsOptions,
  type PruneResult,
  type SnapshotChatItem,
} from "./types";

import { getTargetDir, copyIfExists, getDirSize } from "./backupFs";

export * from "./types";
export * from "./chatRestore";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

export function listBackupSnapshots(
  target?: AntigravityAppTarget | null,
  opt?: ListBackupSnapshotsOptions,
): BackupSnapshot[] {
  const canonical = resolveAntigravityAppTarget(target);
  const targetDir = getTargetDir(canonical, opt);
  if (!fs.existsSync(targetDir)) return [];
  const list: BackupSnapshot[] = [];
  try {
    for (const ent of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const mPath = path.join(targetDir, ent.name, "manifest.json");
      if (fs.existsSync(mPath)) {
        list.push(JSON.parse(fs.readFileSync(mPath, "utf-8")));
      }
    }
  } catch {
    /* suppress */
  }
  list.sort((a, b) => b.createdAt - a.createdAt);

  if (opt?.staleOnly) {
    const convDir = getAntigravityConversationsDir(canonical, opt);
    let liveCids = new Set<string>();
    if (convDir && fs.existsSync(convDir)) {
      try {
        liveCids = new Set(
          fs
            .readdirSync(convDir)
            .filter((x) => x.endsWith(".db"))
            .map((x) => x.slice(0, -3)),
        );
      } catch {
        /* suppress */
      }
    }
    return list.map((snap) => {
      const filtered = snap.chats.filter(
        (c) => c.hasTrajectoryDb && !liveCids.has(c.conversationId),
      );
      return {
        ...snap,
        chatCount: filtered.length,
        chats: filtered,
      };
    });
  }

  return list;
}

export function getBackupStats(
  target?: AntigravityAppTarget | null,
  opt?: ListBackupSnapshotsOptions,
): BackupStats {
  const canonical = resolveAntigravityAppTarget(target);
  const snapshots = listBackupSnapshots(canonical, opt);
  const totalSizeBytes = getDirSize(getBackupsDir(opt));
  const targetSizeBytes = getDirSize(getTargetDir(canonical, opt));
  return {
    target: canonical,
    totalSizeBytes,
    targetSizeBytes,
    snapshotCount: snapshots.length,
    exceedsStorageLimit:
      totalSizeBytes > CHAT_BACKUP_CONSTANTS.STORAGE_LIMIT_BYTES,
    snapshots,
  };
}

function writeSnapshot(
  canonical: CanonicalAntigravityAppTarget,
  type: BackupSnapshotType,
  protectedFromPruning: boolean,
  summariesDbPath: string,
  opt?: PathResolutionOptions,
  activeCid?: string,
  filterCids?: string[],
): BackupSnapshot {
  const snapshotId = `snapshot_${Date.now()}_${type === "pre_clean" ? "clean" : "switch"}`;
  const snapDir = path.join(getTargetDir(canonical, opt), snapshotId);
  fs.mkdirSync(snapDir, { recursive: true });
  fs.copyFileSync(
    summariesDbPath,
    path.join(snapDir, "conversation_summaries.db"),
  );

  const convDir = getAntigravityConversationsDir(canonical, opt);
  const annDir = getAntigravityAnnotationsDir(canonical, opt);
  if (activeCid) {
    if (convDir) {
      copyIfExists(
        path.join(convDir, `${activeCid}.db`),
        path.join(snapDir, "conversations"),
      );
    }
    if (annDir) {
      copyIfExists(
        path.join(annDir, `${activeCid}.pbtxt`),
        path.join(snapDir, "annotations"),
      );
    }
  }

  const chats: SnapshotChatItem[] = [];
  try {
    const db: Database.Database = new DatabaseConstructor(
      path.join(snapDir, "conversation_summaries.db"),
      { readonly: true, fileMustExist: true },
    ) as Database.Database;
    configureDatabase(db, {
      busyTimeoutMs: CHAT_BACKUP_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS,
      readOnly: true,
    });
    try {
      let rows: Array<Record<string, unknown>> = [];
      try {
        const query = filterCids?.length
          ? `SELECT conversation_id, title, last_modified_time, parent_conversation_id, nesting_depth, agent_name, preview, workspace_uris FROM conversation_summaries WHERE conversation_id IN (${filterCids.map(() => "?").join(",")})`
          : "SELECT conversation_id, title, last_modified_time, parent_conversation_id, nesting_depth, agent_name, preview, workspace_uris FROM conversation_summaries";
        rows = (
          filterCids?.length ? db.prepare(query).all(...filterCids) : db.prepare(query).all()
        ) as Array<Record<string, unknown>>;
      } catch {
        const fallbackQuery = filterCids?.length
          ? `SELECT conversation_id, title, last_modified_time, workspace_uris FROM conversation_summaries WHERE conversation_id IN (${filterCids.map(() => "?").join(",")})`
          : "SELECT conversation_id, title, last_modified_time, workspace_uris FROM conversation_summaries";
        rows = (
          filterCids?.length ? db.prepare(fallbackQuery).all(...filterCids) : db.prepare(fallbackQuery).all()
        ) as Array<Record<string, unknown>>;
      }

      const parentMap = new Map<string, string>();
      const titleMap = new Map<string, string>();
      for (const r of rows) {
        const cid = String(r.conversation_id);
        if (typeof r.parent_conversation_id === "string") {
          parentMap.set(cid, r.parent_conversation_id);
        }
        if (typeof r.title === "string") {
          titleMap.set(cid, r.title);
        }
      }

      for (const r of rows) {
        const cid = String(r.conversation_id);
        const { projectName } = parseWorkspaceInfo(r.workspace_uris);
        const title = resolveConversationTitle(
          {
            conversation_id: cid,
            title: typeof r.title === "string" ? r.title : null,
            parent_conversation_id:
              typeof r.parent_conversation_id === "string"
                ? r.parent_conversation_id
                : null,
            nesting_depth:
              typeof r.nesting_depth === "number" ? r.nesting_depth : null,
            agent_name: typeof r.agent_name === "string" ? r.agent_name : null,
            preview: typeof r.preview === "string" ? r.preview : null,
          },
          parentMap,
          titleMap,
          projectName,
        );
        chats.push({
          conversationId: cid,
          title,
          updatedAt:
            typeof r.last_modified_time === "number"
              ? r.last_modified_time
              : undefined,
          hasTrajectoryDb: fs.existsSync(
            path.join(snapDir, "conversations", `${cid}.db`),
          ),
        });
      }
    } finally {
      db.close();
    }
  } catch {
    /* suppress */
  }

  const snap: BackupSnapshot = {
    id: snapshotId,
    target: canonical,
    type,
    createdAt: Date.now(),
    sizeBytes: getDirSize(snapDir),
    chatCount: chats.length,
    protectedFromPruning,
    activeConversationId: activeCid,
    chats,
  };
  fs.writeFileSync(
    path.join(snapDir, "manifest.json"),
    JSON.stringify(snap, null, 2),
    "utf-8",
  );
  return snap;
}

export async function createPreSwitchBackup(
  target?: AntigravityAppTarget | null,
  activeCid?: string,
  opt?: PathResolutionOptions,
): Promise<BackupSnapshot | null> {
  const canonical = resolveAntigravityAppTarget(target);
  const dbPath = getAntigravityConversationSummariesDbPath(canonical, opt);
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  return withTimingTrace(
    "backup.create",
    { target: canonical, type: "pre_switch" },
    async () => {
      let effectiveCid = activeCid;
      if (!effectiveCid) {
        const active = getActiveConversationsFromSummaries(canonical);
        if (active && active.size > 0) {
          effectiveCid = active.keys().next().value;
        }
      }
      if (!effectiveCid) {
        try {
          const db: Database.Database = new DatabaseConstructor(dbPath, {
            readonly: true,
            fileMustExist: true,
          }) as Database.Database;
          configureDatabase(db, {
            busyTimeoutMs: CHAT_BACKUP_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS,
            readOnly: true,
          });
          try {
            const row = db
              .prepare(
                "SELECT conversation_id FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 1",
              )
              .get() as { conversation_id?: string } | undefined;
            if (row?.conversation_id) effectiveCid = row.conversation_id;
          } finally {
            db.close();
          }
        } catch {
          /* suppress */
        }
      }
      const snap = writeSnapshot(
        canonical,
        "pre_switch",
        false,
        dbPath,
        opt,
        effectiveCid,
      );
      enforcePreSwitchFifo(canonical, opt);
      return snap;
    },
  );
}

export function enforcePreSwitchFifo(
  canonical: CanonicalAntigravityAppTarget,
  opt?: PathResolutionOptions,
): void {
  try {
    const snapshots = listBackupSnapshots(canonical, opt);
    const preSwitchSnaps = snapshots.filter(
      (s) => s.type === "pre_switch" && !s.protectedFromPruning,
    );
    if (preSwitchSnaps.length > 5) {
      const toPrune = preSwitchSnaps.slice(5);
      const targetDir = getTargetDir(canonical, opt);
      for (const snap of toPrune) {
        try {
          fs.rmSync(path.join(targetDir, snap.id), {
            recursive: true,
            force: true,
          });
        } catch {
          /* suppress */
        }
      }
    }
  } catch {
    /* suppress */
  }
}

export function createPreCleanRollback(
  target?: AntigravityAppTarget | null,
  invalidCids: string[] = [],
  opt?: PathResolutionOptions,
): BackupSnapshot | null {
  const canonical = resolveAntigravityAppTarget(target);
  const dbPath = getAntigravityConversationSummariesDbPath(canonical, opt);
  if (!dbPath || !fs.existsSync(dbPath) || invalidCids.length === 0) {
    return null;
  }
  return writeSnapshot(
    canonical,
    "pre_clean",
    true,
    dbPath,
    opt,
    undefined,
    invalidCids,
  );
}

export function pruneBackups(
  target?: AntigravityAppTarget | null,
  opt?: PathResolutionOptions,
): PruneResult {
  const canonical = resolveAntigravityAppTarget(target);
  const snapshots = listBackupSnapshots(canonical, opt);
  const unprotected = snapshots.filter((s) => !s.protectedFromPruning);
  let prunedCount = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  if (unprotected.length > 1) {
    for (const snap of unprotected.slice(1)) {
      try {
        fs.rmSync(path.join(getTargetDir(canonical, opt), snap.id), {
          recursive: true,
          force: true,
        });
        prunedCount++;
        freedBytes += snap.sizeBytes || 0;
      } catch (err) {
        errors.push(String(err));
      }
    }
  }
  const remaining = listBackupSnapshots(canonical, opt);
  return {
    target: canonical,
    prunedCount,
    freedBytes,
    remainingCount: remaining.length,
    remainingSizeBytes: remaining.reduce(
      (acc, s) => acc + (s.sizeBytes || 0),
      0,
    ),
    errors,
  };
}
