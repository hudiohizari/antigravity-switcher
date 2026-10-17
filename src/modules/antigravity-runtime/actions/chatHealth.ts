import { ipc } from "@/ipc/manager";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export function getChatHealthReport(
  target?: AntigravityAppTarget,
  staleOnly?: boolean,
) {
  return ipc.client.chatHealth.getHealth({ target, staleOnly });
}
