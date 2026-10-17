import { ipc } from "@/ipc/manager";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export function getChatBackupStats(
  target?: AntigravityAppTarget,
  staleOnly?: boolean,
) {
  return ipc.client.chatBackup.getStats({ target, staleOnly });
}

export function listChatBackupSnapshots(
  target?: AntigravityAppTarget,
  staleOnly?: boolean,
) {
  return ipc.client.chatBackup.listSnapshots({ target, staleOnly });
}

export function restoreChatBackupSnapshot(
  target: AntigravityAppTarget,
  snapshotId: string,
) {
  return ipc.client.chatBackup.restoreSnapshot({ target, snapshotId });
}

export function restoreSingleChatBackup(
  target: AntigravityAppTarget,
  snapshotId: string,
  cid: string,
) {
  return ipc.client.chatBackup.restoreChat({ target, snapshotId, cid });
}

export function pruneChatBackups(target?: AntigravityAppTarget) {
  return ipc.client.chatBackup.pruneBackups({ target });
}
