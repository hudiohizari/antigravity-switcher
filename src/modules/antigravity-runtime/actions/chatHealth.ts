import { ipc } from "@/ipc/manager";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export function getChatHealthReport(
  target?: AntigravityAppTarget,
  staleOnly?: boolean,
) {
  return ipc.client.chatHealth.getHealth({ target, staleOnly });
}

export function healBrokenChat(
  target?: AntigravityAppTarget,
  cid?: string,
) {
  return ipc.client.chatHealth.healBrokenChat({ target, cid: cid || "" });
}

export function healAllBrokenChats(target?: AntigravityAppTarget) {
  return ipc.client.chatHealth.healAllBrokenChats({ target });
}
