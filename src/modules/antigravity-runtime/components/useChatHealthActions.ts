import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/components/ui/use-toast";
import { logger } from "@/shared/logging/logger";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import type { BrokenProjectGroup } from "@/modules/antigravity-runtime/conversation/types";
import {
  cleanInvalidChats,
  cleanSingleInvalidChat,
  cleanBatchInvalidChats,
} from "@/modules/antigravity-runtime/actions/conversationCleaner";
import {
  restoreChatBackupSnapshot,
  restoreSingleChatBackup,
  pruneChatBackups,
} from "@/modules/antigravity-runtime/actions/chatBackup";
import {
  healBrokenChat,
  healAllBrokenChats,
} from "@/modules/antigravity-runtime/actions/chatHealth";
import {
  collectDescendantCids,
  DELETED_SESSION_PREFIX,
} from "@/modules/antigravity-runtime/conversation/subagentTree";
import type { HealthConfirmAction } from "./AntigravityChatHealthConfirmDialog";

interface UseChatHealthActionsOptions {
  target: AntigravityAppTarget;
  projectGroups: BrokenProjectGroup[] | undefined;
  reload: () => Promise<void>;
}

/**
 * Runs the confirmed chat health actions (heal, prune, restore) and reports each
 * outcome with a toast. Pruning a chat also prunes its broken subagents.
 */
export function useChatHealthActions({
  target,
  projectGroups,
  reload,
}: UseChatHealthActionsOptions) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<HealthConfirmAction | null>(null);

  const notify = (description: string) =>
    toast({ title: t("settings.chatHealth.title"), description });

  const notifyError = (err: unknown) => {
    logger.error("Chat health action failed", err);
    toast({
      title: t("settings.chatHealth.errorTitle"),
      description: t("settings.chatHealth.errorDesc"),
      variant: "destructive",
    });
  };

  const requestPrune = (cid: string) => {
    const subagentCount = cid.startsWith(DELETED_SESSION_PREFIX)
      ? 0
      : collectDescendantCids(projectGroups, cid).length;
    setConfirmAction({ type: "pruneSingle", cid, subagentCount });
  };

  const prune = async (cid: string) => {
    const descendants = collectDescendantCids(projectGroups, cid);
    if (cid.startsWith(DELETED_SESSION_PREFIX) || descendants.length > 0) {
      const cids = cid.startsWith(DELETED_SESSION_PREFIX)
        ? descendants
        : [cid, ...descendants];
      const res = await cleanBatchInvalidChats(target, cids);
      if (res.errors.length > 0) throw new Error(res.errors[0]);
      notify(t("settings.chatHealth.pruneChatsSuccess", { count: res.prunedCount }));
      return;
    }
    const res = await cleanSingleInvalidChat(target, cid);
    if (!res.success) throw new Error(res.errors[0] ?? `Failed to prune ${cid}`);
    notify(t("settings.chatHealth.pruneSingleSuccess"));
  };

  const healAll = async () => {
    const res = await healAllBrokenChats(target);
    if (res.failedCount > 0 && res.totalHealed === 0) {
      throw new Error(res.errors[0] ?? "Failed to heal broken chats");
    }
    notify(
      res.failedCount > 0
        ? t("settings.chatHealth.healPartial", {
            healed: res.totalHealed,
            failed: res.failedCount,
          })
        : t("settings.chatHealth.healSuccess", { count: res.totalHealed }),
    );
  };

  const run = async (action: HealthConfirmAction) => {
    switch (action.type) {
      case "healSingle": {
        const res = await healBrokenChat(target, action.cid);
        if (!res.success) throw new Error(res.error ?? "Failed to heal chat");
        notify(t("settings.chatHealth.healSuccess", { count: 1 }));
        return;
      }
      case "healAll":
        return healAll();
      case "pruneSingle":
        return prune(action.cid);
      case "pruneAll": {
        const res = await cleanInvalidChats(target);
        if (res.errors.length > 0) throw new Error(res.errors[0]);
        notify(t("settings.chatHealth.pruneChatsSuccess", { count: res.prunedCount }));
        return;
      }
      case "restoreFull":
        await restoreChatBackupSnapshot(target, action.snapshotId);
        notify(t("settings.chatHealth.restoreSuccess"));
        return;
      case "restoreSingle":
        await restoreSingleChatBackup(target, action.snapshotId, action.cid);
        notify(t("settings.chatHealth.restoreSuccess"));
        return;
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    setIsProcessing(true);
    try {
      await run(confirmAction);
      setConfirmAction(null);
      await reload();
    } catch (err) {
      notifyError(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePruneBackups = async () => {
    setIsProcessing(true);
    try {
      const res = await pruneChatBackups(target);
      notify(t("settings.chatHealth.pruneSuccess", { count: res.prunedCount ?? 0 }));
      await reload();
    } catch (err) {
      notifyError(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    confirmAction,
    setConfirmAction,
    isProcessing,
    requestPrune,
    handleConfirmAction,
    handlePruneBackups,
  };
}
