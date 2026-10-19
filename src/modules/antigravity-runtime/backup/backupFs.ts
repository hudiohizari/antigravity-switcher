import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "@/shared/logging/logger";
import type { CanonicalAntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getBackupsDir,
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import type { BackupSnapshotType } from "./types";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

export const getTargetDir = (
  target: CanonicalAntigravityAppTarget,
  opt?: PathResolutionOptions,
) => path.join(getBackupsDir(opt), target);

export interface SnapshotLocation {
  snapshotId: string;
  snapDir: string;
}

export function createSnapshotDir(targetDir: string, type: BackupSnapshotType): SnapshotLocation {
  const snapshotId = `snapshot_${Date.now()}_${type === "pre_clean" ? "clean" : "switch"}`;
  const snapDir = path.join(targetDir, snapshotId);
  fs.mkdirSync(snapDir, { recursive: true });
  return { snapshotId, snapDir };
}

export const copyIfExists = (s: string, d: string) => {
  if (fs.existsSync(s)) {
    fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(s, path.join(d, path.basename(s)));
  }
};

export function getDirSize(p: string): number {
  if (!fs.existsSync(p)) return 0;
  try {
    return fs.readdirSync(p, { withFileTypes: true }).reduce((acc, e) => {
      const full = path.join(p, e.name);
      return (
        acc +
        (e.isDirectory()
          ? getDirSize(full)
          : e.isFile()
            ? fs.statSync(full).size
            : 0)
      );
    }, 0);
  } catch (err) {
    logger.warn(`Failed to read directory size for ${p}`, err);
    return 0;
  }
}

const RECENT_TRAJECTORY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RECENT_TRAJECTORIES = 50;

interface TrajectoryFile {
  name: string;
  mtimeMs: number;
  size: number;
}

function listTrajectoryFiles(convDir: string): TrajectoryFile[] {
  const files: TrajectoryFile[] = [];
  for (const entry of fs.readdirSync(convDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".db")) continue;
    try {
      const stat = fs.statSync(path.join(convDir, entry.name));
      files.push({ name: entry.name, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch (err) {
      logger.warn(`Failed to inspect trajectory file ${entry.name}`, err);
    }
  }
  return files;
}

/**
 * Picks the trajectory files a pre-switch snapshot keeps: the active chat first,
 * then chats changed in the last 14 days, newest first, at most 50 in total.
 * A recent chat that would push the backups past the storage limit is skipped;
 * the active chat is always kept.
 */
export function selectRecentTrajectories(
  convDir: string,
  activeCid?: string,
  storageLimitBytes = 1024 * 1024 * 1024,
  currentSize = 0,
  now = Date.now(),
): string[] {
  const files = listTrajectoryFiles(convDir);
  const activeName = activeCid ? `${activeCid}.db` : undefined;
  const active = files.find((f) => f.name === activeName);
  const recent = files
    .filter((f) => f !== active && now - f.mtimeMs <= RECENT_TRAJECTORY_WINDOW_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const ordered = [...(active ? [active] : []), ...recent].slice(0, MAX_RECENT_TRAJECTORIES);

  const selected: string[] = [];
  let total = currentSize;
  for (const file of ordered) {
    if (file !== active && total + file.size > storageLimitBytes) continue;
    selected.push(file.name);
    total += file.size;
  }
  return selected;
}

/**
 * Copies one trajectory database with SQLite's online backup, which captures
 * changes still in its write-ahead log and yields between pages instead of
 * blocking. Falls back to a plain file copy when SQLite cannot open the file.
 */
async function copyTrajectoryDatabase(source: string, destDir: string): Promise<void> {
  const destination = path.join(destDir, path.basename(source));
  let db: Database.Database | null = null;
  try {
    db = new DatabaseConstructor(source, {
      readonly: true,
      fileMustExist: true,
    }) as Database.Database;
    await db.backup(destination);
  } catch (err) {
    logger.warn(`SQLite backup failed for ${path.basename(source)}, copying the file instead`, err);
    await fs.promises.copyFile(source, destination);
  } finally {
    db?.close();
  }
}

export async function copyRecentTrajectories(
  convDir: string | null | undefined,
  snapConvDir: string,
  activeCid?: string,
  storageLimitBytes?: number,
  currentSize?: number,
): Promise<void> {
  if (!convDir || !fs.existsSync(convDir)) return;
  let names: string[];
  try {
    names = selectRecentTrajectories(convDir, activeCid, storageLimitBytes, currentSize);
  } catch (err) {
    logger.warn("Failed to list trajectory files for backup", err);
    return;
  }
  if (names.length === 0) return;

  await fs.promises.mkdir(snapConvDir, { recursive: true });
  for (const name of names) {
    try {
      await copyTrajectoryDatabase(path.join(convDir, name), snapConvDir);
    } catch (err) {
      logger.warn(`Failed to back up trajectory ${name}`, err);
    }
  }
}
