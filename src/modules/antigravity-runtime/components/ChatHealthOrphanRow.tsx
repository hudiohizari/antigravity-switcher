import { RotateCcw, Trash2, Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BrokenChatItem } from "@/modules/antigravity-runtime/conversation/types";

interface ChatHealthOrphanRowProps {
  chat: BrokenChatItem;
  projectName?: string;
  onRestore: (snapshotId: string, cid: string) => void;
  onPrune: (cid: string) => void;
  disabled?: boolean;
}

export function ChatHealthOrphanRow({
  chat,
  projectName,
  onRestore,
  onPrune,
  disabled = false,
}: ChatHealthOrphanRowProps) {
  const { t } = useTranslation();

  const maskedId =
    chat.conversationId.length > 8
      ? `${chat.conversationId.slice(0, 8)}...`
      : chat.conversationId;

  return (
    <div
      data-testid={`orphan-row-${chat.conversationId}`}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-md border border-border/40 bg-muted/20 hover:bg-muted/40 transition-colors text-xs"
    >
      <div className="flex flex-col min-w-0 pr-2">
        <div className="flex items-center space-x-2">
          <span
            className="truncate max-w-[220px] sm:max-w-[340px] font-medium text-foreground"
            title={chat.title}
          >
            {chat.title}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
            {maskedId}
          </span>
        </div>
        <div className="flex items-center space-x-2 mt-0.5">
          {projectName && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
              {projectName}
            </span>
          )}
          {chat.hasBackup && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono"
            >
              <Archive className="mr-0.5 h-2.5 w-2.5 inline" />
              Restorable
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0 self-end sm:self-auto">
        {chat.hasBackup && chat.matchingSnapshotId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onRestore(chat.matchingSnapshotId!, chat.conversationId)
            }
            className="h-8 px-2.5 text-xs min-h-[32px] sm:min-h-[32px]"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.chatHealth.restoreChat")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onPrune(chat.conversationId)}
          className="h-8 px-2.5 text-xs min-h-[32px] sm:min-h-[32px] text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-destructive/10"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t("settings.chatHealth.pruneChat")}
        </Button>
      </div>
    </div>
  );
}
