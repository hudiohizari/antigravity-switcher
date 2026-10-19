import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/shared/ui/utils";
import { DELETED_SESSION_PREFIX } from "@/modules/antigravity-runtime/conversation/subagentTree";

export type HealthConfirmAction =
  | { type: "pruneAll" }
  | { type: "pruneSingle"; cid: string; subagentCount?: number }
  | { type: "restoreFull"; snapshotId: string }
  | { type: "restoreSingle"; snapshotId: string; cid: string }
  | { type: "healSingle"; cid: string }
  | { type: "healAll"; count?: number };

interface AntigravityChatHealthConfirmDialogProps {
  action: HealthConfirmAction | null;
  onClose: () => void;
  onConfirm: () => void;
  isProcessing: boolean;
  brokenCount?: number;
}

export function AntigravityChatHealthConfirmDialog({
  action,
  onClose,
  onConfirm,
  isProcessing,
  brokenCount = 0,
}: AntigravityChatHealthConfirmDialogProps) {
  const { t } = useTranslation();

  if (!action) {
    return null;
  }

  const isHealSingle = action.type === "healSingle";
  const isHealAll = action.type === "healAll";
  const isHeal = isHealSingle || isHealAll;
  const isPruneSingle = action.type === "pruneSingle";
  const isPruneAll = action.type === "pruneAll";
  const isPrune = isPruneSingle || isPruneAll;
  const isRestoreFull = action.type === "restoreFull";
  const isDeletedSessionPrune =
    isPruneSingle && action.cid.startsWith(DELETED_SESSION_PREFIX);
  const prunedSubagentCount =
    action.type === "pruneSingle" ? (action.subagentCount ?? 0) : 0;

  const healAllCount =
    action.type === "healAll" && typeof action.count === "number"
      ? action.count
      : brokenCount;

  const title = isHealSingle
    ? t("settings.chatHealth.healConfirmTitle")
    : isHealAll
      ? t("settings.chatHealth.healAllConfirmTitle")
      : isDeletedSessionPrune
        ? t("settings.chatHealth.pruneDeletedSession")
        : isPruneSingle
          ? t("settings.chatHealth.confirmPruneTitle")
          : isPruneAll
            ? t("settings.chatHealth.confirmPruneAllTitle")
            : isRestoreFull
              ? t("settings.chatHealth.confirmRestoreTitle")
              : t("settings.chatHealth.confirmRestoreChatTitle");

  const description = isHealSingle
    ? t("settings.chatHealth.healConfirmDesc")
    : isHealAll
      ? t("settings.chatHealth.healAllConfirmDesc", { count: healAllCount })
      : isDeletedSessionPrune
        ? t("settings.chatHealth.deletedSessionTooltip")
        : isPruneSingle && prunedSubagentCount > 0
          ? t("settings.chatHealth.confirmPruneWithSubagentsDesc", {
              count: prunedSubagentCount,
            })
          : isPruneSingle
            ? t("settings.chatHealth.confirmPruneDesc")
          : isPruneAll
            ? t("settings.chatHealth.confirmPruneAllDesc")
            : isRestoreFull
              ? t("settings.chatHealth.confirmRestoreDesc")
              : t("settings.chatHealth.confirmRestoreChatDesc");

  const confirmText = isHealSingle
    ? t("settings.chatHealth.heal")
    : isHealAll
      ? t("settings.chatHealth.healAllBroken")
      : isDeletedSessionPrune
        ? t("settings.chatHealth.pruneDeletedSession")
        : isPrune
          ? t("settings.chatHealth.pruneChat")
          : t("settings.chatHealth.restoreChat");

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => !open && !isProcessing && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end space-x-2 pt-2">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isProcessing}
            >
              {t("settings.chatHealth.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={isPrune ? "destructive" : "default"}
            size="sm"
            disabled={isProcessing}
            onClick={onConfirm}
            className={cn(
              isHeal &&
                "bg-teal-600 hover:bg-teal-500 text-white dark:bg-teal-600 dark:hover:bg-teal-500 focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2",
            )}
          >
            {isProcessing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : isHeal ? (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            ) : null}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
