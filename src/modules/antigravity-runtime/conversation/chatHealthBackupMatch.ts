import fs from "fs";
import path from "path";
import {
  type AntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityConversationsDir,
  getBackupsDir,
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import {
  listBackupSnapshots,
  type BackupSnapshot,
  type SnapshotChatItem,
} from "@/modules/antigravity-runtime/backup/chatBackup";
import type { BrokenChatItem } from "./types";

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
