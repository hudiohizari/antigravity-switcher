import { ipc } from "@/ipc/manager";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export function getInvalidChatsStats(target?: AntigravityAppTarget) {
  return ipc.client.conversationCleaner.stats({ target });
}

export function cleanInvalidChats(target?: AntigravityAppTarget) {
  return ipc.client.conversationCleaner.clean({ target });
}

export function cleanSingleInvalidChat(
  target?: AntigravityAppTarget,
  cid?: string,
) {
  return ipc.client.conversationCleaner.cleanSingle({ target, cid: cid || "" });
}

export function cleanBatchInvalidChats(
  target?: AntigravityAppTarget,
  cids: string[] = [],
) {
  return ipc.client.conversationCleaner.cleanBatch({ target, cids });
}
