import { Loader2 } from "lucide-react";
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

export type HealthConfirmAction =
  | { type: "pruneAll" }
  | { type: "pruneSingle"; cid: string }
  | { type: "restoreFull"; snapshotId: string }
  | { type: "restoreSingle"; snapshotId: string; cid: string };

interface AntigravityChatHealthConfirmDialogProps {
  action: HealthConfirmAction | null;
  onClose: () => void;
  onConfirm: () => void;
  isProcessing: boolean;
}

export function AntigravityChatHealthConfirmDialog({
  action,
  onClose,
  onConfirm,
  isProcessing,
}: AntigravityChatHealthConfirmDialogProps) {
  const { t } = useTranslation();

  if (!action) {
    return null;
  }

  const isPrune = action.type === "pruneAll" || action.type === "pruneSingle";
  const isRestoreFull = action.type === "restoreFull";

  const title = isPrune
    ? t("settings.chatHealth.confirmPruneAllTitle")
    : isRestoreFull
      ? t("settings.chatHealth.confirmRestoreTitle")
      : t("settings.chatHealth.confirmRestoreChatTitle");

  const description = isPrune
    ? t("settings.chatHealth.confirmPruneAllDesc")
    : isRestoreFull
      ? t("settings.chatHealth.confirmRestoreDesc")
      : t("settings.chatHealth.confirmRestoreChatDesc");

  const confirmText = isPrune
    ? t("settings.chatHealth.pruneChat")
    : t("settings.chatHealth.restoreChat");

  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onClose()}>
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
          >
            {isProcessing && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
